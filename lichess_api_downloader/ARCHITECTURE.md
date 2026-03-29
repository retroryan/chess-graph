# Lichess Game Downloader: Architecture

## Overview

The downloader collects Italian Game (ECO C50-C59) games from Lichess as NDJSON. It operates in two phases: **Phase 1** discovers game IDs, and **Phase 2** exports full game data. Phase 1 has two strategies depending on whether a Lichess API token is available.

```
                        ┌─────────────────────┐
                        │   LICHESS_TOKEN set? │
                        └──────────┬──────────┘
                           yes /       \ no
                              /         \
                ┌────────────▼──┐   ┌───▼─────────────┐
                │  Phase 1a:    │   │  Phase 1b:       │
                │  Explorer BFS │   │  HuggingFace     │
                │  tree walk    │   │  puzzle search   │
                └──────┬────────┘   └────────┬─────────┘
                       │                     │
                       │   set[game_ids]     │
                       └─────────┬───────────┘
                                 │
                        ┌────────▼────────┐
                        │    Phase 2:     │
                        │  Lichess batch  │
                        │  export (_ids)  │
                        └────────┬────────┘
                                 │
                        ┌────────▼────────┐
                        │   NDJSON file   │
                        │  (500 games)    │
                        └─────────────────┘
```

## Phase 1a: Opening Explorer Tree Walk (with token)

When `LICHESS_TOKEN` is set, the downloader uses the Lichess Opening Explorer to discover game IDs through a breadth-first traversal of the opening tree.

### How it works

The explorer endpoint (`explorer.lichess.org/lichess`) accepts a UCI move sequence and returns aggregate statistics plus a sample of actual game IDs for that board position. Each response includes up to 4 `topGames` (highest-rated) and 8 `recentGames` (most recent), giving up to 12 game IDs per position queried.

The BFS starts from the Italian Game base position (1.e4 e5 2.Nf3 Nc6 3.Bc4) and expands outward:

```
                    1.e4 e5 2.Nf3 Nc6 3.Bc4          depth 0
                    ┌────────┼────────┐
                 3...Bc5   3...Nf6   3...d6            depth 1
               ┌────┼────┐    │       │
           4.c3  4.d3  4.b4  ...     ...               depth 2
            │     │     │
           ...   ...   ...                              depth 3
```

At each position the downloader:

1. Queries the explorer with the UCI move sequence, filtering by rating buckets and time controls (rapid, classical)
2. Collects game IDs from `topGames` and `recentGames`
3. Sorts the position's continuations by popularity (total games played)
4. Enqueues the **top 5 most popular moves** for further exploration
5. Stops when enough unique game IDs have been accumulated or depth exceeds 20

The explorer endpoint is rate-limited to 2 requests/second (configurable via `EXPLORER_RATE_LIMIT`). HTTP 429 responses trigger exponential backoff (60s, 120s, 180s).

### Explorer path advantages

- **Rating filtering at discovery time.** The explorer accepts rating bucket parameters, so only games in the configured `RATING_MIN`/`RATING_MAX` range are returned.
- **Broader game database.** Draws from all rated Lichess games at a position, not just games that produced puzzles.
- **Enables the probe command.** The `probe` command queries each rating bucket with `topGames=0, recentGames=0` to display game counts without downloading, helping tune the rating range.

```
$ uv run lichess-downloader probe

Italian Game (1.e4 e5 2.Nf3 Nc6 3.Bc4)
Speeds: rapid, classical only

  Rating Range              Games
  ----------------------------------
  1200-1399                 89,012  <-- selected
  1400-1599                 67,890  <-- selected
  1600-1799                 45,123  <-- selected
  1800-1999                 23,456  <-- selected
  Total (selected)         225,481
```

## Phase 1b: HuggingFace Puzzle Search (fallback, no token)

Without a token, the downloader discovers game IDs by searching the Lichess puzzle dataset hosted on HuggingFace (`Lichess/chess-puzzles`, ~248K puzzles).

### How it works

Each puzzle record in the dataset includes a `GameId` field linking it to its source Lichess game and an `OpeningTags` field (e.g., `Italian_Game Italian_Game_Two_Knights_Defense`). The downloader searches for `Italian_Game` and extracts the game ID from each matching puzzle.

```
  HuggingFace datasets-server
  ┌──────────────────────────────────────────────────────┐
  │  GET /search?dataset=Lichess/chess-puzzles            │
  │              &query=Italian_Game                       │
  │              &offset=0&length=10                       │
  │                                                        │
  │  Response:                                             │
  │  ┌──────────────────────────────────────────────────┐  │
  │  │ { "GameId": "TJxUmbWK/black#42", ... }          │  │
  │  │ { "GameId": "aB3cD4eF#17", ... }                │  │
  │  │ ...  (10 rows per page)                          │  │
  │  └──────────────────────────────────────────────────┘  │
  └──────────────────────────────────────────────────────┘
                           │
                     extract game ID
                     (strip /player#ply suffix)
                           │
                           ▼
                   "TJxUmbWK", "aB3cD4eF", ...
                   added to deduplicated set
```

