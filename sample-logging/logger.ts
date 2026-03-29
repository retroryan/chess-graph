/**
 * Structured Logger — lightweight JSON logger for chess-coach-ai.
 *
 * Replaces the 272 `console.log/warn/error` calls across the codebase with a
 * logger that emits structured JSON lines. Zero external dependencies — uses
 * only Node.js built-ins and the request-context module from this directory.
 *
 * ## Why structured logging?
 *
 * The current codebase uses emoji prefixes (📦, 🔍, ✅, ❌) as poor-man's
 * namespaces and string concatenation for context. This is human-readable in
 * a terminal but:
 * - Cannot be filtered by log level in production
 * - Cannot be searched by field (e.g. "show me all cache misses for FEN X")
 * - Cannot be aggregated (e.g. "cache hit rate over the last hour")
 * - Cannot be correlated across a single request (no request ID)
 * - Vercel and Sentry consume JSON logs far more effectively than raw text
 *
 * ## Output format
 *
 * **Production** (NODE_ENV === "production") — one minified JSON line per entry:
 *   {"timestamp":"2026-03-28T12:00:00.000Z","level":"info","message":"Cache hit","module":"cache","cacheKey":"rnbqkbnr...","hitCount":3,"requestId":"lax1::abc"}
 *
 * **Development** — pretty-printed with ANSI colors:
 *   12:00:00.000 INFO  [cache] Cache hit { cacheKey: "rnbqkbnr...", hitCount: 3 }
 *
 * ## Usage
 *
 *   import { createLogger } from "@/lib/logger";
 *
 *   // Root logger (typically one per module)
 *   const log = createLogger({ module: "cache" });
 *
 *   log.info("Cache hit", { cacheKey, hitCount: entry.hitCount });
 *   log.debug("TTL check passed", { ageMs, ttlMs: CACHE_TTL_MS });
 *   log.error("Cache corruption detected", { key, error: err.message });
 *
 *   // Child loggers inherit parent context
 *   const routeLog = log.child({ route: "/api/feedback" });
 *   routeLog.info("Request received"); // includes module + route fields
 */

import { getRequestId } from "./request-context";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  requestId?: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  child(baseContext: Record<string, unknown>): Logger;
}

/** Optional callback invoked on every log entry (used by sentry-integration) */
export type LogHook = (entry: LogEntry) => void;

// ---------------------------------------------------------------------------
// Level filtering
// ---------------------------------------------------------------------------

const LEVEL_VALUES: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getConfiguredLevel(): LogLevel {
  const env = (
    typeof process !== "undefined" ? process.env?.LOG_LEVEL : undefined
  ) as string | undefined;

  if (env && env in LEVEL_VALUES) return env as LogLevel;

  // Default: debug in dev, info in production
  const nodeEnv =
    typeof process !== "undefined" ? process.env?.NODE_ENV : undefined;
  return nodeEnv === "production" ? "info" : "debug";
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

const isProduction =
  typeof process !== "undefined" && process.env?.NODE_ENV === "production";

const isBrowser =
  typeof process === "undefined" ||
  typeof process.stdout === "undefined";

/** ANSI color codes for dev output */
const COLORS: Record<LogLevel, string> = {
  debug: "\x1b[90m",  // gray
  info: "\x1b[36m",   // cyan
  warn: "\x1b[33m",   // yellow
  error: "\x1b[31m",  // red
};
const RESET = "\x1b[0m";

function formatDev(entry: LogEntry): string {
  const time = entry.timestamp.split("T")[1]?.replace("Z", "") ?? entry.timestamp;
  const color = COLORS[entry.level];
  const levelTag = entry.level.toUpperCase().padEnd(5);
  const module = entry.module ? ` [${entry.module}]` : "";

  // Collect extra fields (everything except the standard fields)
  const { timestamp, level, message, requestId, module: _m, ...extra } = entry;
  const extraStr = Object.keys(extra).length > 0
    ? ` ${JSON.stringify(extra)}`
    : "";

  const reqId = requestId ? ` req=${requestId.slice(0, 16)}` : "";

  return `${color}${time} ${levelTag}${RESET}${module} ${message}${extraStr}${reqId}`;
}

function formatProd(entry: LogEntry): string {
  return JSON.stringify(entry);
}

// ---------------------------------------------------------------------------
// Output routing
// ---------------------------------------------------------------------------

function writeOut(formatted: string): void {
  if (isBrowser) {
    // Fallback for accidental client-side import
    console.log(formatted);
    return;
  }
  process.stdout.write(formatted + "\n");
}

function writeErr(formatted: string): void {
  if (isBrowser) {
    console.error(formatted);
    return;
  }
  process.stderr.write(formatted + "\n");
}

// ---------------------------------------------------------------------------
// Logger implementation
// ---------------------------------------------------------------------------

/**
 * Create a structured logger.
 *
 * @param baseContext  Fields merged into every log entry (e.g. { module: "cache" })
 * @param hook        Optional callback fired on every entry (for Sentry breadcrumbs)
 */
export function createLogger(
  baseContext: Record<string, unknown> = {},
  hook?: LogHook,
): Logger {
  const minLevel = LEVEL_VALUES[getConfiguredLevel()];
  const format = isProduction ? formatProd : formatDev;

  function log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    if (LEVEL_VALUES[level] < minLevel) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...baseContext,
      ...context,
    };

    // Attach request ID from AsyncLocalStorage if available
    const requestId = getRequestId();
    if (requestId) entry.requestId = requestId;

    // Format and write
    const formatted = format(entry);
    if (level === "warn" || level === "error") {
      writeErr(formatted);
    } else {
      writeOut(formatted);
    }

    // Fire hook (used by Sentry integration for breadcrumbs)
    if (hook) {
      try {
        hook(entry);
      } catch {
        // Never let a hook failure break the application
      }
    }
  }

  return {
    debug: (msg, ctx) => log("debug", msg, ctx),
    info: (msg, ctx) => log("info", msg, ctx),
    warn: (msg, ctx) => log("warn", msg, ctx),
    error: (msg, ctx) => log("error", msg, ctx),

    child(childContext: Record<string, unknown>): Logger {
      return createLogger({ ...baseContext, ...childContext }, hook);
    },
  };
}
