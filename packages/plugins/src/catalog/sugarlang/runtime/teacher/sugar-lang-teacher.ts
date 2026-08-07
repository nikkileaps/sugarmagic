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
import { isDeferrableStaleness } from "./staleness-policy";
import { learnerKey } from "../learner";
import { isInPostPlacementCalibration } from "./calibration-mode";
import { DirectiveCache } from "./directive-cache";
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
import { TeacherInvocationError } from "./policies/llm-teacher-policy";

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
   * The Teacher call currently in flight for a conversation, if any.
   *
   * A MAP RATHER THAN A SET so a real turn can JOIN a call already running
   * instead of starting a second one. Measured on a fresh game: the region
   * warm-up starts on the first frame and takes ~9s, the player reached the NPC
   * before it landed, and the turn made its own blocking call -- 16.8s, the
   * exact cost the warm-up exists to remove. Joining converts the remainder of
   * the head start into saved wall-clock.
   */
  private readonly teacherCallsInFlight = new Map<
    string,
    { keys: { situationKey?: string; learnerKey?: string }; promise: Promise<unknown> }
  >();
  private readonly telemetry: TelemetrySink;

  constructor(options: SugarLangTeacherOptions) {
    this.llmPolicy = options.llmPolicy;
    this.fallbackPolicy = options.fallbackPolicy;
    this.cache = options.cache;
    this.telemetry = options.telemetry ?? createNoOpTelemetrySink();
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
    const keysNow = {
      ...(effectiveContext.situationKey === undefined
        ? {}
        : { situationKey: effectiveContext.situationKey }),
      learnerKey: learnerKey(effectiveContext.learner)
    };
    const inspection = this.cache.inspect(effectiveContext.conversationId, keysNow);

    // 7gp.1: THE OUTGOING DIRECTIVE IS SERVED WHILE ITS REPLACEMENT IS WRITTEN.
    //
    // A re-plan costs ~11s and the result is reused for up to 20 turns, so
    // making the player watch it happen is paying a synchronous price for a
    // decision with a long shelf life. When the only thing that changed is the
    // LEARNER, the outgoing plan is still about the right place -- so it ships
    // now and the replacement lands for the next turn. When the WORLD changed
    // it is about the wrong place, and the player waits (staleness-policy.ts).
    if (inspection?.staleness && isDeferrableStaleness(inspection.staleness)) {
      this.cache.spendTurn(effectiveContext.conversationId);
      noteTurnFact("teacherCache", `stale-served:${inspection.staleness}`);
      this.scheduleBackgroundReplan(effectiveContext, keysNow);
      traceTeacherDirective({
        context: effectiveContext,
        directive: inspection.directive,
        source: "cache"
      });
      return inspection.directive;
    }

    const cached = this.cache.get(effectiveContext.conversationId, keysNow);
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
    const inFlight = this.teacherCallsInFlight.get(effectiveContext.conversationId);
    // ONLY JOIN A CALL PLANNED FOR THE SAME WORLD.
    //
    // Joining blindly is worse than not joining at all: if the in-flight call
    // was planned for a different situation, the post-join cache read misses on
    // situation_change and the turn makes its own call anyway -- so it pays the
    // remainder of that call PLUS a full one. The branch's own boot case
    // produces exactly that key mismatch, because the first warm can run before
    // the save restore and key against default "morning" and a null quest.
    //
    // The learner axis is deliberately NOT compared: a directive stale only on
    // the learner is servable (7gp.1), so joining one is still a win.
    const joinable =
      inFlight && inFlight.keys.situationKey === effectiveContext.situationKey
        ? inFlight.promise
        : null;
    if (joinable) {
      await joinable.catch(() => undefined);
      const joined = this.cache.get(effectiveContext.conversationId, keysNow);
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

    try {
      directive = await this.llmPolicy.invoke(effectiveContext);
    } catch (error) {
      if (!(error instanceof TeacherInvocationError)) {
        throw error;
      }
      outcome = "fallback";
      directive = await this.fallbackPolicy.invoke(effectiveContext, {
        triggerReasonOverride: error.fallbackTriggerReason
      });
      traceTeacherDirective({
        context: effectiveContext,
        directive,
        source: "fallback"
      });
    }

    this.cache.set(effectiveContext.conversationId, directive, keysNow);
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
   * Pre-computes ONE directive for a whole region's NPCs, so the FIRST turn of
   * a conversation with any of them is a cache hit instead of a ~10s blocking
   * Teacher call (sugarmagic-latency-00m).
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
   * Returns what it did, so a caller can log or test it. Never throws: a
   * warm-up that fails leaves the first turn merely slow, which is today's
   * behaviour, and a background failure must never surface as an unhandled
   * rejection.
   */
  async warmConversations(
    conversationIds: readonly string[],
    context: TeacherContext
  ): Promise<"fresh" | "warmed" | "skipped" | "in-flight" | "failed"> {
    const keys = {
      ...(context.situationKey === undefined
        ? {}
        : { situationKey: context.situationKey }),
      learnerKey: learnerKey(context.learner)
    };

    // Which slots would actually block a first turn. A slot stale only on the
    // LEARNER is left alone: it is served instantly and re-planned in the
    // background (7gp.1), so warming it buys nothing.
    const needsWarming = conversationIds.filter((conversationId) => {
      if (this.teacherCallsInFlight.has(conversationId)) return false;
      const before = this.cache.inspect(conversationId, keys);
      return !before || before.staleness === "situation_change";
    });
    if (needsWarming.length === 0) {
      return conversationIds.some((id) => this.teacherCallsInFlight.has(id))
        ? "in-flight"
        : "fresh";
    }

    // ONE CALL, N WRITES -- and this is the whole point.
    //
    // The directive cache is scoped per conversation
    // (createActiveDirectiveFactScope -> ("conversation", conversationId)), so
    // a directive written for NPC A is invisible to NPC B. An earlier version
    // looped `warmConversation` per NPC believing the later ones would hit
    // cache; they cannot, so a region with N NPCs fired N full ~9s Teacher
    // calls, and did it again on every time-of-day or quest-stage change.
    //
    // The directive does not depend on the NPC anyway -- the situation key has
    // no per-NPC axis and the Teacher receives only ids and a display name
    // (sugarmagic-teaching-rnw) -- so ONE plan is correct for all of them.
    // Registered under every id so a turn with any of these NPCs can join it.
    const call = this.llmPolicy.invoke({ ...context, backgroundReplan: true });
    for (const conversationId of needsWarming) {
      this.teacherCallsInFlight.set(conversationId, { keys, promise: call });
    }
    try {
      const directive = await call;
      let written = 0;
      for (const conversationId of needsWarming) {
        // Re-check per slot: a real conversation may have started meanwhile and
        // written a better directive, built with the actual NPC and history.
        const after = this.cache.inspect(conversationId, keys);
        if (after && after.staleness !== "situation_change") continue;
        this.cache.set(conversationId, directive, keys);
        written += 1;
      }
      // "skipped" when every slot was claimed while the call was in flight --
      // reported rather than folded into "warmed", so a test can tell the
      // clobber guard fired.
      return written > 0 ? "warmed" : "skipped";
    } catch {
      // Includes a disposed blackboard when the region unloaded mid-call.
      return "failed";
    } finally {
      for (const conversationId of needsWarming) {
        this.teacherCallsInFlight.delete(conversationId);
      }
    }
  }

  /**
   * Starts a re-plan that the current turn does not wait for.
   *
   * ONE PER CONVERSATION. A fast player can send three turns inside an ~11s
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
    plannedFor: { situationKey?: string; learnerKey?: string }
  ): void {
    const conversationId = context.conversationId;
    if (this.teacherCallsInFlight.has(conversationId)) {
      return;
    }
    const replan = this.runBackgroundReplan(context, plannedFor);
    this.teacherCallsInFlight.set(conversationId, { keys: plannedFor, promise: replan });
    void replan
      .catch(() => undefined)
      .finally(() => {
        this.teacherCallsInFlight.delete(conversationId);
      });
  }

  private async runBackgroundReplan(
    context: TeacherContext,
    plannedFor: { situationKey?: string; learnerKey?: string }
  ): Promise<void> {
    // `backgroundReplan` keeps this call's tokens and latency off whatever
    // turn happens to be open when it lands. Attributing them to a turn that
    // did not wait for them would make the epic's own before/after unreadable.
    const replanContext: TeacherContext = { ...context, backgroundReplan: true };

    let directive: PedagogicalDirective;
    try {
      directive = await this.llmPolicy.invoke(replanContext);
    } catch (error) {
      if (!(error instanceof TeacherInvocationError)) {
        throw error;
      }
      // No fallback directive here. A fallback is a different QUALITY of
      // teaching, and the outgoing real directive is better than swapping one
      // in silently. Leave what is there; the next turn re-plans.
      return;
    }

    // THE WORLD MAY HAVE MOVED WHILE THIS WAS IN FLIGHT.
    //
    // If the player walked into a new scene, a synchronous re-plan has already
    // written the directive for where they now are. This result was planned
    // for where they WERE, and writing it would reintroduce exactly the
    // teaching-the-wrong-place bug the blocking split exists to prevent.
    const currentInspection = this.cache.inspect(context.conversationId);
    if (!currentInspection) {
      // The conversation ended, or the directive was cleared. Do not resurrect.
      return;
    }
    if (currentInspection.plannedFor.situationKey !== plannedFor.situationKey) {
      return;
    }

    this.cache.set(context.conversationId, directive, plannedFor);
  }

}
