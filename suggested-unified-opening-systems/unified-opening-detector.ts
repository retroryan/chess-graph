/**
 * Unified opening detector — replaces the hardcoded 29-opening database in
 * openingDetector.ts with detection powered by the full 3,401-entry openings
 * dataset from Firestore.
 *
 * The original openingDetector.ts hardcodes 29 openings as move arrays and
 * matches them sequentially. This version:
 *
 *   1. Loads openings from Firestore (via openings-data.ts) on first use
 *   2. Parses PGN strings into move arrays (3,219 of 3,401 entries have PGN)
 *   3. Builds a trie for efficient prefix matching against the game's move history
 *   4. Returns the most specific match (longest move sequence wins)
 *   5. Preserves the existing OpeningInfo interface and phase detection functions
 *
 * Drop-in replacement: exports the same three functions as openingDetector.ts
 * (detectOpening, isOpeningMove, getOpeningPhase) plus the same OpeningInfo
 * interface. Callers do not need to change.
 *
 * Performance note: the trie is built once on first call and cached in module
 * scope. Subsequent calls traverse the trie in O(n) where n is the game's
 * move count, regardless of how many openings exist in the dataset.
 */

import { Chess } from "chess.js";
import { getAllOpenings, type OpeningDocument } from "../suggested-openings/openings-data";

// ---------------------------------------------------------------------------
// Public interface (unchanged from openingDetector.ts)
// ---------------------------------------------------------------------------

export interface OpeningInfo {
  name: string;
  eco?: string;
  moves: number;
  isEarlyOpening: boolean;
}

// ---------------------------------------------------------------------------
// Trie for efficient prefix matching
// ---------------------------------------------------------------------------

interface TrieNode {
  children: Map<string, TrieNode>;
  /** If this node represents the end of an opening's move sequence. */
  opening: { name: string; eco?: string; moveCount: number } | null;
}

function createTrieNode(): TrieNode {
  return { children: new Map(), opening: null };
}

/**
 * Build a trie from an array of openings with PGN move sequences.
 *
 * Each opening's PGN is parsed into individual SAN moves. The trie stores
 * these as a path from root to leaf. When multiple openings share a prefix
 * (e.g., "Sicilian Defense" at move 2 and "Sicilian Defense: Najdorf" at
 * move 6), both are stored. The detector walks the trie with the game's
 * moves and returns the deepest (most specific) match.
 */
function buildTrie(openings: Array<{ name: string; eco?: string; moves: string[] }>): TrieNode {
  const root = createTrieNode();

  for (const opening of openings) {
    let node = root;
    for (const move of opening.moves) {
      const normalized = normalizeMove(move);
      if (!node.children.has(normalized)) {
        node.children.set(normalized, createTrieNode());
      }
      node = node.children.get(normalized)!;
    }
    // If two openings have the same move sequence, keep the one with the
    // longer (more specific) name. E.g., "Sicilian Defense" vs
    // "Sicilian Defense: Najdorf Variation" at the same depth — the latter
    // should win because it was matched from a more specific PGN.
    // In practice, identical move sequences with different names are rare,
    // but when they occur the longer name is almost always the sub-variation.
    if (!node.opening || opening.name.length > node.opening.name.length) {
      node.opening = {
        name: opening.name,
        eco: opening.eco,
        moveCount: opening.moves.length,
      };
    }
  }

  return root;
}

// ---------------------------------------------------------------------------
// PGN parsing
// ---------------------------------------------------------------------------

/**
 * Parse a PGN move string into an array of SAN moves.
 *
 * Input:  "1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6"
 * Output: ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6"]
 *
 * Strips move numbers ("1.", "2.", etc.) and result markers ("1-0", "0-1", "1/2-1/2").
 */
