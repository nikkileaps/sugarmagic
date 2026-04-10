/**
 * packages/plugins/src/catalog/sugarlang/runtime/director/sugar-lang-director.ts
 *
 * Purpose: Implements the facade over Claude invocation, fallback handling, calibration, and directive caching.
 *
 * Exports:
 *   - SugarLangDirector
 *
 * Relationships:
 *   - Depends on the DirectorPolicy provider boundary and directive contract types.
 *   - Will be consumed by the director middleware once Epic 9 lands.
 *
 * Implements: Proposal 001 §3. Director
 *
 * Status: active
 */

import { isInPostPlacementCalibration } from "./calibration-mode";
import { DirectiveCache } from "./directive-cache";
import { FallbackDirectorPolicy } from "./fallback-director-policy";
import type {
  DirectorContext,
  DirectorPolicy,
  PedagogicalDirective
} from "../types";
import type { TelemetrySink } from "../telemetry/telemetry";
import { DirectorInvocationError } from "./claude-director-policy";

const NO_OP_TELEMETRY: TelemetrySink = {
  emit() {
    return undefined;
  }
};

export interface SugarLangDirectorOptions {
  claudePolicy: DirectorPolicy;
  fallbackPolicy: FallbackDirectorPolicy;
  cache: DirectiveCache;
  telemetry?: TelemetrySink;
}

export class SugarLangDirector {
  private readonly claudePolicy: DirectorPolicy;
  private readonly fallbackPolicy: FallbackDirectorPolicy;
  private readonly cache: DirectiveCache;
  private readonly telemetry: TelemetrySink;

  constructor(options: SugarLangDirectorOptions) {
    this.claudePolicy = options.claudePolicy;
    this.fallbackPolicy = options.fallbackPolicy;
    this.cache = options.cache;
    this.telemetry = options.telemetry ?? NO_OP_TELEMETRY;
  }

  async invoke(context: DirectorContext): Promise<PedagogicalDirective> {
    const calibrationActive =
      context.calibrationActive || isInPostPlacementCalibration(context.learner);
    const effectiveContext: DirectorContext = {
      ...context,
      calibrationActive
    };
    const cached = this.cache.get(effectiveContext.conversationId);
    if (cached) {
      await this.telemetry.emit("director.cache-hit", {
        conversationId: effectiveContext.conversationId,
        fallback: cached.isFallbackDirective,
        timestamp: Date.now()
      });
      return cached;
    }

    let directive: PedagogicalDirective;
    let outcome: "claude" | "fallback" = "claude";

    try {
      directive = await this.claudePolicy.invoke(effectiveContext);
    } catch (error) {
      if (!(error instanceof DirectorInvocationError)) {
        throw error;
      }
      outcome = "fallback";
      directive = await this.fallbackPolicy.invoke(effectiveContext, {
        triggerReasonOverride: error.fallbackTriggerReason
      });
    }

    this.cache.set(effectiveContext.conversationId, directive);
    await this.telemetry.emit("director.invocation-resolved", {
      conversationId: effectiveContext.conversationId,
      outcome,
      fallback: directive.isFallbackDirective,
      calibrationActive,
      timestamp: Date.now()
    });

    return directive;
  }
}
