/**
 * packages/plugins/src/catalog/sugarlang/runtime/teacher/sugar-lang-teacher.ts
 *
 * Purpose: Implements the facade over teacher-policy invocation, fallback handling, calibration, and directive caching.
 *
 * Exports:
 *   - SugarLangTeacher
 *
 * Relationships:
 *   - Depends on the TeacherPolicy provider boundary and directive contract types.
 *   - Will be consumed by the teacher middleware once Epic 9 lands.
 *
 * Implements: Proposal 001 §3. Teacher's *
 * Status: active
 */

import { traceTeacherDirective } from "./teacher-trace";
import { noteTurnFact } from "@sugarmagic/runtime-core";
import { learnerKey } from "../learner";
import { isInPostPlacementCalibration } from "./calibration-mode";
import { DirectiveCache, type DirectiveKeys } from "./directive-cache";
import { FallbackTeacherPolicy } from "./policies/fallback-teacher-policy";
import type {
  TeacherContext,
  TeacherPolicy,
  PedagogicalDirective
} from "../types";
import {
  createNoOpTelemetrySink,
  createTelemetryEvent,
  emitTelemetry,
  type TelemetrySink
} from "../telemetry/telemetry";
import { EMPTY_NPC_CONTEXT } from "../situation";
import { describeSituationKeyChange } from "../situation/situation-key";
import { TeacherInvocationError } from "./policies/llm-teacher-policy";

/**
 * How many re-plans may fail in a row before a turn stops being served a stale
 * directive and waits for a real one.
 *
 * Three because a re-plan fails for two shapes of reason: a blip, which the
 * next turn's re-plan clears, and something that stays broken -- a gateway
 * down, a model erroring -- which no amount of turns will clear. Three
 * failures is past the blip and short enough that a player is not taught from
 * an old plan for a whole session.
 */
const MAX_CONSECUTIVE_REPLAN_FAILURES = 3;

/**
 * Where a call registers itself while it runs. A call with no situation key
 * still needs a slot, and it must not collide with a real key.
 */
function inFlightKey(situationKey: string | undefined): string {
  return situationKey ?? "(no-situation)";
}

/**
 * The context a shared directive is planned from.
 *
 * One directive serves every NPC, so nothing that varies by conversation may
 * shape it: the NPC, the turns already spoken, and the count of turns since the
 * last comprehension probe are all dropped before planning. Left in, they would
 * plan the entry for whichever NPC happened to miss the cache first and then
 * hand it to everyone else.
 *
 * The turn's own context keeps them -- tracing and telemetry still say which
 * NPC the turn was for. Only the plan call is narrowed.
 */
function sharedPlanContext(context: TeacherContext): TeacherContext {
  if (!context.situation) {
    return context;
  }
  const {
    npc: _npc,
    recentTurns: _recentTurns,
    turnsSinceLastProbe: _turnsSinceLastProbe,
    ...sharedSituation
  } = context.situation;
  return { ...context, situation: sharedSituation };
}

export interface SugarLangTeacherOptions {
  llmPolicy: TeacherPolicy;
  fallbackPolicy: FallbackTeacherPolicy;
  cache: DirectiveCache;
  telemetry?: TelemetrySink;
}

export class SugarLangTeacher {
  private readonly llmPolicy: TeacherPolicy;
  private readonly fallbackPolicy: FallbackTeacherPolicy;
  private readonly cache: DirectiveCache;
  /**
   * The Teacher calls currently running, by the situation they are planning
   * for.
   *
   * A MAP RATHER THAN A SET so a real turn can JOIN a call already running
   * instead of starting a second one. Measured on a fresh game: the region
   * warm-up starts on the first frame and takes ~9s, the player reached the NPC
   * before it landed, and the turn made its own blocking call -- 16.8s, the
   * exact cost the warm-up exists to remove. Joining converts the remainder of
   * the head start into saved wall-clock.
   *
   * KEYED BY SITUATION, NOT BY CONVERSATION. One directive serves every NPC, so
   * a call started for the region is the call every NPC's first turn is waiting
   * for. Keying by conversation registered the same promise once per NPC to get
   * that effect; the situation key gives it directly.
   */
  private readonly teacherCallsInFlight = new Map<
    string,
    { keys: DirectiveKeys; promise: Promise<unknown> }
  >();
  private readonly telemetry: TelemetrySink;
  /**
   * Teacher calls that COMPLETED with a failure since the last one that
   * succeeded. What bounds how long a stale directive may be served.
   *
   * Counted on completion only, so a call still in flight is neither a success
   * nor a failure -- the difference between "the gateway is down" and "the
   * player is faster than an ~11s call", which must not be confused.
   */
  private consecutiveReplanFailures = 0;

