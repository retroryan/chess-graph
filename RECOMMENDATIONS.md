# Chess Coach AI: Suggestions for Improvement

## What Chess Masti Already Gets Right

Before diving into suggestions, it is worth calling out what this project already gets right. These are not small things. Several of them reflect design decisions that many projects at this stage skip entirely.

**1. Tactical motif detection is algorithmic, not LLM-generated.** The `detectTacticalMotifs()` function in the enhanced analysis route identifies sacrifices, forks, pins, discovered checks, promotion threats, and quiet moves by analyzing piece values, attack maps, and available responses. This runs before the LLM sees the position, which means the coaching prompt arrives with structured tactical context rather than asking the model to figure it out from a raw FEN. That is a meaningful architectural choice.

**2. The gold standard examples are genuinely well written.** The 80 coaching examples in `goldStandardExamples.ts` vary tone by skill level (simple and encouraging for beginners, concise and analytical for advanced players), they name specific squares and pieces, and they teach the underlying concept rather than just stating the best move. Using these as few-shot examples gives the LLM a consistent coaching voice that most chess tools lack.

**3. Skill-level adaptation runs through the entire stack.** Rating-based skill bucketing (beginner below 1000, intermediate below 1600, advanced above) affects which gold standard examples are selected, how the analysis prompt is framed, and which puzzle difficulty bands are offered. The system genuinely meets the learner where they are.

**4. Response validation catches hallucinated chess claims.** The `aiResponseValidator.ts` module checks whether pieces the LLM mentions actually exist on the claimed squares, whether suggested moves are legal, and whether square references are valid. Scoring responses on a 0-to-1 scale and only caching those above 0.8 means the system self-corrects over time. Most LLM-powered tools skip this kind of domain-specific validation entirely.

**5. The puzzle dataset is well structured.** Splitting 90,599 puzzles into 71 theme directories with 4 difficulty bands each is a clean organizational scheme. The index file provides instant metadata lookups without scanning the full dataset. The deduplication logic (puzzles tagged with multiple themes appear in multiple directories but are filtered by ID) handles the cross-cutting concern correctly.

**6. Opening detection gives the coach positional awareness.** The `openingDetector.ts` module identifies which opening the user played and which phase of the game they are in (opening, early middlegame, middlegame, endgame). The phase-based critique gating, which skips analysis in the first 10 moves where opening theory dominates, prevents the coach from flagging book moves as mistakes. That is a subtle but important UX decision.

**7. The Maia engine integration adds a human dimension.** Including Maia (a neural network trained to predict human moves rather than optimal moves) alongside Stockfish gives the coach a way to distinguish between "the engine's best move" and "what a player at this level would actually consider." This is a differentiator that most chess analysis tools skip.

**8. Game storage in Firestore is cleanly abstracted.** The `firestoreGames.ts` module provides a clear CRUD interface (get, add, update, delete) with server timestamps and ordered retrieval. The separation between the storage layer and the analysis layer means the analysis logic stays independent of Firestore. This is the right boundary.

**9. The caching strategy is quality-gated.** Rather than caching every LLM response, the system only caches responses with a validation score above 0.8. The cache key combines FEN, skill level, and message hash, which means the same position analyzed at different skill levels produces different cached entries. This is a more thoughtful caching design than a simple request-response cache.

**10. The project scope is ambitious and coherent.** Combining game analysis, puzzle training, opening repertoires, spaced repetition drilling, and an AI coaching chat into a single application is a significant undertaking. The fact that these features share a common type system (`types/game.ts`, `types/openings.ts`, `types/puzzles.ts`) and common chess utilities shows intentional architecture rather than ad-hoc feature bolting.

---

## Suggestions for Improving Chess Masti

The suggestions below build on these strengths. They focus on structural changes that would make the platform easier to maintain, more capable as the dataset grows, and better positioned for the features described in the project's own roadmap.

---

## 1. Separate the Data Layer from the Deployment

The `src/data/` directory contains 34 MB of puzzle JSON files, a 13,600-line openings file, 917 lines of gold standard examples, and opening repertoires. All of this ships inside the application bundle. Moving this data to external storage decouples content updates from code releases: puzzles, openings, examples, and repertoires become documents that can be added, corrected, or rebalanced without a redeploy.

