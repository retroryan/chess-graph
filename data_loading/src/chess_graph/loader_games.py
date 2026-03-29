import json
import chess
from chess_graph.config import GAMES_NDJSON, ITALIAN_GAME
from chess_graph.db import run_batch


def _replay_moves(moves_str: str) -> list[tuple[str, str]]:
    """Replay SAN moves, return [(san, fen_after), ...].

    Returns an empty list if any move is illegal (corrupt game data).
    """
    board = chess.Board()
    result = []
    for token in moves_str.split():
        try:
            move = board.parse_san(token)
        except (chess.InvalidMoveError, chess.IllegalMoveError, chess.AmbiguousMoveError):
            return result
        san = board.san(move)
        board.push(move)
        result.append((san, board.fen()))
    return result


def _game_result(game: dict) -> str:
    """Derive a result string like '1-0', '0-1', '1/2-1/2' from the NDJSON."""
    winner = game.get("winner")
    if winner == "white":
        return "1-0"
    elif winner == "black":
        return "0-1"
    else:
        return "1/2-1/2"


def load():
    if not GAMES_NDJSON.exists():
        print(f"  skipping — {GAMES_NDJSON} not found")
        return

    lo, hi = ITALIAN_GAME["eco_range"]

    games = []
    skipped = 0
    with open(GAMES_NDJSON) as f:
        for line in f:
            game = json.loads(line)
            eco = game.get("opening", {}).get("eco", "")
            if not (lo <= eco <= hi):
                skipped += 1
                continue

            moves = _replay_moves(game.get("moves", ""))
            if not moves:
                skipped += 1
                continue

            fens = [chess.STARTING_FEN] + [fen for _, fen in moves]
            sans = [san for san, _ in moves]

            games.append({
                "gameId": game["id"],
                "result": _game_result(game),
                "eco": eco,
                "fens": fens,
                "sans": sans,
            })

    print(f"  parsed {len(games)} games ({skipped} skipped)")

    if not games:
        return

    # Create Game nodes + HAS_MOVE to starting position + FROM_OPENING
    run_batch(
        """
        UNWIND $rows AS row
        MERGE (g:Game {gameId: row.gameId})
        ON CREATE SET g.result = row.result, g.eco = row.eco
        WITH g, row
        MERGE (p:Position {fen: row.fens[0]})
        MERGE (g)-[:HAS_MOVE]->(p)
        WITH g, row
        MATCH (o:Opening {eco: row.eco})
        MERGE (g)-[:FROM_OPENING]->(o)
        """,
        games,
    )

    # Create all Position nodes from game moves
    position_rows = []
    seen_fens = set()
    for g in games:
        for fen in g["fens"]:
            if fen not in seen_fens:
                seen_fens.add(fen)
                position_rows.append({"fen": fen})

    run_batch(
        """
        UNWIND $rows AS row
        MERGE (:Position {fen: row.fen})
        """,
        position_rows,
    )
    print(f"  {len(position_rows)} unique positions across all games")

    # Create GAME_MOVE chains with gameId scoping
    transition_rows = []
    for g in games:
        for i in range(len(g["sans"])):
            transition_rows.append({
                "from_fen": g["fens"][i],
                "to_fen": g["fens"][i + 1],
                "san": g["sans"][i],
                "ply": i + 1,
                "gameId": g["gameId"],
            })

    run_batch(
        """
        UNWIND $rows AS row
        MATCH (a:Position {fen: row.from_fen})
        MATCH (b:Position {fen: row.to_fen})
        MERGE (a)-[:GAME_MOVE {san: row.san, ply: row.ply, gameId: row.gameId}]->(b)
        """,
        transition_rows,
    )

    print(f"  {len(games)} Game nodes, {len(transition_rows)} GAME_MOVE edges (game-scoped)")
