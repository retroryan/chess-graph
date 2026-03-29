/**
 * Request Context — AsyncLocalStorage-based request ID propagation.
 *
 * Provides a request-scoped context (request ID, start time, route name) that
 * flows through the entire request lifecycle without manual parameter threading.
 * The structured logger (logger.ts) reads from this store automatically so
 * every log entry in a request shares the same correlation ID.
 *
 * ## How it works
 *
 * Each API route wraps its handler with `withRequestContext(request, handler)`.
 * This reads the `x-vercel-id` header (provided by Vercel on every request) or
 * falls back to `crypto.randomUUID()` for local development. The context is
 * then available to any module in the call chain via `getRequestId()`.
 *
 * Uses Node.js `AsyncLocalStorage` (stable since Node 16). This is the standard
 * mechanism for request-scoped context in serverless environments and works with
 * Next.js API routes running on the Node.js runtime.
 *
 * **Note:** AsyncLocalStorage is NOT available on the Vercel Edge Runtime. The
 * chess-coach-ai API routes use `maxDuration: 60` (Node.js serverless functions),
 * so this is safe. If a route were moved to Edge Runtime, the context functions
 * would return undefined and the logger would simply omit the request ID.
 *
 * ## Usage
 *
 *   // In an API route:
 *   import { withRequestContext } from "@/lib/request-context";
 *
 *   export async function POST(request: NextRequest) {
 *     return withRequestContext(request, "/api/feedback", async () => {
 *       // ... handler logic — all logs auto-tagged with request ID
 *     });
 *   }
 *
 *   // In any module:
 *   import { getRequestId } from "@/lib/request-context";
 *   const id = getRequestId(); // "lax1::iad1::abc123" or undefined
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RequestContext {
  /** Correlation ID for the request — from x-vercel-id header or random UUID */
  requestId: string;
  /** High-resolution start time (Date.now()) for duration calculations */
  startTime: number;
  /** Route path, e.g. "/api/feedback" */
  route?: string;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const storage = new AsyncLocalStorage<RequestContext>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Wrap an API route handler to establish request context for the duration
 * of the request. All downstream code (including the structured logger)
 * can read from this context without explicit parameter passing.
 *
 * @param request  The incoming NextRequest (used to read x-vercel-id header)
 * @param route    Optional route name for logging (e.g. "/api/feedback")
 * @param handler  The async handler function to execute within the context
 * @returns        The handler's return value
 */
export function withRequestContext<T>(
  request: { headers: { get(name: string): string | null } },
  route: string | undefined,
  handler: () => Promise<T>,
): Promise<T> {
  const requestId =
    request.headers.get("x-vercel-id") ||
    request.headers.get("x-request-id") ||
    randomUUID();

  const ctx: RequestContext = {
    requestId,
    startTime: Date.now(),
    route: route ?? undefined,
  };

  return storage.run(ctx, handler);
}

/**
 * Get the current request context, or undefined if called outside a request.
 */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Shorthand — get just the request ID, or undefined if outside a request.
 */
export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/**
 * Get elapsed milliseconds since the request started, or undefined if
 * called outside a request.
 */
export function getRequestDuration(): number | undefined {
  const ctx = storage.getStore();
  return ctx ? Date.now() - ctx.startTime : undefined;
}
