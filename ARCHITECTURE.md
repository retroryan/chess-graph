# Graph Model Architecture

A chess coaching app needs to connect board positions to puzzles, puzzles to tactical themes, games to openings, and users to the skills they need to practice. In a relational database, answering "find unattempted puzzles that target this user's weaknesses" requires joining across five or six tables. In a graph, that same question is a single traversal: User -> STRUGGLED_WITH -> Theme <- HAS_THEME <- Puzzle.

This document walks through the graph model that makes those traversals possible. It covers each node type, each relationship, and the design decisions behind them. If you are new to graph databases, the Cypher examples throughout will orient you. If you want to load this model into a Neo4j instance and run queries against it, see the [data loading guide](data_loading/README.md).

## The Model

![Chess Coach AI — Graph Model](simplified-chess-graph.png)

Six node types and nine relationship types, with Position at the center as a shared hub. Games replay through positions, puzzles start from positions, and openings catalog positions. Every cross-dataset query passes through Position nodes.

The total footprint is approximately 28,000 nodes and 37,000 relationships, about 14% of the Neo4j Aura free tier's node budget and 9% of its relationship budget. Small enough to run at no cost.

## Nodes

Graph databases store entities as nodes. Each node carries a label (its type) and properties (its data). In Neo4j's Cypher query language, creating a node looks like this:

```cypher
CREATE (p:Position {fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'})
```

This creates a node with the label `Position` and a single property `fen`. The label acts like a table name in SQL; properties act like column values. Unlike SQL, different nodes with the same label can carry different properties, though a consistent schema makes queries simpler in practice.

### Position

| Property | Description |
|----------|-------------|
| `fen` | Board state in Forsyth-Edwards Notation (primary key) |

Position is the hub of the entire graph. Every board state that appears in an opening, a game, or a puzzle is stored as a single Position node identified by its FEN string. FEN encodes a complete chess position in one line of text: piece placement, whose turn it is, castling rights, en passant square, and move counters.

The critical design choice is that Position nodes are shared. When a game passes through the same board state as an opening or a puzzle, they all point to the same Position node rather than creating duplicates. This is what makes cross-dataset queries possible. A single `MATCH` from a Position node can fan out to the opening it belongs to, the games that passed through it, and the puzzles that start from it.

The graph contains approximately 25,000 Position nodes, making it the most numerous node type by a wide margin.

### Game

| Property | Description |
|----------|-------------|
| `gameId` | Lichess game identifier |
| `result` | Outcome: white win, black win, or draw |
| `eco` | ECO code of the opening played |

