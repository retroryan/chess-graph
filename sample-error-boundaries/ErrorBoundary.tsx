/**
 * ErrorBoundary — reusable React error boundary for chess-coach-ai.
 *
 * React error boundaries must be class components (there is no hook equivalent
 * for componentDidCatch / getDerivedStateFromError as of React 19). This module
 * provides a single configurable boundary that can wrap any section of the UI.
 *
 * ## Why error boundaries?
 *
 * chess-coach-ai has zero error boundary components. A runtime error in any
 * component — a null FEN reaching the chessboard, a malformed PGN crashing
 * chess.js, a missing puzzle field — crashes the entire page. The user sees
 * a blank white screen. Sentry captures the error after the fact, but the
 * user has no way to recover without a full page reload.
 *
 * Error boundaries let each section fail independently. If the AI coach chat
 * throws, the chessboard and analysis panel keep working. If a puzzle crashes,
 * the puzzle selector and navigation remain functional.
 *
 * ## Current state
 *
 * The application has 44+ unprotected `new Chess(fen)` calls, 9 JSON.parse()
 * calls without try-catch, and multiple components that access atom values
 * without null guards. Any of these can throw during render and crash the
 * entire page.
 *
 * The component hierarchy (from _app.tsx) is:
 *
 *   QueryClientProvider → AuthProvider → Layout → Page Component
 *
 * With no boundaries, an error anywhere below Layout propagates up and
 * unmounts everything.
 *
 * ## Usage
 *
 *   import { ErrorBoundary } from "@/components/ErrorBoundary";
 *
 *   // Wrap a section of the UI
 *   <ErrorBoundary name="coach" fallback={<CoachErrorFallback />}>
 *     <AICoachChat position={fen} game={game} />
 *   </ErrorBoundary>
 *
 *   // With the default fallback (no custom component needed)
 *   <ErrorBoundary name="chessboard">
 *     <Board />
 *   </ErrorBoundary>
 *
 *   // With onError callback for logging/Sentry
 *   <ErrorBoundary name="puzzles" onError={(error, info) => logErrorToSentry(error, { component: info })}>
 *     <PuzzleRush />
 *   </ErrorBoundary>
 */

import React, { Component, type ErrorInfo, type ReactNode } from "react";
import * as Sentry from "@sentry/nextjs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Name for this boundary — appears in error messages and Sentry context */
  name: string;
  /** Custom fallback UI. Receives error and reset function. */
  fallback?: ReactNode | ((props: { error: Error; reset: () => void }) => ReactNode);
  /** Optional callback when an error is caught */
  onError?: (error: Error, componentStack: string) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const componentStack = errorInfo.componentStack ?? "";

    // Report to Sentry with boundary context
    if (Sentry.isInitialized()) {
      Sentry.withScope((scope) => {
        scope.setTag("errorBoundary", this.props.name);
        scope.setContext("componentStack", { stack: componentStack });
        Sentry.captureException(error);
      });
    }

    // Call optional error handler
    this.props.onError?.(error, componentStack);

    // Always log to console for development
    console.error(
      `[ErrorBoundary:${this.props.name}] Caught error:`,
      error,
      componentStack,
    );
  }

  reset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      // Custom fallback (function or element)
      if (typeof this.props.fallback === "function") {
        return this.props.fallback({
          error: this.state.error,
          reset: this.reset,
        });
      }
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default fallback
      return <DefaultFallback name={this.props.name} error={this.state.error} onReset={this.reset} />;
    }

    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Default fallback UI
// ---------------------------------------------------------------------------

function DefaultFallback({
  name,
  error,
  onReset,
}: {
  name: string;
  error: Error;
  onReset: () => void;
}) {
  return (
    <div
      style={{
        padding: "24px",
        textAlign: "center",
        border: "1px solid #e0e0e0",
        borderRadius: "8px",
        backgroundColor: "#fafafa",
        margin: "8px",
      }}
    >
      <p style={{ fontSize: "16px", fontWeight: 600, margin: "0 0 8px 0" }}>
        Something went wrong in {name}
      </p>
      <p
        style={{
          fontSize: "14px",
          color: "#666",
          margin: "0 0 16px 0",
          fontFamily: "monospace",
        }}
      >
        {error.message}
      </p>
      <button
        onClick={onReset}
        style={{
          padding: "8px 24px",
          fontSize: "14px",
          fontWeight: 600,
          backgroundColor: "#FF6B35",
          color: "#fff",
          border: "none",
          borderRadius: "4px",
          cursor: "pointer",
        }}
      >
        Try Again
      </button>
    </div>
  );
}
