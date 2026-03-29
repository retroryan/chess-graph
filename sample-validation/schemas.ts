/**
 * API Input Schemas — Zod schemas for chess-coach-ai API route validation.
 *
 * Replaces the ad-hoc if/else input checks scattered across 11 API routes with
 * declarative schemas that validate, coerce, and document the expected shape of
 * every request body in one place.
 *
 * ## Why Zod?
 *
 * Zod is already the dominant validation library in the Next.js ecosystem. It:
 * - Infers TypeScript types from schemas (no manual interface + runtime check duplication)
 * - Produces structured error objects (field path, expected type, received value)
 * - Handles type coercion (string "25" → number 25 for query params)
 * - Composes naturally (reuse `fenSchema` across routes)
 * - Is 13 KB gzipped with zero dependencies
 *
 * ## Current state
 *
 * The API routes destructure request bodies with minimal validation:
 *
 *   const { fen, themes, limit = 5, command = "find_similar", difficulty } = await req.json();
 *   if (!themes || themes.length === 0) { ... }
 *   difficulty: difficulty as DifficultyBand  // TypeScript cast — no runtime check
 *
 * Problems:
 * - `limit` could be -1, "abc", or 999999 (no type or range check)
 * - `difficulty` is cast to DifficultyBand without validation (the cast is a lie)
 * - `themes` is checked for presence but not that it's an array of strings
 * - No consistent error format across routes
 *
 * ## After (this module)
 *
 * Each schema validates, coerces, and constrains inputs at the route boundary:
 *
 *   const result = puzzleDatasetSchema.safeParse(await req.json());
 *   if (!result.success) return NextResponse.json(
 *     { error: "Invalid input", details: result.error.flatten() },
 *     { status: 400 }
 *   );
 *   const { themes, limit, difficulty, command } = result.data;
 *   // limit is guaranteed to be 1..100, difficulty is a valid band or undefined
 *
 * ## Usage
 *
 *   import { feedbackSchema, puzzleDatasetSchema, type FeedbackInput } from "@/lib/schemas";
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared field schemas (reused across routes)
// ---------------------------------------------------------------------------

/**
 * FEN string validation. Checks basic structure (6 ranks separated by /,
 * active color, castling, en passant, halfmove clock, fullmove number).
 * Does NOT validate that the position is legal — chess.js handles that.
 */
export const fenSchema = z
  .string()
  .min(1, "FEN is required")
  .regex(
    /^[rnbqkpRNBQKP1-8/]+ [wb] [KQkq-]+ [a-h1-8-]+ \d+ \d+$/,
    "Invalid FEN format",
  );

/** Platform — the two chess platforms the app supports. */
export const platformSchema = z.enum(["lichess", "chesscom"], {
  errorMap: () => ({ message: "Platform must be 'lichess' or 'chesscom'" }),
});

/** Username — non-empty string with reasonable length bounds. */
export const usernameSchema = z
  .string()
  .min(1, "Username is required")
  .max(50, "Username too long");

/** Difficulty bands used by the puzzle system. */
export const difficultyBandSchema = z.enum([
  "easy",
  "medium",
  "hard",
  "expert",
]);

// ---------------------------------------------------------------------------
// Route schemas
// ---------------------------------------------------------------------------

/**
 * POST /api/feedback
 *
 * Current validation:
 *   if (!username || !platform) → 400
 *   if (!["lichess", "chesscom"].includes(platform)) → 400
 *
 * Missing: username type/length, maxGames type/range (default 25, no ceiling)
 */
export const feedbackSchema = z.object({
  username: usernameSchema,
  platform: platformSchema,
  maxGames: z
    .number()
    .int()
    .min(1, "maxGames must be at least 1")
    .max(100, "maxGames cannot exceed 100")
    .default(25),
});

export type FeedbackInput = z.infer<typeof feedbackSchema>;

/**
 * POST /api/chess-puzzles-dataset
 *
 * Current validation:
 *   if (!themes || themes.length === 0) → 400 (for find_similar/by_theme)
 *   difficulty as DifficultyBand  ← type cast with no runtime check
 *
 * Missing: limit range, difficulty enum validation, themes array type,
 *          excludeIds type, command enum
 */