  constructor(options: SugarLangTeacherOptions) {
    this.llmPolicy = options.llmPolicy;
    this.fallbackPolicy = options.fallbackPolicy;
    this.cache = options.cache;
    this.telemetry = options.telemetry ?? createNoOpTelemetrySink();
  }

  /**
   * Gives up the cached directive and refuses later writes, for a region
   * unloading or a session ending. A Teacher call takes about ten seconds, so
   * one started before teardown can land after it; this is what stops that
   * result from becoming the next region's teaching.
   */
  dispose(): void {
    this.cache.dispose();
  }

  /** True once too many re-plans have failed in a row to keep serving stale. */
  private replanBoundTripped(): boolean {
    return this.consecutiveReplanFailures >= MAX_CONSECUTIVE_REPLAN_FAILURES;
  }

  /** A Teacher call came back with a plan. Whatever was failing is not now. */
  private recordPlanSucceeded(): void {
    this.consecutiveReplanFailures = 0;
  }

  /** A Teacher call finished without a plan. Only completions count here. */
  private recordPlanFailed(): void {
    this.consecutiveReplanFailures += 1;
  }

  async invoke(context: TeacherContext): Promise<PedagogicalDirective> {
    const calibrationActive =
      context.calibrationActive || isInPostPlacementCalibration(context.learner);
    const effectiveContext: TeacherContext = {
      ...context,
      calibrationActive
    };
    const sceneId = effectiveContext.situation?.sceneId ?? "unknown-scene";
    const npc = effectiveContext.situation?.npc ?? EMPTY_NPC_CONTEXT;
    // 090.4: the learner key is computed HERE rather than carried on the
    // context, because it must reflect the learner as of THIS turn -- the whole
    // point is catching a change that happened since the last decision.
    const keysNow: DirectiveKeys = {
      ...(effectiveContext.situationKey === undefined
        ? {}
        : { situationKey: effectiveContext.situationKey }),
      learnerKey: learnerKey(effectiveContext.learner)
    };
    const inspection = this.cache.inspect(keysNow);

    // THE OUTGOING DIRECTIVE IS SERVED WHILE ITS REPLACEMENT IS WRITTEN.
    //
    // A re-plan costs ~11s and the result is reused for up to 20 turns, so
    // making the player watch it happen is paying a synchronous price for a
    // decision with a long shelf life. Whatever went stale -- the world, the
    // learner, or the turn backstop -- the outgoing plan ships now and the
    // replacement lands for a later turn.
    //
    // WHAT SERVING STALE COSTS. The directive never reaches the player: it
    // biases which words the NPC's line leans on. So the whole cost is that
    // the Teacher teaches from a slightly outdated read of the situation for
    // as long as it takes one re-plan to land -- normally two or three turns,
    // because a fast player can send that many inside an ~11s call.
    //
    // AND IT IS BOUNDED. If re-plans keep FAILING, nothing refreshes the entry
    // and "outdated for a few turns" becomes "outdated forever" -- the NPC
    // teaching dock words in a forest. After MAX_CONSECUTIVE_REPLAN_FAILURES
    // completed failures the next turn stops serving stale and waits for a
    // real plan. Latency is not failure: a call still in flight has not failed,
    // so turns taken during a healthy slow re-plan never trip this.
    if (inspection?.staleness && !this.replanBoundTripped()) {
      this.cache.spendTurn();
      noteTurnFact("teacherCache", `stale-served:${inspection.staleness}`);
      if (inspection.staleness === "situation_change") {
        // The turn that gets served stale is the one worth explaining: it is
        // where a warm that should have covered this did not.
        noteTurnFact(
          "situationMoved",
          describeSituationKeyChange(
            inspection.plannedFor.situationKey,
            keysNow.situationKey
          )
        );
      }
      this.scheduleBackgroundReplan(effectiveContext, keysNow);
      traceTeacherDirective({
        context: effectiveContext,
        directive: inspection.directive,
        source: "cache"
      });
      return inspection.directive;
    }
    if (inspection?.staleness) {
      // The bound tripped. Say so on the turn, because otherwise this looks
      // exactly like an ordinary cold miss in the timeline.
      noteTurnFact("teacherReplanFailures", this.consecutiveReplanFailures);
    }

    const cached = this.cache.get(keysNow);
    if (cached) {
      await emitTelemetry(
        this.telemetry,
        createTelemetryEvent("teacher.cache-hit", {
          conversationId: effectiveContext.conversationId,
          sessionId: effectiveContext.telemetryContext?.sessionId,
          turnId: effectiveContext.telemetryContext?.turnId,
          timestamp: Date.now(),
          sceneId: sceneId,
          npcId: npc.npcDefinitionId,
          npcDisplayName: npc.displayName,
          fallback: cached.isFallbackDirective
        })
      );
      await emitTelemetry(
        this.telemetry,
        createTelemetryEvent("teacher.invocation-completed", {
          conversationId: effectiveContext.conversationId,
          sessionId: effectiveContext.telemetryContext?.sessionId,
          turnId: effectiveContext.telemetryContext?.turnId,
          timestamp: Date.now(),
          sceneId: sceneId,
          npcId: npc.npcDefinitionId,
          npcDisplayName: npc.displayName,
          directive: cached,
          cacheHit: true,
          fallback: cached.isFallbackDirective,
          latencyMs: 0,
          parseMode: "cached"
        })
      );
      traceTeacherDirective({
        context: effectiveContext,
        directive: cached,
        source: "cache"
      });
      return cached;
    }

    // JOIN A CALL ALREADY RUNNING RATHER THAN STARTING A SECOND ONE.
    //
    // The region warm-up begins on the first frame after load and takes ~9s.
    // Measured on a fresh game: the player reached the NPC before it landed,
    // this path started its own blocking call, and the turn cost 16.8s -- the
    // exact cost the warm-up exists to remove. Whatever head start the warm-up
    // had is wall-clock this turn does not have to spend again.
    //
    // Re-check the cache afterwards rather than using the joined call's result
    // directly: the normal two-axis validity rules then decide whether that
    // directive suits this turn, instead of this path having to reason about a
    // directive planned for a slightly different context. If it does not suit,
    // fall through and make the call that was always going to be needed.
    const inFlight = this.teacherCallsInFlight.get(
      inFlightKey(effectiveContext.situationKey)
    );
    // ONLY JOIN A CALL PLANNED FOR THE SAME WORLD.
    //
    // Joining blindly is worse than not joining at all: if the in-flight call
    // was planned for a different situation, the post-join cache read misses on
    // situation_change and the turn makes its own call anyway -- so it pays the
    // remainder of that call PLUS a full one. The branch's own boot case
    // produces exactly that key mismatch, because the first warm can run before
    // the save restore and key against default "morning" and a null quest.
    //
    // The learner axis is deliberately NOT compared: a directive stale on the
    // learner is servable, so joining one is still a win.
    const joinable =
      inFlight && inFlight.keys.situationKey === effectiveContext.situationKey
        ? inFlight.promise
        : null;
    if (joinable) {
      await joinable.catch(() => undefined);
      const joined = this.cache.get(keysNow);
      if (joined) {
        traceTeacherDirective({
          context: effectiveContext,
          directive: joined,
          source: "cache"
        });
        return joined;
      }
    }

    let directive: PedagogicalDirective;
    let outcome: "llm" | "fallback" = "llm";

    // PLANNED FROM THE SHARED VIEW, even though a conversation asked for it.
    // What comes back is written into the one entry every NPC reads, so it may
    // not be shaped by the NPC that happened to miss the cache first.
    const planContext = sharedPlanContext(effectiveContext);
    try {
      directive = await this.llmPolicy.invoke(planContext);
      // A real plan landed, so whatever was failing is not failing now and a
      // later turn may be served stale again.
      this.recordPlanSucceeded();
    } catch (error) {
      // COUNTED BEFORE THE TYPE CHECK, so an unexpected error counts too. A
      // failure the bound cannot see is a bound that never trips.
      this.recordPlanFailed();
      if (!(error instanceof TeacherInvocationError)) {
        throw error;
      }
      outcome = "fallback";
      directive = await this.fallbackPolicy.invoke(planContext, {
        triggerReasonOverride: error.fallbackTriggerReason
      });
      traceTeacherDirective({
        context: effectiveContext,
        directive,
        source: "fallback"
      });
    }

    this.cache.set(directive, keysNow);
    await emitTelemetry(
      this.telemetry,
      createTelemetryEvent("teacher.invocation-resolved", {
        conversationId: effectiveContext.conversationId,
        sessionId: effectiveContext.telemetryContext?.sessionId,
        turnId: effectiveContext.telemetryContext?.turnId,
        timestamp: Date.now(),
        sceneId: sceneId,
        npcId: npc.npcDefinitionId,
        npcDisplayName: npc.displayName,
        outcome,
        fallback: directive.isFallbackDirective,
        calibrationActive
      })
    );

    return directive;
  }

