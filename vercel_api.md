# Connecting Chess Masti to Neo4j Through Vercel API Routes

Chess Masti stores user data in Firestore and runs on Vercel as a Next.js application. Adding Neo4j as a second data source for graph-powered features (adaptive puzzles, opening traversals, weakness analysis) requires a different connection strategy than the one Firestore uses. This document explains why, walks through how Vercel's serverless API routes solve the problem, and provides a phased integration plan that keeps the architecture simple and the data consistent.

## Why Neo4j Cannot Be Queried from the Browser

Chess Masti's Firestore integration works directly from client-side React code. The `firebase.ts` module initializes a Firestore client in the browser, and service modules like `firestoreGames.ts` call `getDocs`, `addDoc`, and `updateDoc` against it. This is safe because Firebase was designed for browser access: the API key visible in the page source only identifies the project, while **Firebase Security Rules** running on Google's servers enforce who can read or write each document. The credentials in the browser are not secrets.

Neo4j has no equivalent. A Neo4j connection requires a URI, username, and password that grant full access to the database. Anyone who can read those credentials can run arbitrary Cypher: read every node, delete relationships, drop constraints. Embedding them in client-side JavaScript (even through environment variables prefixed with `NEXT_PUBLIC_`) exposes them in the browser's network tab and bundled source. There is no server-side rule layer between the browser and the database to limit what those credentials can do.

The solution is to keep Neo4j credentials on the server and expose graph data through API endpoints that the browser calls over HTTP. The browser never sees the credentials; it only sees the query results.

## How Vercel API Routes Keep Secrets Server-Side

Chess Masti already uses this pattern. The `src/app/api/` directory contains route handlers for chess puzzles, the scout feature, chat, and several other endpoints. Each is a `route.ts` file that exports HTTP method handlers (`GET`, `POST`) and runs as a **serverless function** on Vercel, not in the browser.

The execution model works like this:

1. The React client calls `fetch('/api/scout', { method: 'POST', body: ... })`.
2. Vercel receives the request and spins up a serverless function instance.
3. The function runs `src/app/api/scout/route.ts`, which can access server-only environment variables, make backend API calls, and return a `NextResponse`.
4. The response travels back to the browser. The function instance may stay warm for subsequent requests or shut down after a period of inactivity.

Environment variables configured in the Vercel dashboard (without the `NEXT_PUBLIC_` prefix) are available only inside these serverless functions. The browser cannot read them. This is where Neo4j credentials belong: set `NEO4J_URI`, `NEO4J_USER`, and `NEO4J_PASSWORD` in Vercel's environment settings, and only API route handlers can access them through `process.env`.

## Phase 1: Validate the Pattern with a Test Route

Before wiring up Neo4j, confirm that a new API route works end-to-end in the existing Chess Masti setup. This isolates deployment and configuration issues from database integration issues.

**Create the route handler.** Add a file at `src/app/api/graph/health/route.ts`:

```typescript
import { NextResponse } from "next/server";

export async function GET() {
  // Confirm server-only env vars are accessible
  const neo4jUri = process.env.NEO4J_URI;

  return NextResponse.json({
    status: "ok",
    neo4jConfigured: !!neo4jUri,
    timestamp: new Date().toISOString(),
  });
}
```

**Add the environment variables.** In the Vercel dashboard under Settings > Environment Variables, add `NEO4J_URI`, `NEO4J_USER`, and `NEO4J_PASSWORD` with the values from your Neo4j Aura instance. Do not prefix them with `NEXT_PUBLIC_`. For local development, add them to a `.env.local` file (which is already in `.gitignore`).

**Call it from the client.** From any React component or hook:

```typescript
const res = await fetch("/api/graph/health");
const data = await res.json();
// data.neo4jConfigured should be true
```

Deploy and verify that `neo4jConfigured` returns `true` in production and that the Neo4j credentials do not appear in the browser's network response or page source.

## Phase 2: Add Read-Only Neo4j Route Handlers

With the pattern validated, install the Neo4j JavaScript driver and create route handlers that query the graph.

