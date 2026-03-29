/**
 * Before/After Example — response cache (src/lib/responseCache.ts)
 *
 * This file shows the real response cache module from chess-coach-ai transformed
 * to use structured logging. The "BEFORE" section is the current code (verbatim).
 * The "AFTER" section shows the same module with the structured logger.
 *
 * Key changes:
 * - Emoji prefixes (📦) → child logger with { module: "cache" }
 * - Template literal strings → structured fields (cacheKey, hitCount, size, etc.)
 * - All console.log → level-appropriate calls (info for operations, debug for skips)
 * - Context fields are machine-parseable (Vercel can filter by cacheKey, hitCount, etc.)
 */

// ===========================================================================
// BEFORE — current code from chess-coach-ai/src/lib/responseCache.ts
// (showing only the logging-relevant functions)
// ===========================================================================
//
// export function getCachedResponse(cacheKey: string): string | null {
//   const entry = cache.get(cacheKey);
//   if (!entry) return null;
//
//   // ... TTL and validation checks ...
//
//   entry.hitCount++;
//   cache.delete(cacheKey);
//   cache.set(cacheKey, entry);
//
//   console.log(`📦 Cache HIT for key: ${cacheKey.slice(0, 50)}... (hits: ${entry.hitCount})`);
//   return entry.response;
// }
//
// export function setCachedResponse(
//   cacheKey: string,
//   response: string,
//   validationScore: number
// ): void {
//   if (validationScore < 0.8) {
//     console.log(`📦 Cache SKIP — validation score too low: ${validationScore.toFixed(2)}`);
//     return;
//   }
//
//   // ... LRU eviction ...
//
//   cache.set(cacheKey, { response, timestamp: Date.now(), validationScore, hitCount: 0 });
//   console.log(`📦 Cache SET for key: ${cacheKey.slice(0, 50)}... (size: ${cache.size})`);
// }
//
// export function clearCache(): void {
//   cache.clear();
//   console.log("📦 Cache CLEARED");
// }

// ===========================================================================
// AFTER — same module with structured logging
// ===========================================================================

import { createHash } from "crypto";
import { createLogger } from "../logger";

// The child logger replaces the 📦 emoji prefix. Every log entry from this
// module automatically includes { module: "cache" } — searchable in Vercel
// logs without parsing emoji characters.
const log = createLogger({ module: "cache" });

interface CacheEntry {
  response: string;
  timestamp: number;
  validationScore: number;
  hitCount: number;
}

const MAX_CACHE_SIZE = 200;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const cache = new Map<string, CacheEntry>();

export function generateCacheKey(
  fen: string,
  skillLevel: string,
  userMessage: string,
): string {
  const messageHash = createHash("md5")
    .update(userMessage.toLowerCase().trim())
    .digest("hex")
    .slice(0, 12);

  const fenParts = fen.split(" ");
  const normalizedFen = fenParts.slice(0, 4).join(" ");

  return `${normalizedFen}|${skillLevel}|${messageHash}`;
}

export function getCachedResponse(cacheKey: string): string | null {
  const entry = cache.get(cacheKey);
  if (!entry) return null;

  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(cacheKey);
    // debug level — TTL expiration is routine, not an operational event
    log.debug("Cache entry expired", {
      cacheKey: cacheKey.slice(0, 50),
      ageMs: Date.now() - entry.timestamp,
    });
    return null;
  }

  if (entry.validationScore < 0.8) {
    cache.delete(cacheKey);
    log.debug("Cache entry below quality threshold", {
      cacheKey: cacheKey.slice(0, 50),
      validationScore: entry.validationScore,
    });
    return null;
  }

  entry.hitCount++;
  cache.delete(cacheKey);
  cache.set(cacheKey, entry);

  // Structured fields replace the template literal string.
  // In Vercel, you can now filter: level=info AND module=cache AND message="Cache hit"
  // to see all cache hits, or add cacheKey filter for a specific position.
  log.info("Cache hit", {
    cacheKey: cacheKey.slice(0, 50),
    hitCount: entry.hitCount,
  });

  return entry.response;
}

export function setCachedResponse(
  cacheKey: string,
  response: string,
  validationScore: number,
): void {
  if (validationScore < 0.8) {
    // debug level — low-score skips are expected behavior, not warnings.
    // The current code logs this at console.log level (info-equivalent),
    // but it's diagnostic detail that clutters production logs.
    log.debug("Cache skip — validation score too low", {
      cacheKey: cacheKey.slice(0, 50),
      validationScore,
      threshold: 0.8,
    });
    return;
  }

  if (cache.size >= MAX_CACHE_SIZE) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) {
      cache.delete(oldestKey);
      log.debug("Cache eviction (LRU)", {
        evictedKey: oldestKey.slice(0, 50),
      });
    }
  }

  cache.set(cacheKey, {
    response,
    timestamp: Date.now(),
    validationScore,
    hitCount: 0,
  });

  log.info("Cache set", {
    cacheKey: cacheKey.slice(0, 50),
    validationScore,
    cacheSize: cache.size,
    maxSize: MAX_CACHE_SIZE,
  });
}

export function getCacheStats(): {
  size: number;
  maxSize: number;
  oldestEntryAge: number | null;
} {
  let oldestAge: number | null = null;
  const entries = Array.from(cache.values());
  for (let i = 0; i < entries.length; i++) {
    const age = Date.now() - entries[i].timestamp;
    if (oldestAge === null || age > oldestAge) {
      oldestAge = age;
    }
  }

  return {
    size: cache.size,
    maxSize: MAX_CACHE_SIZE,
    oldestEntryAge: oldestAge,
  };
}

export function clearCache(): void {
  const previousSize = cache.size;
  cache.clear();
  // warn level — clearing the cache is a significant operational event.
  // The current code uses console.log, but this should be visible even
  // at higher log levels since it affects all cached responses.
  log.warn("Cache cleared", { previousSize });
}

// ===========================================================================
// Migration summary
// ===========================================================================
//
// BEFORE (emoji prefix, template literal)        → AFTER (structured logger)
// ─────────────────────────────────────────────── ──────────────────────────────────────
// console.log(`📦 Cache HIT for key: ...`)        → log.info("Cache hit", { cacheKey, hitCount })
// console.log(`📦 Cache SKIP — validation...`)    → log.debug("Cache skip...", { validationScore, threshold })
// console.log(`📦 Cache SET for key: ...`)         → log.info("Cache set", { cacheKey, validationScore, cacheSize })
// console.log("📦 Cache CLEARED")                  → log.warn("Cache cleared", { previousSize })
// (nothing for TTL expiry)                         → log.debug("Cache entry expired", { ageMs })
// (nothing for LRU eviction)                       → log.debug("Cache eviction (LRU)", { evictedKey })
//
// New capabilities:
// - TTL expirations and LRU evictions are now visible at debug level
// - Cache clear is elevated to warn (significant operational event)
// - Low-score skips demoted to debug (routine, not worth cluttering prod logs)
// - All fields are machine-parseable JSON (no emoji parsing needed)