#### Hosting Static Data via Vercel `/public`

 Vercel serves any file in the `/public` directory as a static asset through its global CDN. A file at `/public/data/openings.json` becomes accessible at `https://chessmasti.com/data/openings.json`, cached at edge locations worldwide with appropriate cache headers. The Hobby (free) tier includes 100 GB/month of bandwidth, which is more than sufficient.

Keep the static JSON files in the git repository as the **gold copy** of the data. These files are version-controlled, reviewable in pull requests, and serve as the authoritative source of truth. Store them in a `/data` directory at the project root (outside `src/`) to make the distinction between application code and data assets clear, and place them (or symlink them) in `/public/data/` so they are available via CDN at predictable URLs.

For the runtime data store, continue using **Firebase Firestore**, which the application already uses for game storage. The openings, puzzles, gold standard examples, and repertoires become Firestore collections that the application reads from at runtime. This gives the app query capabilities (filter openings by ECO code, puzzles by theme and difficulty) that static file serving alone cannot provide.

#### Syncing Static Files to Firestore

The gold-copy JSON files need to reach Firestore. The simplest pattern that works well for a project at this stage:

**Startup sync with version check.** The application checks a `metadata` document in Firestore on startup (or on first relevant request). This document stores a version string (e.g., a hash of the JSON file or a semver you increment manually). If the version in Firestore matches the version baked into the deploy, the data is current and no sync is needed. If it differs or the collection is empty, the application reads the JSON from the `/public/data/` URL and batch-writes it to Firestore.

```
App starts
  -> Read metadata/openings doc from Firestore
  -> Compare version field to expected version in app config
  -> If match: data is current, proceed
  -> If mismatch or missing: fetch /data/openings.json, batch-write to Firestore, update metadata doc
```

This approach is self-healing (if Firestore data is wiped, the next deploy restores it), requires no additional infrastructure, and keeps the static files as the single source of truth.
For now, the startup sync pattern is the right tradeoff: simple to implement, easy to reason about, and sufficient for a project in active development.

---

## 2. Openings: Extract the Openings out of the TypeScript Data File into Structured JSON

> **Status:** The suggested replacement is in `suggested-openings/`.

#### The challenge

`src/data/openings.ts` is a 13,606-line TypeScript file that bakes 2,000+ opening names and FEN positions directly into the JavaScript bundle shipped to every user's browser. The data has no ECO codes, no PGN move sequences, and every edit requires a code change, rebuild, and redeploy. Meanwhile, two other parts of the application maintain their own disconnected opening lists: `openingDetector.ts` (29 openings) and `repertoires.ts` (11 repertoires). The three datasets share no common structure and reference each other only by coincidence of naming.

#### The suggested alternative

`suggested-openings/` contains two files that together replace the hardcoded TypeScript:

**`openings.json`** — A structured JSON file with 3,401 openings, each carrying four fields:

```json
{ "name": "Sicilian Defense: Najdorf Variation", "fen": "rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R", "eco": "B90", "pgn": "1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6" }
```

ECO codes and PGN move sequences were sourced from the lichess-org/chess-openings dataset. Coverage: 96.4% of entries have ECO codes (3,278 of 3,401) and 94.6% have PGN sequences (3,219 of 3,401). The remaining entries with null values can be enriched over time without code changes.

**`openings-data.ts`** — A Firestore service module that follows the same patterns established in `firestoreGames.ts` (modular SDK imports, shared `firebase.ts` config, `serverTimestamp()`, guard clauses). It provides:

- `bulkLoadOpenings()` — Batch-writes the JSON to Firestore in chunks of 500 (7 batches for 3,401 openings)
- `getAllOpenings()` / `getOpeningsPaginated()` — Full and paginated reads, ordered by name
- `getOpeningByName()` / `searchOpeningsByName()` — Exact match and prefix search
- `getOpeningsByEcoPrefix()` — Filter by ECO family (e.g., `"B"` for all semi-open games, `"B20"` for the Sicilian family)
- Standard CRUD (`addOpening`, `updateOpening`, `deleteOpening`)

The openings collection is top-level in Firestore (shared reference data, not user-scoped), with security rules that allow authenticated reads and restrict writes to the Admin SDK.

Once this JSON and service module are adopted, the three disconnected opening systems (`openings.ts`, `openingDetector.ts`, `repertoires.ts`) can draw from the same Firestore collection through different query patterns. The data can also be enriched incrementally with fields like `description`, `popularity`, `difficulty`, or `themes` without modifying application code.

Section 1 covers where to host the static JSON and how to sync it to Firestore.

---

## 3. Unify the Three Opening Systems