**Install the driver:**

```bash
npm install neo4j-driver
```

**Create a shared driver module.** Serverless functions can be reused across requests when Vercel keeps them warm. Initializing the driver at module scope lets warm invocations reuse the existing connection instead of opening a new one on every request.

Add `src/lib/neo4j.ts`:

```typescript
import neo4j, { Driver } from "neo4j-driver";

let driver: Driver | null = null;

export function getDriver(): Driver {
  if (!driver) {
    const uri = process.env.NEO4J_URI;
    const user = process.env.NEO4J_USER;
    const password = process.env.NEO4J_PASSWORD;

    if (!uri || !user || !password) {
      throw new Error(
        "Neo4j environment variables (NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD) are not configured"
      );
    }

    driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  }

  return driver;
}
```

Caching the driver in a module-level variable is the standard approach for serverless Neo4j connections. When the function instance stays warm between requests, subsequent calls reuse the same driver and its connection pool. When the instance shuts down, the driver is garbage-collected and the connection closes. Neo4j Aura Free Tier supports enough concurrent connections for this pattern at typical application traffic levels.

**Create a route handler.** For example, a route that returns puzzle recommendations for a user's weak themes at `src/app/api/graph/puzzles/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getDriver } from "@/lib/neo4j";

export async function GET(req: NextRequest) {
  const username = req.nextUrl.searchParams.get("username");

  if (!username) {
    return NextResponse.json(
      { error: "username parameter is required" },
      { status: 400 }
    );
  }

  const driver = getDriver();
  const session = driver.session({ defaultAccessMode: "READ" });

  try {
    const result = await session.run(
      `MATCH (u:User {username: $username})-[:STRUGGLED_WITH]->(t:Theme)
       <-[:HAS_THEME]-(p:Puzzle)
       WHERE NOT (u)-[:SOLVED]->(p)
       RETURN p.puzzleId AS puzzleId, p.rating AS rating,
              collect(t.name) AS themes
       ORDER BY p.rating
       LIMIT 10`,
      { username }
    );

    const puzzles = result.records.map((record) => ({
      puzzleId: record.get("puzzleId"),
      rating: record.get("rating"),
      themes: record.get("themes"),
    }));

    return NextResponse.json({ puzzles });
  } finally {
    await session.close();
  }
}
```

Two details worth noting. The session is opened with `defaultAccessMode: "READ"`, which tells the driver this session will only run read queries. Always close the session in a `finally` block so connections return to the pool even when a query fails.

**Call it from the client using React Query.** Chess Masti already uses `@tanstack/react-query` for data fetching, so graph queries fit the existing pattern:

```typescript
import { useQuery } from "@tanstack/react-query";

function useGraphPuzzles(username: string | undefined) {
  return useQuery({
    queryKey: ["graph-puzzles", username],
    queryFn: async () => {
      const res = await fetch(
        `/api/graph/puzzles?username=${encodeURIComponent(username!)}`
      );
      if (!res.ok) throw new Error("Failed to fetch puzzles");
      return res.json();
    },
    enabled: !!username,
  });
}
```

## Phase 3: Keep All Writes in the Python Pipeline

The data loading pipeline (`chess-graph/data_loading/`) is the single writer to Neo4j. It loads openings, puzzles, games, and seed users through the Python `neo4j` driver. Chess Masti's API routes should only read from the graph.

This separation exists for a practical reason: the graph data comes from external sources (Lichess, the ECO dataset, bundled puzzles) that require parsing, deduplication, and position merging before they become nodes and relationships. That transformation logic lives in the Python pipeline and does not need to be duplicated in TypeScript. When the graph needs updated data, rerun the pipeline. When Chess Masti needs to display graph data, query it through the read-only API routes.

If a future feature requires the web application to write to Neo4j (recording that a user solved a puzzle, for example), add a dedicated `POST` route handler that performs only that specific write, with the same server-side credential pattern. Avoid giving the web application broad write access or replicating the pipeline's bulk loading logic.
