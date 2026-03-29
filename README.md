# Chess Coaching Graph

A standalone project created for the author of [Chess Masti](https://github.com/AayanHetam/chess-coach-ai) that demonstrates how a Neo4j graph database can connect chess positions, puzzles, and games to power adaptive coaching features. It includes a working data pipeline, instructions for creating a Neo4j instance with sample queries, and a set of improvement recommendations with reference implementations.

## Getting Started

### Setup

This project requires Python and uses [uv](https://docs.astral.sh/uv/) for dependency management. If you do not have Python or uv installed, see [guide_python_uv.md](guide_python_uv.md) for step-by-step instructions on macOS and Windows.

### 1. Download Lichess Games

See [chess-graph/lichess_api_downloader/README.md](chess-graph/lichess_api_downloader/README.md) for full setup, configuration, and the probe command.

The downloader collects Italian Game (C50-C59) games from Lichess as NDJSON. It can run without an API token (sources game IDs from puzzles on HuggingFace) or with a free Lichess token (walks the Opening Explorer for broader coverage). Using the Lichess API with a token is preferred because it provides richer data including clock times, evaluations, and a wider variety of games.

### 2. Load Data into Neo4j

See [chess-graph/data_loading/README.md](chess-graph/data_loading/README.md) for Neo4j Aura setup, what gets loaded (~28,000 nodes across 6 label types), configuration, and 13 sample queries you can paste directly into the Aura console.

The data loader creates a graph of openings, puzzles, games, and seed users in a Neo4j Aura Free Tier instance. It reads from three local sources: the [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) ECO dataset, the bundled puzzle JSONs from chess-coach-ai, and the games NDJSON from step 1.

The README also includes 15 sample Cypher queries with tutorials explaining how each query works and the steps it takes to traverse the graph. These progress from basic schema inspection to the full adaptive puzzle recommendation query, and can be pasted directly into the Aura console.

### 3. Review Recommendations

[RECOMMENDATIONS.md](RECOMMENDATIONS.md) contains improvement suggestions for Chess Masti, starting with what the project already gets right and then covering 11 areas for improvement. Five of the recommendations include working reference implementations in the `chess-graph/` directory:

| Recommendation | Sample Code | What It Contains |
|---|---|---|
| 2. Extract openings into structured JSON | `chess-graph/suggested-openings/` | `openings.json` with 3,401 openings (ECO codes, FEN, PGN) and a Firestore service module |
| 3. Unify the three opening systems | `chess-graph/suggested-unified-opening-systems/` | A trie-based opening detector using all 3,219 PGN-equipped openings, plus enriched repertoire lookups |
| 4. Introduce structured logging | `chess-graph/sample-logging/` | A zero-dependency structured logger, AsyncLocalStorage request context, Sentry breadcrumb bridge, and before/after route examples |
| 5. Validate API inputs at the boundary | `chess-graph/sample-validation/` | Zod schemas for 6 API routes with shared field validators, and before/after route examples |
| 6. Add React error boundaries | `chess-graph/sample-error-boundaries/` | A reusable `ErrorBoundary` component with Sentry tagging, and placement examples for the analysis and practice pages |

The remaining recommendations (1, 7-11) are described in the document without separate sample code.
