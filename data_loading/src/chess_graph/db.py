from neo4j import GraphDatabase
from chess_graph.config import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD

BATCH_SIZE = 500

driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))


def run_query(query: str, **params):
    with driver.session() as s:
        return s.run(query, **params).consume()


def run_batch(query: str, rows: list, param_name: str = "rows"):
    for i in range(0, len(rows), BATCH_SIZE):
        chunk = rows[i : i + BATCH_SIZE]
        run_query(query, **{param_name: chunk})


def count_nodes() -> int:
    with driver.session() as s:
        return s.run("MATCH (n) RETURN count(n) AS c").single()["c"]


def count_rels() -> int:
    with driver.session() as s:
        return s.run("MATCH ()-[r]->() RETURN count(r) AS c").single()["c"]


def clear_database():
    """Delete all nodes and relationships in batches."""
    while True:
        with driver.session() as s:
            result = s.run(
                "MATCH (n) WITH n LIMIT 10000 DETACH DELETE n RETURN count(*) AS deleted"
            ).single()
            if result["deleted"] == 0:
                break
