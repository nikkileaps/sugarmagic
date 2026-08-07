/**
 * packages/plugins/src/catalog/sugarlang/runtime/teacher/warm-region-teacher.ts
 *
 * Purpose: Fills the Teacher's directive slot for the NPCs in the loaded
 *   region, so the FIRST turn of a conversation is a cache hit rather than a
 *   ~10s blocking call.
 *
 * WHY THE FIRST TURN IS THE WORST ONE
 *   7gp.1 took the Teacher off the critical path for every LATER turn: when a
 *   plan goes stale the outgoing one ships and the replacement is written while
 *   the player reads and types. The first turn is the one case that cannot
 *   help itself, because there is no previous plan to serve. Measured: a warm
 *   turn is 6.6-8.2s, a cold first turn 16-24s, and nearly all of the gap is
 *   the Teacher. nikki: the first message "feels especially bad its the SLOWEST
 *   ONE now which is double bad".
 *
 * ONE CALL FOR THE WHOLE REGION
 *   The situation key is scene + content hash + quest stage + objectives +
 *   time, and `sceneId` IS the region id -- there is no per-area or per-NPC
 *   axis in it. The Teacher also barely differentiates by NPC today: it
 *   receives a uuid, a display name and a lore page ID, never the page
 *   (sugarmagic-teaching-rnw). So one call, written into every present NPC's
 *   slot, is faithful to what the Teacher actually does. If rnw lands and
 *   directives become genuinely NPC-specific, THIS MUST BECOME ONE CALL PER
 *   NPC, and the cost question it currently sidesteps comes back.
 *
 * WHY A WASTED FIRST WARM IS ACCEPTED
 *   Plugin init runs BEFORE the save restore, so an early warm can compute a
 *   key against default "morning" and a null quest. Rather than gate on a
 *   lifecycle signal plugins are not given, this re-warms whenever the key
 *   MOVES -- so the pre-restore attempt is simply corrected by the
 *   post-restore one. The cost is one wasted call at boot. Deliberate: the
 *   alternative was inventing a readiness signal, and a wrong one fails
 *   silently by never warming at all.
 *
 * WHY THERE IS NO CONVERSATION-END HOOK
 *   The plan called for re-warming when a conversation ends, because a
 *   conversation can advance a quest and quest stage IS in the situation key --
 *   which would invalidate every other NPC's slot and make the next first turn
 *   slow again. That is a real case, and the key check already covers it: the
 *   quest fact moves, the next check sees a different key, and every slot is
 *   refilled within one interval. Wiring `dialogueManager.setOnEnd` would have
 *   meant a new plugin-boundary signal to say something the key already says.
 *   `invalidate()` remains for a caller that ever needs to force it.
 *
 * Exports:
 *   - createRegionTeacherWarmer
 *
 * Status: active
 */

import type { SugarLangTeacher } from "./sugar-lang-teacher";

/** Minimum gap between checks. Deciding whether to warm costs ~12 blackboard
 *  reads, which is fine twice a second and not fine at 60fps. */
const CHECK_INTERVAL_MS = 2000;

export interface RegionWarmerDeps {
  /** Resolves the NPCs currently worth warming. Scripted-only NPCs must be
   *  excluded by the caller: their slot is never read. */
  listWarmableNpcIds: () => string[];
  /** Builds the situation key and teacher context for an NPC-less situation.
   *  Returns null when the world is not ready to be asked. */
  buildWarmContext: () => Promise<
    { situationKey: string; warm: (npcId: string) => Promise<unknown> } | null
  >;
}

export interface RegionTeacherWarmer {
  /** Drive from the plugin's per-frame update, in MILLISECONDS. The runtime
   *  frame delta is in seconds -- convert at the call site. */
  tick: (deltaMs: number) => void;
  /** Forget what was warmed, so the next tick re-warms. For a conversation
   *  ending: it may have advanced a quest, which moves the key. */
  invalidate: () => void;
  dispose: () => void;
}

/**
 * `teacher` is unused by this module directly -- warming goes through the
 * caller's `warm` closure so this file never has to know about contexts. Kept
 * in the signature so the dependency is visible at the call site.
 */
export function createRegionTeacherWarmer(
  deps: RegionWarmerDeps,
  _teacher?: SugarLangTeacher
): RegionTeacherWarmer {
  let sinceLastCheckMs = CHECK_INTERVAL_MS;
  let warmedForKey: string | null = null;
  let running = false;
  let disposed = false;

  async function runCheck(): Promise<void> {
    const built = await deps.buildWarmContext();
    if (!built || disposed) return;
    // Already warmed for exactly this world state -- nothing to do. This is
    // what makes a re-check cheap and what corrects a pre-restore warm: the key
    // moves, so this no longer matches.
    if (built.situationKey === warmedForKey) return;

    const npcIds = deps.listWarmableNpcIds();
    if (npcIds.length === 0) return;

    // Sequential, not parallel. One Teacher call serves the whole region, so
    // there is nothing to parallelise -- and the calls after the first are
    // cache-warm anyway. Bursting would matter only if this ever became
    // per-NPC, which is when a concurrency cap becomes load-bearing.
    for (const npcId of npcIds) {
      if (disposed) return;
      await built.warm(npcId);
    }
    if (!disposed) {
      warmedForKey = built.situationKey;
    }
  }

  return {
    tick(deltaMs: number): void {
      if (disposed || running) return;
      sinceLastCheckMs += deltaMs;
      if (sinceLastCheckMs < CHECK_INTERVAL_MS) return;
      sinceLastCheckMs = 0;
      running = true;
      // Fire and forget: nothing is waiting on a warm-up, and an unhandled
      // rejection here would surface as a crash unrelated to any turn.
      void runCheck()
        .catch(() => undefined)
        .finally(() => {
          running = false;
        });
    },
    invalidate(): void {
      warmedForKey = null;
      sinceLastCheckMs = CHECK_INTERVAL_MS;
    },
    dispose(): void {
      disposed = true;
    }
  };
}