Each Game node represents a single Lichess game. Games connect to the position graph through HAS_MOVE (pointing to the game's first position) and a chain of GAME_MOVE relationships that replay every move from start to finish. A FROM_OPENING relationship connects each game directly to its Opening node, providing a shortcut that avoids traversing through Position nodes.

### Puzzle

| Property | Description |
|----------|-------------|
| `puzzleId` | Lichess puzzle identifier |
| `rating` | Difficulty rating (Glicko system) |
| `moves` | Solution move sequence in UCI notation |
| `popularity` | Engagement score from Lichess |
| `nbPlays` | Total number of attempts on Lichess |

Puzzles are tactical problems sourced from the Lichess puzzle database. Each puzzle begins at a specific board position (connected via STARTS_FROM) and carries a difficulty rating. Puzzles connect to themes through HAS_THEME, which is what makes adaptive recommendations possible: a puzzle rated 1400 tagged with "fork" and "pin" can be recommended to any user who struggles with either skill. A FROM_OPENING relationship links each puzzle directly to its Opening, bypassing the Position layer entirely. This shortcut is necessary because puzzle starting positions are deep middlegame FENs that do not appear in the opening skeleton.

### Opening

| Property | Description |
|----------|-------------|
| `eco` | Encyclopedia of Chess Openings code (e.g., C50) |
| `name` | Human-readable name (e.g., "Italian Game: Giuoco Pianissimo") |

Each Opening node represents one entry in the Encyclopedia of Chess Openings. This dataset covers ECO codes C50 through C59, the Italian Game family. Openings connect to Position nodes through IN_OPENING, forming a tree structure of each opening's theoretical move sequence. Games and Puzzles also connect to Openings directly through FROM_OPENING, making Opening a hub for querying across all three datasets in a single traversal.

### Theme

| Property | Description |
|----------|-------------|
| `name` | Tactical skill name (fork, pin, skewer, sacrifice, etc.) |

Theme nodes represent tactical skills. Each theme carries a simple `name` property.

Themes are the bridge between puzzles and users. HAS_THEME tags puzzles with the skills they test. STRUGGLED_WITH connects users to the themes they find difficult. Together, these two relationships form the traversal path that powers the recommendation query.

### User

| Property | Description |
|----------|-------------|
| `userId` | Unique user identifier |

User nodes represent individual learners. In the current dataset, 10 seed users are generated with simulated puzzle attempts. Each user has ATTEMPTED relationships to puzzles (recording whether they solved each one) and STRUGGLED_WITH relationships to themes (derived from their failed attempts).

## Relationships

Relationships in a graph database are first-class citizens, not join tables. Each relationship has a type, a direction, and optional properties. In Cypher, you create a relationship between existing nodes like this:

```cypher
MATCH (g:Game {gameId: 'abc123'})
MATCH (p:Position {fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'})
CREATE (g)-[:HAS_MOVE]->(p)
```

This creates a directed relationship of type `HAS_MOVE` from the Game to the Position. Direction matters: `(g)-[:HAS_MOVE]->(p)` only matches outgoing relationships from `g`. You can also store properties on relationships, as the ATTEMPTED and GAME_MOVE examples below demonstrate.

### HAS_MOVE

**Direction:** `(Game)-[:HAS_MOVE]->(Position)`

Points from a Game to the first Position in that game's move sequence. Every game has exactly one HAS_MOVE relationship, serving as the entry point for replaying the game through its GAME_MOVE chain.

### THEORY_MOVE

**Direction:** `(Position)-[:THEORY_MOVE]->(Position)`
**Properties:** `san` (Standard Algebraic Notation, e.g., "e4", "Nf3")

Connects consecutive positions in the opening book skeleton. Following THEORY_MOVE edges from the starting position walks through an opening's theoretical move order.

These relationships form a tree rooted at the starting position. Multiple openings share early moves (1.e4 e5 2.Nf3 is common to all C5x openings), so the tree branches as openings diverge. Depth varies from roughly 13 to 28 plies depending on the variation.

```cypher
-- Walk the first three moves of the Italian Game
MATCH (start:Position {fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'})
      -[m1:THEORY_MOVE]->(p1)-[m2:THEORY_MOVE]->(p2)-[m3:THEORY_MOVE]->(p3)
WHERE m1.san = 'e4' AND m2.san = 'e5' AND m3.san = 'Nf3'
RETURN m1.san, m2.san, m3.san, p3.fen
```

### GAME_MOVE

**Direction:** `(Position)-[:GAME_MOVE]->(Position)`
**Properties:** `gameId`, `san`, `ply`

Connects consecutive positions in a game's move sequence. Unlike THEORY_MOVE, which represents opening theory, GAME_MOVE records actual moves played in real games. The `gameId` property is essential because Position nodes are shared: the same board state might appear in dozens of games, so `gameId` disambiguates which edges belong to which game.

To replay a specific game, start from the Position connected via HAS_MOVE and follow GAME_MOVE edges filtered by `gameId`:

```cypher
MATCH (g:Game {eco: 'C50'})-[:HAS_MOVE]->(start:Position)
WITH g, start LIMIT 1
MATCH path = (start)-[:GAME_MOVE*1..200 {gameId: g.gameId}]->(final)
WHERE NOT (final)-[:GAME_MOVE {gameId: g.gameId}]->()
RETURN g.gameId, length(path) AS total_moves
```

### STARTS_FROM

**Direction:** `(Puzzle)-[:STARTS_FROM]->(Position)`

Links each puzzle to the board position where it begins. Every puzzle has exactly one STARTS_FROM relationship. Because Position nodes are shared, this connection allows queries that reach from puzzles back into the opening tree or game history through their common board states.

### IN_OPENING

**Direction:** `(Position)-[:IN_OPENING]->(Opening)`

Tags positions as belonging to a particular opening variation. The THEORY_MOVE tree defines the move order; IN_OPENING labels which ECO code each position falls under. A position early in the Italian Game tree (after 1.e4 e5 2.Nf3 Nc6) belongs to multiple ECO codes because several C5x variations share those moves before diverging.

### FROM_OPENING

**Direction:** `(Game)-[:FROM_OPENING]->(Opening)` and `(Puzzle)-[:FROM_OPENING]->(Opening)`

A direct shortcut from Games and Puzzles to their Opening, bypassing the Position layer. This relationship exists because the natural path through Position nodes does not always work. Puzzle starting positions are deep middlegame FENs, 30 to 60+ moves into a game, that never appear in the opening skeleton (which only covers 13 to 28 plies of theory). An earlier version of the model tried `Opening <- IN_OPENING <- Position <- STARTS_FROM <- Puzzle`, which returned zero results. FROM_OPENING solves this by using the opening tags already present in the source data.

For Games, FROM_OPENING provides a convenient shortcut that avoids walking GAME_MOVE chains back to opening-tagged positions. Together, these two FROM_OPENING connections turn Opening into a secondary hub, enabling queries that fan out to both games and puzzles from a single Opening node:

```cypher
-- Count games and puzzles per opening variation
MATCH (o:Opening)
OPTIONAL MATCH (g:Game)-[:FROM_OPENING]->(o)
WITH o, count(g) AS games
OPTIONAL MATCH (pz:Puzzle)-[:FROM_OPENING]->(o)
RETURN o.eco, o.name, games, count(pz) AS puzzles
ORDER BY o.eco
```

### HAS_THEME

**Direction:** `(Puzzle)-[:HAS_THEME]->(Theme)`

Tags a puzzle with the tactical skills it tests. A single puzzle can carry multiple themes: a position requiring a fork followed by a pin gets both tags. This many-to-many connection is what the recommendation engine queries to find puzzles that match a user's weaknesses.

### ATTEMPTED

**Direction:** `(User)-[:ATTEMPTED]->(Puzzle)`
**Properties:** `solved` (boolean)

Records that a user tried a puzzle and whether they solved it. The `solved` boolean drives the computation of STRUGGLED_WITH during data loading: if a user fails puzzles tagged with "fork," the loader creates a STRUGGLED_WITH edge to the fork theme.

ATTEMPTED also serves as a negative filter in recommendation queries. The pattern `NOT EXISTS { MATCH (u)-[:ATTEMPTED]->(pz) }` excludes puzzles the user has already seen:

```cypher
MATCH (u:User {userId: 'seed_user_0'})-[:STRUGGLED_WITH]->(t:Theme)
MATCH (pz:Puzzle)-[:HAS_THEME]->(t)
WHERE NOT EXISTS { MATCH (u)-[:ATTEMPTED]->(pz) }
RETURN pz.puzzleId, pz.rating, collect(t.name) AS targets_weaknesses
ORDER BY abs(pz.rating - 1200)
LIMIT 5
```

### STRUGGLED_WITH

**Direction:** `(User)-[:STRUGGLED_WITH]->(Theme)`

A derived relationship computed during data loading rather than stored in any source dataset. When a user fails puzzles tagged with a particular theme, the loader creates a STRUGGLED_WITH edge connecting the user to that theme. The dashed line in the model diagram reflects this derived nature.

This relationship is the starting point for the adaptive recommendation query. Without it, the system would need to recompute failures at query time by traversing every ATTEMPTED edge, checking `solved=false`, and aggregating themes across all attempts.

## Design Decisions

### Position as Hub

The most important decision in this graph model is making Position the central hub that all other entities connect through. Games replay through Position nodes, puzzles start from them, openings catalog them. This hub pattern means a single Cypher `MATCH` can cross dataset boundaries without joins or denormalization.

The alternative would be to keep games, puzzles, and openings in separate subgraphs connected only by shared property values like ECO codes. That works for simple lookups but falls apart when you need traversals that span datasets. "Find puzzles that start from positions where players frequently deviate from opening theory" requires Position nodes to exist as shared meeting points.

### FEN as Universal Key

FEN strings serve as a natural deduplication key. When a game reaches a board state that already exists as a Position node (because another game or an opening line passed through it), the loader merges into the existing node rather than creating a duplicate. This keeps 500 games from producing 500 x 80 = 40,000 position nodes. Shared positions merge, and the graph grows sublinearly with the number of games loaded.

### Derived Relationships

STRUGGLED_WITH is computed at write time rather than query time. This is a deliberate trade-off: the data loader does more work so that the recommendation query stays fast. Traversing STRUGGLED_WITH takes constant time per user, regardless of how many puzzles they have attempted. Recomputing weaknesses at query time would require aggregating across every ATTEMPTED relationship on every request.

### Relationship Properties for Scoping

GAME_MOVE relationships carry a `gameId` property because Position nodes are shared across games. Without this property, following GAME_MOVE edges from a position would return moves from every game that passed through that board state. The `gameId` filter scopes the traversal to a single game's move sequence.

This pattern (shared nodes with relationship properties for scoping) appears frequently in graph models where the same entity participates in multiple contexts. It preserves the deduplication benefits of shared nodes while keeping traversals precise.

## Building the Graph

To create this graph and start running queries:

1. **Download chess games** from Lichess using the [downloader tool](lichess_api_downloader/README.md)
2. **Set up a free Neo4j Aura instance** and **load the data** following the [data loading guide](data_loading/README.md)
3. **Explore the graph** with the bundled Cypher tutorial:
   ```
   uv run sample-queries
   ```

The data loading guide includes 16 sample Cypher queries with step-by-step explanations. They progress from basic schema inspection (`CALL db.schema.visualization()`) through single-hop matches, multi-hop traversals, variable-length paths, and the full adaptive recommendation query. Each query includes a plain-language description, a breakdown of how it works, and numbered traversal steps showing how Neo4j executes it.
