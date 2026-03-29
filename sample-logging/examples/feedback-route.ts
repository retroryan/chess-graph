/**
 * Before/After Example — feedback API route (/api/feedback/route.ts)
 *
 * This file shows the real feedback route from chess-coach-ai transformed to
 * use structured logging. The "BEFORE" section is the current code (verbatim).
 * The "AFTER" section shows the same route with the structured logger.
 *
 * Key changes:
 * - 6 separate console.* calls → 4 structured log calls with context objects
 * - String concatenation → structured fields (searchable, filterable)
 * - No request correlation → automatic request ID from AsyncLocalStorage
 * - console.error with raw error → structured error with message + stack
 * - Sentry integration added for error reporting
 */

// ===========================================================================
// BEFORE — current code from chess-coach-ai/src/app/api/feedback/route.ts
// ===========================================================================
//
// import { NextRequest, NextResponse } from "next/server";
// import { generatePlayerFeedback } from "@/lib/feedback/generateFeedback";
//
// export async function POST(request: NextRequest) {
//   try {
//     console.log("Feedback API called");
//     const body = await request.json();
//     const { username, platform, maxGames = 25 } = body;
//
//     console.log("Request data:", { username, platform, maxGames });
//
//     if (!username || !platform) {
//       return NextResponse.json(
//         { error: "Username and platform are required" },
//         { status: 400 }
//       );
//     }
//
//     if (!["lichess", "chesscom"].includes(platform)) {
//       return NextResponse.json(
//         { error: "Platform must be either 'lichess' or 'chesscom'" },
//         { status: 400 }
//       );
//     }
//
//     console.log("Starting feedback generation for:", username, "on", platform);
//     const feedbackData = await generatePlayerFeedback({
//       username,
//       platform,
//       maxGames,
//     });
//
//     console.log("Feedback generation completed successfully");
//     return NextResponse.json(feedbackData);
//   } catch (error) {
//     console.error("Error generating feedback:", error);
//     console.error(
//       "Error stack:",
//       error instanceof Error ? error.stack : "No stack trace"
//     );
//
//     const errorMessage =
//       error instanceof Error ? error.message : "Unknown error occurred";
//
//     return NextResponse.json({ error: errorMessage }, { status: 500 });
//   }
// }

// ===========================================================================
// AFTER — same route with structured logging
// ===========================================================================

import { NextRequest, NextResponse } from "next/server";
import { generatePlayerFeedback } from "@/lib/feedback/generateFeedback";
import { withRequestContext, getRequestDuration } from "../request-context";
import { createSentryLogger, logErrorToSentry } from "../sentry-integration";

const log = createSentryLogger({ module: "feedback", route: "/api/feedback" });

export async function POST(request: NextRequest) {
  return withRequestContext(request, "/api/feedback", async () => {
    try {
      const body = await request.json();
      const { username, platform, maxGames = 25 } = body;

      // One structured call replaces two separate console.log calls.
      // "username", "platform", "maxGames" become searchable JSON fields.
      log.info("Feedback API called", { username, platform, maxGames });

      if (!username || !platform) {
        log.warn("Missing required fields", { username: !!username, platform: !!platform });
        return NextResponse.json(
          { error: "Username and platform are required" },
          { status: 400 },
        );
      }

      if (!["lichess", "chesscom"].includes(platform)) {
        log.warn("Invalid platform", { platform });
        return NextResponse.json(
          { error: "Platform must be either 'lichess' or 'chesscom'" },
          { status: 400 },
        );
      }

      const feedbackData = await generatePlayerFeedback({
        username,
        platform,
        maxGames,
      });

      // Duration is auto-calculated from the request context start time.
      log.info("Feedback generation completed", {
        username,
        platform,
        durationMs: getRequestDuration(),
      });

      return NextResponse.json(feedbackData);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";

      // One call replaces two console.error calls AND sends to Sentry.
      // The structured logger captures message, stack, and context as
      // separate JSON fields — no more "Error stack: ..." string parsing.
      logErrorToSentry(error, {
        route: "/api/feedback",
        operation: "generatePlayerFeedback",
      });

      return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
  });
}

// ===========================================================================
// Sample output (production JSON lines for a single request)
// ===========================================================================
//
// {"timestamp":"2026-03-28T12:00:00.000Z","level":"info","message":"Feedback API called","module":"feedback","route":"/api/feedback","username":"magnus","platform":"lichess","maxGames":25,"requestId":"lax1::iad1::8f3a2b"}
// {"timestamp":"2026-03-28T12:00:02.150Z","level":"info","message":"Feedback generation completed","module":"feedback","route":"/api/feedback","username":"magnus","platform":"lichess","durationMs":2150,"requestId":"lax1::iad1::8f3a2b"}
//
// Sample output (development pretty-print):
//
// 12:00:00.000 INFO  [feedback] Feedback API called {"username":"magnus","platform":"lichess","maxGames":25} req=lax1::iad1::8f
// 12:00:02.150 INFO  [feedback] Feedback generation completed {"username":"magnus","platform":"lichess","durationMs":2150} req=lax1::iad1::8f
