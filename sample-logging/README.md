# Structured Logging Sample for chess-coach-ai

This directory contains a working example of how structured logging could replace the current `console.log` / `console.warn` / `console.error` calls throughout the chess-coach-ai codebase. Every file here is self-contained TypeScript that could be dropped into `chess-coach-ai/src/lib/`.

## Why structured logging?

chess-coach-ai currently has **272 console output calls across 64 files**. They look like this:

```typescript
console.log("Feedback API called");
console.log("Request data:", { username, platform, maxGames });
console.log(`📦 Cache HIT for key: ${cacheKey.slice(0, 50)}... (hits: ${entry.hitCount})`);
console.error("Error generating feedback:", error);
```

This works in development but creates real problems in production:

**No way to filter by severity.** Every `console.log` and `console.error` appears in the same stream. There's no way to say "show me only errors" or "suppress debug noise in production" without changing code.

**No request correlation.** When two users hit `/api/enhanced-analysis` simultaneously, their log lines interleave. There's no way to trace which lines belong to which request. Debugging a single user's issue means reading every log line and guessing.

**No structured fields.** Context is embedded in template literal strings: `` `📦 Cache HIT for key: ${cacheKey}... (hits: ${entry.hitCount})` ``. Vercel's log viewer and Sentry can't parse emoji prefixes or extract `hitCount` from a string. You can't filter logs by `cacheKey` or aggregate `hitCount` across requests.

**No timestamps.** The console calls don't include timestamps. Vercel adds its own, but they reflect when Vercel received the output — not when the event happened in your code. For timing-sensitive debugging (e.g., "how long did the OpenAI call take?"), you need precise application-level timestamps.

**Sentry sees errors in isolation.** The current `logErrorToSentry()` sends the exception to Sentry, but Sentry has no context about what happened *before* the error. With structured logging, every info/warn log becomes a Sentry breadcrumb — when an error fires, the Sentry UI shows the full trail of events leading up to it.

## What structured logging gives you

The same log entries, with context as structured JSON fields:

```json
{"timestamp":"2026-03-28T12:00:00.000Z","level":"info","message":"Feedback API called","module":"feedback","route":"/api/feedback","username":"magnus","platform":"lichess","maxGames":25,"requestId":"lax1::iad1::8f3a2b"}
{"timestamp":"2026-03-28T12:00:02.150Z","level":"info","message":"Feedback generation completed","module":"feedback","route":"/api/feedback","username":"magnus","platform":"lichess","durationMs":2150,"requestId":"lax1::iad1::8f3a2b"}
```

Now you can:
- **Filter by level**: show only `warn` + `error` in production, `debug` in development
- **Correlate by request**: filter by `requestId` to see every log from a single request
- **Search by field**: find all cache misses for a specific FEN, or all requests from a specific user
- **Aggregate**: cache hit rate, average response time, error rate — all queryable
- **Trace through Sentry**: errors show the breadcrumb trail of structured events

## How it works

### Architecture

```
request-context.ts     AsyncLocalStorage for request ID propagation
       ↓
    logger.ts          Core structured logger (reads request ID automatically)
       ↓
sentry-integration.ts  Bridges logger → Sentry breadcrumbs + captureException
```

### 1. Request Context (`request-context.ts`)

Uses Node.js `AsyncLocalStorage` to flow a request ID through the entire call chain without parameter threading:

```typescript
// In an API route — wraps the handler to establish context
export async function POST(request: NextRequest) {
  return withRequestContext(request, "/api/feedback", async () => {
    // Everything inside here (including called modules) can access
    // the request ID via getRequestId() — no need to pass it around
  });
}
```

The request ID comes from Vercel's `x-vercel-id` header (automatically provided on every request) or falls back to `crypto.randomUUID()` for local development.

### 2. Logger (`logger.ts`)

Zero-dependency structured logger with four log levels:

```typescript
import { createLogger } from "@/lib/logger";

const log = createLogger({ module: "cache" });

log.debug("TTL check passed", { ageMs, ttlMs });         // Development only
log.info("Cache hit", { cacheKey, hitCount });             // Standard operations
log.warn("Cache cleared", { previousSize });               // Significant events
log.error("Cache corruption", { key, error: err.message }); // Errors
```

**Log level filtering** is controlled by the `LOG_LEVEL` environment variable. Default: `debug` in development, `info` in production.

**Output format** adapts to the environment:
- **Production**: minified JSON lines (one per entry) — what Vercel Log Drain and Sentry expect
- **Development**: colored, human-readable lines with timestamps

