import os
from dataclasses import dataclass

from dotenv import load_dotenv

# Lichess explorer uses fixed rating buckets.
# Each bucket covers ratings from its value up to (but not including) the next.
# E.g., 1200 covers 1200-1399, 1400 covers 1400-1599, 2500 covers 2500+.
RATING_BUCKETS = [0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500]


@dataclass
class Settings:
    game_count: int
    rating_min: int
    rating_max: int
    rate_limit: float
    explorer_rate_limit: float
    output_dir: str
    lichess_token: str | None

    @property
    def rating_bucket_params(self) -> list[int]:
        """Return the Lichess rating bucket values that overlap with [rating_min, rating_max)."""
        buckets = []
        for i, b in enumerate(RATING_BUCKETS):
            bucket_max = RATING_BUCKETS[i + 1] if i + 1 < len(RATING_BUCKETS) else 9999
            if bucket_max > self.rating_min and b < self.rating_max:
                buckets.append(b)
        return buckets


def load_settings() -> Settings:
    load_dotenv()
    token = os.getenv("LICHESS_TOKEN", "").strip() or None
    return Settings(
        game_count=int(os.getenv("GAME_COUNT", "500")),
        rating_min=int(os.getenv("RATING_MIN", "1200")),
        rating_max=int(os.getenv("RATING_MAX", "2000")),
        rate_limit=float(os.getenv("RATE_LIMIT", "20")),
        explorer_rate_limit=float(os.getenv("EXPLORER_RATE_LIMIT", "2")),
        output_dir=os.getenv("OUTPUT_DIR", "output"),
        lichess_token=token,
    )
