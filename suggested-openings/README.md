# Suggested Openings: Structured JSON + Firestore Service

This directory contains a structured JSON dataset and a Firestore service module that together replace the hardcoded 13,600-line `openings.ts` file in chess-coach-ai. The goal is to decouple opening data from the JavaScript bundle so it can be updated, enriched, and queried without code deploys.

## Why replace openings.ts?

The current `src/data/openings.ts` bakes 2,000+ opening names and FEN positions directly into the JavaScript bundle shipped to every user's browser. The data has no ECO codes, no PGN move sequences, and every edit requires a code change, rebuild, and redeploy. Meanwhile, two other parts of the application (`openingDetector.ts` and `repertoires.ts`) maintain their own disconnected opening lists with no shared structure.

## What's in this directory

```
suggested-openings/
  openings.json       # 3,401 openings with name, FEN, ECO, and PGN
  openings-data.ts    # Firestore service module (CRUD, search, pagination)
  README.md
```

### `openings.json`

A structured JSON file with 3,401 openings. Each entry carries four fields:

```json
{
  "name": "Sicilian Defense: Najdorf Variation",
  "fen": "rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R",
  "eco": "B90",
  "pgn": "1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6"
}
```

ECO codes and PGN move sequences were sourced from the [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) dataset:

| Field | Coverage |
|-------|----------|
| ECO codes | 96.4% (3,278 of 3,401) |
| PGN sequences | 94.6% (3,219 of 3,401) |

Entries with `null` values can be enriched over time without code changes.

### `openings-data.ts`

A Firestore service module that follows the same patterns established in `firestoreGames.ts` (modular SDK imports, shared `firebase.ts` config, `serverTimestamp()`, guard clauses). It provides:

| Function | Description |
|----------|-------------|
| `bulkLoadOpenings()` | Batch-writes the JSON to Firestore in chunks of 500 (7 batches for 3,401 openings) |
| `getAllOpenings()` | Retrieve all openings, ordered by name |
| `getOpeningsPaginated()` | Cursor-based pagination for client-side use |
| `getOpeningByName()` | Exact name match lookup |
| `searchOpeningsByName()` | Prefix search (e.g., "Sicilian" returns all Sicilian lines) |
| `getOpeningsByEcoPrefix()` | Filter by ECO family (e.g., `"B"` for semi-open games, `"B20"` for the Sicilian family) |
| `addOpening()` / `updateOpening()` / `deleteOpening()` | Standard CRUD |

The openings collection is top-level in Firestore (shared reference data, not user-scoped), with security rules that allow authenticated reads and restrict writes to the Admin SDK.

## How it connects to the rest of the project

This directory is referenced by Section 2 of the main `chess-graph/README.md`. The Firestore collection it populates becomes the single source of truth that two other suggested modules draw from:

- `suggested-unified-opening-systems/unified-opening-detector.ts` reads PGN sequences to build a detection trie
- `suggested-unified-opening-systems/unified-repertoires.ts` reads ECO/name/FEN to enrich curated drill repertoires

Section 1 of the main README covers where to host the static JSON and how to sync it to Firestore.

## Design decisions

**Top-level Firestore collection, not user-scoped.** Openings are shared reference data — every user queries the same set. A top-level collection avoids duplicating 3,401 documents per user and allows a single set of security rules.

**Auto-generated document IDs.** Opening names contain colons and apostrophes that are valid but awkward as Firestore document IDs. Auto-generated IDs avoid these issues.

**Prefix search via range queries.** Firestore does not support `LIKE` or substring-contains queries. The `searchOpeningsByName()` function uses the standard `>= prefix` / `<= prefix + \uf8ff` range query trick. This matches the start of the name only. For substring search, a dedicated search service (Algolia, Typesense) or client-side filtering over a cached dataset would be needed.

**No composite indexes required.** All queries use single-field conditions with optional `orderBy` on the same field, which Firestore handles with automatic single-field indexes.
