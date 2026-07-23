/**
 * packages/plugins/src/catalog/sugaragent/runtime/quest/quest-context-debug.ts
 *
 * Purpose: a dev-only `globalThis.__sugaragentQuestContext` handle for
 * inspecting the quest context and world-narrative facts surfaced by the
 * current NPC conversation, without UI archaeology (Plan 077.5 -- same idiom
 * as `__sugaragentMemory` / `__sugaragentPrompts`). Not used by the game.
 *
 * From a devtools console (or an automated browser session):
 *   __sugaragentQuestContext.dump()              // all NPCs seen this session
 *   __sugaragentQuestContext.dump("npc:finnick") // one NPC
 *
 * Each entry reports:
 *   - npcDefinitionId, questId, stageId
 *   - worldContext: the lore text injected into the NPC prompt (null if none)
 *   - goalSurfacedCount: how many times the objective has been raised (blackboard)
 *
 * Status: active
 */

export const SUGARAGENT_QUEST_CONTEXT_WINDOW_KEY = "__sugaragentQuestContext";

export interface QuestContextSnapshot {
  npcDefinitionId: string;
  questId: string;
  stageId: string;
  /** The world-lore text injected into the NPC's user-turn (null = nothing resolved). */
  worldContext: string | null;
  /**
   * How many times the quest objective has been raised across all NPC
   * conversations this session (read from runtimeContext at annotation time).
   */
  goalSurfacedCount: number | null;
}

// Per-npc snapshots, updated by the middleware on each annotation.
const snapshots = new Map<string, QuestContextSnapshot>();

/** Called by the quest-context middleware when it publishes an annotation. */
export function recordQuestContextSnapshot(snapshot: QuestContextSnapshot): void {
  snapshots.set(snapshot.npcDefinitionId, snapshot);
}

export interface SugarAgentQuestContextDebugHandle {
  /** Dump the last quest-context snapshot for one NPC, or all NPCs seen this session. */
  dump(npcDefinitionId?: string): unknown;
}

/**
 * Install the handle once. No-op off-browser or if already installed.
 * Never throws (a broken global must not break plugin init).
 */
export function installQuestContextDebugHandle(): void {
  try {
    const g = globalThis as unknown as Record<string, unknown>;
    if (!g || g[SUGARAGENT_QUEST_CONTEXT_WINDOW_KEY]) return;
    const handle: SugarAgentQuestContextDebugHandle = {
      dump(npcDefinitionId) {
        if (npcDefinitionId) {
          return snapshots.get(npcDefinitionId) ?? null;
        }
        return Object.fromEntries(snapshots.entries());
      }
    };
    g[SUGARAGENT_QUEST_CONTEXT_WINDOW_KEY] = handle;
  } catch {
    // ignore -- a dev handle must never break init
  }
}
