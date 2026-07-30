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
 * Deleted in 086.4:
 *   - buildScriptedGeneratorPromptOverlay (scripted path no longer uses an overlay)
 *
 * Status: active
 */

import type { SugarlangConstraint } from "../types";
import type { CompetencyRef, TeachableRef } from "../contracts/teachable-ref";
import { languageDisplayName } from "../language-names";

/**
 * 090.4: the slate holds TeachableRefs, so rendering it means rendering BOTH
 * kinds. Vocabulary is a word; a competency is an act, and telling an NPC to
 * "use ask-where" is meaningless -- it has to be told what the act IS.
 *
 * The competency's realizing exponents live in the inventory, which this module
 * does not have. So the caller resolves them and passes them in; absent a
 * lookup, the competency still appears by id rather than vanishing. Silent
 * omission here is precisely how competency teaching disappeared before.
 */
function listTeachables(
  refs: TeachableRef[],
  describeCompetency?: (ref: CompetencyRef) => string
): string {
  return refs
    .map((ref) =>
      ref.kind === "vocabulary"
        ? ref.lemmaId
        : describeCompetency?.(ref) ?? ref.competencyId
    )
    .join(", ");
}

function formatTargetLanguageGuidance(constraint: SugarlangConstraint): string {
  const ratioPercent = Math.round(constraint.targetLanguageRatio * 100);
  const lang = languageDisplayName(constraint.targetLanguage);
  switch (constraint.supportPosture) {
    case "anchored":
      return `Language constraint: Reply mostly in the support language (English). Sprinkle in a few ${lang} words — about ${ratioPercent}% of the reply.`;
    case "supported":
      return `Language constraint: Use a mixed reply. Keep roughly ${ratioPercent}% of the reply in ${lang} and the rest in the support language so meaning stays easy to follow.`;
    case "target-dominant":
      return `Language constraint: Reply mostly in ${lang}, with brief support-language anchoring only when it helps comprehension. Aim for about ${ratioPercent}% ${lang}.`;
    case "target-only":
      return `Language constraint: Reply entirely in ${lang}.`;
  }
}

/**
 * Builds the prompt overlay string for the NPC generator. The generator
 * splices this into its system prompt without interpreting the fields.
 * Note: buildScriptedGeneratorPromptOverlay was removed in 086.4 (scripted
 * path no longer uses a generator prompt overlay).
 */
export function buildGeneratorPromptOverlay(
  constraint: SugarlangConstraint,
  describeCompetency?: (ref: CompetencyRef) => string
): string {
  const lines = [
    formatTargetLanguageGuidance(constraint),
    `Reinforce vocabulary (weave naturally into your reply, not their English translations): ${listTeachables(constraint.targetVocab.reinforce, describeCompetency) || "(none)"}.`,
    `Introduce vocabulary (try to use naturally this turn, not their English translations): ${listTeachables(constraint.targetVocab.introduce, describeCompetency) || "(none)"}. Do not substitute their English equivalents. These words do NOT need to be about you or your current activity. You can mention them in passing, as an observation, a rumor, a memory, a question, or just ambient scene description. Do not invent actions or goals for yourself to justify using these words.`,
    `Forbidden vocabulary (use simpler synonyms): ${listTeachables(constraint.targetVocab.avoid.slice(0, 12), describeCompetency) || "(none)"}.`,
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
      `  ${constraint.comprehensionCheckInFlight.targetLemmas.map((l) => l.lemmaId).join(", ")}`,
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
/**
 * Determines whether the generator should keep the opening greeting brief and
 * simple. This fires when: the learner hasn't typed anything yet, the teacher
 * chose the most conservative posture, and there's no vocabulary to teach.
 *
 * Plan 073.4 — this is a PEDAGOGICAL brevity signal for a conservative-beginner
 * opening (short/simple language), independent of whether the player and NPC
 * have met. First-meeting vs repeat-visit semantics (introduce / don't
 * re-introduce) are SugarAgent's concern, driven by its memory mechanic — not
 * sugarlang's. So a beginner's opening stays brief on every visit; SugarAgent
 * decides acquaintance framing separately.
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
