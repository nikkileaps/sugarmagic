/**
 * packages/plugins/src/catalog/sugaragent/runtime/memory/memory-debug.ts
 *
 * Purpose: a dev-only `globalThis.__sugaragentMemory` handle for
 * inspecting + resetting an NPC's memory in preview, without UI
 * archaeology (Plan 073.5, house debug-tooling style — same idiom as
 * `__sugaragentPrompts`). Not used by the game.
 *
 * From a devtools console (or an automated browser session):
 *   await __sugaragentMemory.dump()            // every NPC this playthrough
 *   await __sugaragentMemory.dump("npc:finnick")
 *   await __sugaragentMemory.forget("npc:finnick") // re-test first-meeting
 *   await __sugaragentMemory.forget()              // forget all this playthrough
 *
 * Status: active
 */

import { resolveNpcMemoryStore } from "./store-registry";

export const SUGARAGENT_MEMORY_WINDOW_KEY = "__sugaragentMemory";

export interface SugarAgentMemoryDebugHandle {
  /** Dump one NPC's record, or every record for the current playthrough. */
  dump(npcDefinitionId?: string): Promise<unknown>;
  /** Forget one NPC (or all NPCs) for the current playthrough. */
  forget(npcDefinitionId?: string): Promise<string>;
}

/**
 * Install the handle once. No-op off-browser or if already installed.
 * Never throws (a broken global must not break plugin init).
 */
export function installNpcMemoryDebugHandle(): void {
  try {
    const globalObject = globalThis as unknown as Record<string, unknown>;
    if (typeof globalObject !== "object" || !globalObject) return;
    if (globalObject[SUGARAGENT_MEMORY_WINDOW_KEY]) return;

    const handle: SugarAgentMemoryDebugHandle = {
      async dump(npcDefinitionId) {
        const store = resolveNpcMemoryStore();
        if (!store) return { error: "memory identity not ready (boot incomplete?)" };
        return npcDefinitionId
          ? store.load(npcDefinitionId)
          : store.debugListRecords();
      },
      async forget(npcDefinitionId) {
        const store = resolveNpcMemoryStore();
        if (!store) return "memory identity not ready (boot incomplete?)";
        await store.debugForget(npcDefinitionId);
        return npcDefinitionId
          ? `forgot ${npcDefinitionId} for this playthrough`
          : "forgot all NPCs for this playthrough";
      }
    };
    globalObject[SUGARAGENT_MEMORY_WINDOW_KEY] = handle;
  } catch {
    // ignore — a dev handle must never break init
  }
}
