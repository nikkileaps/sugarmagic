/**
 * packages/plugins/src/catalog/sugarlang/runtime/teacher/policies/fallback-teacher-policy.ts
 *
 * Purpose: Implements the deterministic fallback Teacher'spolicy used when Claude is unavailable or rejected.
 *
 * Exports:
 *   - FallbackTeacherPolicy
 *
 * Relationships:
 *   - Implements the TeacherPolicy contract from runtime/contracts/providers.ts.
 *   - Will be consumed when Claude output is unavailable or invalid in Epic 9.
 *
 * Implements: Proposal 001 §3. Teacher's *
 * Status: active
 */

import {
  vocabularyRefs,
  type TeachableRef
} from "../../contracts/teachable-ref";
import { isAvailable } from "../../situation";
import { getLearningStatus } from "../../learner";
import { resolveSceneTeachables } from "../../inventory/scene-teachable-resolver";
import type {
  CEFRBand,
  TeacherContext,
  TeacherPolicy,
  LemmaRef,
  PedagogicalDirective
} from "../../types";
import {
  TARGET_LANGUAGE_RATIO_BY_POSTURE,
  getSentenceComplexityCap
} from "../band-envelope";

export interface FallbackTeacherPolicyOptions {
  triggerReasonOverride?: PedagogicalDirective["comprehensionCheck"]["triggerReason"];
}

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
  context: TeacherContext,
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
  context: TeacherContext,
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

function takeOldestPending(context: TeacherContext): LemmaRef[] {
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
  context: TeacherContext,
  options: FallbackTeacherPolicyOptions | undefined
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

/**
 * 090.4b: the fallback's slate, derived from the SITUATION and the learner --
 * not from the prescription.
 *
 * It used to be `context.prescription.introduce.slice(0, cap)`, which made the
 * budgeter the author of every fallback directive and meant `prescription` could
 * never leave `TeacherContext`. Worse, the fallback fires exactly when the
 * gateway is unavailable -- so the path taken during an outage was the one most
 * tightly coupled to the machinery the epic is deleting.
 *
 * The replacement uses what the epic already built: concepts from the situation,
 * resolved against the atlas (090.2), then sorted by where the learner stands on
 * each (090.9). No LLM, fully deterministic, which is the whole point of a
 * fallback.
 *
 *   unseen        -> introduce, capped by band
 *   due           -> reinforce
 *   out-of-reach  -> avoid
 *   learning/known-> neither; nothing to do about them this turn
 *
 * Returns empty lists when there is no situation or the scene was never built.
 * That is a legitimate answer -- "teach nothing this turn" -- and far better
 * than inventing a slate from a scan the Teacher is no longer bound by.
 */
function deriveFallbackSlate(context: TeacherContext): {
  introduce: TeachableRef[];
  reinforce: TeachableRef[];
  avoid: TeachableRef[];
} {
  const empty = { introduce: [], reinforce: [], avoid: [] };
  const situation = context.situation;
  if (!situation || !isAvailable(situation.sceneContext)) {
    return empty;
  }

  const targetLanguage = context.lang.targetLanguage;
  const { teachables } = resolveSceneTeachables({
    concepts: situation.sceneContext.value.concepts,
    atlas: context.atlas,
    targetLanguage,
    supportLanguage: context.lang.supportLanguage
  });

  const introduce: TeachableRef[] = [];
  const reinforce: TeachableRef[] = [];
  const avoid: TeachableRef[] = [];

  for (const teachable of teachables) {
    if (teachable.kind !== "vocabulary") {
      // Competencies are nameable on the slate (090.4a) but the fallback has no
      // deterministic way to choose between them -- that judgment is the
      // Teacher's. Skipping is honest; guessing would put an unjustified act in
      // front of the learner during an outage.
      continue;
    }
    const ref: TeachableRef = {
      kind: "vocabulary",
      lemmaId: teachable.id,
      lang: targetLanguage
    };
    const status = getLearningStatus({
      card: context.learner.lemmaCards[teachable.id],
      itemBand: context.atlas.getBand(teachable.id, targetLanguage),
      learnerBand: context.learner.estimatedCefrBand
    });

    if (status === "unseen") introduce.push(ref);
    else if (status === "due") reinforce.push(ref);
    else if (status === "out-of-reach") avoid.push(ref);
  }

  return {
    introduce: introduce.slice(
      0,
      getIntroduceLevelCap(context.learner.estimatedCefrBand)
    ),
    reinforce,
    avoid
  };
}

export class FallbackTeacherPolicy implements TeacherPolicy {
  async invoke(
    context: TeacherContext,
    options?: FallbackTeacherPolicyOptions
  ): Promise<PedagogicalDirective> {
    const confidence = context.learner.assessment.cefrConfidence;
    const supportPosture = pickFallbackPosture(confidence);
    const slate = deriveFallbackSlate(context);
    const glossingStrategy = pickGlossingStrategy(
      context,
      vocabularyRefs(slate.introduce)
    );
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
      targetVocab: slate,
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
          ? "Deterministic fallback - Teacher'sLLM ignored a required comprehension probe."
          : "Deterministic fallback - Teacher'sLLM unavailable.",
      confidenceBand:
        confidence >= 0.7 ? "high" : confidence >= 0.3 ? "medium" : "low",
      isFallbackDirective: true
    };
  }
}
