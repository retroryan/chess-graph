from pathlib import Path

import httpx

from .config import Settings

EXPORT_URL = "https://lichess.org/api/games/export/_ids"
HEADERS = {"User-Agent": "chess-coach-ai-loader (github.com/AayanHetam/chess-coach-ai)"}
BATCH_SIZE = 300  # Lichess API max per request


def export_games(game_ids: set[str], settings: Settings) -> tuple[Path, int]:
    """Export games by ID as NDJSON via the Lichess batch export endpoint.
    Streams the response to disk. Returns (output_path, game_count)."""
    ids_list = list(game_ids)[: settings.game_count]
    output_dir = Path(settings.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "italian_game_games.ndjson"

    count = 0
    total_batches = (len(ids_list) + BATCH_SIZE - 1) // BATCH_SIZE

    with open(output_path, "w") as f:
        with httpx.Client(timeout=300, headers=HEADERS) as client:
            for i in range(0, len(ids_list), BATCH_SIZE):
                batch = ids_list[i : i + BATCH_SIZE]
                batch_num = i // BATCH_SIZE + 1

                print(f"  Batch {batch_num}/{total_batches} ({len(batch)} IDs)...")

                with client.stream(
                    "POST",
                    EXPORT_URL,
                    content=",".join(batch),
                    headers={
                        "Accept": "application/x-ndjson",
                        "Content-Type": "text/plain",
                    },
                    params={
                        "opening": "true",
                        "clocks": "true",
                    },
                ) as resp:
                    resp.raise_for_status()
                    for line in resp.iter_lines():
                        line = line.strip()
                        if line:
                            f.write(line + "\n")
                            count += 1
                            if count % 100 == 0:
                                print(f"    {count} games exported...")

    print(f"\n  {count} games saved to {output_path}")
    return output_path, count
