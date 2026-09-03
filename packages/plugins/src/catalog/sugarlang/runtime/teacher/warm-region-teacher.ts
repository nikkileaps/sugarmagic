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
 *   time, and `regionId` IS the region id -- there is no per-area or per-NPC
 *   axis in it. The directive store holds ONE entry keyed by that pair of
 *   keys, so warming is one call and one write however many NPCs are standing
 *   there, and `warmRegion` takes no ids at all.
 *
 *   Do not reintroduce a per-NPC loop here. An earlier version looped a
 *   per-NPC warm and claimed the later calls would hit cache; they could not,
 *   because the cache was then scoped per conversation, so a region with N
 *   NPCs billed N full Teacher calls and repeated the set on every
 *   time-of-day and quest-stage change.
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
 * A FAILING WARM MUST GIVE UP
 *   This shipped retrying for ever. A failed warm did not record its key, so
 *   the next check saw the same unwarmed state and called again -- every 2
 *   seconds, each one a paid Teacher call. That is correct for a blip and
 *   ruinous for anything that stays broken, and prod stayed broken: the
 *   gateway answered 401 and the loop billed until nikki closed the browser.
 *   The comment here used to assert the retry was correct, which is why review
 *   after review read past it.
 *
 *   So failures are budgeted PER WORLD STATE: `MAX_ATTEMPTS_PER_KEY` tries,
 *   then quiet until the key moves. Per-key rather than global because the
 *   thing that failed is one situation, and a world that has moved on deserves
 *   a fresh try. Warming is an OPTIMISATION -- when it cannot run the game
 *   plays on with slow first turns, and that is always the better trade than
 *   spending money in a loop.
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

/** Minimum gap between checks. Deciding whether to warm costs ~12 blackboard
 *  reads, which is fine twice a second and not fine at 60fps. */
const CHECK_INTERVAL_MS = 2000;

/** How many times ONE world state may fail before the warmer stops asking for
 *  it. See "A FAILING WARM MUST GIVE UP" in the module header. */
const MAX_ATTEMPTS_PER_KEY = 3;

export interface RegionWarmerDeps {
  /** Resolves the NPCs currently worth warming. Scripted-only NPCs must be
   *  excluded by the caller: their slot is never read. */
  listWarmableNpcIds: () => string[];
  /** Builds the situation key and teacher context for an NPC-less situation.
   *  Returns null when the world is not ready to be asked. */
  buildWarmContext: () => Promise<
    {
      situationKey: string;
      /** ONE Teacher call for all of them -- see the module header. Returns
       *  "failed" when nothing could be warmed, so the caller can retry. */
      warmAll: (npcIds: readonly string[]) => Promise<string>;
    } | null
  >;
}

export interface RegionTeacherWarmer {
  /** Drive from the plugin's per-frame update, in MILLISECONDS. The runtime
   *  frame delta is in seconds -- convert at the call site. */
  tick: (deltaMs: number) => void;
  /**
   * Warm once and resolve when it is done, for the boot step that runs before
   * the player can act.
   *
   * SAME CHECK AS THE TICK, awaited instead of fired and forgotten. Two
   * implementations of "should this warm, and against what" would drift, and
   * the whole value of warming at boot is that it decides against the same
   * world state the next turn will read.
   *
   * Never throws: an unprepared first turn is slower, not broken, and this is
   * awaited by the boot.
   */
  warmNow: () => Promise<void>;
  /** Forget what was warmed, so the next tick re-warms. For a conversation
   *  ending: it may have advanced a quest, which moves the key. */
  invalidate: () => void;
  dispose: () => void;
}

export function createRegionTeacherWarmer(deps: RegionWarmerDeps): RegionTeacherWarmer {
  let sinceLastCheckMs = CHECK_INTERVAL_MS;
  let warmedForKey: string | null = null;
  /** The key `attempts` is counting for. Failures are budgeted per world
   *  state, so a key that moves gets a fresh budget. */
  let attemptsForKey: string | null = null;
  let attempts = 0;
  let running = false;
  let disposed = false;

  async function runCheck(): Promise<void> {
    const built = await deps.buildWarmContext();
    if (!built || disposed) return;
    // Already warmed for exactly this world state -- nothing to do. This is
    // what makes a re-check cheap and what corrects a pre-restore warm: the key
    // moves, so this no longer matches.
    if (built.situationKey === warmedForKey) return;

    if (built.situationKey !== attemptsForKey) {
      attemptsForKey = built.situationKey;
      attempts = 0;
    }
    // Given up on this world state. Silent, because it already said so once.
    if (attempts >= MAX_ATTEMPTS_PER_KEY) return;

    const npcIds = deps.listWarmableNpcIds();
    if (npcIds.length === 0) return;

    // ONE call, handed every id at once. An earlier version looped per NPC
    // believing the calls after the first would hit cache -- they cannot: the
    // directive cache is scoped per conversation, so a region with N NPCs fired
    // N full ~9s Teacher calls, repeating on every time-of-day and quest-stage
    // change. Caught in review before it shipped.
    // Counted BEFORE the call, so a warm that throws costs the budget exactly
    // like a warm that returns "failed". Anything else lets a throwing path
    // retry for ever, which is the bug this budget exists to stop.
    attempts += 1;
    const outcome = await built.warmAll(npcIds);
    if (disposed) return;

    // ONLY REMEMBER A STATE THAT ACTUALLY GOT WARMED. Marking it regardless
    // meant a failed warm -- gateway down, model erroring -- was recorded as
    // done and never retried until the world moved, which on a fixed region
    // can be a long time.
    //
    // "fresh" counts: the entry already suits this world state, which is what
    // warming is for. "warmed" counts: this call wrote it.
    if (outcome === "fresh" || outcome === "warmed") {
      warmedForKey = built.situationKey;
      return;
    }

    // "in-flight" and "skipped" are not warms and are not failures. Another
    // call owns this key -- a turn's background re-plan, or the boot warm --
    // and it will write the entry. Do not remember the state (nothing was
    // warmed yet) and do not spend the budget, which exists for a Teacher that
    // cannot be reached. A ~11s call outlasts several 2s ticks, so counting
    // these would give up on a key while the work for it is still running.
    if (outcome === "in-flight" || outcome === "skipped") {
      attempts -= 1;
      return;
    }

    if (attempts >= MAX_ATTEMPTS_PER_KEY) {
      // Loud, and exactly once per world state. Warming is an optimisation;
      // the game plays on with slow first turns.
      console.error(
        `[sugarlang] region warm failed ${attempts}x, giving up until the ` +
          `world changes. First turns will be slow. Check the gateway.`
      );
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
    async warmNow(): Promise<void> {
      if (disposed || running) return;
      running = true;
      // The tick's throttle is about not re-deciding 60 times a second. This
      // is one deliberate call, so it resets the clock rather than obeying it.
      sinceLastCheckMs = 0;
      try {
        await runCheck();
      } catch {
        // Same trade as the tick: warming is an optimisation, and the boot
        // that awaits this must not fail because the gateway did.
      } finally {
        running = false;
      }
    },
    invalidate(): void {
      warmedForKey = null;
      // A forced re-warm is a fresh start, including for a state that had
      // used up its budget.
      attemptsForKey = null;
      attempts = 0;
      sinceLastCheckMs = CHECK_INTERVAL_MS;
    },
    dispose(): void {
      disposed = true;
    }
  };
}
