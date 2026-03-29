/**
 * Before/After Example — analysis page (pages/analysis.tsx)
 *
 * The analysis page is the highest-risk page in the application. It composes
 * three independent sections (Board, AnalysisTab/MovesCoachTab, CoachTab) that
 * each depend on chess.js state and atom values. A crash in any one of these
 * currently brings down the entire page.
 *
 * Key changes:
 * - Three independent sections each get their own ErrorBoundary
 * - If the AI coach crashes, the chessboard and analysis panel keep working
 * - If the chessboard crashes, the analysis tabs remain visible
 * - Each boundary reports to Sentry with its section name as context
 * - Users get a "Try Again" button instead of a blank white screen
 */

// ===========================================================================
// BEFORE — current code from chess-coach-ai/src/pages/analysis.tsx
// (showing the component composition — no error boundaries)
// ===========================================================================
//
// export default function GameAnalysis() {
//   // ... state setup ...
//
//   return (
//     <Grid container>
//       {/* If Board throws (e.g. invalid FEN), everything below unmounts */}
//       <Grid>
//         <Board />
//       </Grid>
//
//       <Grid>
//         {/* Tabs container — if any tab throws, all tabs crash */}
//         <PanelHeader />
//         <Tabs>...</Tabs>
//
//         <AnalysisTab hidden={tab !== 0} />
//         <MovesCoachTab hidden={tab !== 1} />
//         <CoachTab hidden={tab !== 2} />
//         {/*  ↑ CoachTab dynamically imports AICoachChat (1500+ lines, 13 Chess
//              instantiations, JSON.parse without try-catch). A crash here kills
//              the entire analysis page including the board. */}
//
//         <PanelToolBar />
//       </Grid>
//     </Grid>
//   );
// }

// ===========================================================================
// AFTER — same page with error boundaries around each section
// ===========================================================================

