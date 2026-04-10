/**
 * packages/plugins/src/catalog/sugarlang/runtime/director/fallback-director-policy.ts
 *
 * Purpose: Implements the deterministic fallback Director policy used when Claude is unavailable or rejected.
 *
 * Exports:
 *   - FallbackDirectorPolicy
 *
 * Relationships:
 *   - Implements the DirectorPolicy contract from runtime/contracts/providers.ts.
 *   - Will be consumed when Claude output is unavailable or invalid in Epic 9.
 *
 * Implements: Proposal 001 §3. Director
 *
 * Status: active
 */

import type {
  CEFRBand,
  DirectorContext,
  DirectorPolicy,
  LemmaRef,
  PedagogicalDirective
} from "../types";

export interface FallbackDirectorPolicyOptions {
  triggerReasonOverride?: PedagogicalDirective["comprehensionCheck"]["triggerReason"];
}

const TARGET_LANGUAGE_RATIO_BY_POSTURE = {
  anchored: 0.3,
  supported: 0.65,
  "target-dominant": 0.85,
  "target-only": 1
} as const;

function getIntroduceLevelCap(cefrBand: CEFRBand): number {
  switch (cefrBand) {
    case "A1":
      return 1;
    case "A2":
      return 2;
    case "B1":
      return 3;
    case "B2":
      return 4;
    case "C1":
    case "C2":
      return 5;
  }
}

function getSentenceComplexityCap(
  cefrBand: CEFRBand
): PedagogicalDirective["sentenceComplexityCap"] {
  switch (cefrBand) {
    case "A1":
      return "single-clause";
    case "A2":
    case "B1":
      return "two-clause";
    case "B2":
    case "C1":
    case "C2":
      return "free";
  }
}

function pickFallbackPosture(
  confidence: number
): PedagogicalDirective["supportPosture"] {
  if (confidence < 0.3) {
    return "anchored";
  }
  if (confidence < 0.7) {
    return "supported";
  }
  return "target-dominant";
}

function pickInteractionStyle(
  context: DirectorContext,
  confidence: number
): PedagogicalDirective["interactionStyle"] {
  if (context.learner.assessment.status !== "evaluated") {
    return "listening_first";
  }
  if (confidence < 0.7 || context.calibrationActive) {
    return "guided_dialogue";
  }
  return "natural_dialogue";
}

function pickGlossingStrategy(
  context: DirectorContext,
  introduce: LemmaRef[]
): PedagogicalDirective["glossingStrategy"] {
  if (context.activeQuestEssentialLemmas.length > 0) {
    return "parenthetical";
  }
  if (introduce.length > 0) {
    return "inline";
  }
  return "hover-only";
}

function takeOldestPending(context: DirectorContext): LemmaRef[] {
  return [...context.pendingProvisionalLemmas]
    .sort((left, right) => {
      if (left.turnsPending !== right.turnsPending) {
        return right.turnsPending - left.turnsPending;
      }
      return left.lemmaRef.lemmaId.localeCompare(right.lemmaRef.lemmaId);
    })
    .slice(0, 3)
    .map((pending) => pending.lemmaRef);
}

function pickTriggerReason(
  context: DirectorContext,
  options: FallbackDirectorPolicyOptions | undefined
): PedagogicalDirective["comprehensionCheck"]["triggerReason"] {
  if (options?.triggerReasonOverride) {
    return options.triggerReasonOverride;
  }
  if (context.probeFloorState.hardFloorReached) {
    return context.probeFloorState.hardFloorReason === "lemma-age"
      ? "hard-floor-lemma-age"
      : "hard-floor-turns";
  }
  if (context.probeFloorState.softFloorReached) {
    return "soft-floor";
  }
  return undefined;
}

export class FallbackDirectorPolicy implements DirectorPolicy {
  async invoke(
    context: DirectorContext,
    options?: FallbackDirectorPolicyOptions
  ): Promise<PedagogicalDirective> {
    const confidence = context.learner.assessment.cefrConfidence;
    const supportPosture = pickFallbackPosture(confidence);
    const introduce = context.prescription.introduce.slice(
      0,
      getIntroduceLevelCap(context.learner.estimatedCefrBand)
    );
    const glossingStrategy = pickGlossingStrategy(context, introduce);
    const shouldTriggerProbe =
      context.probeFloorState.hardFloorReached ||
      (context.probeFloorState.softFloorReached && confidence >= 0.3);
    const targetLemmas = shouldTriggerProbe ? takeOldestPending(context) : [];
    const triggerReason = shouldTriggerProbe
      ? pickTriggerReason(context, options)
      : undefined;
    const fallbackSignals = ["fallback:claude-unavailable"];

    if (options?.triggerReasonOverride === "director-deferred-override") {
      fallbackSignals.push("fallback:director-deferred-override");
    }

    return {
      targetVocab: {
        introduce,
        reinforce: [...context.prescription.reinforce],
        avoid: [...context.prescription.avoid]
      },
      supportPosture,
      targetLanguageRatio: TARGET_LANGUAGE_RATIO_BY_POSTURE[supportPosture],
      interactionStyle: pickInteractionStyle(context, confidence),
      glossingStrategy,
      sentenceComplexityCap: getSentenceComplexityCap(
        context.learner.estimatedCefrBand
      ),
      comprehensionCheck: shouldTriggerProbe
        ? {
            trigger: true,
            probeStyle: "recognition",
            targetLemmas,
            triggerReason,
            characterVoiceReminder:
              context.npc.displayName != null
                ? `Stay in ${context.npc.displayName}'s established character voice.`
                : "Stay in the NPC's established character voice.",
            acceptableResponseForms: "short-phrase"
          }
        : {
            trigger: false,
            probeStyle: "none",
            targetLemmas: []
          },
      directiveLifetime: {
        maxTurns: 3,
        invalidateOn: ["quest_stage_change", "location_change"]
      },
      citedSignals: fallbackSignals,
      rationale:
        options?.triggerReasonOverride === "director-deferred-override"
          ? "Deterministic fallback - Director LLM ignored a required comprehension probe."
          : "Deterministic fallback - Director LLM unavailable.",
      confidenceBand:
        confidence >= 0.7 ? "high" : confidence >= 0.3 ? "medium" : "low",
      isFallbackDirective: true
    };
  }
}