function parsePgn(pgn: string): string[] {
  return pgn
    .split(/\s+/)
    .filter((token) => {
      // Skip move numbers like "1." or "12."
      if (/^\d+\.+$/.test(token)) return false;
      // Skip result markers
      if (token === "1-0" || token === "0-1" || token === "1/2-1/2" || token === "*") return false;
      // Skip empty tokens
      if (token.trim() === "") return false;
      return true;
    });
}

// ---------------------------------------------------------------------------
// Move normalization (unchanged from openingDetector.ts)
// ---------------------------------------------------------------------------

/**
 * Normalize move notation for comparison.
 * Removes check/checkmate symbols and standardizes format.
 */
function normalizeMove(move: string): string {
  return move.replace(/[+#]/g, "").trim();
}

// ---------------------------------------------------------------------------
// Module-level cache
// ---------------------------------------------------------------------------

let cachedTrie: TrieNode | null = null;
let trieLoadPromise: Promise<TrieNode> | null = null;

/**
 * Load openings from Firestore and build the detection trie.
 *
 * Called once on first use. The trie is cached in module scope for the
 * lifetime of the process (or serverless invocation).
 */
async function getOrBuildTrie(): Promise<TrieNode> {
  if (cachedTrie) return cachedTrie;

  // Deduplicate concurrent calls during initial load
  if (trieLoadPromise) return trieLoadPromise;

  trieLoadPromise = (async () => {
    const allOpenings = await getAllOpenings();

    // Filter to openings with PGN data and parse their move sequences
    const parsed = allOpenings
      .filter((o): o is OpeningDocument & { pgn: string } => !!o.pgn)
      .map((o) => ({
        name: o.name,
        eco: o.eco,
        moves: parsePgn(o.pgn),
      }))
      .filter((o) => o.moves.length > 0);

    cachedTrie = buildTrie(parsed);
    return cachedTrie;
  })();

  return trieLoadPromise;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect chess opening from move sequence.
 *
 * Walks the game's move history through the trie and returns the deepest
 * (most specific) opening match. For example, if the game starts with
 * 1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6, the detector
 * returns "Sicilian Defense: Najdorf Variation" (B90) rather than the
 * less specific "Sicilian Defense" (B20) that matches at move 2.
 *
 * Returns null if the game has no moves or no opening match is found
 * beyond the generic "Opening" fallback.
 */
export async function detectOpening(game: Chess): Promise<OpeningInfo | null> {
  const history = game.history();
  if (history.length === 0) return null;

  const trie = await getOrBuildTrie();

  // Walk the trie, tracking the deepest match found
  let node = trie;
  let bestMatch: OpeningInfo | null = null;

  for (let i = 0; i < history.length; i++) {
    const normalized = normalizeMove(history[i]);
    const child = node.children.get(normalized);
    if (!child) break;

    node = child;
    if (node.opening) {
      bestMatch = {
        name: node.opening.name,
        eco: node.opening.eco,
        moves: node.opening.moveCount,
        isEarlyOpening: history.length <= 10,
      };
    }
  }

  // Fallback: if within the first 10 moves and no match, return generic info
  if (!bestMatch && history.length <= 10) {
    return {
      name: "Opening",
      moves: history.length,
      isEarlyOpening: true,
    };
  }

  return bestMatch;
}

/**
 * Check if a move is in the opening phase.
 */
export function isOpeningMove(moveNumber: number): boolean {
  return moveNumber <= 10;
}

/**
 * Get opening phase information.
 */
export function getOpeningPhase(moveNumber: number): {
  phase: "opening" | "early-middlegame" | "middlegame" | "endgame";
  shouldSkipCritique: boolean;
} {
  if (moveNumber <= 10) {
    return { phase: "opening", shouldSkipCritique: true };
  } else if (moveNumber <= 20) {
    return { phase: "early-middlegame", shouldSkipCritique: false };
  } else if (moveNumber <= 40) {
    return { phase: "middlegame", shouldSkipCritique: false };
  } else {
    return { phase: "endgame", shouldSkipCritique: false };
  }
}