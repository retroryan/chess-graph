/**
 * Before/After Example — practice page (pages/practice.tsx)
 *
 * The practice page has three modes (standard puzzles, Puzzle Rush, Pattern
 * Training) that each instantiate Chess objects from puzzle FEN strings. A
 * malformed puzzle or a race condition during rapid-fire Puzzle Rush can throw
 * and crash the entire practice page.
 *
 * Key changes:
 * - Each practice mode gets its own ErrorBoundary
 * - The theme selector and navigation remain functional even if puzzles crash
 * - PuzzleRush (810 lines, multiple Chess instantiations, timer-driven state
 *   transitions) is isolated from the rest of the page
 */

// ===========================================================================
// BEFORE — current code from chess-coach-ai/src/pages/practice.tsx
// (showing the mode-switching composition — no error boundaries)
// ===========================================================================
//
// export default function Practice() {
//   const [practiceMode, setPracticeMode] = useState("standard");
//   // ...
//
//   // If in Puzzle Rush mode — an error here crashes the entire page
//   if (practiceMode === "rush") {
//     return (
//       <>
//         <PageTitle title="Chess Masti AI - Puzzle Rush" />
//         <Box>
//           <PuzzleRush onBack={() => setPracticeMode("standard")} />
//         </Box>
//       </>
//     );
//   }
//
//   // If in Pattern Training mode — same risk
//   if (practiceMode === "pattern") {
//     return (
//       <>
//         <PageTitle title="Chess Masti AI - Pattern Training" />
//         <Box>
//           <PatternTraining onBack={() => setPracticeMode("standard")} />
//         </Box>
//       </>
//     );
//   }
//
//   // Standard mode
//   return (
//     <>
//       {/* ... theme selector (safe, no chess logic) ... */}
//       {hasPuzzles && (
//         <Box>
//           <PracticeBoard />   {/* ← new Chess(puzzle.fen) — crash if FEN bad */}
//           <PuzzleInfo />
//           <PuzzleList />
//         </Box>
//       )}
//     </>
//   );
// }

// ===========================================================================
// AFTER — same page with error boundaries around each practice mode
// ===========================================================================

import { useCallback, useEffect, useState } from "react";
import {
  Typography,
  Box,
  Button,
  Paper,
  Alert,
  Divider,
} from "@mui/material";
import BoltIcon from "@mui/icons-material/Bolt";
import PsychologyIcon from "@mui/icons-material/Psychology";
import { useAtom, useAtomValue } from "jotai";
import { PageTitle } from "@/components/pageTitle";
import PuzzleList from "@/sections/practice/PuzzleList";
import PuzzleInfo from "@/sections/practice/PuzzleInfo";
import PracticeBoard from "@/sections/practice/PracticeBoard";
import {
  practicePuzzlesAtom,
  currentPuzzleIndexAtom,
  practiceThemeAtom,
} from "@/sections/practice/states";
import PuzzleRush from "@/sections/practice/PuzzleRush";
import PatternTraining from "@/sections/practice/PatternTraining";

// The error boundary component from this sample
import { ErrorBoundary } from "../ErrorBoundary";

