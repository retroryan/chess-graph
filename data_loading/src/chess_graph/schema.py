from chess_graph.db import run_query

CONSTRAINTS = [
    "CREATE CONSTRAINT pos_fen IF NOT EXISTS FOR (p:Position) REQUIRE p.fen IS UNIQUE",
    "CREATE CONSTRAINT puzzle_id IF NOT EXISTS FOR (pz:Puzzle) REQUIRE pz.puzzleId IS UNIQUE",
    "CREATE CONSTRAINT theme_name IF NOT EXISTS FOR (t:Theme) REQUIRE t.name IS UNIQUE",
    "CREATE CONSTRAINT opening_eco IF NOT EXISTS FOR (o:Opening) REQUIRE o.eco IS UNIQUE",
    "CREATE CONSTRAINT user_id IF NOT EXISTS FOR (u:User) REQUIRE u.userId IS UNIQUE",
    "CREATE CONSTRAINT game_id IF NOT EXISTS FOR (g:Game) REQUIRE g.gameId IS UNIQUE",
]

INDEXES = [
    "CREATE INDEX game_move_gameid IF NOT EXISTS FOR ()-[r:GAME_MOVE]-() ON (r.gameId)",
    "CREATE INDEX game_eco IF NOT EXISTS FOR (g:Game) ON (g.eco)",
]


def setup():
    for c in CONSTRAINTS:
        run_query(c)
    for idx in INDEXES:
        run_query(idx)