**Child loggers** inherit parent context and add their own:

```typescript
const routeLog = log.child({ route: "/api/feedback" });
routeLog.info("Request received");
// Output includes both module: "cache" AND route: "/api/feedback"
```

### 3. Sentry Integration (`sentry-integration.ts`)

Drop-in replacement for the existing `src/lib/sentry.ts` with the same API:

```typescript
// Backward-compatible — same function signature
logErrorToSentry(error, { route: "/api/feedback" });

// New: logger with Sentry breadcrumb bridge
const log = createSentryLogger({ module: "feedback" });
log.info("Starting generation");  // → Sentry breadcrumb
log.error("Generation failed");   // → Sentry breadcrumb + captureException
```

## Development vs. Production Output

**Development** (pretty-printed with ANSI colors):

```
12:00:00.000 INFO  [feedback] Feedback API called {"username":"magnus","platform":"lichess","maxGames":25} req=lax1::iad1::8f
12:00:00.050 DEBUG [cache] TTL check passed {"ageMs":120000,"ttlMs":86400000} req=lax1::iad1::8f
12:00:00.051 INFO  [cache] Cache hit {"cacheKey":"rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKB","hitCount":3} req=lax1::iad1::8f
12:00:02.150 INFO  [feedback] Feedback generation completed {"username":"magnus","durationMs":2150} req=lax1::iad1::8f
```

**Production** (JSON lines for Vercel):

```json
{"timestamp":"2026-03-28T12:00:00.000Z","level":"info","message":"Feedback API called","module":"feedback","username":"magnus","platform":"lichess","maxGames":25,"requestId":"lax1::iad1::8f3a2b"}
{"timestamp":"2026-03-28T12:00:00.051Z","level":"info","message":"Cache hit","module":"cache","cacheKey":"rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKB","hitCount":3,"requestId":"lax1::iad1::8f3a2b"}
{"timestamp":"2026-03-28T12:00:02.150Z","level":"info","message":"Feedback generation completed","module":"feedback","username":"magnus","durationMs":2150,"requestId":"lax1::iad1::8f3a2b"}
```

Note: `debug` entries are suppressed in production by default (LOG_LEVEL=info).

## Migration Pattern Reference

| Current pattern | Structured replacement |
|---|---|
| `console.log("message")` | `log.info("message")` |
| `console.log("message:", data)` | `log.info("message", data)` |
| `console.log(\`📦 Cache HIT: ${key}\`)` | `log.info("Cache hit", { cacheKey: key })` |
| `console.warn(\`[Module] warning\`)` | `log.warn("warning")` (module in child context) |
| `console.error("Error:", error)` | `log.error("message", { error: err.message, stack: err.stack })` |
| `console.error(error)` + `logErrorToSentry(error)` | `logErrorToSentry(error, context)` (does both) |

## Before/After Examples

See the `examples/` directory for full transformations of real chess-coach-ai code:

- **`examples/feedback-route.ts`** — API route lifecycle logging (6 console calls → 4 structured calls)
- **`examples/response-cache.ts`** — Cache operations with emoji prefixes (4 emoji logs → 6 level-appropriate structured calls)

## Vercel Integration

Vercel automatically parses JSON-line output from serverless functions. When the logger emits `{"level":"error","message":"..."}`, Vercel:

1. Shows it in the **Error** tab of the deployment logs
2. Makes every JSON field searchable in the log viewer
3. Forwards it to any configured **Log Drain** (Datadog, Axiom, etc.) as structured data

No additional configuration is needed — Vercel detects JSON lines automatically.

## Design Decisions

**Zero dependencies.** The logger uses only `JSON.stringify`, `Date.toISOString()`, and `process.stdout.write`. No pino, winston, or bunyan. For chess-coach-ai's workload (a handful of log calls per API request, dominated by OpenAI API calls and Stockfish evaluations), the overhead of `JSON.stringify` on small context objects is negligible.

**AsyncLocalStorage for request IDs.** This is the Node.js standard for request-scoped context. It avoids threading a `requestId` parameter through every function signature. The chess-coach-ai API routes run on Node.js serverless functions (not Edge Runtime), so AsyncLocalStorage is fully supported.

**stdout/stderr split.** `debug` and `info` go to stdout; `warn` and `error` go to stderr. Vercel routes stderr to the error panel, making errors immediately visible without filtering.

**Client-side safety.** If the logger is accidentally imported in a browser component, it falls back to `console.log` / `console.error` instead of crashing on missing `process.stdout`. The primary target is server-side API routes and lib modules.