export default function Practice() {
  const [practiceMode, setPracticeMode] = useState<"standard" | "rush" | "pattern">("standard");
  const [puzzles] = useAtom(practicePuzzlesAtom);
  const hasPuzzles = puzzles.length > 0;

  // --- Puzzle Rush mode ---
  if (practiceMode === "rush") {
    return (
      <>
        <PageTitle title="Chess Masti AI - Puzzle Rush" />
        <Box sx={{ width: "100%", maxWidth: "100vw", p: { xs: 1, md: 2 } }}>
          {/* ----------------------------------------------------------------
              BOUNDARY: Puzzle Rush
              PuzzleRush (810 lines) has timer-driven state transitions,
              multiple Chess instantiations from puzzle FEN strings, and
              rapid move validation. A malformed puzzle FEN or a race
              condition in the timer logic can throw. The boundary catches
              the error and shows a recovery option — the user can click
              "Try Again" to reset the rush, or use the Back button
              (which is outside the boundary and always accessible).
              ---------------------------------------------------------------- */}
          <Button
            onClick={() => setPracticeMode("standard")}
            sx={{ mb: 2, textTransform: "none" }}
          >
            Back to Practice
          </Button>
          <ErrorBoundary name="puzzle-rush">
            <PuzzleRush onBack={() => setPracticeMode("standard")} />
          </ErrorBoundary>
        </Box>
      </>
    );
  }

  // --- Pattern Training mode ---
  if (practiceMode === "pattern") {
    return (
      <>
        <PageTitle title="Chess Masti AI - Pattern Training" />
        <Box sx={{ width: "100%", maxWidth: "100vw", p: { xs: 1, md: 2 } }}>
          <Button
            onClick={() => setPracticeMode("standard")}
            sx={{ mb: 2, textTransform: "none" }}
          >
            Back to Practice
          </Button>
          <ErrorBoundary name="pattern-training">
            <PatternTraining onBack={() => setPracticeMode("standard")} />
          </ErrorBoundary>
        </Box>
      </>
    );
  }

  // --- Standard puzzle mode ---
  return (
    <>
      <PageTitle title="Chess Masti AI - Practice Puzzles" />
      <Box sx={{ width: "100%", maxWidth: "100vw", p: { xs: 1, md: 2 } }}>
        {/* Theme/difficulty selector is pure UI — no chess logic, no boundary needed */}
        {!hasPuzzles && (
          <Paper sx={{ p: 3, mb: 2, maxWidth: 900, mx: "auto" }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>Practice</Typography>
              <Box sx={{ display: "flex", gap: 1 }}>
                <Button variant="outlined" startIcon={<BoltIcon />} onClick={() => setPracticeMode("rush")} sx={{ textTransform: "none" }}>
                  Puzzle Rush
                </Button>
                <Button variant="outlined" startIcon={<PsychologyIcon />} onClick={() => setPracticeMode("pattern")} sx={{ textTransform: "none" }}>
                  Pattern Training
                </Button>
              </Box>
            </Box>
            {/* ... theme selector chips, difficulty dropdown ... */}
          </Paper>
        )}

        {/* Puzzle solving UI — the board and puzzle info are wrapped */}
        {hasPuzzles && (
          <Box sx={{ maxWidth: 1200, mx: "auto" }}>
            <Box sx={{ display: "flex", flexDirection: { xs: "column", lg: "row" }, gap: 2 }}>
              {/* ----------------------------------------------------------------
                  BOUNDARY: Practice board
                  PracticeChessBoard (505 lines) calls new Chess(puzzle.fen)
                  and validates moves. A corrupt puzzle crashes this section
                  but the puzzle list remains navigable — user can skip to
                  the next puzzle.
                  ---------------------------------------------------------------- */}
              <Box sx={{ flexShrink: 0 }}>
                <ErrorBoundary name="practice-board">
                  <PracticeBoard />
                </ErrorBoundary>
              </Box>

              <Box sx={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                <ErrorBoundary name="puzzle-info">
                  <PuzzleInfo />
                </ErrorBoundary>
                <Paper sx={{ bgcolor: "grey.900", maxHeight: { lg: "40vh" }, overflowY: "auto" }}>
                  {/* PuzzleList is pure UI (renders puzzle IDs and solved status).
                      It stays outside a boundary so users can always navigate. */}
                  <PuzzleList />
                </Paper>
              </Box>
            </Box>
          </Box>
        )}
      </Box>
    </>
  );
}

// ===========================================================================
// Design note: where to place boundaries vs. where NOT to
// ===========================================================================
//
// Wrap with a boundary:
//   - Components that instantiate Chess objects from external data (FEN, PGN)
//   - Components with dynamic imports (AICoachChat via next/dynamic)
//   - Components with timer-driven state (PuzzleRush countdown)
//   - Components that parse JSON from API responses or localStorage
//
// Do NOT wrap:
//   - Pure UI components (buttons, selectors, tabs) — they won't throw
//   - Navigation elements — these must stay functional for recovery
//   - Components that are already inside a boundary (don't double-wrap)
//   - The entire page at once (too coarse — defeats the purpose)
