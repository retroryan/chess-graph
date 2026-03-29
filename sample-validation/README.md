# API Input Validation Sample for chess-coach-ai

This directory contains a working example of how Zod schema validation could replace the ad-hoc input checking across chess-coach-ai's 11 API routes. Every file here is self-contained TypeScript that could be dropped into `chess-coach-ai/src/lib/`.

## Why validate at the boundary?

chess-coach-ai's API routes accept JSON request bodies and destructure them with minimal validation. The checks that do exist are inconsistent: some routes check field presence, some check enum values, and most trust types blindly. Here is what a typical route looks like today:

```typescript
const { fen, themes, limit = 5, command = "find_similar", difficulty, excludeIds } = await req.json();

if (!themes || themes.length === 0) {
  return NextResponse.json({ error: "Themes are required" }, { status: 400 });
}

const puzzles = await queryPuzzles({
  difficulty: difficulty as DifficultyBand,  // TypeScript cast — no runtime check
  limit,                                      // No ceiling — client can send 999999
});
```

This creates four categories of problems:

**No type safety at runtime.** TypeScript's `as DifficultyBand` is a compile-time assertion — it does nothing at runtime. A request with `{ difficulty: 42 }` or `{ difficulty: "banana" }` passes through the cast and reaches `queryPuzzles()`, which may silently return no results, throw a confusing error deep in the puzzle query logic, or worse.

**No bounds on numeric fields.** `limit`, `maxGames`, and `months` all have defaults but no ceilings. A request with `{ maxGames: 999999 }` triggers 999,999 API calls to Chess.com or Lichess. A request with `{ limit: 1000000 }` queries the entire puzzle dataset. These are not theoretical — any client with access to the API can send them.

**Inconsistent error responses.** Each route crafts its own error messages. The feedback route returns `{ error: "Username and platform are required" }`. The puzzle route returns `{ error: "Themes are required for find_similar" }`. The chat route returns `{ error: "Messages array is required" }`. Clients cannot parse these reliably because the format varies.

**Errors surface deep instead of at the boundary.** When an invalid FEN string reaches `new Chess(fen)`, chess.js throws an exception with a message like `"Invalid FEN: expected 6 space-delimited fields"`. This bubbles up as a 500 error from the catch block, not a 400 with a clear explanation of what the client sent wrong. The fix is simple: validate the FEN at the route boundary before it reaches chess.js.

## What schema validation gives you

A single `safeParse()` call at the top of each route replaces all scattered if/else checks:

```typescript
const result = feedbackSchema.safeParse(await request.json());

if (!result.success) {
  return NextResponse.json(
    { error: "Invalid input", details: result.error.flatten() },
    { status: 400 },
  );
}

const { username, platform, maxGames } = result.data;
// username: string (1..50 chars), platform: "lichess" | "chesscom", maxGames: int (1..100)
```

When validation fails, the client gets a structured error:

```json
{
  "error": "Invalid input",
  "details": {
    "fieldErrors": {
      "maxGames": ["Number must be less than or equal to 100"],
      "difficulty": ["Invalid enum value. Expected 'easy' | 'medium' | 'hard' | 'expert', received 'banana'"]
    }
  }
}
```

Every field name, what was expected, and what was received — in a consistent format across all routes.

## What's in this directory

```
sample-validation/
  schemas.ts                             # Zod schemas for all API routes
  examples/
    puzzle-dataset-route.ts              # Before/after: the route from RECOMMENDATIONS.md §3.8
    feedback-route.ts                    # Before/after: feedback route validation
  README.md
```

### `schemas.ts`

Defines schemas for 6 API routes plus shared field validators:

| Schema | Route | Fields validated |
|--------|-------|-----------------|
| `feedbackSchema` | POST /api/feedback | username (1..50), platform (enum), maxGames (1..100) |
| `puzzleDatasetSchema` | POST /api/chess-puzzles-dataset | command (enum), themes (string[]), limit (1..100), difficulty (enum), excludeIds (string[]) |
| `scoutSchema` | POST /api/scout | username (1..50), platform (enum), months (1..24) |
| `maiaPredictSchema` | POST /api/maia-predict | fen (format validated), rating (100..3500), opponent_rating (100..3500) |
| `chatSchema` | POST /api/chat | messages (role/content), model (whitelist), temperature (0..2), max_tokens (1..4000) |

Shared validators (`fenSchema`, `usernameSchema`, `platformSchema`, `difficultyBandSchema`) are reused across schemas to keep constraints consistent.

Also exports a `parseBody()` helper that wraps `safeParse()` and returns either the validated data or a structured error response.

### `examples/puzzle-dataset-route.ts`

The route specifically called out in RECOMMENDATIONS.md §3.8. Shows how:
- `difficulty as DifficultyBand` (type cast lie) becomes a schema-validated enum
- `limit = 5` with no ceiling becomes `.min(1).max(100).default(5)`
- `!themes || themes.length === 0` becomes `z.array(z.string().min(1))`
- The scattered `else if (command === ...)` chain benefits from command being a validated enum

### `examples/feedback-route.ts`

Shows how the manual presence checks (`!username || !platform`) and the array `includes()` call become a single `feedbackSchema.safeParse()`, and how edge cases like `{ maxGames: 999999 }` and `{ username: 123 }` are caught.

## Route-by-Route Validation Gaps

Summary of what each route validates today vs. what it should validate:

| Route | Today | Gaps |
|-------|-------|------|
| `/api/enhanced-analysis` | Checks OPENAI_API_KEY, moveHistory length | No FEN format, no systemPrompt sanitization, no rating bounds, no playerColor enum |
| `/api/feedback` | username/platform presence, platform enum | No username length, no maxGames bounds |
| `/api/chat` | OPENAI_API_KEY, messages array presence | No model whitelist, no temperature/max_tokens bounds, message structure unchecked |
| `/api/maia-predict` | FEN presence | No FEN format, no rating type/range |
| `/api/chess-puzzles-dataset` | command branching, themes presence | No limit bounds, difficulty cast without check, themes type unchecked |
| `/api/scout` | username/platform presence | No months bounds, username unbounded, platform case-sensitive |
| `/api/chess-puzzles` | FEN presence | No FEN format, PV array type unchecked |

## Design Decisions

**Zod over alternatives.** Zod is the most common validation library in the Next.js ecosystem. It integrates with Next.js server actions, tRPC, and React Hook Form. It infers TypeScript types from schemas (eliminating the need for separate interface definitions), and it's 13 KB gzipped with zero dependencies. The chess-coach-ai project does not currently have a validation library installed.

**Schemas in a single file.** All route schemas live in `schemas.ts` because the shared field validators (`fenSchema`, `usernameSchema`) need to be reusable. Routes import only the schema they need. If the file grows too large, it can be split by domain (puzzle schemas, auth schemas, etc.).

**safeParse over parse.** `safeParse()` returns a result object instead of throwing. This keeps control flow explicit — the route checks `result.success` and returns a 400, rather than relying on a try/catch to distinguish validation errors from application errors.

**Bounds are conservative.** The max values (100 for limit/maxGames, 24 for months, 4000 for max_tokens) are chosen to be generous enough for any legitimate use while preventing abuse. They can be adjusted based on actual usage patterns.
