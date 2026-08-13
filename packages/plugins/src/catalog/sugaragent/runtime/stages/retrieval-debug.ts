/**
 * packages/plugins/src/catalog/sugaragent/runtime/stages/retrieval-debug.ts
 *
 * Purpose: a dev-only `globalThis.__sugaragentRetrieval` handle for
 * inspecting per-chunk lore similarity scores from the most recent turn,
 * per NPC. Same idiom as `__sugaragentQuestContext` / `__sugaragentMemory`.
 *
 * From a devtools console (or an automated browser session):
 *   __sugaragentRetrieval.dump()                // all NPCs seen this session
 *   __sugaragentRetrieval.dump("npc:finnick")   // one NPC
 *
 * Each entry reports searchQuery, the exact string that was embedded, and
 * loreScores: score, source tag
 * (retrieved/pinned/synthetic-location), pageId, and fileId for every
 * chunk in that NPC's most recent turn. Use this to choose a value for
 * the Lore Relevance Floor setting.
 *
 * Scores here are what survived the threshold, because the vector store
 * applies it during the search. A result below it never arrives, so it
 * cannot appear in this dump.
 *
 * Status: active
 */

import type { RetrievalScoreEntry } from "../types";

export const SUGARAGENT_RETRIEVAL_WINDOW_KEY = "__sugaragentRetrieval";

export interface RetrievalSnapshot {
  npcDefinitionId: string;
  /**
   * The exact string that was embedded and searched. It is the player's
   * message, plus location and quest lines on the turns that add them.
   * Null when no search ran.
   */
  searchQuery: string | null;
  loreScores: RetrievalScoreEntry[];
  loreSearchPerformed: boolean;
  broadenedBeyondLorePage: boolean;
  ownPageExcluded: boolean;
  /**
   * Why no lore search ran, or null when one did. Without this a skipped
   * greeting, a missing gateway URL, and a failed search all look the same:
   * loreSearchPerformed false with no scores.
   */
  noSearchReason:
    | "social-fast-turn"
    | "no-vector-store-provider"
    | "no-proxy-base-url"
    | "search-failed"
    | null;
}

const snapshots = new Map<string, RetrievalSnapshot>();

export function recordRetrievalSnapshot(snapshot: RetrievalSnapshot): void {
  snapshots.set(snapshot.npcDefinitionId, snapshot);
}

export interface SugarAgentRetrievalDebugHandle {
  dump(npcDefinitionId?: string): unknown;
}

export function installRetrievalDebugHandle(): void {
  try {
    const g = globalThis as unknown as Record<string, unknown>;
    if (!g || g[SUGARAGENT_RETRIEVAL_WINDOW_KEY]) return;
    const handle: SugarAgentRetrievalDebugHandle = {
      dump(npcDefinitionId) {
        if (npcDefinitionId) return snapshots.get(npcDefinitionId) ?? null;
        return Object.fromEntries(snapshots.entries());
      }
    };
    g[SUGARAGENT_RETRIEVAL_WINDOW_KEY] = handle;
  } catch {
    // ignore -- a dev handle must never break init
  }
}
