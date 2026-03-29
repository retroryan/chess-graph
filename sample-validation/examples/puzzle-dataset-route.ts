/**
 * Before/After Example — puzzle dataset route (/api/chess-puzzles-dataset/route.ts)
 *
 * This is the route specifically called out in RECOMMENDATIONS.md §3.8:
 *
 *   "The puzzle dataset route checks for a `command` field and branches on its
 *    value, but does not validate that `themes` is an array of strings, that
 *    `limit` is a positive integer, or that `difficulty` is a known band."
 *
 * Key changes:
 * - `difficulty as DifficultyBand` type cast → schema-validated enum
 * - `limit` with no bounds → constrained to 1..100
 * - `themes` presence check → validated as string array
 * - `command` string comparison → validated enum with default
 * - `excludeIds` unvalidated → validated as string array
 * - Ad-hoc error messages → consistent structured error format
 */

// ===========================================================================
// BEFORE — current code from chess-coach-ai/src/app/api/chess-puzzles-dataset/route.ts
// ===========================================================================
//
// import { NextResponse } from "next/server";
// import {
//   queryPuzzles,
//   findSimilarPuzzles,
//   getDatabaseIndex,
//   getAvailableThemes,
//   type DifficultyBand,
// } from "@/lib/puzzleDatabase";
//
// export async function POST(req: Request) {
//   try {
//     const { fen, themes, limit = 5, command = "find_similar", difficulty, excludeIds } = await req.json();
//
//     if (command === "find_similar") {
//       if (!themes || themes.length === 0) {
//         return NextResponse.json(
//           { error: "Themes are required for find_similar" },
//           { status: 400 }
//         );
//       }
//
//       const puzzles = await queryPuzzles({
//         themes,
//         limit,
//         shuffle: true,
//         excludeIds: excludeIds || undefined,
//       });
//
//       return NextResponse.json({
//         success: true,
//         puzzles,
//         count: puzzles.length,
//       });
//     } else if (command === "by_theme") {
//       if (!themes || themes.length === 0) {
//         return NextResponse.json(
//           { error: "Themes are required for by_theme command" },
//           { status: 400 }
//         );
//       }
//
//       const puzzles = await queryPuzzles({
//         themes,
//         limit,
//         difficulty: difficulty as DifficultyBand | DifficultyBand[] | undefined,
//         //          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//         //          This cast is a lie — difficulty could be "banana" or 42.
//         //          TypeScript is satisfied at compile time, but at runtime
//         //          the invalid value passes through to queryPuzzles().
//         shuffle: true,
//         excludeIds: excludeIds || undefined,
//       });
//
//       return NextResponse.json({
//         success: true,
//         puzzles,
//         count: puzzles.length,
//       });
//     } else if (command === "random") {
//       const puzzles = await queryPuzzles({
//         limit,     // ← no ceiling: limit=999999 queries the entire dataset
//         difficulty: difficulty as DifficultyBand | DifficultyBand[] | undefined,
//         shuffle: true,
//         excludeIds: excludeIds || undefined,
//       });
//
//       return NextResponse.json({
//         success: true,
//         puzzles,
//         count: puzzles.length,
//       });
//     } else if (command === "daily") {
//       // ...
//     } else {
//       return NextResponse.json(
//         { error: `Unknown command: ${command}` },
//         { status: 400 }
//       );
//     }
//   } catch (error) {
//     console.error("Error querying chess puzzles dataset:", error);
//     return NextResponse.json(
//       {
//         error: "Failed to query chess puzzles dataset",
//         details: error instanceof Error ? error.message : "Unknown error",
//       },
//       { status: 500 }
//     );
//   }
// }

// ===========================================================================
// AFTER — same route with Zod schema validation at the boundary
// ===========================================================================

import { NextResponse } from "next/server";
import {
  queryPuzzles,
  getDatabaseIndex,
  getAvailableThemes,
} from "@/lib/puzzleDatabase";
import { puzzleDatasetSchema } from "../schemas";

