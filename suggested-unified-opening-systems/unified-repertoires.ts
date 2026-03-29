/**
 * Unified repertoire system — updated to reference the shared Firestore
 * openings collection for metadata while keeping curated drill lines.
 *
 * The original repertoires.ts hardcodes ECO codes, names, and descriptions
 * for 11 repertoires. This version:
 *
 *   1. Keeps the curated drill lines (hand-picked pedagogical content)
 *   2. Adds a function to enrich repertoire metadata from the unified
 *      openings collection in Firestore (ECO codes, descriptions, FEN)
 *   3. Adds a function to look up the parent opening for any repertoire
 *   4. Preserves the existing export shape (OPENING_REPERTOIRES array
 *      and helper functions) so callers do not need to change
 *
 * The repertoire drill lines are intentionally NOT generated from the
 * 3,401-entry openings dataset. Drill lines are curated teaching content:
 * each line has a specific pedagogical purpose, a description explaining
 * the strategic idea, and a carefully chosen move depth. The openings
 * dataset provides the reference metadata (ECO, FEN, full name) that
 * the repertoires draw from.
 *
 * How the three systems connect through unified data:
 *
 *   Firestore openings collection (3,401 entries)
 *       │
 *       ├── unified-opening-detector.ts
 *       │   Reads PGN sequences → builds trie → detects openings in games
 *       │
 *       ├── unified-repertoires.ts (this file)
 *       │   Reads ECO/name/FEN → enriches curated drill repertoires
 *       │
 *       └── openings-data.ts (from suggested-openings/)
 *           CRUD + search + pagination for the openings UI
 */

import type { OpeningRepertoire, OpeningCourse } from "@/types/openings";
import { VIENNA_COURSE } from "./viennaRepertoire";
import {
  getOpeningsByEcoPrefix,
  getOpeningByName,
  type OpeningDocument,
} from "../suggested-openings/openings-data";

// ---------------------------------------------------------------------------
// Curated drill repertoires
// ---------------------------------------------------------------------------
// These are the same 11 repertoires from the original repertoires.ts.
// The drill lines (moves, descriptions) are curated teaching content
// and remain hardcoded. The opening-level metadata (eco, name) can be
// validated and enriched from the unified Firestore collection using
// the enrichRepertoire() function below.

