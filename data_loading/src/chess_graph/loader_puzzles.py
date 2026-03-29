import json
from chess_graph.config import ITALIAN_GAME, PUZZLE_TAG_TO_ECO, PUZZLES_DIR
from chess_graph.db import run_batch, driver


def load():
    tag = ITALIAN_GAME["puzzle_tag"]

    # Collect all FENs already in the graph (from openings loader)
    with driver.session() as s:
        in_graph_fens = {
            r["fen"] for r in s.run("MATCH (p:Position) RETURN p.fen AS fen")
        }
    print(f"  {len(in_graph_fens)} positions already in graph")

    # Scan all bundled puzzle JSONs
    puzzles = []
    seen_ids: set[str] = set()

    for json_file in PUZZLES_DIR.rglob("*.json"):
        data = json.loads(json_file.read_text())
        if not isinstance(data, list):
            continue
        for p in data:
            pid = p["id"]
            if pid in seen_ids:
                continue
            # Match by opening tag OR by FEN overlap
            tags = p.get("openingTags") or ""
            if tag in tags or p["fen"] in in_graph_fens:
                seen_ids.add(pid)
                puzzles.append(p)

    print(f"  matched {len(puzzles)} puzzles (by tag or FEN overlap)")

    # Build rows for batch insert
    puzzle_rows = [
        {
            "puzzleId": p["id"],
            "fen": p["fen"],
            "moves": " ".join(p["moves"]),
            "rating": p["rating"],
            "popularity": p["popularity"],
            "nbPlays": p["nbPlays"],
            "themes": " ".join(p["themes"]) if p["themes"] else "",
        }
        for p in puzzles
    ]

    run_batch(
        """
        UNWIND $rows AS row
        MERGE (p:Position {fen: row.fen})
        MERGE (pz:Puzzle {puzzleId: row.puzzleId})
        ON CREATE SET
            pz.rating     = toInteger(row.rating),
            pz.popularity = toInteger(row.popularity),
            pz.nbPlays    = toInteger(row.nbPlays),
            pz.moves      = row.moves
        MERGE (pz)-[:STARTS_FROM]->(p)
        WITH pz, row
        UNWIND split(row.themes, ' ') AS themeName
        WITH pz, themeName WHERE themeName <> ''
        MERGE (t:Theme {name: themeName})
        MERGE (pz)-[:HAS_THEME]->(t)
        """,
        puzzle_rows,
    )

    print(f"  loaded {len(puzzle_rows)} puzzles")

    # Link puzzles to openings via FROM_OPENING using sub-tag → ECO mapping
    opening_rows = []
    for p in puzzles:
        tags = (p.get("openingTags") or "").split()
        subtag = tags[1] if len(tags) > 1 else tags[0] if tags else ""
        eco = PUZZLE_TAG_TO_ECO.get(subtag)
        if eco:
            opening_rows.append({"puzzleId": p["id"], "eco": eco})

    if opening_rows:
        run_batch(
            """
            UNWIND $rows AS row
            MATCH (pz:Puzzle {puzzleId: row.puzzleId})
            MATCH (o:Opening {eco: row.eco})
            MERGE (pz)-[:FROM_OPENING]->(o)
            """,
            opening_rows,
        )
    print(f"  linked {len(opening_rows)} puzzles to openings via FROM_OPENING")