The downloader paginates through results (10 rows per request, incrementing `offset`) until enough unique game IDs accumulate. Rate limiting uses the general `RATE_LIMIT` setting (default 20 req/s), with a 30-second backoff on 429 responses. If 3 consecutive pages return no new rows, pagination stops.

### Fallback path tradeoffs

- **No rating filtering.** Game IDs come from whichever games produced puzzles, regardless of player rating. In practice, ~81% of player ratings fall in the 1200-2000 target range (average 1848).
- **Puzzle selection bias.** Only games that produced tactical puzzles appear in the dataset. These are games where the computer evaluation swings sharply — blunders, missed tactics, or forced winning sequences. For a chess coaching app focused on tactical training, this bias is arguably a feature.
- **Full-text search.** The HuggingFace search is text-based, not a structured column filter. `Italian_Game` matches only the `OpeningTags` field in practice, but this is a coincidence of the schema, not an API guarantee.
- **Probe unavailable.** The `probe` command requires the explorer endpoint, so it is not available without a token.

## Phase 2: Batch Export

Both discovery paths feed into the same export step. The downloader posts collected game IDs to the Lichess batch export endpoint (`lichess.org/api/games/export/_ids`) in groups of 300 (the API maximum).

```
  Collected game IDs (set of ~500)
  ┌──────────────────────────────┐
  │ TJxUmbWK, aB3cD4eF, ...     │
  └──────────────┬───────────────┘
                 │
       split into batches of 300
       ┌─────────┴─────────┐
       │                   │
  ┌────▼────┐        ┌────▼────┐
  │ Batch 1 │        │ Batch 2 │
  │ 300 IDs │        │ 200 IDs │
  └────┬────┘        └────┬────┘
       │                   │
       ▼                   ▼
  POST /api/games/export/_ids
  Content-Type: text/plain
  Accept: application/x-ndjson
  ?opening=true&clocks=true
       │                   │
       ▼                   ▼
  Streaming NDJSON response
  (one JSON object per game)
       │                   │
       └─────────┬─────────┘
                 │
                 ▼
  output/italian_game_games.ndjson
```

Each request streams the response to avoid buffering large payloads in memory. The timeout is 300 seconds per batch. Each game record in the output includes the game ID, variant, speed, player names/ratings, winner, full move sequence (SAN), opening ECO code and name, and clock configuration.

## Path Comparison

```
                        Explorer (with token)     HuggingFace (fallback)
                        ─────────────────────     ──────────────────────
  Discovery source      Lichess game database     Lichess puzzle dataset
  Rating filtering      Yes (server-side)         No (post-hoc only)
  Game selection        All rated games            Tactically rich games
  Probe command         Available                  Not available
  Rate limit            2 req/s (explorer)         20 req/s (datasets API)
  Auth required         Scopeless API token        None
  Discovery speed       ~125 queries (~1 min)      ~75 pages (~4 sec)
```

## Future Options

**Lichess monthly database dumps.** Lichess publishes complete game archives at `database.lichess.org` as zstandard-compressed PGN files, one per month. A streaming PGN parser that filters for ECO C50-C59 during decompression could extract thousands of Italian Game games from a single file without loading the full archive into memory. This gives the most control over game selection at the cost of a significant download (recent months exceed 20 GB compressed).

**HuggingFace filter endpoint.** The datasets server supports a `/filter` endpoint with SQL-like `WHERE` clauses. During development, it rejected the query syntax for array-typed columns. If HuggingFace adds support for `list_contains()` or similar array predicates, the filter endpoint would be more reliable than full-text search.

**Expand to multiple opening families.** The downloader currently hardcodes the Italian Game UCI sequence and the `Italian_Game` search term. Parameterizing these would let the same tool collect games for any opening group defined in the plan.

---

## Reference

| Resource | URL | Notes |
|----------|-----|-------|
| Lichess API documentation | `https://lichess.org/api` | OpenAPI spec for all public endpoints |
| Opening Explorer API | `https://lichess.org/api#tag/Opening-Explorer` | Explorer endpoint; requires auth token |
| Batch game export | `https://lichess.org/api#tag/Games/operation/gamesExportIds` | POST up to 300 IDs, streams NDJSON or PGN |
| HuggingFace puzzle dataset | `https://huggingface.co/datasets/Lichess/chess-puzzles` | ~248K puzzles with GameId and OpeningTags fields |
| HuggingFace datasets server API | `https://huggingface.co/docs/datasets-server` | Row, search, and filter endpoints for hosted datasets |
| Lichess database downloads | `https://database.lichess.org` | Monthly PGN dumps (zstd compressed) and puzzle CSV |
| Lichess API token creation | `https://lichess.org/account/oauth/token` | Free scopeless tokens for explorer access |
