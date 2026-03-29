/**
 * Firestore service module for chess openings data.
 *
 * This module replaces the hardcoded 13,600-line openings.ts file (which ships
 * 3,400+ openings in the JavaScript bundle) with a Firestore-backed data layer.
 * Moving openings to Firestore means the data can be updated, enriched, and
 * queried without code deploys.
 *
 * Follows the same patterns established in firestoreGames.ts:
 * - Modular Firestore SDK imports
 * - Shared firebase.ts config for the db instance
 * - firestoreId assigned after read (not stored in the document)
 * - serverTimestamp() for created/updated fields
 * - Guard clause when db is not initialized
 *
 * Recommended Firestore security rules for this collection:
 *
 *   match /openings/{openingId} {
 *     allow read: if request.auth != null;
 *     allow write: if false; // Admin SDK only — reference data shouldn't
 *                            // be writable from the client
 *   }
 *
 * No composite indexes are required. All queries below use single-field
 * conditions (name, eco) with optional orderBy on the same field, which
 * Firestore handles with automatic single-field indexes.
 */

import {
  collection,
  doc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  writeBatch,
  serverTimestamp,
  Timestamp,
  DocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A chess opening stored in Firestore.
 *
 * Required fields (name, fen) come from the original openings.ts data.
 * ECO codes are sourced from the lichess-org/chess-openings dataset (a.tsv
 * through e.tsv) for 94.6% of entries (exact name match), with the remaining
 * 5.4% manually assigned from 365chess.com and chess reference sources.
 * All 3,401 entries now have ECO codes (100% coverage). PGN move sequences
 * are available for the 94.6% matched from the lichess dataset.
 * Additional optional fields support future enrichment — descriptions from
 * commentary data, popularity scores, etc. — without schema changes.
 */
export interface OpeningDocument {
  /** Firestore document ID, assigned after read (not stored in the document). */
  firestoreId?: string;

  /** Opening name, e.g. "Sicilian Defense: Najdorf Variation". */
  name: string;

  /** FEN string representing the board position after the opening moves. */
  fen: string;

  /**
   * ECO (Encyclopedia of Chess Openings) code, e.g. "B90" for Sicilian Najdorf.
   * All 3,401 entries have ECO codes: 94.6% from the lichess-org/chess-openings
   * dataset (exact name match), 5.4% manually verified against 365chess.com.
   */
  eco?: string;

  /** PGN move sequence leading to the FEN position. */
  pgn?: string;

  /** Human-readable description of the opening's strategic character. */
  description?: string;

  /** Usage frequency from game databases (0-1 scale). */
  popularity?: number;

  /** Skill level, aligning with the existing skill bucketing in chess-coach-ai. */
  difficulty?: "beginner" | "intermediate" | "advanced";

  /** Strategic themes, aligning with OpeningRepertoire.themes in types/openings.ts. */
  themes?: string[];

  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

// ---------------------------------------------------------------------------
// Collection reference
// ---------------------------------------------------------------------------

/**
 * Top-level collection, not nested under users/{userId}.
 *
 * Openings are shared reference data — every user queries the same set.
 * This differs from the games collection (users/{userId}/games) which is
 * user-scoped. A top-level collection avoids duplicating 3,400 documents
 * per user and allows a single set of security rules for read access.
 */
const OPENINGS_COLLECTION = "openings";

function getOpeningsRef() {
  if (!db) throw new Error("Firestore not initialized");
  return collection(db, OPENINGS_COLLECTION);
}

// ---------------------------------------------------------------------------
// Bulk load (initial seed)
// ---------------------------------------------------------------------------

/**
 * Seed the Firestore openings collection from the extracted JSON data.
 *
 * Uses writeBatch to minimize round trips. Firestore limits batches to 500
 * operations, so 3,400 openings require ~7 batches instead of 3,400 individual
 * writes. Each opening gets auto-generated document IDs (not name-based,
 * because opening names contain colons and apostrophes that are valid but
 * awkward as document IDs).
 *
 * Intended to be run once during migration. For ongoing updates, use the
 * individual CRUD functions below.
 *
 * Usage:
 *   import openingsJson from "./openings.json";
 *   const count = await bulkLoadOpenings(openingsJson);
 *   console.log(`Loaded ${count} openings`);
 */
export async function bulkLoadOpenings(
  openingsData: Array<{
    name: string;
    fen: string;
    eco: string;
    pgn?: string | null;
  }>
): Promise<number> {
  if (!db) throw new Error("Firestore not initialized");

  const BATCH_SIZE = 500;
  let totalWritten = 0;

  for (let i = 0; i < openingsData.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    const chunk = openingsData.slice(i, i + BATCH_SIZE);

    for (const opening of chunk) {
      const docRef = doc(getOpeningsRef());
      batch.set(docRef, {
        name: opening.name,
        fen: opening.fen,
        eco: opening.eco,
        ...(opening.pgn ? { pgn: opening.pgn } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
    totalWritten += chunk.length;
  }

  return totalWritten;
}

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

/**
 * Retrieve all openings, ordered by name.
 *
 * Cost note: This reads all ~3,400 documents in one query (3,400 Firestore
 * reads). At the free tier limit of 50,000 reads/day, calling this 14 times
 * exhausts the daily quota. For client-side use, prefer getOpeningsPaginated()
 * or cache the result. Firestore's offline persistence can also cache this
 * collection locally after the first load.
 */
export async function getAllOpenings(): Promise<OpeningDocument[]> {
  const openingsRef = getOpeningsRef();
  const q = query(openingsRef, orderBy("name"));
  const snapshot = await getDocs(q);

  return snapshot.docs.map((doc) => ({
    ...(doc.data() as Omit<OpeningDocument, "firestoreId">),
    firestoreId: doc.id,
  }));
}

/**
 * Find an opening by exact name match.
 *
 * Note: Firestore string equality is case-sensitive. "sicilian defense" will
 * NOT match "Sicilian Defense". If case-insensitive search is needed, store
 * a lowercased `nameLower` field and query against that.
 */
export async function getOpeningByName(
  name: string
): Promise<OpeningDocument | null> {
  const openingsRef = getOpeningsRef();
  const q = query(openingsRef, where("name", "==", name), limit(1));
  const snapshot = await getDocs(q);

  if (snapshot.empty) return null;

  const doc = snapshot.docs[0];
  return {
    ...(doc.data() as Omit<OpeningDocument, "firestoreId">),
    firestoreId: doc.id,
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Add a single opening to the collection.
 * Mirrors the addCloudGame pattern in firestoreGames.ts.
 */
export async function addOpening(
  opening: Omit<OpeningDocument, "firestoreId" | "createdAt" | "updatedAt">
): Promise<string> {
  const openingsRef = getOpeningsRef();
  const docRef = await addDoc(openingsRef, {
    ...opening,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return docRef.id;
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/**
 * Partially update an opening document.
 * Mirrors the updateCloudGameEval pattern — only the provided fields are
 * overwritten, and updatedAt is set automatically.
 */
export async function updateOpening(
  firestoreId: string,
  updates: Partial<
    Omit<OpeningDocument, "firestoreId" | "createdAt" | "updatedAt">
  >
): Promise<void> {
  if (!db) throw new Error("Firestore not initialized");
  const openingRef = doc(db, OPENINGS_COLLECTION, firestoreId);
  await updateDoc(openingRef, {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Delete an opening by its Firestore document ID.
 * Mirrors the deleteCloudGame pattern.
 */
export async function deleteOpening(firestoreId: string): Promise<void> {
  if (!db) throw new Error("Firestore not initialized");
  const openingRef = doc(db, OPENINGS_COLLECTION, firestoreId);
  await deleteDoc(openingRef);
}

// ---------------------------------------------------------------------------
// Query: search by name prefix
// ---------------------------------------------------------------------------

/**
 * Search openings by name prefix (e.g. "Sicilian" returns all Sicilian lines).
 *
 * Firestore does not support LIKE or substring-contains queries. This uses
 * the standard range query trick: >= prefix AND <= prefix + \uf8ff (a high
 * Unicode character). This matches any string that starts with the prefix.
 *
 * Limitation: only matches the START of the name. Searching "Najdorf" will
 * NOT find "Sicilian Defense: Najdorf Variation". For substring search,
 * consider a dedicated search service (Algolia, Typesense) or a client-side
 * filter over a cached dataset.
 *
 * Usage:
 *   const sicilians = await searchOpeningsByName("Sicilian Defense");
 *   // Returns: Sicilian Defense, Sicilian Defense: Najdorf, etc.
 */
export async function searchOpeningsByName(
  prefix: string
): Promise<OpeningDocument[]> {
  const openingsRef = getOpeningsRef();
  const q = query(
    openingsRef,
    where("name", ">=", prefix),
    where("name", "<=", prefix + "\uf8ff")
  );
  const snapshot = await getDocs(q);

  return snapshot.docs.map((doc) => ({
    ...(doc.data() as Omit<OpeningDocument, "firestoreId">),
    firestoreId: doc.id,
  }));
}

// ---------------------------------------------------------------------------
// Query: filter by ECO code prefix
// ---------------------------------------------------------------------------

/**
 * Find openings by ECO code prefix.
 *
 * Uses the same range query pattern as searchOpeningsByName.
 *
 * Usage:
 *   const allB = await getOpeningsByEcoPrefix("B");    // All semi-open games
 *   const sicilians = await getOpeningsByEcoPrefix("B20"); // Sicilian family
 *   const queens = await getOpeningsByEcoPrefix("D");  // All d4 d5 openings
 */
export async function getOpeningsByEcoPrefix(
  ecoPrefix: string
): Promise<OpeningDocument[]> {
  const openingsRef = getOpeningsRef();
  const q = query(
    openingsRef,
    where("eco", ">=", ecoPrefix),
    where("eco", "<=", ecoPrefix + "\uf8ff")
  );
  const snapshot = await getDocs(q);

  return snapshot.docs.map((doc) => ({
    ...(doc.data() as Omit<OpeningDocument, "firestoreId">),
    firestoreId: doc.id,
  }));
}

// ---------------------------------------------------------------------------
// Query: paginated retrieval
// ---------------------------------------------------------------------------

/**
 * Retrieve openings in pages, ordered by name.
 *
 * This is the recommended approach for client-side use. Instead of loading
 * all 3,400 openings at once (3,400 reads), load them in pages of 50-100
 * as the user scrolls or navigates.
 *
 * Uses cursor-based pagination via startAfter, which is Firestore's native
 * pagination model. The caller passes back the lastVisible snapshot from the
 * previous page to get the next page.
 *
 * Usage:
 *   // First page
 *   const page1 = await getOpeningsPaginated(50);
 *   renderOpenings(page1.openings);
 *
 *   // Next page
 *   const page2 = await getOpeningsPaginated(50, page1.lastVisible);
 *   renderOpenings(page2.openings);
 */
export async function getOpeningsPaginated(
  pageSize: number,
  lastDoc?: DocumentSnapshot | null
): Promise<{
  openings: OpeningDocument[];
  lastVisible: DocumentSnapshot | null;
}> {
  const openingsRef = getOpeningsRef();

  const constraints = [orderBy("name"), limit(pageSize)];
  if (lastDoc) {
    constraints.push(startAfter(lastDoc));
  }

  const q = query(openingsRef, ...constraints);
  const snapshot = await getDocs(q);

  const openings = snapshot.docs.map((doc) => ({
    ...(doc.data() as Omit<OpeningDocument, "firestoreId">),
    firestoreId: doc.id,
  }));

  const lastVisible =
    snapshot.docs.length > 0
      ? snapshot.docs[snapshot.docs.length - 1]
      : null;

  return { openings, lastVisible };
}
