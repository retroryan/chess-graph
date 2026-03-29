"""
Sample Cypher Queries — A tutorial walkthrough of the chess graph.

Each section demonstrates a Cypher concept using the loaded Italian Game data.
Run with: uv run sample-queries

Note: These tutorial queries use hard-coded literal values (e.g. 'C50',
'seed_user_0') for readability. In production, all dynamic values should use
Cypher $parameters for security (prevents injection) and performance (enables
query plan caching).
"""

from chess_graph.db import driver

SEPARATOR = "\n" + "=" * 70 + "\n"


def run(title: str, explanation: str, query: str, **params):
    """Run a query, print the explanation and results."""
    print(SEPARATOR)
    print(f"## {title}")
    print()
    print(explanation)
    print()
    print("Cypher:")
    print(query.strip())
    print()
    with driver.session() as s:
        result = s.run(query, **params)
        records = list(result)
        if not records:
            print("(no results)")
            return records
        keys = records[0].keys()
        # Print as a simple table
        widths = {k: max(len(k), max(len(str(r[k])) for r in records)) for k in keys}
        header = " | ".join(k.ljust(widths[k]) for k in keys)
        print(header)
        print("-+-".join("-" * widths[k] for k in keys))
        for r in records:
            print(" | ".join(str(r[k]).ljust(widths[k]) for k in keys))
        print(f"\n({len(records)} rows)")
        return records


def section_1_schema():
    run(
        "1. Graph schema — What's connected to what?",
        """Before exploring data, see the shape of the graph. This query finds every
distinct relationship pattern (from-label → relationship → to-label) in the
database. It's a quick way to understand the data model without visualisation.""",
        """
MATCH (a)-[r]->(b)
RETURN DISTINCT labels(a)[0] AS from, type(r) AS relationship, labels(b)[0] AS to
ORDER BY from, relationship
""",
    )


def section_2_match_basics():
    run(
        "2. MATCH basics — What's in the graph?",
        """MATCH finds patterns in the graph. Here we count every node by its label.
The labels() function returns a list of labels on a node. We group by label
and count, just like SQL's GROUP BY.""",
        """
MATCH (n)
RETURN labels(n)[0] AS label, count(n) AS count
ORDER BY count DESC
""",
    )


def section_3_node_properties():
    run(
        "3. Node properties — Browse openings",
        """Each Opening node has an eco code and a name. LIMIT works like SQL.
The WHERE clause filters by property — here we look at C50-C54.""",
        """
MATCH (o:Opening)
WHERE o.eco <= 'C54'
RETURN o.eco AS eco, o.name AS name
ORDER BY o.eco
LIMIT 10
""",
    )


def section_4_relationships():
    run(
        "4. Relationships — Positions in an opening",
        """Arrow syntax (-[:REL_TYPE]->) matches relationships. This finds all
Position nodes linked to the Italian Game (C50) via IN_OPENING.
count() tells us how many positions define this opening's tree.""",
        """
MATCH (p:Position)-[:IN_OPENING]->(o:Opening {eco: 'C50'})
RETURN o.name AS opening, count(p) AS positions
""",
    )


def section_5_traversal():
    run(
        "5. Traversal — Follow the opening moves",
        """THEORY_MOVE connects positions in the opening skeleton. The {san} property
stores the move in Standard Algebraic Notation. Starting from the initial
board position, we walk 3 hops to see the Italian Game's first moves.""",
        """
MATCH (start:Position {fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'})
      -[m1:THEORY_MOVE]->(p1:Position)
      -[m2:THEORY_MOVE]->(p2:Position)
      -[m3:THEORY_MOVE]->(p3:Position)
WHERE m1.san = 'e4' AND m2.san = 'e5' AND m3.san = 'Nf3'
RETURN m1.san AS move1, m2.san AS move2, m3.san AS move3,
       left(p3.fen, 40) AS position_after_3_moves
""",
    )


def section_6_puzzles():
    run(
        "6. Puzzles — Find the hardest Italian Game puzzles",
        """Puzzle nodes have a rating (higher = harder). STARTS_FROM links each
puzzle to the board position where it begins. ORDER BY + LIMIT gives us
the top 5 hardest puzzles in the dataset.""",
        """
MATCH (pz:Puzzle)-[:STARTS_FROM]->(p:Position)
RETURN pz.puzzleId AS id, pz.rating AS rating, pz.moves AS solution,
       left(p.fen, 40) AS starting_position
ORDER BY pz.rating DESC
LIMIT 5
""",
    )


