import argparse
import sys

from .config import load_settings
from .explorer import (
    collect_game_ids_from_explorer,
    collect_game_ids_from_puzzles,
    probe_game_counts,
)
from .exporter import export_games


def cmd_probe(settings):
    """Show game counts by rating range.
    Uses the Lichess Explorer if accessible, otherwise reports unavailability."""
    print("Italian Game (1.e4 e5 2.Nf3 Nc6 3.Bc4)")
    print("Speeds: rapid, classical only\n")

    counts = probe_game_counts(settings)

    if counts is None:
        print("The Lichess Opening Explorer requires authentication.")
        print("To use probe mode, add a free API token to .env:")
        print("  1. Create a token at https://lichess.org/account/oauth/token")
        print("  2. Add LICHESS_TOKEN=lip_... to your .env file")
        print("  3. Re-run this command")
        print()
        print("Note: the 'download' command works without a token by using")
        print("the HuggingFace puzzle dataset to discover game IDs.")
        sys.exit(1)

    print(f"\n  {'Rating Range':<20} {'Games':>12}")
    print(f"  {'-' * 34}")
    total = 0
    for label, count in counts.items():
        marker = ""
        bucket_val = int(label.split("-")[0].replace("+", ""))
        if bucket_val in settings.rating_bucket_params:
            marker = " <-- selected"
        print(f"  {label:<20} {count:>12,}{marker}")
        total += count
    print(f"  {'-' * 34}")
    print(f"  {'Total':<20} {total:>12,}")

    selected_total = sum(
        c
        for label, c in counts.items()
        if int(label.split("-")[0].replace("+", "")) in settings.rating_bucket_params
    )
    print(f"\n  Your .env range: {settings.rating_min}-{settings.rating_max}")
    print(f"  Games in selected range: {selected_total:,}")
    print(f"  Target download: {settings.game_count}")


def cmd_download(settings):
    """Collect game IDs then export as NDJSON."""
    print(f"Target:       {settings.game_count} games")
    print(f"Rating range: {settings.rating_min}-{settings.rating_max} (applied during export)")
    print(f"Speeds:       rapid, classical only")
    print(f"Output:       {settings.output_dir}/")
    print()

    # Phase 1: Collect game IDs
    # Try explorer first if token is available, otherwise use HuggingFace puzzles
    if settings.lichess_token:
        print("Phase 1: Walking opening tree via Lichess Explorer...\n")
        game_ids = collect_game_ids_from_explorer(settings)
    else:
        print("Phase 1: Collecting game IDs from Lichess puzzle dataset (HuggingFace)...\n")
        print("  (Set LICHESS_TOKEN in .env for explorer-based collection instead)\n")
        game_ids = collect_game_ids_from_puzzles(settings)

    if not game_ids:
        print("\nNo games found. Check your network connection and try again.")
        sys.exit(1)

    # Phase 2: Export as NDJSON
    actual = min(len(game_ids), settings.game_count)
    print(f"\nPhase 2: Exporting {actual} games as NDJSON...\n")
    output_path, count = export_games(game_ids, settings)

    print(f"\nDone. {count} games saved to {output_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Download Italian Game (C50-C59) games from Lichess",
    )
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("probe", help="Show game counts by rating range (needs LICHESS_TOKEN)")
    sub.add_parser("download", help="Download games as NDJSON")

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(0)

    settings = load_settings()

    if args.command == "probe":
        cmd_probe(settings)
    elif args.command == "download":
        cmd_download(settings)


if __name__ == "__main__":
    main()
