# Chess Coaching Graph Data Loader

Loads Italian Game (C50-C59) chess data into Neo4j Aura Free Tier: openings, puzzles, games, and seed user activity.

## Setup

1. Create a free Neo4j Aura instance (see [Neo4j Aura Setup Guide](#neo4j-aura-setup-guide) below for detailed steps)
2. Copy `.env.example` to `.env` and fill in your credentials:
   ```
   cp .env.example .env
   ```
3. Run the loader:
   ```
   uv run chess-graph
   ```

To clear the database and reload from scratch:
```
uv run chess-graph --clear
```

## Sample Queries

After loading, run the Cypher tutorial to explore the graph:
```
uv run sample-queries
```

This walks through 15 queries covering the graph schema, MATCH basics, traversals, aggregations, variable-length paths, the adaptive puzzle recommendation query, opening-scoped puzzle analysis, and Lichess game data.

## What Gets Loaded

| Loader | Source | Nodes |
|--------|--------|-------|
| Openings | `chess-openings/c.tsv` | ~10 Opening, ~424 Position |
| Puzzles | `chess-coach-ai/src/data/puzzles/` | ~882 Puzzle, ~61 Theme |
| Games | `lichess_api_downloader/output/italian_game_games.ndjson` | ~500 Game, ~25,000 Position (merged) |
| Seed Users | Generated | 10 User |

Total: ~28,000 nodes, ~37,000 relationships (about 14% nodes / 9% relationships of the Aura free tier budget).

## Data Sources

The loader reads from three local data sources. Set the paths in `.env` — they can be full absolute paths like `/Users/you/projects/chess-openings/c.tsv` or relative to the `data_loading/` directory.

**OPENINGS_TSV** — The `c.tsv` file from the Lichess chess-openings repository. This is a TSV with ECO codes, opening names, and PGN move sequences for every catalogued opening. Clone it from https://github.com/lichess-org/chess-openings. The loader only reads `c.tsv` (the C-group ECO codes that contain the Italian Game).

**PUZZLES_DIR** — The bundled puzzle JSON files from the chess-coach-ai app. These are already part of this project at `chess-coach-ai/src/data/puzzles/`. Each subfolder is a tactical theme (fork, pin, sacrifice, etc.) containing four difficulty bands (`beginner.json`, `intermediate.json`, `advanced.json`, `expert.json`). Each JSON file is an array of puzzle objects with FEN, moves, rating, themes, and opening tags.

**GAMES_NDJSON** — An NDJSON file of Lichess games downloaded by the `lichess_api_downloader` tool. Each line is a JSON object with game metadata, SAN moves, and opening info. The loader replays each game's moves with python-chess to build Position nodes and GAME_MOVE chains. See `chess-graph/lichess_api_downloader/` for how to download games.

## Configuration

All settings are in `.env`:

| Variable | Description |
|----------|-------------|
| `NEO4J_URI` | Aura connection URI |
| `NEO4J_USERNAME` | Database username |
| `NEO4J_PASSWORD` | Database password |
| `OPENINGS_TSV` | Path to `c.tsv` from [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) |
| `PUZZLES_DIR` | Path to puzzle JSONs (e.g. `/Users/you/projects/chess-coach-ai/src/data/puzzles`) |
| `GAMES_NDJSON` | Path to Lichess games NDJSON file (e.g. `../../lichess_api_downloader/output/italian_game_games.ndjson`) |

---

## Neo4j Aura Setup Guide

### Creating your free instance

1. Go to [console.neo4j.io](https://console.neo4j.io/) and sign up or log in.
2. Click **Create Instance**.
3. Select **Create a Free instance**. The defaults are fine — free tier gives you 200,000 nodes and 400,000 relationships, which is more than enough for this project.
4. **Important:** When the instance is created, a credentials dialog will appear with your connection URI, username, and password. **Save the credentials file and download it.** The password is only shown once. If you lose it you'll need to reset it.
5. Copy the three values into your `.env` file:
   ```
   NEO4J_URI=neo4j+s://xxxxxxxx.databases.neo4j.io
   NEO4J_USERNAME=neo4j
   NEO4J_PASSWORD=the-password-from-the-downloaded-file
   ```
6. Wait a minute or two for the instance to finish provisioning (the status dot turns green).

### Loading the data

Once the instance is running and your `.env` is set up:

```
uv run chess-graph
```

This takes about 30 seconds. You'll see progress output and a budget summary at the end.

### Exploring the graph in the Aura console

After loading, go back to [console.neo4j.io](https://console.neo4j.io/), find your instance, and click **Open** on the right-hand side. Then click **Query** to open the Cypher query console. This gives you an interactive editor where you can run Cypher queries and see results as tables or as visual graph diagrams.

Paste any of the queries below into the query console and hit the play button to run them.

---

## Sample Queries for the Aura Console

These queries are designed to be pasted directly into the Aura query console. They progress from basic Cypher concepts to the full adaptive recommendation query.

### 1. Graph schema

See the shape of the entire data model at a glance. In the Aura query console this renders as a visual diagram showing all node labels, relationship types, and how they connect.

```cypher
CALL db.schema.visualization()
```

**How it works:** This is a built-in Neo4j procedure, not a MATCH query. It inspects the database metadata and returns a virtual graph showing every node label and relationship type that exists in the database.

**Traversal steps:**
1. Neo4j scans its internal schema catalog for all distinct node labels (Opening, Position, Puzzle, Theme, User, Game)
2. It scans for all distinct relationship types (IN_OPENING, THEORY_MOVE, STARTS_FROM, HAS_THEME, etc.)
3. It returns a virtual graph connecting labels via their relationship types — the Aura console renders this as a clickable diagram

### 2. What's in the graph?

Count every node by its label. `labels(n)` returns a list of labels on a node — most nodes have one. This is the Cypher equivalent of "show me all tables and their row counts."

```cypher
MATCH (n)
RETURN labels(n)[0] AS label, count(n) AS count
ORDER BY count DESC
```

**How it works:** `MATCH (n)` binds every node in the database to the variable `n`, with no label filter. `labels(n)` returns a list of all labels on that node — since our nodes each have one label, `[0]` grabs it. `count(n)` groups by that label and counts.

**Traversal steps:**
1. Neo4j scans all nodes in the database (no index used — this is a full scan)
2. For each node, it reads the label and groups it into a bucket
3. It counts the nodes in each bucket, sorts by count descending, and returns the table

### 3. Browse the openings

Each Opening node has an `eco` code (the Encyclopedia of Chess Openings identifier) and a `name`. This is a simple property filter with `WHERE` and `ORDER BY`, similar to SQL.

```cypher
MATCH (o:Opening)
RETURN o.eco AS eco, o.name AS name
ORDER BY o.eco
```

**How it works:** `MATCH (o:Opening)` finds all nodes with the Opening label. No relationships are traversed — this reads properties directly from the matched nodes. `ORDER BY o.eco` sorts the results alphabetically by ECO code (C50, C51, C52, ...).

**Traversal steps:**
1. Neo4j uses the label index to find all Opening nodes (fast — no full scan)
2. For each Opening node, it reads the `eco` and `name` properties
3. Results are sorted by `eco` and returned as a table

### 4. Positions in an opening

The arrow syntax `()-[:REL_TYPE]->()` is how Cypher matches relationships. This finds every Position node connected to the Italian Game (C50) via an IN_OPENING relationship, and counts them.

```cypher
MATCH (p:Position)-[:IN_OPENING]->(o:Opening {eco: 'C50'})
RETURN o.name AS opening, count(p) AS positions
```

**In plain terms:** Find the Italian Game opening and count how many distinct board positions belong to it.

**How it works:** The inline property filter `{eco: 'C50'}` restricts the Opening match to exactly one node. The arrow pattern `(p:Position)-[:IN_OPENING]->(o:Opening)` matches all Position nodes connected to that Opening via an IN_OPENING relationship. `count(p)` aggregates the matching positions.

**Traversal steps:**
1. Neo4j finds the Opening node where `eco = 'C50'` (uses the property index)
2. From that Opening node, it follows all incoming IN_OPENING relationships backwards to find connected Position nodes
3. It counts the matched Position nodes and returns the opening name alongside the count

### 5. Walk the opening tree

THEORY_MOVE connects positions in the opening skeleton. The `san` property on each relationship stores the move in Standard Algebraic Notation (e.g. "e4", "Nf3"). Here we start from the initial board position and walk exactly 3 hops to trace the Italian Game's first moves: 1.e4 e5 2.Nf3.

```cypher
MATCH (start:Position {fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'})
      -[m1:THEORY_MOVE]->(p1:Position)
      -[m2:THEORY_MOVE]->(p2:Position)
      -[m3:THEORY_MOVE]->(p3:Position)
WHERE m1.san = 'e4' AND m2.san = 'e5' AND m3.san = 'Nf3'
RETURN m1.san AS move1, m2.san AS move2, m3.san AS move3,
       left(p3.fen, 40) AS position_after
```

**In plain terms:** Start from the empty board and play three specific moves (1.e4 e5 2.Nf3) step by step, showing the board position you arrive at.

**How it works:** This query chains three explicit THEORY_MOVE hops from the starting position. Each relationship is bound to a variable (`m1`, `m2`, `m3`) so we can filter on the `san` property to walk a specific move sequence. `left(p3.fen, 40)` truncates the FEN string for readability.

**Traversal steps:**
1. Neo4j finds the Position node matching the standard starting FEN
2. From that node, it follows all outgoing THEORY_MOVE relationships and filters for `san = 'e4'` — landing on the position after 1.e4
3. From that position, it follows THEORY_MOVE edges and filters for `san = 'e5'` — landing on the position after 1.e4 e5
4. One more hop filters for `san = 'Nf3'` — arriving at the position after 1.e4 e5 2.Nf3
5. It returns the three move names and the resulting FEN

### 6. Hardest puzzles

Puzzle nodes have a `rating` (higher = harder). STARTS_FROM links each puzzle to the board position where it begins. `ORDER BY ... DESC` with `LIMIT` gives us the top 5.

```cypher
MATCH (pz:Puzzle)-[:STARTS_FROM]->(p:Position)
RETURN pz.puzzleId AS id, pz.rating AS rating, pz.moves AS solution,
       left(p.fen, 40) AS starting_position
ORDER BY pz.rating DESC
LIMIT 5
```

**In plain terms:** Find the 5 hardest puzzles in the database and show the board position where each one starts.

**How it works:** Each Puzzle node is linked to exactly one Position via STARTS_FROM — the board state where the puzzle begins. The query matches all puzzles with their starting positions, sorts by rating descending, and takes the top 5. `LIMIT` stops Neo4j from sorting the entire result set once it has enough rows.

**Traversal steps:**
1. Neo4j finds all Puzzle nodes via the label index
2. For each Puzzle, it follows the outgoing STARTS_FROM relationship to reach the linked Position node
3. It reads `puzzleId`, `rating`, and `moves` from the Puzzle, and `fen` from the Position
4. Results are sorted by rating descending and the top 5 are returned

### 7. Most common tactical themes

Each puzzle is tagged with tactical themes (fork, pin, sacrifice, etc.) via HAS_THEME relationships. This aggregation counts puzzles per theme — showing what skills the Italian Game tests most.

```cypher
MATCH (pz:Puzzle)-[:HAS_THEME]->(t:Theme)
RETURN t.name AS theme, count(pz) AS puzzles
ORDER BY puzzles DESC
LIMIT 10
```

**In plain terms:** Count how many puzzles exist for each tactical skill (forks, pins, sacrifices, etc.) and show the 10 most common ones.

**How it works:** HAS_THEME connects each Puzzle to one or more Theme nodes (fork, pin, sacrifice, etc.). A single puzzle can have multiple themes, so one puzzle may appear in several groups. `count(pz)` groups by theme and counts how many puzzles carry that tag.

**Traversal steps:**
1. Neo4j finds all Puzzle nodes via the label index
2. For each Puzzle, it follows all outgoing HAS_THEME relationships to reach the connected Theme nodes
3. It groups the results by Theme and counts the puzzles in each group
4. Results are sorted by count descending and the top 10 themes are returned

### 8. A user's weaknesses

The STRUGGLED_WITH relationship connects users to themes they find difficult. This is derived from failed puzzle attempts — if a user fails a puzzle tagged "fork", they get a STRUGGLED_WITH edge to the fork theme.

```cypher
MATCH (u:User {userId: 'seed_user_0'})-[:STRUGGLED_WITH]->(t:Theme)
RETURN u.userId AS user, t.name AS weak_theme
ORDER BY weak_theme
```

**In plain terms:** Look up a specific user and list all the tactical skills they struggle with.

**How it works:** STRUGGLED_WITH is a derived relationship created during data loading based on a user's failed puzzle attempts. If a user fails a puzzle tagged with "fork", the loader creates a STRUGGLED_WITH edge from the User to the "fork" Theme. This query reads those edges directly — no computation at query time.

**Traversal steps:**
1. Neo4j finds the User node where `userId = 'seed_user_0'`
2. From that User, it follows all outgoing STRUGGLED_WITH relationships to reach Theme nodes
3. It reads the `name` property from each connected Theme
4. Results are sorted alphabetically by theme name

### 9. Adaptive puzzle recommendation

This is the core Coach AI query. It follows the full path: User -> STRUGGLED_WITH -> Theme <- HAS_THEME <- Puzzle. The `NOT EXISTS` subquery filters out puzzles the user has already attempted. Results are ranked by how close the puzzle rating is to 1200 (a typical intermediate player). `collect()` gathers matching themes into a list.

```cypher
MATCH (u:User {userId: 'seed_user_0'})-[:STRUGGLED_WITH]->(t:Theme)
MATCH (pz:Puzzle)-[:HAS_THEME]->(t)
WHERE NOT EXISTS { MATCH (u)-[:ATTEMPTED]->(pz) }
RETURN pz.puzzleId AS puzzle, pz.rating AS rating,
       collect(t.name) AS targets_weaknesses
ORDER BY abs(pz.rating - 1200)
LIMIT 5
```

**In plain terms:** Find puzzles that target this user's weaknesses, skip any they've already tried, and pick the 5 closest to their skill level. This is the query a chess coach would use to assign homework.

**How it works:** This is the core recommendation engine. Two MATCH clauses build a chain: User → STRUGGLED_WITH → Theme ← HAS_THEME ← Puzzle. The `NOT EXISTS` subquery acts as an anti-join — it excludes any puzzle the user has already attempted. `collect(t.name)` aggregates all matching weakness themes into a single list per puzzle (a puzzle may target multiple weaknesses). `abs(pz.rating - 1200)` ranks puzzles by proximity to a target difficulty.

**Traversal steps:**
1. Neo4j finds User `seed_user_0` and follows STRUGGLED_WITH edges to get the user's weak themes
2. For each weak Theme, it follows incoming HAS_THEME relationships backwards to find all Puzzles tagged with that theme
3. For each candidate Puzzle, it checks whether an ATTEMPTED relationship exists from the User to that Puzzle — if so, the puzzle is filtered out
4. Remaining puzzles are grouped by puzzleId, and their matching theme names are collected into a list
5. Results are sorted by how close the puzzle rating is to 1200 and the top 5 are returned

### 10. Practice capacity per weakness

A three-hop traversal that answers: "for each of this user's weak themes, how many unattempted puzzles are available?" This is the data the Coach AI would use to decide which weakness to prioritize — themes with more available puzzles give more room for practice.

```cypher
MATCH (u:User {userId: 'seed_user_0'})-[:STRUGGLED_WITH]->(t:Theme)<-[:HAS_THEME]-(pz:Puzzle)
WHERE NOT EXISTS { MATCH (u)-[:ATTEMPTED]->(pz) }
RETURN t.name AS weak_theme, count(pz) AS available_puzzles,
       toInteger(avg(pz.rating)) AS avg_rating
ORDER BY available_puzzles DESC
LIMIT 10
```

**In plain terms:** For each skill a user is weak at, count how many unseen practice puzzles are available and what their average difficulty is. This tells the coach which weaknesses have the most material to work with.

**How it works:** This extends query 9 by grouping results per theme instead of per puzzle. The same three-hop traversal (User → Theme ← Puzzle) is written as a single MATCH pattern. `count(pz)` and `avg(pz.rating)` aggregate per theme, showing how much practice material exists for each weakness and its average difficulty.

**Traversal steps:**
1. Neo4j finds User `seed_user_0` and follows STRUGGLED_WITH edges to the user's weak themes
2. For each Theme, it follows incoming HAS_THEME relationships to find all tagged Puzzles
3. The `NOT EXISTS` subquery filters out puzzles the user has already attempted
4. Remaining puzzles are grouped by theme — Neo4j counts them and averages their ratings
5. Results are sorted by available puzzle count descending, returning the top 10 themes

### 11. Depth of opening theory

The `*1..30` syntax matches variable-length paths with an upper bound. Always bound variable-length paths to prevent combinatorial explosion. Here we find the longest THEORY_MOVE chain from the starting position that stays within each opening's tree. Max opening theory depth is ~28 plies.

```cypher
MATCH (o:Opening)<-[:IN_OPENING]-(start:Position)
WHERE start.fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
MATCH path = (start)-[:THEORY_MOVE*1..30]->(end:Position)-[:IN_OPENING]->(o)
RETURN o.eco AS eco, o.name AS opening, max(length(path)) AS depth
ORDER BY depth DESC
LIMIT 10
```

**In plain terms:** For each opening, find the longest sequence of book moves — the deepest the theory goes before you're "out of book." This shows which openings have been analyzed the most moves deep.

**How it works:** The `*1..30` syntax is a variable-length path — Neo4j explores all THEORY_MOVE chains from 1 to 30 hops. The second MATCH requires the final position to also belong to the same opening (`-[:IN_OPENING]->(o)`), ensuring the path stays within that opening's tree. `max(length(path))` finds the longest such chain per opening. The upper bound of 30 prevents runaway expansion.

**Traversal steps:**
1. Neo4j finds each Opening and its starting Position (the initial board position linked via IN_OPENING)
2. From that starting position, it expands all possible THEORY_MOVE chains up to 30 hops deep
3. At each endpoint, it checks whether that Position also has an IN_OPENING edge back to the same Opening
4. For each valid path, it records the length — then groups by Opening and takes the maximum
5. Results are sorted by depth descending, returning the 10 openings with the deepest theory

### 12. Opening-scoped puzzles

This is the opening-scoped analysis query. It joins all three layers: Opening <- IN_OPENING <- Position <- STARTS_FROM <- Puzzle. The result is every puzzle whose starting position falls within a specific opening's tree — powering queries like "show me tactical exercises for the Italian Game."

```cypher
MATCH (o:Opening {eco: 'C50'})<-[:IN_OPENING]-(p:Position)<-[:STARTS_FROM]-(pz:Puzzle)
RETURN pz.puzzleId AS puzzle, pz.rating AS rating,
       left(p.fen, 40) AS position
ORDER BY pz.rating DESC
LIMIT 10
```

**In plain terms:** Find all puzzles that arise from positions in the Italian Game. This is how a coach would say "practice tactics from the opening you're studying."

**How it works:** This joins three layers of the graph in a single pattern: Opening ← Position ← Puzzle. It finds puzzles whose starting position falls within a specific opening's theory tree. This is the query that powers "show me tactical exercises for the Italian Game" — it works because Position nodes are shared hubs connecting openings and puzzles.

**Traversal steps:**
1. Neo4j finds the Opening node where `eco = 'C50'`
2. From that Opening, it follows incoming IN_OPENING relationships to find all Position nodes in the Italian Game tree
3. For each of those Positions, it follows incoming STARTS_FROM relationships to find Puzzles that begin at that position
4. It reads puzzle and position properties, sorts by rating descending, and returns the top 10

### 13. Games by opening

Find all games that used a specific ECO code. The `eco` property is stored directly on Game nodes for fast lookup.

```cypher
MATCH (g:Game {eco: 'C55'})
RETURN g.gameId AS id, g.eco AS eco, g.result AS result
ORDER BY g.gameId
LIMIT 10
```

**In plain terms:** List 10 games that used a specific opening (the Two Knights Defense, C55), showing each game's result.

**How it works:** A straightforward property lookup — no relationship traversal. The `eco` property is stored directly on Game nodes so you can filter games by opening code without joining through Opening or Position nodes.

**Traversal steps:**
1. Neo4j finds all Game nodes where `eco = 'C55'` (uses property index if available, otherwise label scan with filter)
2. For each matching Game, it reads the `gameId`, `eco`, and `result` properties
3. Results are sorted by gameId and the first 10 are returned

### 14. Replay a game's position chain

Follow a single game from start to finish. HAS_MOVE points to the first position, then GAME_MOVE (indexed on gameId) walks the full move sequence. The upper bound of 200 covers the longest possible chess game.

```cypher
MATCH (g:Game {eco: 'C50'})-[:HAS_MOVE]->(start:Position)
WITH g, start LIMIT 1
MATCH path = (start)-[:GAME_MOVE*1..200 {gameId: g.gameId}]->(final:Position)
WHERE NOT (final)-[:GAME_MOVE {gameId: g.gameId}]->()
RETURN g.gameId AS game, length(path) AS total_moves,
       left(start.fen, 40) AS start_pos, left(final.fen, 40) AS final_pos
```

**In plain terms:** Pick one Italian Game and walk through every move from the opening position to the final position, showing how many moves the game lasted.

**How it works:** This replays a full game move-by-move through the graph. HAS_MOVE points from a Game to its first Position. GAME_MOVE relationships form a linked list of positions for that game, with the `gameId` property distinguishing moves that belong to different games (since Position nodes are shared). The `WHERE NOT` clause finds the terminal position — the one with no outgoing GAME_MOVE for this game. `WITH ... LIMIT 1` restricts to a single game to keep the variable-length expansion manageable.

**Traversal steps:**
1. Neo4j finds a Game node where `eco = 'C50'` and follows its HAS_MOVE edge to the starting Position
2. `WITH g, start LIMIT 1` passes only one game forward (prevents expanding multiple games)
3. From the starting Position, Neo4j expands variable-length GAME_MOVE paths (1 to 200 hops), filtering each edge to match the game's `gameId`
4. The `WHERE NOT` clause keeps only the path that ends at the final position — where no further GAME_MOVE with this gameId exists
5. It returns the game ID, total move count, and the FEN of the first and last positions

### 15. Cross-dataset connectivity — positions shared between openings and games

The Position-as-hub design means opening skeleton positions are reused by games that pass through them. This query shows which opening positions appear most frequently in actual games.

```cypher
MATCH (p:Position)-[:IN_OPENING]->(o:Opening)
WITH p, o
MATCH (g:Game)-[:HAS_MOVE|GAME_MOVE*1..10]->(p)
RETURN o.eco AS eco, left(p.fen, 40) AS position,
       count(DISTINCT g) AS games_through_position
ORDER BY games_through_position DESC
LIMIT 10
```

**In plain terms:** Find which opening book positions show up most often in real games. These are the critical crossroads where theory meets practice — the positions a student should know best.

**How it works:** This query demonstrates the "Position as hub" design. Position nodes are shared across openings and games — the same node that represents a board state in opening theory is also referenced by games that reach that position. The `HAS_MOVE|GAME_MOVE*1..10` syntax follows either relationship type in a variable-length expansion, finding games that pass through opening positions within 10 moves. `count(DISTINCT g)` ensures each game is counted once even if multiple paths reach the same position.

**Traversal steps:**
1. Neo4j finds all Position nodes that have an IN_OPENING relationship to an Opening (the opening skeleton positions)
2. For each of those Positions, it looks for Game nodes that can reach it via a chain of HAS_MOVE or GAME_MOVE hops (up to 10 deep)
3. `count(DISTINCT g)` counts how many unique games pass through each position
4. Results are sorted by game count descending — the top 10 are the most commonly visited opening positions in actual play

---

## Additional Data Available in the Games NDJSON

The games loader currently stores `gameId`, `result`, and `eco` on each Game node. The source NDJSON file contains additional fields that could be loaded in the future:

| Field | Description |
|-------|-------------|
| `players.white.rating` / `players.black.rating` | Player Elo ratings at time of game |
| `players.white.user.name` / `players.black.user.name` | Lichess usernames |
| `speed` | Time control category (rapid, classical, etc.) |
| `clock.initial` / `clock.increment` | Time control settings (seconds) |
| `clocks` | Array of clock times (centiseconds) at each move |
| `status` | Game termination reason (resign, mate, outoftime, draw, etc.) |
| `rated` | Whether the game was rated |
| `opening.name` | Full opening name (e.g. "Italian Game: Two Knights Defense") |
| `opening.ply` | Number of half-moves in the opening phase |
| `createdAt` / `lastMoveAt` | Timestamps (milliseconds since epoch) |
