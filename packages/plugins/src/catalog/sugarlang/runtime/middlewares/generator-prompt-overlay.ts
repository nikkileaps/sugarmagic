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
import type { CompetencyRef } from "../contracts/teachable-ref";
import { languageDisplayName } from "../language-names";
import {
  describeLanguageMix,
  getIntroduceCapForBand
} from "../teacher/band-envelope";
import { formatAlwaysTargetWords } from "../teacher/always-target-words";
import {
  INFLECT_SLATED_WORDS_PROMPT,
  MAX_PROMPT_REINFORCE,
  renderTeachableList
} from "../teacher/slate-prompt";

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
/**
 * 090.4: THE PROMPT-SHAPING CAP.
 *
 * The slate is a working set for a whole situation and may hold several items;
 * a single NPC line cannot carry them all, and handing a generator a long list
 * of words to "use naturally" produces a sentence that is a list.
 *
 * So the cap lives HERE, at the point where the slate becomes an instruction,
 * rather than on what the Teacher may choose.
 *
 * 090.10: the flat number is gone -- how much a learner can take is a property
 * of the LEARNER, so it reads `getIntroduceCapForBand` (band-envelope.ts),
 * which is now the single enforcer. A flat 2 was giving an A1 beginner and a
 * C2 near-native the same budget, while a per-band curve one file over
 * disagreed with both.
 *
 * A competency's EXPONENTS do not count against this. They are how the act is
 * performed, not additional things to teach, and are capped inside
 * `describeCompetency`.
 *
 * 090.11: `MAX_PROMPT_REINFORCE` and the list renderer moved to
 * `teacher/slate-prompt.ts` when the build-time bake gained a slate input and
 * needed the same rendering. This module keeps the CAPS-and-composition policy;
 * the shared module owns only how a list of teachables becomes text.
 */

function formatTargetLanguageGuidance(constraint: SugarlangConstraint): string {
  // 090.11: one wording, shared with the build-time bake. These two prompts had
  // drifted until they contradicted each other -- the bake told the model to
  // write "predominantly or entirely" in the target language at every band,
  // including A1. Same posture must mean the same instruction wherever the text
  // is written.
  return `Language constraint: ${describeLanguageMix(
    constraint.supportPosture,
    languageDisplayName(constraint.targetLanguage),
    constraint.targetLanguageRatio
  )}`;
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
    // Directly under the ratio line, because they qualify it: the ratio says
    // how much target language, these say which words are target language no
    // matter what the ratio works out to.
    ...formatAlwaysTargetWords(
      constraint.targetLanguage,
      constraint.learnerCefr,
      languageDisplayName(constraint.targetLanguage)
    ),
    `Reinforce (weave naturally into your reply, not their English translations):${renderTeachableList(constraint.targetVocab.reinforce.slice(0, MAX_PROMPT_REINFORCE), describeCompetency) || " (none)"}`,
    `Introduce (try to use naturally this turn, not their English translations):${renderTeachableList(constraint.targetVocab.introduce.slice(0, getIntroduceCapForBand(constraint.learnerCefr)), describeCompetency) || " (none)"}\nDo not substitute their English equivalents. Reach for whichever is true and closest to hand: first something about yourself or what you do, then this place or this moment, then a passing observation, rumor, or memory. A question is a good shape -- it invites a reply -- but ask about something that is true of the PLAYER or the world, never about what you do yourself. Do not invent an action or goal you do not have in order to use one -- leaving a word out is better than pretending.`,
    INFLECT_SLATED_WORDS_PROMPT,
    `Forbidden vocabulary (use simpler synonyms):${renderTeachableList(constraint.targetVocab.avoid.slice(0, 12), describeCompetency) || " (none)"}`,
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