> **Status:** The suggested replacement is in `suggested-unified-opening-systems/`.

#### The challenge

The application has three separate representations of openings that serve different purposes but share no common data source:

- `openings.ts`: 3,401 openings as name/FEN pairs. Used for opening name display. Has no ECO codes or move sequences.
- `openingDetector.ts`: 29 openings as hardcoded move arrays with ECO codes. Used for detecting which opening was played during a game. Coverage is limited to 29 entries out of 3,401.
- `repertoires.ts`: 11 curated repertoires with drill lines. Used for the opening training system. Hardcodes its own ECO codes and descriptions independently.

#### The suggested alternative

`suggested-unified-opening-systems/` contains two files that replace the detector and repertoire modules, both drawing from the unified Firestore openings collection (Section 2):

**`unified-opening-detector.ts`** — Replaces the 29-entry hardcoded database with detection powered by all 3,219 openings that have PGN sequences. On first use, it loads the openings from Firestore, parses their PGN strings into move arrays, and builds a trie (prefix tree) for efficient matching. The trie is cached in module scope for subsequent calls.

Detection uses a longest-match-wins strategy: if a game starts with 1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6, the detector returns "Sicilian Defense: Najdorf Variation" (B90) rather than the less specific "Sicilian Defense" (B20) that matches at move 2. The original detector would return just "Sicilian Defense" for any Sicilian game because it has no sub-variation entries.

The module exports the same three functions and `OpeningInfo` interface as the original `openingDetector.ts`, so callers do not need to change. The only API difference is that `detectOpening()` is now async (it returns `Promise<OpeningInfo | null>`) because the first call loads data from Firestore. The `isOpeningMove()` and `getOpeningPhase()` functions remain synchronous and unchanged.

**`unified-repertoires.ts`** — Keeps all 11 curated drill repertoires and their hand-picked lines unchanged (these are pedagogical content, not generated from the openings dataset). Adds two functions that connect repertoires to the unified data:

- `lookupRepertoireOpening(repertoire)` — Looks up the parent opening in Firestore by name or ECO code, returning the full `OpeningDocument` with FEN, ECO, and PGN. This lets the UI show the starting position for any repertoire and validate that its ECO code matches the authoritative data.
- `enrichRepertoire(repertoire)` — Returns a new repertoire with metadata updated from the unified collection (ECO code, name). Drill lines are preserved unchanged.

The existing exports (`OPENING_REPERTOIRES`, `getRepertoiresByColor`, `getRepertoireById`, `OPENING_COURSES`, `getCoursesByColor`) are preserved with the same signatures.

---

## 4. Introduce Structured Logging

> **Status:** A working sample is in `sample-logging/`.

#### The challenge

The codebase has 272 `console.log`, `console.warn`, and `console.error` calls across 64 files. Some use emoji prefixes as informal namespaces (`📦` for cache, `🔍` for validation), others concatenate context into template literal strings, and error handlers mix `console.error` with the separate `logErrorToSentry()` path. There is no log level filtering, no structured format, no request correlation, and no way to search or aggregate logs in production.

This creates several concrete problems:

- **No severity filtering.** Every `console.log` and `console.error` appears in the same stream. In production on Vercel, there is no way to suppress debug noise or isolate errors without changing code.
- **No request correlation.** When concurrent requests hit `/api/enhanced-analysis`, their log lines interleave with no shared identifier. Tracing a single user's issue means reading every log line and guessing which belong together.
- **No structured fields.** Context is embedded in strings: `` `📦 Cache HIT for key: ${cacheKey}... (hits: ${hitCount})` ``. Vercel's log viewer cannot parse emoji prefixes or extract `hitCount` from free text. You cannot filter by `cacheKey` or compute cache hit rates.
- **Sentry sees errors in isolation.** The current `logErrorToSentry()` sends exceptions to Sentry, but Sentry has no visibility into what happened before the error. There is no breadcrumb trail of the events leading up to a failure.

#### The suggested alternative

`sample-logging/` contains three modules and two before/after examples that demonstrate how a lightweight structured logger could replace the current patterns:

**`request-context.ts`** — Uses Node.js `AsyncLocalStorage` to flow a request ID through the entire call chain without parameter threading. The ID comes from Vercel's `x-vercel-id` header (or `crypto.randomUUID()` in local dev). Every downstream module can call `getRequestId()` without the request ID being passed as a function argument.