def section_7_themes():
    run(
        "7. Themes — Most common tactical patterns",
        """Each puzzle is tagged with tactical themes (fork, pin, sacrifice, etc.)
via HAS_THEME. This aggregation counts how many puzzles use each theme —
the chess equivalent of 'what skills does this opening test?'""",
        """
MATCH (pz:Puzzle)-[:HAS_THEME]->(t:Theme)
RETURN t.name AS theme, count(pz) AS puzzles
ORDER BY puzzles DESC
LIMIT 10
""",
    )


def section_8_user_weaknesses():
    run(
        "8. User weaknesses — STRUGGLED_WITH",
        """The adaptive learning path: a user fails puzzles, those puzzles have
themes, and the STRUGGLED_WITH relationship captures the connection.
This query shows which themes a specific user finds difficult.""",
        """
MATCH (u:User {userId: 'seed_user_0'})-[:STRUGGLED_WITH]->(t:Theme)
RETURN u.userId AS user, t.name AS weak_theme
ORDER BY weak_theme
""",
    )


def section_9_recommendation():
    run(
        "9. Puzzle recommendation — The full adaptive query",
        """This is the core Coach AI query. Starting from a user's weaknesses,
find puzzles they haven't attempted that target those weak themes.
The NOT EXISTS pattern filters out already-attempted puzzles.
We rank by rating closeness to 1200 (a typical intermediate player).""",
        """
MATCH (u:User {userId: 'seed_user_0'})-[:STRUGGLED_WITH]->(t:Theme)
MATCH (pz:Puzzle)-[:HAS_THEME]->(t)
WHERE NOT EXISTS { MATCH (u)-[:ATTEMPTED]->(pz) }
RETURN pz.puzzleId AS puzzle, pz.rating AS rating,
       collect(t.name) AS targets_weaknesses
ORDER BY abs(pz.rating - 1200)
LIMIT 5
""",
    )


def section_10_opening_analysis():
    run(
        "10. Multi-hop analysis — Practice capacity per user weakness",
        """A three-hop traversal: User -> STRUGGLED_WITH -> Theme <- HAS_THEME <- Puzzle.
For each user's weak theme, count how many unattempted puzzles are available.
This is the data the Coach AI uses to decide what to recommend next.""",
        """
MATCH (u:User {userId: 'seed_user_0'})-[:STRUGGLED_WITH]->(t:Theme)<-[:HAS_THEME]-(pz:Puzzle)
WHERE NOT EXISTS { MATCH (u)-[:ATTEMPTED]->(pz) }
RETURN t.name AS weak_theme, count(pz) AS available_puzzles,
       toInteger(avg(pz.rating)) AS avg_rating
ORDER BY available_puzzles DESC
LIMIT 10
""",
    )


def section_11_variable_length():
    run(
        "11. Variable-length paths — Depth of opening theory",
        """The *1..30 syntax matches paths of variable length with an upper bound.
Always bound variable-length paths to prevent combinatorial explosion.
Here we find the longest THEORY_MOVE chain from the starting position that
stays within a single opening's tree. Max opening theory depth is ~28 plies.""",
        """
MATCH (o:Opening)<-[:IN_OPENING]-(start:Position)
WHERE start.fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
MATCH path = (start)-[:THEORY_MOVE*1..30]->(end:Position)-[:IN_OPENING]->(o)
RETURN o.eco AS eco, o.name AS opening, max(length(path)) AS depth
ORDER BY depth DESC
LIMIT 10
""",
    )


def section_12_opening_scoped_puzzles():
    run(
        "12. Opening-scoped puzzles — Puzzles from a specific variation",
        """FROM_OPENING links each puzzle to its opening based on the puzzle's
opening tags from the Lichess database. Puzzle positions are typically deep
in the middlegame — well past the opening skeleton — so this direct
relationship is the reliable way to scope puzzles by opening.

Design lesson: an earlier version of this query tried to traverse
Opening <- IN_OPENING <- Position <- STARTS_FROM <- Puzzle, which returned
zero results. The opening skeleton only covers ~13-28 plies of theory, but
puzzles arise from positions 30-60+ moves into a game. Those middlegame
FENs will never appear in the opening tree. The fix was to create a direct
FROM_OPENING relationship during data loading using the Lichess opening tags
that are already present in the puzzle source data. This turns an empty
result set into hundreds of actionable puzzles per variation.""",
        """
MATCH (pz:Puzzle)-[:FROM_OPENING]->(o:Opening {eco: 'C54'})
MATCH (pz)-[:STARTS_FROM]->(p:Position)
RETURN pz.puzzleId AS puzzle, pz.rating AS rating,
       left(p.fen, 40) AS position
ORDER BY pz.rating DESC
LIMIT 10
""",
    )


