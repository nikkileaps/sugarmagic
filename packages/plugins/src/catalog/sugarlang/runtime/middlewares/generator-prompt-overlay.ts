/**
 * packages/plugins/src/catalog/sugarlang/runtime/middlewares/generator-prompt-overlay.ts
 *
 * Purpose: Builds the pre-formatted prompt overlay string that the NPC generator
 *          splices into its system prompt. This keeps all sugarlang pedagogical
 *          prompt logic inside the sugarlang plugin — the generator treats it as
 *          an opaque string.
 *
 * Exports:
 *   - buildGeneratorPromptOverlay
 *   - computeMinimalGreetingMode
 *
 * Status: active
 */

import type { SugarlangConstraint } from "../types";
import type { LemmaRef } from "../contracts/lexical-prescription";

function listLemmaIds(lemmas: LemmaRef[]): string {
  return lemmas.map((l) => l.lemmaId).join(", ");
}

function formatTargetLanguageGuidance(constraint: SugarlangConstraint): string {
  const ratioPercent = Math.round(constraint.targetLanguageRatio * 100);
  switch (constraint.supportPosture) {
    case "anchored":
      return `Language constraint: Reply mostly in the support language (English). Sprinkle in a few ${constraint.targetLanguage} words — about ${ratioPercent}% of the reply.`;
    case "supported":
      return `Language constraint: Use a mixed reply. Keep roughly ${ratioPercent}% of the reply in ${constraint.targetLanguage} and the rest in the support language so meaning stays easy to follow.`;
    case "target-dominant":
      return `Language constraint: Reply mostly in ${constraint.targetLanguage}, with brief support-language anchoring only when it helps comprehension. Aim for about ${ratioPercent}% ${constraint.targetLanguage}.`;
    case "target-only":
      return `Language constraint: Reply entirely in ${constraint.targetLanguage}.`;
  }
}

/**
 * Builds the prompt overlay string for the NPC generator. The generator
 * splices this into its system prompt without interpreting the fields.
 */
export function buildGeneratorPromptOverlay(
  constraint: SugarlangConstraint
): string {
  const lines = [
    formatTargetLanguageGuidance(constraint),
    `Must-use vocabulary (weave naturally into your reply): ${listLemmaIds(constraint.targetVocab.reinforce) || "(none)"}.`,
    `New vocabulary to introduce this turn (use each exactly once, clearly in context): ${listLemmaIds(constraint.targetVocab.introduce) || "(none)"}.`,
    `Forbidden vocabulary (use simpler synonyms): ${listLemmaIds(constraint.targetVocab.avoid.slice(0, 12)) || "(none)"}.`,
    `CEFR envelope: learner is ${constraint.learnerCefr}; keep >=95% of lemmas at or below ${constraint.learnerCefr}+1 band.`,
    `Support posture: ${constraint.supportPosture}. Target-language ratio: ${constraint.targetLanguageRatio}. Sentence complexity: ${constraint.sentenceComplexityCap}.`,
    `Do NOT add parenthetical translations or inline glosses. The UI handles vocabulary glossing via hover tooltips. Let the NPC speak naturally.`
  ];

  if (constraint.comprehensionCheckInFlight) {
    lines.push(
      "",
      "COMPREHENSION CHECK - THIS TURN MUST INCLUDE A PROBE:",
      "",
      "After speaking naturally in character, include a short in-character question that elicits a response demonstrating comprehension of one or more of these lemmas:",
      `  ${listLemmaIds(constraint.comprehensionCheckInFlight.targetLemmas)}`,
      "",
      `Probe style: ${constraint.comprehensionCheckInFlight.probeStyle}`,
      `Character voice reminder: ${constraint.comprehensionCheckInFlight.characterVoiceReminder}`,
      "",
      "IMPORTANT:",
      "- Stay in character.",
      "- The probe can be a natural non-sequitur if needed.",
      "- The probe should be the LAST thing in your reply.",
      "Reply length constraint: keep the reply to 2-3 sentences including the probe question."
    );
  }

  return lines.join("\n");
}

/**
 * Determines whether the generator should use minimal greeting mode:
 * very short reply, no volunteered details. This is for cold-start
 * first-meeting turns with no vocabulary to teach.
 */
/**
 * Determines whether the generator should use minimal greeting mode.
 * This fires when: the learner hasn't typed anything yet, the teacher
 * chose the most conservative posture, and there's no vocabulary to teach.
 */
export function computeMinimalGreetingMode(
  constraint: SugarlangConstraint,
  hasUserText: boolean
): boolean {
  return (
    !hasUserText &&
    constraint.supportPosture === "anchored" &&
    constraint.interactionStyle === "listening_first" &&
    constraint.sentenceComplexityCap === "single-clause" &&
    !constraint.comprehensionCheckInFlight &&
    constraint.targetVocab.introduce.length === 0 &&
    constraint.targetVocab.reinforce.length === 0 &&
    constraint.targetVocab.avoid.length === 0 &&
    (constraint.questEssentialLemmas?.length ?? 0) === 0
  );
}