**`logger.ts`** — A zero-dependency structured logger with four levels (`debug`, `info`, `warn`, `error`), `LOG_LEVEL` environment variable filtering, and environment-aware output: minified JSON lines in production (what Vercel Log Drain expects), colored human-readable lines in development. Child loggers (`logger.child({ module: "cache" })`) replace the emoji prefix convention with machine-parseable namespace fields.

**`sentry-integration.ts`** — A drop-in replacement for the existing `src/lib/sentry.ts` that preserves the same `logErrorToSentry()` API. Adds a Sentry breadcrumb bridge: `info` and `warn` log entries become Sentry breadcrumbs automatically, so when an error fires, the Sentry error detail page shows the structured trail of events leading up to it.

The `examples/` directory shows the transformation applied to real code:

- **`feedback-route.ts`** — The `/api/feedback` route goes from 6 separate `console.*` calls to 4 structured calls with context objects, wrapped in `withRequestContext` for automatic request ID tagging.
- **`response-cache.ts`** — The cache module goes from 4 emoji-prefixed `console.log` calls to 6 level-appropriate structured calls. Cache skips and TTL expirations become `debug` (suppressed in production), cache clears become `warn` (always visible), and every entry carries searchable fields like `cacheKey`, `hitCount`, and `validationScore`.

The result is production logs that look like this:

```json
{"timestamp":"2026-03-28T12:00:00.000Z","level":"info","message":"Cache hit","module":"cache","cacheKey":"rnbqkbnr...","hitCount":3,"requestId":"lax1::iad1::8f3a2b"}
```

Every field is searchable in Vercel's log viewer, forwardable to a Log Drain (Datadog, Axiom), and consumable by Sentry as structured breadcrumbs.

---

## 5. Validate API Inputs at the Boundary

> **Status:** A working sample is in `sample-validation/`.

#### The challenge

The 11 API routes accept JSON request bodies and destructure them with minimal validation. The checks that do exist are inconsistent: some routes check field presence, some check enum values, and most trust types blindly. No validation library is installed.

The puzzle dataset route is a representative example. It checks for a `command` field and branches on its value, but does not validate that `themes` is an array of strings, that `limit` is a positive integer, or that `difficulty` is a known band. The `difficulty` field is handled with `difficulty as DifficultyBand` — a TypeScript cast that does nothing at runtime. A request with `{ difficulty: "banana" }` or `{ limit: 999999 }` passes straight through to the query logic.

The same pattern repeats across routes:
- `/api/feedback`: `maxGames` defaults to 25 but has no ceiling — a client can send `999999` to trigger massive API calls to Chess.com or Lichess.
- `/api/scout`: `months` defaults to 12 with no bounds — `months: 999999` fetches years of game archives.
- `/api/chat`: `model`, `temperature`, and `max_tokens` are passed directly to the OpenAI API with no whitelist or range checks.
- `/api/maia-predict`: `fen` is checked for presence but not format — a malformed FEN string passes through to the external Maia microservice and produces a confusing error.

When invalid inputs are not caught at the route boundary, errors surface deep in the call stack (chess.js throwing on an invalid FEN, queryPuzzles returning no results for a nonsense difficulty band) as 500 errors with unhelpful messages instead of clear 400 responses telling the client what it sent wrong.

#### The suggested alternative

`sample-validation/` contains a Zod schema module and two before/after route examples:

**`schemas.ts`** — Defines schemas for 6 API routes plus shared field validators (`fenSchema`, `usernameSchema`, `platformSchema`, `difficultyBandSchema`). Each schema validates types, constrains ranges, and provides defaults:

```typescript
export const puzzleDatasetSchema = z.object({
  command: z.enum(["find_similar", "by_theme", "random", "daily"]).default("find_similar"),
  themes: z.array(z.string().min(1)).optional(),
  limit: z.number().int().min(1).max(100).default(5),
  difficulty: z.union([difficultyBandSchema, z.array(difficultyBandSchema)]).optional(),
  excludeIds: z.array(z.string()).optional(),
});
```

A single `safeParse()` call at the top of each route replaces all scattered if/else checks. When validation fails, the client gets a structured error with the field name, what was expected, and what was received — in a consistent format across all routes:

```json
{
  "error": "Invalid input",
  "details": {
    "fieldErrors": {
      "difficulty": ["Invalid enum value. Expected 'easy' | 'medium' | 'hard' | 'expert', received 'banana'"],
      "limit": ["Number must be less than or equal to 100"]
    }
  }
}
```

