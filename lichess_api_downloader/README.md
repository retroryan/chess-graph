# Lichess API Downloader

Downloads Italian Game (C50-C59) games from Lichess as NDJSON for loading into Neo4j.

**Constraint:** Only rapid and classical time controls are targeted. Games are sourced from Italian Game puzzles, so the dataset is biased toward tactically rich positions (which is ideal for the chess coaching use case).

## Quick Start

### 1. Install uv

**macOS:**

```bash
brew install uv
# or
curl -LsSf https://astral.sh/uv/install.sh | sh
```

**Windows (PowerShell):**

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
# or with winget
winget install astral-sh.uv
```

### 2. Set up the project

```bash
cd chess-graph/lichess_api_downloader

# Install dependencies (creates .venv automatically)
uv sync

# Copy the example env file and adjust settings
cp .env.example .env
```

### 3. Create a Lichess API token (optional)

A token unlocks the Opening Explorer path (rating-range filtering, broader game database) and the `probe` command. No scopes are required — a scopeless token is sufficient.

1. Go to [lichess.org/account/oauth/token/create](https://lichess.org/account/oauth/token/create?description=chess-graph-downloader) (pre-fills the description)
2. Enter a description like `chess-graph-downloader`
3. **Leave all scope checkboxes unchecked** — no scopes needed
4. Click **CREATE**
5. Copy the token (it is only shown once)
6. Add it to your `.env`:

```
LICHESS_TOKEN=lip_xxxxxxxxxxxxxxxxxxxxx
```

### 4. Run

```bash
# (Requires token) Check how many games exist per rating bracket before downloading.
# Use this to tune RATING_MIN / RATING_MAX in .env so you target a range with enough games.
uv run lichess-downloader probe

# Download 500 Italian Game games (default)
uv run lichess-downloader download
```

## Configuration

All settings are in `.env`. See `.env.example` for defaults and documentation.

| Variable | Default | Description |
|----------|---------|-------------|
| `GAME_COUNT` | `500` | Number of games to download |
| `RATING_MIN` | `1200` | Minimum player rating |
| `RATING_MAX` | `2000` | Maximum player rating |
| `RATE_LIMIT` | `20` | General Lichess API rate limit (req/s) |
| `EXPLORER_RATE_LIMIT` | `2` | Opening Explorer API rate limit (req/s) |
| `OUTPUT_DIR` | `output` | Directory for downloaded NDJSON files |
| `LICHESS_TOKEN` | *(none)* | Optional Lichess API token for explorer access |

## How it works

### Game ID collection (Phase 1)

**Without a token (default):** Searches the [Lichess puzzle dataset on HuggingFace](https://huggingface.co/datasets/Lichess/chess-puzzles) for puzzles tagged with `Italian_Game`. Each puzzle links to its source game on Lichess. The downloader collects these game IDs.

**With a token:** Walks the Italian Game opening tree via the [Lichess Opening Explorer API](https://lichess.org/api#tag/Opening-Explorer) (BFS), collecting game IDs from `topGames` and `recentGames` at each position. Filters by rating range and time control. Get a free token at [lichess.org/account/oauth/token](https://lichess.org/account/oauth/token).

### Game export (Phase 2)

Posts collected game IDs to the [Lichess batch export endpoint](https://lichess.org/api#tag/Games/operation/gamesExportIds) in batches of 300. The response streams back as NDJSON with opening info and clock data included.

### Checking game availability (probe command, requires token)

```
$ uv run lichess-downloader probe

Italian Game (1.e4 e5 2.Nf3 Nc6 3.Bc4)
Speeds: rapid, classical only

  Rating Range              Games
  ----------------------------------
  0-999                     12,345
  1000-1199                 45,678
  1200-1399                 89,012  <-- selected
  ...
```

## Output format

Each line in `output/italian_game_games.ndjson` is a JSON object:

```json
{
  "id": "TJxUmbWK",
  "rated": true,
  "variant": "standard",
  "speed": "rapid",
  "status": "resign",
  "players": {
    "white": {"user": {"name": "player1", "id": "player1"}, "rating": 1650},
    "black": {"user": {"name": "player2", "id": "player2"}, "rating": 1720}
  },
  "winner": "white",
  "moves": "e4 e5 Nf3 Nc6 Bc4 ...",
  "opening": {"eco": "C50", "name": "Italian Game", "ply": 5},
  "clock": {"initial": 600, "increment": 0, "totalTime": 600}
}
```

This is the format Loader 4 consumes when building Game, Position, and User nodes in Neo4j.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for details on the two-phase download pipeline, the Opening Explorer tree walk (with token) vs. HuggingFace puzzle search (fallback), and the batch export step.

## uv cheat sheet

| Command | What it does |
|---------|-------------|
| `uv sync` | Install/update all dependencies into `.venv` |
| `uv run <cmd>` | Run a command using the project's `.venv` |
| `uv add <pkg>` | Add a dependency to `pyproject.toml` and install it |
| `uv lock` | Regenerate the lockfile without installing |
| `uv python install 3.12` | Install a specific Python version (if needed) |
