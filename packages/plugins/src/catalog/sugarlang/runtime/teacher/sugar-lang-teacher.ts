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
  /** Conversations with a background re-plan in flight. See scheduleBackgroundReplan. */
  private readonly replansInFlight = new Set<string>();
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
    if (this.replansInFlight.has(conversationId)) {
      return;
    }
    this.replansInFlight.add(conversationId);
    void this.runBackgroundReplan(context, plannedFor)
      .catch(() => undefined)
      .finally(() => {
        this.replansInFlight.delete(conversationId);
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
