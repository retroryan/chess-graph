/**
 * Before/After Example — feedback route (/api/feedback/route.ts)
 *
 * This route already has some validation (username/platform presence, platform
 * allowlist), but it has gaps: no username length/type check, no maxGames bounds,
 * and the error format differs from other routes.
 *
 * Key changes:
 * - Manual if/else checks → single schema.safeParse() call
 * - maxGames default 25 with no ceiling → constrained to 1..100
 * - Username accepted as any truthy value → validated as 1..50 char string
 * - Platform checked via array.includes() → validated via z.enum()
 * - Consistent error format: { error, details: { fieldErrors } }
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
//     // Validation: presence check only — no type, length, or range checks
//     if (!username || !platform) {
//       return NextResponse.json(
//         { error: "Username and platform are required" },
//         { status: 400 }
//       );
//     }
//
//     // Validation: platform allowlist — but maxGames has no ceiling
//     if (!["lichess", "chesscom"].includes(platform)) {
//       return NextResponse.json(
//         { error: "Platform must be either 'lichess' or 'chesscom'" },
//         { status: 400 }
//       );
//     }
//
//     // maxGames could be -1, "abc", or 999999 here
//     const feedbackData = await generatePlayerFeedback({ username, platform, maxGames });
//     return NextResponse.json(feedbackData);
//   } catch (error) {
//     // ...
//   }
// }

// ===========================================================================
// AFTER — same route with Zod schema validation
// ===========================================================================

import { NextRequest, NextResponse } from "next/server";
import { generatePlayerFeedback } from "@/lib/feedback/generateFeedback";
import { feedbackSchema } from "../schemas";

export async function POST(request: NextRequest) {
  try {
    const result = feedbackSchema.safeParse(await request.json());

    if (!result.success) {
      // Structured error tells the client exactly what's wrong:
      // {
      //   "error": "Invalid input",
      //   "details": {
      //     "fieldErrors": {
      //       "username": ["String must contain at least 1 character(s)"],
      //       "platform": ["Platform must be 'lichess' or 'chesscom'"],
      //       "maxGames": ["Number must be less than or equal to 100"]
      //     }
      //   }
      // }
      return NextResponse.json(
        { error: "Invalid input", details: result.error.flatten() },
        { status: 400 },
      );
    }

    // All three fields are now guaranteed valid:
    // - username: string, 1..50 characters
    // - platform: "lichess" | "chesscom"
    // - maxGames: integer, 1..100 (defaults to 25 if omitted)
    const { username, platform, maxGames } = result.data;

    const feedbackData = await generatePlayerFeedback({
      username,
      platform,
      maxGames,
    });

    return NextResponse.json(feedbackData);
  } catch (error) {
    console.error("Error generating feedback:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// ===========================================================================
// What the schema catches that the current code does not
// ===========================================================================
//
// Input                                    Current behavior              With schema
// ────────────────────────────────────── ─────────────────────────────── ──────────────────────────
// { username: "", platform: "lichess" }  Passes !username check → 400   "username: min 1 char" → 400
// { username: 123, platform: "lichess" } !123 is false → passes!        "Expected string" → 400
// { platform: "LICHESS" }                 includes() is case-sensitive   "Invalid enum value" → 400
//                                         → 400 (but unclear why)        (with exact allowed values)
// { maxGames: 999999 }                    Passes — triggers 999999 API  "max 100" → 400
//                                         calls to Chess.com/Lichess
// { maxGames: -1 }                        Passes — meaningless value     "min 1" → 400
// { maxGames: "abc" }                     Passes — NaN propagates        "Expected number" → 400
// { username: "a".repeat(10000) }         Passes — very long URL         "max 50 chars" → 400