The `examples/` directory shows the transformation applied to the puzzle dataset route (the route specifically called out in RECOMMENDATIONS.md) and the feedback route. Both demonstrate how manual if/else checks, unsafe type casts, and unbounded defaults become a declarative schema that catches malformed inputs before they reach application logic.

Zod is the dominant validation library in the Next.js ecosystem (integrates with server actions, tRPC, and React Hook Form), is 13 KB gzipped with zero dependencies, and infers TypeScript types from schemas — eliminating the need for separate interface definitions alongside runtime checks.

---

## 6. Add React Error Boundaries

> **Status:** A working sample is in `sample-error-boundaries/`.

#### The challenge

The application has no error boundary components. A runtime error in any component — a null FEN reaching the chessboard, a malformed PGN crashing chess.js, a JSON.parse failure in the AI coach — unmounts the entire component tree. The user sees a blank white screen with no way to recover except a full page reload. Sentry captures the error after the fact, but the user experience is already broken.

The codebase has patterns that make render-time crashes likely:

- 44+ `new Chess(fen)` calls across components and hooks. chess.js throws on invalid FEN strings, and any component that receives a bad FEN from an atom, API response, or URL parameter will crash during render.
- 9 `JSON.parse()` calls without try-catch in hooks and services (`useAtomLocalStorage`, `useLocalStorage`, `weaknessProfile`, `feedbackStore`). Corrupted localStorage or unexpected API responses trigger parse errors during render.
- The CoachTab dynamically imports `AICoachChat` (1,500+ lines, 13 Chess instantiations). A crash in this module takes down the entire analysis page, including the chessboard and analysis tabs that were working fine.

The component hierarchy from `_app.tsx` is `QueryClientProvider → AuthProvider → Layout → Page`. With no boundaries, an error anywhere below Layout propagates up and unmounts everything.

#### The suggested alternative

`sample-error-boundaries/` contains a reusable `ErrorBoundary` class component and three before/after examples showing where to place boundaries in the component tree:

**`ErrorBoundary.tsx`** — A single configurable component with a `name` prop for identification, support for custom or default fallback UI, a `reset()` function for retry without page reload, and Sentry integration that tags each captured error with the boundary name for dashboard filtering.

**`examples/analysis-page.tsx`** — The analysis page with four boundaries: one around the chessboard, one around each of the three tab panels (analysis, moves/coach, AI coach). If the AI coach crashes (the highest-risk section, with 13 Chess instantiations and JSON.parse calls), the chessboard and analysis panel keep working. The tab navigation and toolbar stay outside boundaries so users can always switch tabs.

**`examples/practice-page.tsx`** — The practice page with three boundaries: PuzzleRush (810 lines, timer-driven state transitions), PatternTraining, and PracticeBoard. The Back button and theme selector stay outside boundaries so users can always navigate away from a broken puzzle.

**`examples/app-wrapper.tsx`** — A top-level boundary in `_app.tsx` as a last-resort safety net. Placed inside `QueryClientProvider` and `AuthProvider` so the user stays authenticated after clicking "Try Again". This catches any error that escapes section-level boundaries or occurs in pages that haven't been wrapped yet.

The boundary placement hierarchy:

```
_app.tsx
  ErrorBoundary name="app"                    ← last resort
    Layout
      analysis.tsx
        ErrorBoundary name="chessboard"       ← section level
        ErrorBoundary name="analysis"
        ErrorBoundary name="moves-coach"
        ErrorBoundary name="ai-coach"
      practice.tsx
        ErrorBoundary name="puzzle-rush"      ← section level
        ErrorBoundary name="pattern-training"
        ErrorBoundary name="practice-board"
```

Every caught error reports to Sentry with the boundary name as an indexed tag, so the Sentry dashboard can filter by `errorBoundary: ai-coach` to see exactly which section crashed.

---

## 7. Persist User Progress Server-Side

Puzzle progress currently lives in IndexedDB on the client. Moving this to Firestore (which the application already uses for game storage via `firestoreGames.ts`) would give users continuity across devices and give the coaching AI a richer picture of each learner's strengths and weaknesses. The same CRUD pattern that `firestoreGames.ts` establishes can extend to puzzle attempts, solve rates by theme, and drill progress.

---

## 8. Add Test Coverage