export const OPENING_REPERTOIRES: OpeningRepertoire[] = [
  // ===== WHITE OPENINGS =====
  {
    id: "italian-game",
    name: "Italian Game",
    eco: "C50",
    color: "white",
    difficulty: "beginner",
    description:
      "A classical opening aiming for quick development and central control. White targets f7 with the bishop while developing naturally.",
    themes: ["development", "center control", "kingside attack"],
    lines: [
      {
        id: "italian-main",
        name: "Main Line",
        moves: [
          "e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3", "Nf6",
          "d4", "exd4", "cxd4", "Bb4+", "Bd2", "Bxd2+", "Nbxd2",
        ],
        description: "The classical main line with c3-d4 pawn center.",
      },
      {
        id: "italian-giuoco-piano",
        name: "Giuoco Piano",
        moves: [
          "e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "d3", "Nf6",
          "O-O", "d6", "c3",
        ],
        description: "A quieter approach with d3, focusing on slow buildup.",
      },
      {
        id: "italian-evans-gambit",
        name: "Evans Gambit",
        moves: [
          "e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "b4", "Bxb4",
          "c3", "Ba5", "d4", "exd4", "O-O",
        ],
        description:
          "A sharp gambit sacrificing a pawn for rapid development and attacking chances.",
      },
    ],
  },
  {
    id: "london-system",
    name: "London System",
    eco: "D02",
    color: "white",
    difficulty: "beginner",
    description:
      "A solid, easy-to-learn system where White develops the dark-squared bishop to f4 early. Works against almost any Black setup.",
    themes: ["solid", "system opening", "pawn structure"],
    lines: [
      {
        id: "london-main",
        name: "Main Line vs d5",
        moves: [
          "d4", "d5", "Bf4", "Nf6", "e3", "c5", "c3", "Nc6",
          "Nd2", "e6", "Ngf3",
        ],
        description: "The standard London setup against 1...d5.",
      },
      {
        id: "london-vs-kid",
        name: "vs King's Indian Setup",
        moves: [
          "d4", "Nf6", "Bf4", "g6", "e3", "Bg7", "Nf3", "O-O",
          "Be2", "d6", "O-O", "Nbd7", "h3",
        ],
        description: "London against the King's Indian with a solid structure.",
      },
    ],
  },
  {
    id: "queens-gambit",
    name: "Queen's Gambit",
    eco: "D06",
    color: "white",
    difficulty: "intermediate",
    description:
      "White offers a pawn to gain central control. One of the most respected openings at all levels.",
    themes: ["center control", "positional", "pawn structure"],
    lines: [
      {
        id: "qg-accepted",
        name: "Queen's Gambit Accepted",
        moves: [
          "d4", "d5", "c4", "dxc4", "Nf3", "Nf6", "e3", "e6",
          "Bxc4", "c5", "O-O", "a6",
        ],
        description:
          "Black takes the pawn. White regains it with easy development.",
      },
      {
        id: "qg-declined",
        name: "Queen's Gambit Declined",
        moves: [
          "d4", "d5", "c4", "e6", "Nc3", "Nf6", "Bg5", "Be7",
          "e3", "O-O", "Nf3", "Nbd7",
        ],
        description:
          "Black declines the gambit, leading to classical positional play.",
      },
      {
        id: "qg-slav",
        name: "Slav Defense",
        moves: [
          "d4", "d5", "c4", "c6", "Nf3", "Nf6", "Nc3", "dxc4",
          "a4", "Bf5", "e3",
        ],
        description:
          "Black supports d5 with c6. A solid and popular choice.",
      },
    ],
  },
  {
    id: "ruy-lopez",
    name: "Ruy Lopez",
    eco: "C60",
    color: "white",
    difficulty: "intermediate",
    description:
      "The 'Spanish Game' — one of the oldest and most deeply analyzed openings. White pressures the e5 pawn indirectly through the knight.",
    themes: ["positional", "maneuvering", "long-term pressure"],
    lines: [
      {
        id: "ruy-morphy",
        name: "Morphy Defense",
        moves: [
          "e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6",
          "O-O", "Be7", "Re1", "b5", "Bb3", "d6", "c3", "O-O",
        ],
        description:
          "The most common continuation. Black develops naturally while White builds center.",
      },
      {
        id: "ruy-berlin",
        name: "Berlin Defense",
        moves: [
          "e4", "e5", "Nf3", "Nc6", "Bb5", "Nf6", "O-O", "Nxe4",
          "d4", "Nd6", "Bxc6", "dxc6", "dxe5", "Nf5",
        ],
        description:
          "The 'Berlin Wall' — a very solid defense that exchanges queens early.",
      },
    ],
  },
  {
    id: "english-opening",
    name: "English Opening",
    eco: "A20",
    color: "white",
    difficulty: "advanced",
    description:
      "A flexible flank opening starting with 1.c4. Can transpose into many structures. Favored by positional players.",
    themes: ["flexibility", "positional", "flank opening"],
    lines: [
      {
        id: "english-symmetrical",
        name: "Symmetrical Variation",
        moves: [
          "c4", "c5", "Nf3", "Nc6", "Nc3", "g6", "g3", "Bg7",
          "Bg2", "e6", "O-O", "Nge7",
        ],
        description: "Both sides fianchetto. Rich middlegame play.",
      },
      {
        id: "english-reversed-sicilian",
        name: "Reversed Sicilian",
        moves: [
          "c4", "e5", "Nc3", "Nf6", "Nf3", "Nc6", "g3", "d5",
          "cxd5", "Nxd5", "Bg2",
        ],
        description: "Like a Sicilian with an extra tempo for White.",
      },
    ],
  },

  // ===== BLACK OPENINGS =====
  {
    id: "sicilian-dragon",
    name: "Sicilian Dragon",
    eco: "B70",
    color: "black",
    difficulty: "intermediate",
    description:
      "An aggressive Sicilian variation where Black fianchettoes the dark-squared bishop, creating a 'dragon' diagonal aimed at White's queenside.",
    themes: ["attacking", "fianchetto", "opposite-side castling"],
    lines: [
      {
        id: "dragon-classical",
        name: "Classical Variation",
        moves: [
          "e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6",
          "Nc3", "g6", "Be2", "Bg7", "O-O", "O-O", "Be3", "Nc6",
        ],
        description:
          "White plays Be2 — less aggressive but solid. Black gets comfortable development.",
      },
      {
        id: "dragon-yugoslav",
        name: "Yugoslav Attack",
        moves: [
          "e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6",
          "Nc3", "g6", "Be3", "Bg7", "f3", "O-O", "Qd2", "Nc6",
        ],
        description:
          "White's most dangerous plan with opposite-side castling and a kingside pawn storm.",
      },
    ],
  },
  {
    id: "sicilian-najdorf",
    name: "Sicilian Najdorf",
    eco: "B90",
    color: "black",
    difficulty: "advanced",
    description:
      "Bobby Fischer's weapon of choice. The most theoretically complex Sicilian variation, offering Black rich counterplay.",
    themes: ["complex", "counterattack", "dynamic"],
    lines: [
      {
        id: "najdorf-english-attack",
        name: "English Attack",
        moves: [
          "e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6",
          "Nc3", "a6", "Be3", "e5", "Nb3", "Be6",
        ],
        description:
          "White plays Be3 followed by f3, Qd2, and O-O-O. Sharp and principled.",
      },
      {
        id: "najdorf-bg5",
        name: "Classical 6.Bg5",
        moves: [
          "e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6",
          "Nc3", "a6", "Bg5", "e6", "f4", "Be7",
        ],
        description:
          "The old main line. Extremely sharp with deep theory.",
      },
    ],
  },
  {
    id: "french-defense",
    name: "French Defense",
    eco: "C00",
    color: "black",
    difficulty: "beginner",
    description:
      "A solid defense where Black builds a pawn chain with e6-d5. Leads to strategic battles over the center.",
    themes: ["solid", "pawn chain", "counterplay"],
    lines: [
      {
        id: "french-advance",
        name: "Advance Variation",
        moves: [
          "e4", "e6", "d4", "d5", "e5", "c5", "c3", "Nc6", "Nf3",
          "Qb6", "a3", "Nh6",
        ],
        description:
          "White advances e5, locking the center. Black attacks the pawn chain with c5 and f6.",
      },
      {
        id: "french-exchange",
        name: "Exchange Variation",
        moves: [
          "e4", "e6", "d4", "d5", "exd5", "exd5", "Nf3", "Nf6",
          "Bd3", "Bd6", "O-O", "O-O",
        ],
        description:
          "Symmetrical pawn structure. Often leads to endgame-oriented play.",
      },
      {
        id: "french-tarrasch",
        name: "Tarrasch Variation",
        moves: [
          "e4", "e6", "d4", "d5", "Nd2", "Nf6", "e5", "Nfd7",
          "Bd3", "c5", "c3", "Nc6", "Ne2",
        ],
        description:
          "White plays Nd2 to avoid blocking the c-pawn. A flexible system.",
      },
    ],
  },
  {
    id: "caro-kann",
    name: "Caro-Kann Defense",
    eco: "B10",
    color: "black",
    difficulty: "beginner",
    description:
      "A rock-solid defense where Black plays 1...c6 to support d5. Less dynamic than the Sicilian but very reliable.",
    themes: ["solid", "endgame oriented", "light-square bishop"],
    lines: [
      {
        id: "caro-classical",
        name: "Classical Variation",
        moves: [
          "e4", "c6", "d4", "d5", "Nc3", "dxe4", "Nxe4", "Bf5",
          "Ng3", "Bg6", "h4", "h6", "Nf3", "Nd7",
        ],
        description:
          "Black develops the light-squared bishop before e6. The main line of the Caro-Kann.",
      },
      {
        id: "caro-advance",
        name: "Advance Variation",
        moves: [
          "e4", "c6", "d4", "d5", "e5", "Bf5", "Nf3", "e6", "Be2",
          "Nd7", "O-O", "Ne7",
        ],
        description:
          "White advances e5. Black maneuvers to attack the pawn chain.",
      },
    ],
  },
  {
    id: "kings-indian",
    name: "King's Indian Defense",
    eco: "E60",
    color: "black",
    difficulty: "intermediate",
    description:
      "A hypermodern defense where Black allows White to build a big center, then counterattacks it. Leads to rich, double-edged positions.",
    themes: ["counterattack", "kingside attack", "dynamic"],
    lines: [
      {
        id: "kid-classical",
        name: "Classical Variation",
        moves: [
          "d4", "Nf6", "c4", "g6", "Nc3", "Bg7", "e4", "d6",
          "Nf3", "O-O", "Be2", "e5", "O-O", "Nc6",
        ],
        description:
          "The main line. Both sides have clear plans: White pushes on the queenside, Black attacks on the kingside.",
      },
      {
        id: "kid-samisch",
        name: "Samisch Variation",
        moves: [
          "d4", "Nf6", "c4", "g6", "Nc3", "Bg7", "e4", "d6",
          "f3", "O-O", "Be3", "e5", "d5", "Nh5",
        ],
        description:
          "White plays f3 and Be3, planning a broad center. Very aggressive from both sides.",
      },
    ],
  },
  {
    id: "queens-gambit-declined-black",
    name: "Queen's Gambit Declined (Black)",
    eco: "D30",
    color: "black",
    difficulty: "beginner",
    description:
      "Black declines the gambit with e6, building a solid position. One of the most reliable defenses at all levels.",
    themes: ["solid", "classical", "minority attack"],
    lines: [
      {
        id: "qgd-orthodox",
        name: "Orthodox Defense",
        moves: [
          "d4", "d5", "c4", "e6", "Nc3", "Nf6", "Bg5", "Be7",
          "e3", "O-O", "Nf3", "Nbd7", "Rc1", "c6",
        ],
        description:
          "The rock-solid Orthodox line. Black completes development before choosing a plan.",
      },
      {
        id: "qgd-tartakower",
        name: "Tartakower Variation",
        moves: [
          "d4", "d5", "c4", "e6", "Nc3", "Nf6", "Bg5", "Be7",
          "e3", "O-O", "Nf3", "h6", "Bh4", "b6",
        ],
        description:
          "Black fianchettoes the queen's bishop. A flexible approach with good piece activity.",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Full opening courses (unchanged — Vienna course loads from its own PGN)
// ---------------------------------------------------------------------------

export const OPENING_COURSES: OpeningCourse[] = [VIENNA_COURSE];

// ---------------------------------------------------------------------------
// Helper functions (same signatures as original repertoires.ts)
// ---------------------------------------------------------------------------

/**
 * Get all repertoires for a specific color.
 */
export function getRepertoiresByColor(
  color: "white" | "black"
): OpeningRepertoire[] {
  return OPENING_REPERTOIRES.filter((r) => r.color === color);
}

/**
 * Get a repertoire by ID.
 */
export function getRepertoireById(
  id: string
): OpeningRepertoire | undefined {
  return OPENING_REPERTOIRES.find((r) => r.id === id);
}

/**
 * Get all courses for a specific color.
 */
export function getCoursesByColor(
  color: "white" | "black"
): OpeningCourse[] {
  return OPENING_COURSES.filter((c) => c.color === color);
}

// ---------------------------------------------------------------------------
// Unified data enrichment
// ---------------------------------------------------------------------------

/**
 * Look up the parent opening for a repertoire from the unified Firestore
 * openings collection.
 *
 * Returns the matching OpeningDocument if found, or null. This is useful
 * for:
 *   - Validating that the repertoire's ECO code matches the authoritative data
 *   - Getting the FEN position for the opening (not stored in repertoires)
 *   - Displaying additional metadata from the unified collection
 *
 * Usage:
 *   const italian = getRepertoireById("italian-game");
 *   const opening = await lookupRepertoireOpening(italian);
 *   // opening.fen, opening.eco, opening.pgn from Firestore
 */
export async function lookupRepertoireOpening(
  repertoire: OpeningRepertoire
): Promise<OpeningDocument | null> {
  // Try exact name match first
  const byName = await getOpeningByName(repertoire.name);
  if (byName) return byName;

  // Fall back to ECO prefix match and find the best name match
  const byEco = await getOpeningsByEcoPrefix(repertoire.eco);
  if (byEco.length === 0) return null;

  // Return the entry whose name is closest to the repertoire name
  const exactish = byEco.find(
    (o) => o.name.toLowerCase() === repertoire.name.toLowerCase()
  );
  if (exactish) return exactish;

  // Return the shortest-named entry in the ECO family (the parent opening)
  return byEco.reduce((shortest, o) =>
    o.name.length < shortest.name.length ? o : shortest
  );
}

/**
 * Enrich a repertoire with data from the unified Firestore openings collection.
 *
 * Returns a new repertoire object with updated fields from the authoritative
 * data source. The drill lines remain unchanged — only the opening-level
 * metadata is updated.
 *
 * This function is idempotent: calling it on an already-enriched repertoire
 * produces the same result.
 */
export async function enrichRepertoire(
  repertoire: OpeningRepertoire
): Promise<OpeningRepertoire> {
  const opening = await lookupRepertoireOpening(repertoire);
  if (!opening) return repertoire;

  return {
    ...repertoire,
    // Use the authoritative ECO code if available
    eco: opening.eco ?? repertoire.eco,
    // Use the authoritative name if it differs (e.g., "Italian Game" →
    // "Italian Game" is a no-op, but catches drift)
    name: opening.name.length > 0 ? opening.name : repertoire.name,
  };
}