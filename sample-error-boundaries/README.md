# React Error Boundaries Sample for chess-coach-ai

This directory contains a reusable error boundary component and three before/after examples showing where to place boundaries in the chess-coach-ai component tree. The goal is to prevent any single component crash from taking down the entire page.

## Why error boundaries?

chess-coach-ai has no error boundary components. When a runtime error occurs during rendering — a null FEN reaching the chessboard, a malformed PGN crashing chess.js, a missing puzzle field, a JSON.parse failure in the AI coach — React unmounts the entire component tree from `_app.tsx` down. The user sees a blank white screen with no way to recover except a full page reload. Sentry captures the error after the fact, but the user experience is already broken.

The codebase has specific patterns that make this likely:

- **44+ `new Chess(fen)` calls** across components and hooks. chess.js throws on invalid FEN strings. Any component that receives a bad FEN from an atom, API response, or URL parameter will crash during render.
- **9 `JSON.parse()` calls without try-catch** in hooks and services (e.g., `useAtomLocalStorage`, `useLocalStorage`, `weaknessProfile`, `feedbackStore`). Corrupted localStorage or unexpected API responses trigger parse errors during render.
- **Dynamic imports without boundaries.** The CoachTab dynamically imports `AICoachChat` (1,500+ lines, 13 Chess instantiations). A crash in this module takes down the entire analysis page, including the chessboard and analysis tabs that were working fine.
- **Array indexing without bounds checks.** `gameEval.positions[i]` in the analysis tab, `history[history.length - 1]` in chess utilities — these throw on empty or undefined arrays.

## What error boundaries give you

Each section of the UI can fail independently:

| If this crashes... | Without boundaries | With boundaries |
|---|---|---|
| AI Coach chat | Blank white page | Coach tab shows error; board + analysis work |
| Chessboard | Blank white page | Board shows error; analysis tabs work |
| Analysis tab | Blank white page | Analysis shows error; board + coach work |
| Puzzle Rush | Blank white page | Rush shows error; back button still works |
| Practice board | Blank white page | Board shows error; puzzle list navigable |

Every caught error reports to Sentry with the boundary name as a tag (`errorBoundary: ai-coach`), so the Sentry dashboard shows exactly which section crashed without reading the full component stack.

## What's in this directory

```
sample-error-boundaries/
  ErrorBoundary.tsx                     # Reusable error boundary component
  examples/
    analysis-page.tsx                   # Before/after: analysis page (4 boundaries)
    practice-page.tsx                   # Before/after: practice page (3 boundaries)
    app-wrapper.tsx                     # Before/after: _app.tsx top-level boundary
  README.md
```

### `ErrorBoundary.tsx`

A single configurable class component (React requires class components for error boundaries — there is no hook equivalent). Features:

- **`name` prop** — identifies the boundary in error messages and Sentry tags
- **Custom fallback** — accepts a ReactNode or a render function that receives `{ error, reset }`
- **Default fallback** — shows the error message and a "Try Again" button styled in the app's orange theme
- **Sentry integration** — calls `Sentry.captureException` with the boundary name as a tag and the component stack as context
- **Reset capability** — the `reset()` function clears the error state and re-renders the children, letting the user retry without a page reload

### `examples/analysis-page.tsx`

The analysis page (`pages/analysis.tsx`) with four boundaries:

1. **`chessboard`** — wraps the `<Board />` component
2. **`analysis`** — wraps `<AnalysisTab />` (evaluation data, move classifications)
3. **`moves-coach`** — wraps `<MovesCoachTab />` (per-move coaching annotations)
4. **`ai-coach`** — wraps `<CoachTab />` (dynamically imported AICoachChat)

The tab navigation, panel header, and toolbar stay outside boundaries — they're pure UI with no chess logic and must remain functional for recovery.

### `examples/practice-page.tsx`

The practice page (`pages/practice.tsx`) with three boundaries:

1. **`puzzle-rush`** — wraps `<PuzzleRush />` (810 lines, timer-driven, multiple Chess instantiations)
2. **`pattern-training`** — wraps `<PatternTraining />`
3. **`practice-board`** — wraps `<PracticeBoard />` (calls `new Chess(puzzle.fen)`)

The Back button and theme selector stay outside boundaries so users can always navigate away from a broken puzzle.

### `examples/app-wrapper.tsx`

A top-level boundary in `_app.tsx` that acts as a last-resort safety net. If an error escapes all section-level boundaries (or occurs in a page that hasn't been wrapped yet), the user sees a full-page error screen with "Try Again" and "Reload Page" buttons instead of a blank white screen.

The boundary is placed inside `QueryClientProvider` and `AuthProvider` so those contexts survive a reset — the user stays authenticated after clicking "Try Again".

## Boundary placement hierarchy

```
_app.tsx
  QueryClientProvider
    AuthProvider
      ErrorBoundary name="app"                    ← last resort
        Layout
          analysis.tsx
            ErrorBoundary name="chessboard"       ← section level
            ErrorBoundary name="analysis"         ← section level
            ErrorBoundary name="moves-coach"      ← section level
            ErrorBoundary name="ai-coach"         ← section level
          practice.tsx
            ErrorBoundary name="puzzle-rush"      ← section level
            ErrorBoundary name="pattern-training" ← section level
            ErrorBoundary name="practice-board"   ← section level
```

## Where to place boundaries vs. where NOT to

**Wrap with a boundary:**
- Components that instantiate `Chess` objects from external data (FEN, PGN)
- Components with dynamic imports (`next/dynamic`)
- Components with timer-driven state (Puzzle Rush countdown)
- Components that parse JSON from API responses or localStorage

**Do NOT wrap:**
- Pure UI components (buttons, selectors, tabs) — they won't throw
- Navigation elements — must stay functional for recovery
- Components already inside a boundary (don't double-wrap)
- The entire page at once (too coarse — defeats the purpose)

## Design decisions

**Class component, not a hook.** React does not provide a hook equivalent for `componentDidCatch` / `getDerivedStateFromError`. This is a single class component — all customization is via props, so consuming code stays as functional components.

**Sentry tag, not just extra context.** The boundary name is set as a Sentry tag (`scope.setTag("errorBoundary", name)`) rather than extra context. Tags are indexed and filterable in the Sentry dashboard — you can query "show me all errors where errorBoundary = ai-coach" without full-text search.

**Reset via state clear, not remount.** The `reset()` function sets `hasError: false`, which re-renders the children. This works for transient errors (a race condition, a one-time bad value). For persistent errors (a corrupted atom, a broken API response), the error will recur on re-render — but the user still has the option to navigate away, which they can't do with a blank white screen.

**Default fallback uses inline styles.** The default fallback avoids importing MUI components because the error might have originated from a MUI component or theme context. Inline styles guarantee the fallback renders regardless of what's broken.
