/**
 * Sentry Integration — bridges the structured logger with Sentry error tracking.
 *
 * This is a drop-in replacement for chess-coach-ai's current `src/lib/sentry.ts`.
 * It preserves the same `logErrorToSentry` API for backward compatibility while
 * adding two capabilities:
 *
 * 1. Errors are both logged structurally (JSON to stderr) AND sent to Sentry.
 * 2. Info/warn log entries become Sentry breadcrumbs, so when an error does
 *    occur, the Sentry error detail page shows the full structured log trail
 *    leading up to it — not just the exception.
 *
 * ## Current state (src/lib/sentry.ts)
 *
 *   export const logErrorToSentry = (error, context?) => {
 *     if (isSentryEnabled()) {
 *       Sentry.captureException(error, { extra: context });
 *     } else {
 *       console.error(error);
 *     }
 *   };
 *
 * ## After (this module)
 *
 * Same function signature, but:
 * - Always emits a structured log entry (even when Sentry is enabled)
 * - Attaches request ID to Sentry's extra context automatically
 * - Provides `createSentryLogger()` which returns a Logger whose entries
 *   are also sent as Sentry breadcrumbs
 *
 * ## Usage
 *
 *   import { logErrorToSentry, createSentryLogger } from "@/lib/sentry-integration";
 *
 *   // Direct error reporting (backward-compatible with existing call sites)
 *   logErrorToSentry(error, { route: "/api/feedback", username });
 *
 *   // Logger with Sentry breadcrumb bridge
 *   const log = createSentryLogger({ module: "cache" });
 *   log.info("Cache hit", { key });   // → Sentry breadcrumb + JSON stdout
 *   log.error("Corruption", { key }); // → Sentry breadcrumb + captureMessage + JSON stderr
 */

import * as Sentry from "@sentry/nextjs";
import { createLogger, type LogEntry, type Logger } from "./logger";
import { getRequestId } from "./request-context";

// ---------------------------------------------------------------------------
// Sentry status check (same as current src/lib/sentry.ts)
// ---------------------------------------------------------------------------

export const isSentryEnabled = (): boolean =>
  !!process.env.NEXT_PUBLIC_SENTRY_DSN && Sentry.isInitialized();

// ---------------------------------------------------------------------------
// Drop-in replacement for logErrorToSentry
// ---------------------------------------------------------------------------

const errorLogger = createLogger({ module: "sentry" });

/**
 * Log an error structurally and forward it to Sentry if enabled.
 * Drop-in replacement for the existing `logErrorToSentry` in src/lib/sentry.ts.
 */
export const logErrorToSentry = (
  error: unknown,
  context?: Record<string, unknown>,
): void => {
  const errorMessage =
    error instanceof Error ? error.message : String(error);
  const errorStack =
    error instanceof Error ? error.stack : undefined;

  // Always emit structured log
  errorLogger.error(errorMessage, {
    ...context,
    stack: errorStack,
  });

  // Forward to Sentry if available
  if (isSentryEnabled()) {
    const requestId = getRequestId();
    Sentry.captureException(error, {
      extra: {
        ...context,
        ...(requestId ? { requestId } : {}),
      },
    });
  }
};

// ---------------------------------------------------------------------------
// Logger with Sentry breadcrumb bridge
// ---------------------------------------------------------------------------

/**
 * Sentry log hook — routes log entries to Sentry breadcrumbs.
 * When an error later triggers captureException, Sentry's UI shows these
 * breadcrumbs as a timeline leading up to the error.
 */
function sentryLogHook(entry: LogEntry): void {
  if (!isSentryEnabled()) return;

  const { timestamp, level, message, requestId, ...data } = entry;

  Sentry.addBreadcrumb({
    category: (entry.module as string) ?? "app",
    message,
    level: mapToSentryLevel(level),
    data: {
      ...data,
      ...(requestId ? { requestId } : {}),
    },
    timestamp: new Date(timestamp).getTime() / 1000,
  });
}

function mapToSentryLevel(
  level: string,
): "debug" | "info" | "warning" | "error" {
  switch (level) {
    case "debug":
      return "debug";
    case "info":
      return "info";
    case "warn":
      return "warning";
    case "error":
      return "error";
    default:
      return "info";
  }
}

/**
 * Create a structured logger that also sends entries as Sentry breadcrumbs.
 * Use this in API routes and server-side modules where Sentry context matters.
 *
 * @param baseContext  Fields merged into every log entry (e.g. { module: "cache" })
 */
export function createSentryLogger(
  baseContext: Record<string, unknown> = {},
): Logger {
  return createLogger(baseContext, sentryLogHook);
}
