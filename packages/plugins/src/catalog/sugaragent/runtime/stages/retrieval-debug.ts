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
 * Each entry reports loreScores: score, source tag
 * (retrieved/pinned/synthetic-location), pageId, and fileId for every
 * chunk in that NPC's most recent turn. Use this to calibrate the
 * loreRelevanceFloor config knob (Plan 078.2).
 *
 * Status: active (Plan 078.1)
 */

export const SUGARAGENT_RETRIEVAL_WINDOW_KEY = "__sugaragentRetrieval";

export interface RetrievalScoreEntry {
  score: number;
  /** How this chunk entered loreContext. */
  source: "retrieved" | "pinned" | "synthetic-location";
  pageId: string | null;
  fileId: string;
}

export interface RetrievalSnapshot {
  npcDefinitionId: string;
  loreScores: RetrievalScoreEntry[];
  loreSearchPerformed: boolean;
  broadenedBeyondLorePage: boolean;
  ownPageExcluded: boolean;
  /** Number of chunks dropped by loreRelevanceFloor this turn (0 when floor=0). */
  droppedByFloor: number;
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
