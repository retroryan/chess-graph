# Suggested Unified Opening Systems

This directory contains two modules that unify the three disconnected opening systems in chess-coach-ai (`openings.ts`, `openingDetector.ts`, `repertoires.ts`) by drawing from the shared Firestore openings collection defined in `suggested-openings/`.

## Why unify the opening systems?

The application has three separate representations of openings that serve different purposes but share no common data source:

| Module | Entries | Purpose | Limitation |
|--------|---------|---------|------------|
| `openings.ts` | 3,401 | Opening name display | No ECO codes or move sequences |
| `openingDetector.ts` | 29 | Detecting which opening was played | Coverage limited to 29 entries |
| `repertoires.ts` | 11 | Opening training / drill lines | Hardcodes its own ECO codes independently |

The three datasets share no common structure and reference each other only by coincidence of naming.

## What's in this directory

```
suggested-unified-opening-systems/
  unified-opening-detector.ts    # Trie-based detection using all 3,219 PGN-equipped openings
  unified-repertoires.ts         # Curated drill repertoires enriched from unified data
  README.md
```

### `unified-opening-detector.ts`

Replaces the 29-entry hardcoded database with detection powered by all 3,219 openings that have PGN sequences. On first use, it:

1. Loads openings from Firestore via `openings-data.ts`
2. Parses PGN strings into move arrays
3. Builds a trie (prefix tree) for efficient matching
4. Caches the trie in module scope for subsequent calls

**Detection strategy: longest match wins.** If a game starts with 1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6, the detector returns "Sicilian Defense: Najdorf Variation" (B90) rather than the less specific "Sicilian Defense" (B20) that matches at move 2. The original detector would return just "Sicilian Defense" for any Sicilian game because it has no sub-variation entries.

**Drop-in replacement.** Exports the same three functions and `OpeningInfo` interface as the original `openingDetector.ts`:

| Function | Signature change |
|----------|-----------------|
| `detectOpening(game)` | Now returns `Promise<OpeningInfo \| null>` (async, because first call loads from Firestore) |
| `isOpeningMove(moveNumber)` | Unchanged (synchronous) |
| `getOpeningPhase(moveNumber)` | Unchanged (synchronous) |

**Performance.** The trie is built once on first call (O(n) where n is total moves across all openings). Subsequent calls traverse the trie in O(m) where m is the game's move count, regardless of dataset size.

### `unified-repertoires.ts`

Keeps all 11 curated drill repertoires and their hand-picked lines unchanged. The drill lines are pedagogical content — each has a specific teaching purpose, description, and carefully chosen move depth. They are intentionally not generated from the openings dataset.

Adds two functions that connect repertoires to the unified data:

| Function | Description |
|----------|-------------|
| `lookupRepertoireOpening(repertoire)` | Looks up the parent opening in Firestore by name or ECO code, returning the full `OpeningDocument` with FEN, ECO, and PGN |
| `enrichRepertoire(repertoire)` | Returns a new repertoire with metadata updated from the unified collection (ECO code, name). Drill lines are preserved unchanged |

Existing exports are preserved with the same signatures:

- `OPENING_REPERTOIRES` — array of 11 curated repertoires
- `getRepertoiresByColor(color)` — filter by white/black
- `getRepertoireById(id)` — lookup by ID
- `OPENING_COURSES` — array of opening courses
- `getCoursesByColor(color)` — filter courses by color

## How the three systems connect through unified data

```
Firestore openings collection (3,401 entries)
    |
    +-- unified-opening-detector.ts
    |   Reads PGN sequences -> builds trie -> detects openings in games
    |
    +-- unified-repertoires.ts
    |   Reads ECO/name/FEN -> enriches curated drill repertoires
    |
    +-- openings-data.ts (from suggested-openings/)
        CRUD + search + pagination for the openings UI
```

## How it connects to the rest of the project

This directory is referenced by Section 3 of the main `chess-graph/README.md`. It depends on:

- `suggested-openings/openings-data.ts` — for Firestore read functions (`getAllOpenings`, `getOpeningByName`, `getOpeningsByEcoPrefix`)
- `suggested-openings/openings.json` — the source data that populates the Firestore collection

## Design decisions

**Trie over sequential scan.** The original detector iterates through all 29 openings for every call. A trie lookup is O(m) in the game's move count, independent of dataset size. This matters when scaling from 29 to 3,219 openings.

**Async detectOpening.** The only API change from the original. The first call loads data from Firestore, so the function must be async. Subsequent calls hit the module-level cache and resolve immediately.

**Drill lines stay hardcoded.** The repertoire drill lines are curated teaching content, not generated data. They have specific pedagogical purposes that would be lost if auto-generated from the openings dataset. Only the opening-level metadata (ECO, name) is enriched from the unified collection.

**Longest name wins at tie.** When two openings share the same move sequence in the trie, the one with the longer (more specific) name is kept. In practice this is rare, but when it occurs, the sub-variation name is almost always more informative.
