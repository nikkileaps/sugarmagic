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
    const cached = this.cache.get(effectiveContext.conversationId, keysNow);
    if (cached) {
      await emitTelemetry(
        this.telemetry,
        createTelemetryEvent("director.cache-hit", {
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
        createTelemetryEvent("director.invocation-completed", {
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
      createTelemetryEvent("director.invocation-resolved", {
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
}