import { useChessActions } from "@/hooks/useChessActions";
import Board from "@/sections/analysis/board";
import PanelHeader from "@/sections/analysis/panelHeader";
import PanelToolBar from "@/sections/analysis/panelToolbar";
import AnalysisTab from "@/sections/analysis/panelBody/analysisTab";
import MovesCoachTab from "@/sections/analysis/panelBody/movesCoachTab";
import CoachTab from "@/sections/analysis/panelBody/coachTab";
import {
  boardAtom,
  boardOrientationAtom,
  gameAtom,
  gameEvalAtom,
} from "@/sections/analysis/states";
import {
  Box,
  Divider,
  Grid,
  Tab,
  Tabs,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import EngineSettingsButton from "@/sections/engineSettings/engineSettingsButton";
import { PageTitle } from "@/components/pageTitle";

// The error boundary component from this sample
import { ErrorBoundary } from "../ErrorBoundary";

export default function GameAnalysis() {
  const theme = useTheme();
  const [tab, setTab] = useState(0);
  const isLgOrGreater = useMediaQuery(theme.breakpoints.up("lg"));

  const { reset: resetBoard } = useChessActions(boardAtom);
  const { reset: resetGame } = useChessActions(gameAtom);
  const [gameEval, setGameEval] = useAtom(gameEvalAtom);
  const game = useAtomValue(gameAtom);
  const board = useAtomValue(boardAtom);
  const setBoardOrientation = useSetAtom(boardOrientationAtom);

  const router = useRouter();
  const { gameId, fen } = router.query;

  useEffect(() => {
    if (typeof fen === "string" && fen.trim()) {
      const decodedFen = decodeURIComponent(fen);
      resetBoard({ fen: decodedFen });
      resetGame({ fen: decodedFen, noHeaders: true });
      setGameEval(undefined);
      const isBlackToMove = decodedFen.includes(" b ");
      setBoardOrientation(!isBlackToMove);
    } else if (!gameId) {
      resetBoard();
      setGameEval(undefined);
      setBoardOrientation(true);
      resetGame({ noHeaders: true });
    }
  }, [gameId, fen, setGameEval, setBoardOrientation, resetBoard, resetGame]);

  return (
    <Grid
      container
      gap={1}
      justifyContent="flex-start"
      alignItems="start"
      direction={{ xs: "column", lg: "row" }}
      sx={{ width: "100%", maxWidth: "100vw" }}
    >
      <PageTitle title="Chess Masti AI - Game Analysis" />

      {/* ----------------------------------------------------------------
          BOUNDARY 1: Chessboard
          Wraps the board component. If the board crashes (invalid FEN,
          rendering error), the analysis panel stays functional — the user
          can still read the analysis, use the coach, and navigate moves.
          ---------------------------------------------------------------- */}
      <Grid
        size={{ xs: 12, lg: "auto" }}
        sx={{ flexShrink: 0, minWidth: { lg: "400px" } }}
      >
        <ErrorBoundary name="chessboard">
          <Board />
        </ErrorBoundary>
      </Grid>

      <Grid
        size={{ xs: 12, lg: "grow" }}
        container
        justifyContent="start"
        alignItems="center"
        borderRadius={2}
        border={1}
        borderColor={"secondary.main"}
        sx={{
          backgroundColor: "secondary.main",
          borderColor: "primary.main",
          borderWidth: 2,
          boxShadow: "0 2px 10px rgba(0, 0, 0, 0.5)",
          minWidth: { lg: "420px" },
          width: "100%",
          flex: 1,
          ...(gameEval && { overflow: "visible" }),
        }}
        padding={2}
        rowGap={2}
        height={{
          xs: tab === 1 || tab === 2 ? "40rem" : "auto",
          lg: "calc(88vh - 60px)",
        }}
        display="flex"
        flexDirection="column"
        flexWrap="nowrap"
      >
        {/* PanelHeader and Tabs are lightweight UI — no chess logic,
            unlikely to crash, so they stay outside a boundary. */}
        {isLgOrGreater && (
          <Box width="100%">
            <PanelHeader key="analysis-panel-header" />
            <Divider sx={{ marginX: "5%", marginTop: 2.5 }} />
            <Box
              width="95%"
              sx={{
                borderBottom: 1,
                borderColor: "divider",
                marginX: "5%",
                marginTop: 2,
              }}
            >
              <Tabs
                value={tab}
                onChange={(_, newValue) => setTab(newValue)}
                variant="fullWidth"
                sx={{ minHeight: 0 }}
              >
                <Tab label="Analysis" id="tab0" icon={<Icon icon="mdi:magnify" height={15} />} iconPosition="start" sx={{ textTransform: "none", minHeight: 15, padding: "5px 0em 12px" }} disableFocusRipple />
                <Tab label="Moves" id="tab1" icon={<Icon icon="mdi:format-list-bulleted" height={15} />} iconPosition="start" sx={{ textTransform: "none", minHeight: 15, padding: "5px 0em 12px" }} disableFocusRipple />
                <Tab label="Coach" id="tab2" icon={<Icon icon="mdi:account-tie" height={15} />} iconPosition="start" sx={{ textTransform: "none", minHeight: 15, padding: "5px 0em 12px" }} disableFocusRipple />
              </Tabs>
            </Box>
          </Box>
        )}

        {!isLgOrGreater && <PanelToolBar key="review-panel-toolbar" />}
        {!isLgOrGreater && !gameEval && <Divider sx={{ marginX: "5%" }} />}
        {!isLgOrGreater && !gameEval && <PanelHeader key="analysis-panel-header" />}

        {/* ----------------------------------------------------------------
            BOUNDARY 2: Analysis tab
            The analysis tab renders evaluation data, move classifications,
            and mistake summaries. It accesses gameEval positions by index
            (array bounds risk) and calls history() on atoms (null risk).
            ---------------------------------------------------------------- */}
        <ErrorBoundary name="analysis">
          <AnalysisTab role="tabpanel" hidden={tab !== 0} id="tabContent0" />
        </ErrorBoundary>

        {/* ----------------------------------------------------------------
            BOUNDARY 3: Moves/Coach tab
            MovesCoachTab shows per-move coaching annotations.
            ---------------------------------------------------------------- */}
        <ErrorBoundary name="moves-coach">
          <MovesCoachTab role="tabpanel" hidden={tab !== 1} id="tabContent1" />
        </ErrorBoundary>

        {/* ----------------------------------------------------------------
            BOUNDARY 4: AI Coach tab
            This is the highest-risk section. CoachTab dynamically imports
            AICoachChat (1500+ lines), which has 13 `new Chess()` calls,
            JSON.parse without try-catch, and extensive async state
            management. An error here must not take down the board or
            analysis tab.
            ---------------------------------------------------------------- */}
        <ErrorBoundary name="ai-coach">
          <CoachTab role="tabpanel" hidden={tab !== 2} id="tabContent2" />
        </ErrorBoundary>

        <Box width="100%">
          <Divider sx={{ marginX: "5%", marginY: 1.5 }} />
          <PanelToolBar key="main-panel-toolbar" />
        </Box>
      </Grid>

      <EngineSettingsButton />
    </Grid>
  );
}

// ===========================================================================
// What this protects against
// ===========================================================================
//
// Scenario                              Without boundaries    With boundaries
// ───────────────────────────────────── ──────────────────── ──────────────────────
// Null FEN reaches Board component      Blank white page     Board shows error,
//                                                            analysis tabs work
//
// AICoachChat JSON.parse throws         Blank white page     Coach tab shows error,
//                                                            board + analysis work
//
// gameEval.positions[i] out of bounds   Blank white page     Analysis tab shows
//                                                            error, board + coach
//                                                            keep working
//
// chess.js throws on malformed PGN      Blank white page     Affected section shows
// in MovesCoachTab                                           error, others survive
//
// All scenarios: Sentry receives the error with the boundary name as context,
// so you can see "errorBoundary: ai-coach" in the Sentry dashboard and know
// exactly which section crashed without reading the full component stack.