export const puzzleDatasetSchema = z.object({
  command: z
    .enum(["find_similar", "by_theme", "random", "daily"])
    .default("find_similar"),
  themes: z.array(z.string().min(1)).optional(),
  limit: z
    .number()
    .int()
    .min(1, "limit must be at least 1")
    .max(100, "limit cannot exceed 100")
    .default(5),
  difficulty: z
    .union([difficultyBandSchema, z.array(difficultyBandSchema)])
    .optional(),
  fen: fenSchema.optional(),
  excludeIds: z.array(z.string()).optional(),
});

export type PuzzleDatasetInput = z.infer<typeof puzzleDatasetSchema>;

/**
 * POST /api/scout
 *
 * Current validation:
 *   if (!username || !platform) → 400
 *   platform compared with === "chess.com" / "lichess"
 *
 * Missing: months type/range (default 12, no ceiling — could trigger
 *          years of API calls to Chess.com/Lichess)
 */
export const scoutSchema = z.object({
  username: usernameSchema,
  platform: z.enum(["chess.com", "lichess"], {
    errorMap: () => ({ message: "Platform must be 'chess.com' or 'lichess'" }),
  }),
  months: z
    .number()
    .int()
    .min(1, "months must be at least 1")
    .max(24, "months cannot exceed 24")
    .default(12),
});

export type ScoutInput = z.infer<typeof scoutSchema>;

/**
 * POST /api/maia-predict
 *
 * Current validation:
 *   if (!fen) → 400
 *
 * Missing: FEN format validation, rating type/range checks
 */
export const maiaPredictSchema = z.object({
  fen: fenSchema,
  rating: z
    .number()
    .int()
    .min(100, "Rating must be at least 100")
    .max(3500, "Rating cannot exceed 3500")
    .default(1500),
  opponent_rating: z
    .number()
    .int()
    .min(100, "Opponent rating must be at least 100")
    .max(3500, "Opponent rating cannot exceed 3500")
    .optional(),
});

export type MaiaPredictInput = z.infer<typeof maiaPredictSchema>;

/**
 * POST /api/chat (fallback path — plain passthrough)
 *
 * Current validation:
 *   if (!messages || !Array.isArray(messages) || messages.length === 0) → 400
 *
 * Missing: model whitelist, temperature/max_tokens bounds, message structure
 */
export const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string().min(1),
      }),
    )
    .min(1, "At least one message is required")
    .optional(),
  contextId: z.string().optional(),
  userMessage: z.string().min(1).optional(),
  conversationHistory: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string(),
      }),
    )
    .optional(),
  model: z
    .enum(["gpt-4o", "gpt-4o-mini"])
    .default("gpt-4o-mini"),
  temperature: z.number().min(0).max(2).default(0.7),
  max_tokens: z
    .number()
    .int()
    .min(1)
    .max(4000, "max_tokens cannot exceed 4000")
    .default(1500),
});

export type ChatInput = z.infer<typeof chatSchema>;

// ---------------------------------------------------------------------------
// Validation helper
// ---------------------------------------------------------------------------

/**
 * Parse a request body against a schema. Returns the validated data or a
 * NextResponse with a structured 400 error.
 *
 * Usage:
 *   const result = parseBody(feedbackSchema, await req.json());
 *   if (result.error) return result.error;  // NextResponse with 400
 *   const { username, platform, maxGames } = result.data;
 */
export function parseBody<T extends z.ZodType>(
  schema: T,
  body: unknown,
): { data: z.infer<T>; error?: never } | { data?: never; error: { status: 400; body: { error: string; details: z.typeToFlattenedError<z.infer<T>> } } } {
  const result = schema.safeParse(body);
  if (result.success) {
    return { data: result.data };
  }
  return {
    error: {
      status: 400,
      body: {
        error: "Invalid input",
        details: result.error.flatten(),
      },
    },
  };
}