  /**
   * Pre-computes the directive for the loaded region, so the FIRST turn of a
   * conversation is a cache hit instead of a ~10s blocking Teacher call.
   *
   * WHY THIS IS NOT `invoke`. `invoke` on a hit runs `cache.get`, which calls
   * `spendTurn` -- ageing a real directive by a turn the player never took,
   * the exact bug `peek` was split out of `get` to prevent. A warm-up reads
   * with `inspect` (pure) and writes with `set`, and never touches the turn
   * counter.
   *
   * WHAT IT WARMS, AND WHAT IT LEAVES ALONE:
   *   - nothing cached, or STALE ON THE WORLD -> warm. A world-stale directive
   *     blocks the next turn, so refilling it is the whole point.
   *   - stale on the LEARNER only -> LEAVE IT. That one is served instantly and
   *     re-planned in the background (7gp.1), so the first turn is already fast
   *     and a warm call would buy nothing.
   *   - fresh -> leave it.
   *
   * ONE CALL FOR THE REGION. The entry has no NPC axis, so warming is warming
   * the one entry every NPC will read -- there is nothing to loop over. An
   * earlier version looped per NPC believing the calls after the first would
   * hit cache; they could not, because the cache was scoped per conversation,
   * so a region with N NPCs billed N full Teacher calls.
   *
   * Returns what it did, so a caller can log or test it. Never throws: a
   * warm-up that fails leaves the first turn merely slow, which is today's
   * behaviour, and a background failure must never surface as an unhandled
   * rejection.
   */
  async warmRegion(
    context: TeacherContext
  ): Promise<"fresh" | "warmed" | "skipped" | "in-flight" | "failed"> {
    const keys: DirectiveKeys = {
      ...(context.situationKey === undefined
        ? {}
        : { situationKey: context.situationKey }),
      learnerKey: learnerKey(context.learner)
    };
    const callKey = inFlightKey(context.situationKey);

    if (this.teacherCallsInFlight.has(callKey)) {
      return "in-flight";
    }
    // Stale only on the LEARNER counts as fresh here: it is served instantly
    // and re-planned in the background (7gp.1), so warming it buys nothing.
    const before = this.cache.inspect(keys);
    if (before && before.staleness !== "situation_change") {
      return "fresh";
    }
    // What the entry holds NOW, so the write after the call can be a
    // compare-and-set rather than a blind overwrite.
    const claimedBefore = before?.plannedFor.situationKey;

    const call = this.llmPolicy.invoke({
      ...sharedPlanContext(context),
      backgroundReplan: true
    });
    this.teacherCallsInFlight.set(callKey, { keys, promise: call });
    try {
      const directive = await call;
      // COMPARE-AND-SET: write only if nothing claimed the entry while the call
      // was in flight.
      //
      // An earlier check asked whether inspecting with the WARM keys reported
      // `situation_change`, and was inverted for the case it named: when a real
      // turn had written a directive for a NEWER world, that is exactly what it
      // reported, so the guard concluded the entry was free and overwrote the
      // better, newer directive. Comparing what is there against what was there
      // when the call started cannot invert: unchanged means unclaimed.
      const after = this.cache.inspect();
      if (after?.plannedFor.situationKey !== claimedBefore) {
        // Reported rather than folded into "warmed", so a test can tell the
        // clobber guard fired.
        return "skipped";
      }
      this.cache.set(directive, keys);
      return "warmed";
    } catch {
      return "failed";
    } finally {
      this.teacherCallsInFlight.delete(callKey);
    }
  }