export async function POST(req: Request) {
  try {
    // Validate at the boundary — one call replaces all the scattered if/else
    // checks and type casts. If the body is malformed, the user gets a clear
    // 400 with structured error details (which field failed, what was expected).
    const result = puzzleDatasetSchema.safeParse(await req.json());

    if (!result.success) {
      return NextResponse.json(
        {
          error: "Invalid input",
          details: result.error.flatten(),
          // Example error output:
          // {
          //   "error": "Invalid input",
          //   "details": {
          //     "fieldErrors": {
          //       "difficulty": ["Invalid enum value. Expected 'easy' | 'medium' | 'hard' | 'expert', received 'banana'"],
          //       "limit": ["Number must be less than or equal to 100"]
          //     }
          //   }
          // }
        },
        { status: 400 },
      );
    }

    // After validation, every field has the correct type and constraints.
    // No type casts needed — TypeScript infers the types from the schema.
    const { command, themes, limit, difficulty, excludeIds } = result.data;
    //        ^^^^^^^^ "find_similar" | "by_theme" | "random" | "daily"
    //                  ^^^^^^ string[] | undefined
    //                          ^^^^^ number (1..100, default 5)
    //                                 ^^^^^^^^^^ "easy"|"medium"|"hard"|"expert" | array | undefined
    //                                             ^^^^^^^^^^ string[] | undefined

    if (command === "find_similar" || command === "by_theme") {
      // themes is still optional in the schema (not all commands need it),
      // so we check here. But we know it's string[] if present — not "maybe
      // an object, maybe a number" like the unvalidated version.
      if (!themes || themes.length === 0) {
        return NextResponse.json(
          { error: `Themes are required for ${command}` },
          { status: 400 },
        );
      }

      const puzzles = await queryPuzzles({
        themes,
        limit,        // Guaranteed 1..100 by schema
        difficulty,   // Guaranteed valid enum or undefined — no type cast needed
        shuffle: true,
        excludeIds,
      });

      return NextResponse.json({ success: true, puzzles, count: puzzles.length });
    }

    if (command === "random") {
      const puzzles = await queryPuzzles({
        limit,        // Cannot be 999999 — schema caps at 100
        difficulty,   // Cannot be "banana" — schema validates the enum
        shuffle: true,
        excludeIds,
      });

      return NextResponse.json({ success: true, puzzles, count: puzzles.length });
    }

    if (command === "daily") {
      const today = new Date().toISOString().slice(0, 10);
      const seed = today.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
      const allPuzzles = await queryPuzzles({ limit: 500, shuffle: false });
      if (allPuzzles.length === 0) {
        return NextResponse.json({ success: false, error: "No puzzles available" });
      }
      const idx = seed % allPuzzles.length;
      return NextResponse.json({ success: true, puzzle: allPuzzles[idx], date: today });
    }

    // Unreachable — the schema's enum already rejects unknown commands.
    // But TypeScript doesn't know that, so we satisfy exhaustiveness.
    return NextResponse.json({ error: `Unknown command: ${command}` }, { status: 400 });
  } catch (error) {
    console.error("Error querying chess puzzles dataset:", error);
    return NextResponse.json(
      {
        error: "Failed to query chess puzzles dataset",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

// ===========================================================================
// What changes and why
// ===========================================================================
//
// BEFORE                                          AFTER
// ─────────────────────────────────────────────── ─────────────────────────────────────────────
// difficulty as DifficultyBand                    → Schema validates enum; no cast needed
// limit = 5 (no ceiling)                          → Schema: .min(1).max(100).default(5)
// !themes || themes.length === 0                  → Schema: z.array(z.string().min(1)).optional()
// command string === comparison                   → Schema: z.enum(["find_similar", ...])
// excludeIds unvalidated                          → Schema: z.array(z.string()).optional()
// Custom error string per branch                  → result.error.flatten() — structured, consistent
//
// What the schema catches that the current code does not:
// - { limit: -1 }         → "Number must be greater than or equal to 1"
// - { limit: "abc" }      → "Expected number, received string"
// - { difficulty: 42 }    → "Invalid enum value"
// - { themes: "fork" }    → "Expected array, received string"
// - { command: "DROP" }   → "Invalid enum value"
// - { excludeIds: [123] } → "Expected string, received number" (for array items)