The codebase has 225 TypeScript files and adding test coverage would protect the most valuable logic from regressions. Functions like `detectTacticalMotifs()`, `selectExamples()`, and `queryPuzzles()` are pure or near-pure functions that take chess state in and return structured data out, making them ideal candidates for unit testing. The response validator, which checks piece-on-square claims and move legality, is the kind of logic where a regression could silently produce incorrect coaching output. Starting with these high-value, easy-to-test functions would give the project a safety net where it matters most.


## 9. Build Adaptive Puzzle Selection

The puzzle system currently selects 20 random puzzles from a theme/difficulty bucket. The pieces for adaptive selection already exist in the codebase: the `excludeIds` parameter in `queryPuzzles()` filters out previously solved puzzles, the `findSimilarPuzzles()` function matches by theme and rating range, and the spaced repetition types in `types/openings.ts` show that SM-2 scheduling was planned or partially implemented.

Connecting these pieces would produce a puzzle system that prioritizes themes where the user struggles (based on solve rate), avoids puzzles already mastered, and progressively increases difficulty within a theme. This requires tracking solve history server-side (see Section 7) and using it to rank rather than shuffle.

---

## 10. Use a Persistent Response Cache

The enhanced analysis API caches LLM coaching responses in an in-memory LRU cache (`responseCache.ts`) with a 200-entry limit and 24-hour TTL. The quality gating is already well designed — only responses with a validation score above 0.8 are cached, and the cache key combines FEN (normalized to remove move counters), skill level, and a hash of the user's message. This means the same position analyzed at different skill levels produces different cached entries.

The problem is the storage backend. The cache is a `Map` in Node.js process memory. On Vercel's serverless infrastructure, it is lost on every deploy, every cold start, and every instance rotation. Each invocation may run on a different instance, so a cache built up by one instance is invisible to the next. Under production conditions, the hit rate approaches zero.

Replacing the in-memory `Map` with a Firestore document (keyed by the same cache key the module already generates) would persist responses across deploys and share them across instances. The existing `generateCacheKey()`, quality threshold, and TTL logic stay unchanged — only the storage layer moves from memory to Firestore. Since only high-quality responses are cached (validation score >= 0.8), storage costs would be modest. The `getCacheStats()` function could read from a Firestore metadata document to provide the same monitoring interface.

This is a focused change: `responseCache.ts` is 136 lines, and the three functions that touch the `Map` (`getCachedResponse`, `setCachedResponse`, `clearCache`) would become Firestore reads and writes following the same patterns already established in `firestoreGames.ts`.

---

## 11. Decouple the Maia Integration

> **Status:** This was suggested by AI and I have not reviewed this one.


The Maia-2 chess engine (a neural network trained to predict human moves rather than optimal moves) runs as a separate Python/FastAPI microservice. The application connects to it through a hardcoded `MAIA_API_URL` environment variable, a dedicated prediction route (`/api/maia-predict`), and a health check route (`/api/maia-status`).

The coupling surfaces in three ways:

**No fallback when Maia is down.** The prediction route proxies directly to the external service. If Maia is unreachable, the route returns a 503 with `fallback: true` in the response body — but the client-side code that consumes this must handle the fallback in every call site. There is no centralized fallback-to-Stockfish logic.

**No retries or timeouts on the prediction path.** The health check route has a 5-second timeout via `AbortController`, but the prediction route (`/api/maia-predict`) has no timeout at all. A slow Maia response blocks the entire request indefinitely. The health check and prediction routes implement their own separate error handling rather than sharing a common client.

**Multiple Maia-related modules with overlapping concerns.** The codebase has `maiaService.ts`, `maiaServerService.ts`, `maiaEngine.ts`, and `maiaDownloader.ts` alongside the two API routes, plus a `MaiaStatusIndicator` UI component and references in `AICoachChat.tsx` and `enhancedOpenAIService.ts`. These modules each handle parts of the Maia lifecycle (download, spawn, predict, check status) independently.

Wrapping the Maia interaction in a single service module that handles timeouts, retries, and automatic fallback to Stockfish evaluation would make the Maia integration optional rather than fragile. The service module would:

- Expose a single `predictHumanMove(fen, rating)` function
- Check Maia availability once (cached health status with TTL) rather than per-request
- Apply a timeout to prediction requests (e.g., 3 seconds)
- Fall back to Stockfish evaluation when Maia is unavailable or slow, transparently to the caller
- Log whether the response came from Maia or Stockfish (useful for quality comparison)

The application should degrade gracefully to local Stockfish analysis when Maia is unavailable, without requiring error handling at every call site.

---