  /**
   * Starts a re-plan that the current turn does not wait for.
   *
   * ONE PER SITUATION. A fast player can send three turns inside an ~11s
   * re-plan; stacking a call per turn would spend three Teacher calls to
   * answer one question. The later turns keep serving the outgoing directive,
   * which is the correct answer, not a degraded one.
   *
   * NOTHING AWAITS THIS, so nothing would ever see it throw -- an unhandled
   * rejection here would surface as a crash unrelated to any turn. The catch
   * is load-bearing: on failure the outgoing directive simply stays and the
   * next turn tries again.
   */
  private scheduleBackgroundReplan(
    context: TeacherContext,
    plannedFor: DirectiveKeys
  ): void {
    const callKey = inFlightKey(plannedFor.situationKey);
    if (this.teacherCallsInFlight.has(callKey)) {
      return;
    }
    const replan = this.runBackgroundReplan(context, plannedFor);
    this.teacherCallsInFlight.set(callKey, { keys: plannedFor, promise: replan });
    void replan
      .catch(() => undefined)
      .finally(() => {
        this.teacherCallsInFlight.delete(callKey);
      });
  }

  private async runBackgroundReplan(
    context: TeacherContext,
    plannedFor: DirectiveKeys
  ): Promise<void> {
    // `backgroundReplan` keeps this call's tokens and latency off whatever
    // turn happens to be open when it lands. Attributing them to a turn that
    // did not wait for them would make the epic's own before/after unreadable.
    // Planned from the shared view, like every other write to the entry.
    const replanContext: TeacherContext = {
      ...sharedPlanContext(context),
      backgroundReplan: true
    };

    let directive: PedagogicalDirective;
    try {
      directive = await this.llmPolicy.invoke(replanContext);
    } catch (error) {
      // COUNTED, whatever kind of failure it was. This is the count that stops
      // a stale directive being served for ever when the Teacher cannot be
      // reached, so a failure it does not see is a bound that never trips.
      this.recordPlanFailed();
      if (!(error instanceof TeacherInvocationError)) {
        throw error;
      }
      // No fallback directive here. A fallback is a different QUALITY of
      // teaching, and the outgoing real directive is better than swapping one
      // in silently. Leave what is there; the next turn re-plans.
      return;
    }
    // A plan came back. Whether or not it is still the right one for the world
    // below, the Teacher is answering, so serving stale is safe again.
    this.recordPlanSucceeded();

    // THE WORLD MAY HAVE MOVED WHILE THIS WAS IN FLIGHT.
    //
    // If the player walked into a new scene, a turn has already written the
    // directive for where they now are. This result was planned for where they
    // WERE, and writing it would put the wrong place's teaching back.
    const currentInspection = this.cache.inspect();
    if (!currentInspection) {
      // The entry was cleared, or the store was disposed. Do not resurrect.
      return;
    }
    if (currentInspection.plannedFor.situationKey !== plannedFor.situationKey) {
      return;
    }

    this.cache.set(directive, plannedFor);
  }

}
