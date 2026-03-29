import argparse

from chess_graph import schema, loader_openings, loader_puzzles, loader_games, loader_users
from chess_graph.db import count_nodes, count_rels, clear_database

NODE_LIMIT = 200_000
REL_LIMIT = 400_000


def budget():
    n, r = count_nodes(), count_rels()
    print(f"  budget: {n:,} nodes ({n/NODE_LIMIT:.1%}), {r:,} rels ({r/REL_LIMIT:.1%})")


def main():
    parser = argparse.ArgumentParser(description="Load chess data into Neo4j")
    parser.add_argument("--clear", action="store_true", help="Clear the database before loading")
    args = parser.parse_args()

    if args.clear:
        print("Clearing database...")
        clear_database()
        print("  done.")

    print("Setting up schema...")
    schema.setup()

    print("Loading openings (C50-C59)...")
    loader_openings.load()
    budget()

    print("Loading puzzles...")
    loader_puzzles.load()
    budget()

    print("Loading games...")
    loader_games.load()
    budget()

    print("Loading seed users...")
    loader_users.load()
    budget()

    print("Done.")


if __name__ == "__main__":
    main()
