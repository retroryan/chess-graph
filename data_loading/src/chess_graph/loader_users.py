import random
from chess_graph.db import run_batch, run_query, driver

NUM_USERS = 10
PUZZLES_PER_USER = 50
FAIL_RATE = 0.3


def load():
    # Create seed users
    users = [{"userId": f"seed_user_{i}"} for i in range(NUM_USERS)]
    run_batch(
        """
        UNWIND $rows AS row
        MERGE (u:User {userId: row.userId})
        """,
        users,
    )

    # Sample puzzles from graph
    with driver.session() as s:
        all_puzzle_ids = [
            r["pid"] for r in s.run("MATCH (pz:Puzzle) RETURN pz.puzzleId AS pid")
        ]

    if not all_puzzle_ids:
        print("  no puzzles in graph — skipping user activity")
        return

    # Build ATTEMPTED rows
    attempted_rows = []
    for u in users:
        sample = random.sample(all_puzzle_ids, min(PUZZLES_PER_USER, len(all_puzzle_ids)))
        for pid in sample:
            attempted_rows.append({
                "userId": u["userId"],
                "puzzleId": pid,
                "solved": random.random() > FAIL_RATE,
            })

    run_batch(
        """
        UNWIND $rows AS row
        MATCH (u:User {userId: row.userId})
        MATCH (pz:Puzzle {puzzleId: row.puzzleId})
        MERGE (u)-[a:ATTEMPTED]->(pz)
        SET a.solved = row.solved
        """,
        attempted_rows,
    )

    # Derive STRUGGLED_WITH from failed attempts (single batch query)
    user_ids = [u["userId"] for u in users]
    run_query(
        """
        UNWIND $userIds AS userId
        MATCH (u:User {userId: userId})-[:ATTEMPTED {solved: false}]->(pz:Puzzle)
        MATCH (pz)-[:HAS_THEME]->(t:Theme)
        MERGE (u)-[:STRUGGLED_WITH]->(t)
        """,
        userIds=user_ids,
    )

    print(f"  {NUM_USERS} users, {len(attempted_rows)} ATTEMPTED relationships")
