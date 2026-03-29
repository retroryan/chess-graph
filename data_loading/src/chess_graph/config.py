from pathlib import Path
from dotenv import load_dotenv
import os

load_dotenv()

NEO4J_URI = os.environ["NEO4J_URI"]
NEO4J_USER = os.environ.get("NEO4J_USERNAME", os.environ.get("NEO4J_USER", "neo4j"))
NEO4J_PASSWORD = os.environ["NEO4J_PASSWORD"]

OPENINGS_TSV = Path(os.environ.get("OPENINGS_TSV", "../../chess-openings/c.tsv")).resolve()
PUZZLES_DIR = Path(os.environ.get("PUZZLES_DIR", "../../chess-coach-ai/src/data/puzzles")).resolve()
GAMES_NDJSON = Path(os.environ.get("GAMES_NDJSON", "../../lichess_api_downloader/output/italian_game_games.ndjson")).resolve()

ITALIAN_GAME = {
    "name": "Italian Game",
    "eco_range": ("C50", "C59"),
    "puzzle_tag": "Italian_Game",
}

# Map Lichess puzzle opening sub-tags to ECO codes.
# The puzzle database tags like "Italian_Game Italian_Game_Evans_Gambit"
# where the second token identifies the sub-variation.
PUZZLE_TAG_TO_ECO = {
    "Italian_Game_Anti-Fried_Liver_Defense": "C50",
    "Italian_Game_Birds_Attack": "C53",
    "Italian_Game_Blackburne-Kostic_Gambit": "C50",
    "Italian_Game_Classical_Variation": "C54",
    "Italian_Game_Deutz_Gambit": "C50",
    "Italian_Game_Evans_Gambit": "C51",
    "Italian_Game_Evans_Gambit_Accepted": "C52",
    "Italian_Game_Evans_Gambit_Declined": "C51",
    "Italian_Game_Giuoco_Pianissimo": "C50",
    "Italian_Game_Giuoco_Piano": "C50",
    "Italian_Game_Hungarian_Defense": "C50",
    "Italian_Game_Other_variations": "C50",
    "Italian_Game_Paris_Defense": "C50",
    "Italian_Game_Rosentreter_Gambit": "C50",
    "Italian_Game_Rousseau_Gambit": "C50",
    "Italian_Game_Schilling-Kostic_Gambit": "C50",
    "Italian_Game_Scotch_Gambit": "C56",
    "Italian_Game_Scotch_Invitation_Declined": "C56",
    "Italian_Game_Two_Knights_Defense": "C55",
}
