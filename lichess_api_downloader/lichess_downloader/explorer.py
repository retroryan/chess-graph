"""Collect Italian Game game IDs from multiple sources.

Primary: HuggingFace Lichess puzzle dataset (search for Italian Game puzzles,
         extract their source game IDs).
Fallback: Lichess Opening Explorer API (requires LICHESS_TOKEN if the explorer
          returns 401, which is common for the /lichess database).
"""

import json
import time
from collections import deque

import httpx

from .config import RATING_BUCKETS, Settings

EXPLORER_URL = "https://explorer.lichess.org/lichess"
HF_SEARCH_URL = "https://datasets-server.huggingface.co/search"
HF_DATASET = "Lichess/chess-puzzles"

HEADERS = {"User-Agent": "chess-coach-ai-loader (github.com/AayanHetam/chess-coach-ai)"}

# Italian Game: 1.e4 e5 2.Nf3 Nc6 3.Bc4 (UCI move sequence from starting position)
ITALIAN_GAME_PLAY = "e2e4,e7e5,g1f3,b8c6,f1c4"


# ---------------------------------------------------------------------------
# Primary: HuggingFace puzzle dataset
# ---------------------------------------------------------------------------

def collect_game_ids_from_puzzles(settings: Settings) -> set[str]:
    """Search the Lichess puzzle dataset on HuggingFace for Italian Game puzzles.
    Each puzzle links to its source game. Collect unique game IDs."""
    target = settings.game_count
    delay = 1.0 / settings.rate_limit

    game_ids: set[str] = set()
    offset = 0
    batch_size = 10  # HuggingFace search API cap per request
    empty_streak = 0
    puzzles_scanned = 0

    with httpx.Client(timeout=30, headers=HEADERS) as client:
        while len(game_ids) < target:
            params = {
                "dataset": HF_DATASET,
                "config": "default",
                "split": "train",
                "query": "Italian_Game",
                "offset": offset,
                "length": batch_size,
            }

            resp = client.get(HF_SEARCH_URL, params=params)

            if resp.status_code == 429:
                wait = 30
                print(f"  HuggingFace rate limited. Waiting {wait}s...")
                time.sleep(wait)
                continue

            if resp.status_code != 200:
                print(f"  HuggingFace returned {resp.status_code}, stopping")
                break

            data = resp.json()
            rows = data.get("rows", [])

            if not rows:
                empty_streak += 1
                if empty_streak >= 3:
                    break
                time.sleep(2)
                offset += batch_size
                continue

            empty_streak = 0
            before = len(game_ids)

            for row in rows:
                r = row["row"]
                raw_gid = r.get("GameId", "")
                # GameId format: "abc12345/black#42" or "abc12345#53"
                gid = raw_gid.split("/")[0].split("#")[0]
                if gid:
                    game_ids.add(gid)

            puzzles_scanned += len(rows)
            new_ids = len(game_ids) - before
            offset += len(rows)

            print(
                f"  [offset={offset:>5}] puzzles={puzzles_scanned:<5} "
                f"new=+{new_ids:<4} game_ids={len(game_ids)}/{target}"
            )

            time.sleep(delay)

    print(
        f"\nHuggingFace scan complete: {puzzles_scanned} puzzles, "
        f"{len(game_ids)} unique game IDs"
    )
    return game_ids


# ---------------------------------------------------------------------------
# Fallback: Lichess Opening Explorer (needs token for /lichess database)
# ---------------------------------------------------------------------------

def probe_game_counts(settings: Settings) -> dict[str, int] | None:
    """Query the explorer for game counts at the Italian Game position
    across each rating bucket. Returns None if the explorer is inaccessible."""
    results = {}
    headers = {**HEADERS}
    if settings.lichess_token:
        headers["Authorization"] = f"Bearer {settings.lichess_token}"

    with httpx.Client(timeout=30, headers=headers) as client:
        for i, bucket in enumerate(RATING_BUCKETS):
            upper = RATING_BUCKETS[i + 1] if i + 1 < len(RATING_BUCKETS) else None
            label = f"{bucket}-{upper - 1}" if upper else f"{bucket}+"

            params = {
                "play": ITALIAN_GAME_PLAY,
                "speeds": "rapid,classical",
                "ratings": str(bucket),
                "topGames": 0,
                "recentGames": 0,
            }

            resp = _explorer_request(client, params)
            if resp is None:
                return None  # Explorer inaccessible
            data = resp.json()
            total = data.get("white", 0) + data.get("draws", 0) + data.get("black", 0)
            results[label] = total

            time.sleep(1.0)

    return results


def collect_game_ids_from_explorer(settings: Settings) -> set[str]:
    """Walk the Italian Game opening tree via the explorer API (BFS),
    collecting game IDs from topGames and recentGames at each position."""
    target = settings.game_count
    buckets = settings.rating_bucket_params
    delay = 1.0 / settings.explorer_rate_limit

    game_ids: set[str] = set()
    visited: set[str] = set()
    queue: deque[tuple[str, int]] = deque([(ITALIAN_GAME_PLAY, 0)])
    queries = 0

    headers = {**HEADERS}
    if settings.lichess_token:
        headers["Authorization"] = f"Bearer {settings.lichess_token}"

    with httpx.Client(timeout=30, headers=headers) as client:
        while queue and len(game_ids) < target:
            play, depth = queue.popleft()

            if play in visited or depth > 20:
                continue
            visited.add(play)

            params = {
                "play": play,
                "speeds": "rapid,classical",
                "ratings": ",".join(str(b) for b in buckets),
                "topGames": 4,
                "recentGames": 8,
            }

            resp = _explorer_request(client, params)
            if resp is None:
                continue
            queries += 1

            data = resp.json()

            before = len(game_ids)
            for game in data.get("topGames", []):
                game_ids.add(game["id"])
            for game in data.get("recentGames", []):
                game_ids.add(game["id"])
            new_ids = len(game_ids) - before

            pool = data.get("white", 0) + data.get("draws", 0) + data.get("black", 0)
            ply_count = play.count(",") + 1

            print(
                f"  [{queries:>4}] depth={depth:<3} ply={ply_count:<3} "
                f"pool={pool:>10,}  new=+{new_ids:<4} total={len(game_ids)}/{target}"
            )

            moves = data.get("moves", [])
            moves.sort(
                key=lambda m: m.get("white", 0) + m.get("draws", 0) + m.get("black", 0),
                reverse=True,
            )
            for move in moves[:5]:
                next_play = f"{play},{move['uci']}"
                if next_play not in visited:
                    queue.append((next_play, depth + 1))

            time.sleep(delay)

    print(
        f"\nExplorer walk complete: {queries} queries, {len(visited)} positions, "
        f"{len(game_ids)} unique game IDs"
    )
    return game_ids


def _explorer_request(
    client: httpx.Client,
    params: dict,
    max_retries: int = 3,
) -> httpx.Response | None:
    for attempt in range(max_retries):
        resp = client.get(EXPLORER_URL, params=params)
        if resp.status_code == 200:
            return resp
        if resp.status_code == 401:
            if attempt == 0:
                print(
                    "  Explorer returned 401 (auth required).\n"
                    "  Set LICHESS_TOKEN in .env to use the explorer.\n"
                    "  Get a free token at: https://lichess.org/account/oauth/token"
                )
            return None
        if resp.status_code == 429:
            wait = 60 * (attempt + 1)
            print(f"  Rate limited (429). Waiting {wait}s...")
            time.sleep(wait)
            continue
        print(f"  Explorer returned {resp.status_code}, skipping")
        return None
    print("  Max retries exceeded, skipping")
    return None
