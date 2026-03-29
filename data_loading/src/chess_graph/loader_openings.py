import csv
import chess
from chess_graph.config import ITALIAN_GAME, OPENINGS_TSV
from chess_graph.db import run_batch


def _in_range(eco: str) -> bool:
    lo, hi = ITALIAN_GAME["eco_range"]
    return lo <= eco <= hi


def _replay_pgn(pgn: str) -> list[tuple[str, str]]:
    """Replay PGN moves, return [(san, fen_after_move), ...].

    The initial board FEN is NOT included — caller handles it separately.
    """
    board = chess.Board()
    result = []
    for token in pgn.split():
        if "." in token:
            continue
        san = board.san(board.parse_san(token))
        board.push_san(token)
        result.append((san, board.fen()))
    return result


def load():
    # Parse c.tsv, filter to Italian Game ECO range
    openings: list[dict] = []
    with open(OPENINGS_TSV) as f:
        for row in csv.DictReader(f, delimiter="\t"):
            if not _in_range(row["eco"]):
                continue
            moves = _replay_pgn(row["pgn"])
            fens = [chess.STARTING_FEN] + [fen for _, fen in moves]
            sans = [san for san, _ in moves]
            openings.append({
                "eco": row["eco"],
                "name": row["name"],
                "fens": fens,
                "sans": sans,
            })

    print(f"  found {len(openings)} opening lines in {ITALIAN_GAME['eco_range']}")

    # Create Opening nodes
    run_batch(
        """
        UNWIND $rows AS row
        MERGE (o:Opening {eco: row.eco})
        ON CREATE SET o.name = row.name
        """,
        openings,
    )

    # Build position + relationship rows
    position_rows = []
    seen_transitions = set()
    for op in openings:
        for i, fen in enumerate(op["fens"]):
            position_rows.append({"fen": fen, "eco": op["eco"]})
            if i > 0:
                key = (op["fens"][i - 1], fen, op["sans"][i - 1])
                if key not in seen_transitions:
                    seen_transitions.add(key)

    # Create Position nodes + IN_OPENING
    run_batch(
        """
        UNWIND $rows AS row
        MERGE (p:Position {fen: row.fen})
        WITH p, row
        MERGE (o:Opening {eco: row.eco})
        MERGE (p)-[:IN_OPENING]->(o)
        """,
        position_rows,
    )

    # Create THEORY_MOVE between adjacent positions
    transition_rows = [
        {"from_fen": f, "to_fen": t, "san": s}
        for f, t, s in seen_transitions
    ]
    run_batch(
        """
        UNWIND $rows AS row
        MATCH (a:Position {fen: row.from_fen})
        MATCH (b:Position {fen: row.to_fen})
        MERGE (a)-[:THEORY_MOVE {san: row.san}]->(b)
        """,
        transition_rows,
    )

    unique_fens = {fen for op in openings for fen in op["fens"]}
    print(f"  {len(openings)} Opening nodes, ~{len(unique_fens)} Position nodes, {len(transition_rows)} THEORY_MOVE edges")