def section_13_games_by_opening():
    run(
        "13. Games by opening — Lichess games per ECO code",
        """Game nodes come from the Lichess API downloader. Each has a gameId,
result (1-0, 0-1, 1/2-1/2), and eco code. This groups games by ECO
to see which Italian Game sub-variations appear most in our dataset.""",
        """
MATCH (g:Game)
RETURN g.eco AS eco, count(g) AS games,
       count(CASE WHEN g.result = '1-0' THEN 1 END) AS white_wins,
       count(CASE WHEN g.result = '0-1' THEN 1 END) AS black_wins,
       count(CASE WHEN g.result = '1/2-1/2' THEN 1 END) AS draws
ORDER BY games DESC
""",
    )


def section_14_opening_hub():
    run(
        "14. Opening as hub — Games and puzzles per variation",
        """FROM_OPENING connects both Games and Puzzles directly to Opening nodes,
making Opening a central hub for the entire dataset. This single query fans
out to both datasets from the Opening node — something that wasn't possible
when games and puzzles only linked to Positions. Without FROM_OPENING, you'd
need to join through Position nodes (expensive) or match on property values
(losing the graph traversal advantage).""",
        """
MATCH (o:Opening)
OPTIONAL MATCH (g:Game)-[:FROM_OPENING]->(o)
WITH o, count(g) AS games
OPTIONAL MATCH (pz:Puzzle)-[:FROM_OPENING]->(o)
RETURN o.eco AS eco, o.name AS opening, games, count(pz) AS puzzles
ORDER BY o.eco
""",
    )


def section_15_replay_game():
    # Performance note: This variable-length path with property filter could be
    # rewritten as a Quantified Path Pattern (QPP) for better performance in
    # production. QPP allows inline filtering during traversal rather than
    # post-expansion filtering. The legacy *1..200 syntax is used here for
    # tutorial clarity.
    run(
        "15. Replay a game — Follow a game's position chain",
        """HAS_MOVE points from a Game to its starting position. GAME_MOVE edges
(indexed on gameId) walk the full move sequence. The upper bound of 200
covers the longest possible chess game (~180 half-moves).""",
        """
MATCH (g:Game {eco: 'C50'})-[:HAS_MOVE]->(start:Position)
WITH g, start LIMIT 1
MATCH path = (start)-[:GAME_MOVE*1..200 {gameId: g.gameId}]->(final:Position)
WHERE NOT (final)-[:GAME_MOVE {gameId: g.gameId}]->()
RETURN g.gameId AS game, length(path) AS total_moves,
       left(start.fen, 40) AS start_pos, left(final.fen, 40) AS final_pos
""",
    )


def section_16_cross_dataset():
    run(
        "16. Cross-dataset connectivity — Where games diverge from opening theory",
        """The Position-as-hub design means opening skeleton positions are reused by
games that pass through them. This query finds divergence points — opening
positions where games branch into multiple different continuations. The
'branches' column shows how many distinct next moves were played.

Design lesson: an earlier version sorted by games_through_position DESC,
but every game passes through the same early moves (e4, e5, Nf3, Nc6, Bc4),
so the top rows all showed 440 games — technically correct but uninteresting.
Counting distinct next-move targets and filtering for branches > 1 surfaces
the real decision points: where do players actually diverge? The ecos list
reveals which openings share each branching position, showing the Position-
as-hub design in action.""",
        """
MATCH (p:Position)-[:IN_OPENING]->(o:Opening)
WITH p, collect(DISTINCT o.eco) AS ecos
MATCH (p)-[gm:GAME_MOVE]->(next:Position)
WITH ecos, left(p.fen, 40) AS position,
     count(DISTINCT gm.gameId) AS games, count(DISTINCT next) AS branches
WHERE branches > 1
RETURN ecos, position, games, branches
ORDER BY branches DESC, games DESC
LIMIT 10
""",
    )


def main():
    print("Chess Graph — Sample Cypher Queries")
    print("Each section demonstrates a Cypher concept using the Italian Game data.")

    section_1_schema()
    section_2_match_basics()
    section_3_node_properties()
    section_4_relationships()
    section_5_traversal()
    section_6_puzzles()
    section_7_themes()
    section_8_user_weaknesses()
    section_9_recommendation()
    section_10_opening_analysis()
    section_11_variable_length()
    section_12_opening_scoped_puzzles()
    section_13_games_by_opening()
    section_14_opening_hub()
    section_15_replay_game()
    section_16_cross_dataset()

    print(SEPARATOR)
    print("Tutorial complete.")


if __name__ == "__main__":
    main()
