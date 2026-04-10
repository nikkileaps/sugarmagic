/**
 * packages/plugins/src/catalog/sugarlang/runtime/director/prompt-builder.ts
 *
 * Purpose: Builds the Director's cacheable system prompt and dynamic user prompt from middleware-owned context.
 *
 * Exports:
 *   - DirectorPrompt
 *   - DIRECTOR_SYSTEM_ROLE_PROMPT
 *   - DIRECTOR_PEDAGOGICAL_RUBRIC_PROMPT
 *   - DIRECTOR_CEFR_DESCRIPTORS_PROMPT
 *   - DIRECTOR_OUTPUT_SCHEMA_PROMPT
 *   - DIRECTOR_HARD_CONSTRAINTS_PROMPT
 *   - DIRECTOR_COMPREHENSION_GUIDANCE_BLOCK
 *   - buildDirectorPrompt
 *   - estimatePromptTokens
 *   - formatLearnerSummary
 *   - formatLemmaSummary
 *   - formatSceneTeachableIndex
 *   - formatNpcContext
 *   - formatGameMoment
 *   - formatRecentDialogue
 *   - formatPrescription
 *   - formatPendingProvisional
 *   - formatProbeFloorState
 *   - formatQuestEssentialLemmas
 *
 * Relationships:
 *   - Depends on the DirectorContext provider contract.
 *   - Will be consumed by ClaudeDirectorPolicy once Epic 9 lands.
 *
 * Implements: Proposal 001 §3. Director
 *
 * Status: active
 */

import type { DirectorContext } from "../types";

const EMPTY_SECTION = "(none)";
const MAX_SCENE_LEMMAS = 12;
const MAX_DUE_LEMMAS = 12;
const MAX_RECENT_TURNS = 6;
const MAX_STRUGGLING_LEMMAS = 5;
const MAX_RECENTLY_INTRODUCED = 8;

export interface DirectorPrompt {
  system: string;
  user: string;
  cacheMarkers: string[];
}

export const DIRECTOR_SYSTEM_ROLE_PROMPT = `You are the Sugarlang Director.

Your job is to reshape the Lexical Budgeter's prescription into a narratively natural pedagogical directive for one NPC turn. You may change ordering, emphasis, glossing, support posture, and interaction style, but you may NEVER invent vocabulary outside the prescription or move quest-essential lemmas into targetVocab.`;

export const DIRECTOR_PEDAGOGICAL_RUBRIC_PROMPT = `PEDAGOGICAL RUBRIC:

- Preserve the illusion of normal in-character conversation.
- Prefer the lightest support that still keeps the turn comprehensible.
- New vocabulary should feel motivated by the scene, not classroom-like.
- Reinforcement words can be surfaced more naturally than introduces.
- If the learner is cold-start or low-confidence, favor caution over ambition.
- Quest-essential lemmas are a separate mandatory channel, not normal target vocab.`;

export const DIRECTOR_CEFR_DESCRIPTORS_PROMPT = `CEFR DESCRIPTORS:

- A1: isolated words, routines, single-clause sentences, heavy support.
- A2: simple everyday exchanges, short linked clauses, explicit glossing helps.
- B1: straightforward connected speech about familiar goals, moderate support.
- B2+: more flexible phrasing, inference, and lower support when scene context allows.`;

export const DIRECTOR_OUTPUT_SCHEMA_PROMPT = `OUTPUT JSON SCHEMA:

Return valid JSON with:
- targetVocab: { introduce: LemmaRef[], reinforce: LemmaRef[], avoid: LemmaRef[] }
- supportPosture: "anchored" | "supported" | "target-dominant" | "target-only"
- targetLanguageRatio: number in [0, 1]
- interactionStyle: "listening_first" | "guided_dialogue" | "natural_dialogue" | "recast_mode" | "elicitation_mode"
- glossingStrategy: "inline" | "parenthetical" | "hover-only" | "none"
- sentenceComplexityCap: "single-clause" | "two-clause" | "free"
- comprehensionCheck: { trigger, probeStyle, targetLemmas, triggerReason?, characterVoiceReminder?, acceptableResponseForms? }
- directiveLifetime: { maxTurns, invalidateOn[] }
- citedSignals: string[]
- rationale: string
- confidenceBand: "high" | "medium" | "low"
- isFallbackDirective: false`;

export const DIRECTOR_HARD_CONSTRAINTS_PROMPT = `HARD CONSTRAINTS:

- No invention: only output targetVocab lemmas that already appear in the prescription.
- Quest-essential lemmas must never appear in targetVocab.
- When quest-essential lemmas are present, glossingStrategy must be "parenthetical" or "inline".
- If a hard probe floor is active, you must trigger a comprehension check this turn.
- Target lemmas for comprehension checks must come from the pending provisional list.
- Keep citedSignals short and factual.`;

export const DIRECTOR_COMPREHENSION_GUIDANCE_BLOCK = `COMPREHENSION CHECKS:

The player's scheduler has two kinds of evidence per word: committed (real FSRS progress)
and provisional (unconfirmed read-past exposure that has not yet been converted into
mastery). Provisional evidence comes from the player skimming past a word in dialogue
without hovering for a translation or producing the word themselves - behavior that might
mean they know it, or might mean they're in a hurry. It is not reliable evidence on its
own.

When provisional evidence is accumulating (see the "pending provisional" section in the
user prompt), you may choose to trigger a comprehension check to convert provisional
evidence into committed mastery. Set \`comprehensionCheck.trigger: true\` in your output,
pick 1-3 target lemmas from the pending list, and include \`triggerReason:
"director-discretion"\` in your rationale.

IMPORTANT RULES FOR COMPREHENSION CHECKS:

1. A probe does NOT need to be narratively tied to the current scene or quest.
   It can be a total non-sequitur from whatever the NPC was just talking about.

2. A probe MUST stay IN CHARACTER for the NPC speaking. The character's voice is the
   vehicle; the specific target lemmas are the payload. A stationmaster musing about
   cheese can naturally ask "¿entiendes?" or "y tu, ¿tambien te gusta el queso?" without
   breaking character. A noir bouncer would ask differently. Use the NPC bio you've been
   given to calibrate.

3. Good probes are short, conversational, and elicit a response that demonstrates
   comprehension of the target lemmas:
     "¿entiendes?"
     "¿que piensas tu?"
     "y tu, ¿como lo ves?"
     "¿a ti tambien te gusta?"
     "dime, ¿que harias?"

4. BAD probes sound clinical or classroom-like:
     "Now tell me what this word means"
     "Can you use 'llave' in a sentence?"
     "What does 'vez' mean?"
   These break the illusion that this is a conversation, not a test.

5. Do not overuse probes. Each probe interrupts the conversational flow, and the floor
   state tells you when probes are over-frequent vs. under-frequent. If you see
   \`probeFloorState.softFloorReached: true\`, you should probe this turn. If you see
   \`probeFloorState.hardFloorReached: true\`, you MUST probe this turn - the system
   requires it.

ELICITATION MODE (Swain Output Hypothesis hint):

One of the interaction styles you can pick is \`elicitation_mode\` - a Swain-aligned
style where the NPC invites the player to produce specific lemmas rather than just
exposing them. Consider picking this style when the prescription contains 3 or more
lemmas with a high receptive-productive gap (high \`stability\` but low \`productiveStrength\`).
These are words the learner recognizes but cannot produce - good targets for a
production-prompting turn. This is not a hard threshold - use your judgment based on
the scene context and the NPC's character voice - but if the gap signal is strong,
\`elicitation_mode\` is often the right choice. Do not use \`elicitation_mode\` when no
high-gap lemmas exist; it would feel contrived.

QUEST-ESSENTIAL LEMMAS (Linguistic Deadlock fix):

The classifier exempts certain lemmas from the CEFR envelope when they appear in
currently-active quest objective text. These "quest-essential" lemmas are the
vocabulary the player MUST encounter to understand their current goal - even if
those words are above their CEFR band. They are marked in the user prompt's
"QUEST-ESSENTIAL LEMMAS" section.

Rules:

1. If the current scene references an active quest objective, you are expected to use
   at least one quest-essential lemma in your reply.
2. When quest-essential lemmas appear in the user prompt, you MUST set glossingStrategy
   to "parenthetical" (preferred) or "inline". Never "hover-only" or "none".
3. The Generator is instructed to provide an inline parenthetical translation after
   the first use of each quest-essential lemma. Your job as the Director is to make
   sure the glossingStrategy field authorizes it.
4. Do not add quest-essential lemmas to \`targetVocab.introduce\`, \`targetVocab.reinforce\`, or
   \`targetVocab.avoid\`. They flow through a separate channel. Pretend they do not exist for the
   purposes of targetVocab.`;

const DIRECTOR_CACHE_MARKERS = [
  "director.system.role",
  "director.system.rubric",
  "director.system.cefr",
  "director.system.schema",
  "director.system.constraints",
  "director.system.comprehension-guidance"
] as const;

function listOrNone(values: string[]): string {
  return values.length > 0 ? values.join(", ") : EMPTY_SECTION;
}

function formatLemmaRefList(
  refs: Array<{ lemmaId: string; lang: string; surfaceForm?: string }>
): string {
  return listOrNone(
    refs.map((lemma) =>
      lemma.surfaceForm ? `${lemma.lemmaId}/${lemma.surfaceForm}` : lemma.lemmaId
    )
  );
}

function estimateDueScore(card: DirectorContext["learner"]["lemmaCards"][string]): number {
  return (1 - Math.max(0, Math.min(1, card.retrievability))) * 10 +
    (card.lapseCount * 2) +
    card.provisionalEvidence;
}

export function estimatePromptTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function formatLearnerSummary(context: DirectorContext): string {
  const learner = context.learner;
  return [
    "LEARNER SUMMARY:",
    `- learnerId: ${learner.learnerId}`,
    `- estimated CEFR: ${learner.estimatedCefrBand}`,
    `- assessment status: ${learner.assessment.status}`,
    `- CEFR confidence: ${learner.assessment.cefrConfidence.toFixed(2)}`,
    `- target/support language: ${context.lang.targetLanguage} / ${context.lang.supportLanguage}`,
    `- calibrationActive: ${context.calibrationActive ? "yes" : "no"}`,
    `- session turns: ${learner.currentSession?.turns ?? 0}`,
    `- known lemma cards: ${Object.keys(learner.lemmaCards).length}`
  ].join("\n");
}

export function formatLemmaSummary(context: DirectorContext): string {
  const cards = Object.values(context.learner.lemmaCards);
  const due = [...cards]
    .sort((left, right) => estimateDueScore(right) - estimateDueScore(left))
    .slice(0, MAX_DUE_LEMMAS)
    .map((card) => `${card.lemmaId} (ret ${card.retrievability.toFixed(2)})`);
  const struggling = [...cards]
    .sort((left, right) => {
      const leftScore = left.lapseCount * 10 + left.provisionalEvidence;
      const rightScore = right.lapseCount * 10 + right.provisionalEvidence;
      return rightScore - leftScore;
    })
    .slice(0, MAX_STRUGGLING_LEMMAS)
    .map((card) => `${card.lemmaId} (lapses ${card.lapseCount})`);
  const recentlyIntroduced = [...cards]
    .sort((left, right) => (right.lastReviewedAt ?? 0) - (left.lastReviewedAt ?? 0))
    .slice(0, MAX_RECENTLY_INTRODUCED)
    .map((card) => `${card.lemmaId} (reviews ${card.reviewCount})`);

  return [
    "LEMMA SUMMARY:",
    `- top due: ${listOrNone(due)}`,
    `- recently active: ${listOrNone(recentlyIntroduced)}`,
    `- struggling: ${listOrNone(struggling)}`
  ].join("\n");
}

export function formatSceneTeachableIndex(context: DirectorContext): string {
  const sceneLemmas = Object.values(context.scene.lemmas)
    .sort((left, right) => {
      const leftRank = left.frequencyRank ?? Number.MAX_SAFE_INTEGER;
      const rightRank = right.frequencyRank ?? Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return left.lemmaId.localeCompare(right.lemmaId);
    })
    .slice(0, MAX_SCENE_LEMMAS)
    .map((lemma) => {
      const questTag = lemma.isQuestCritical ? " quest-critical" : "";
      return `- ${lemma.lemmaId} (${lemma.cefrPriorBand}, freq ${
        lemma.frequencyRank ?? "?"
      })${questTag}`;
    });

  return [
    "SCENE TEACHABLE INDEX:",
    `- sceneId: ${context.scene.sceneId}`,
    `- anchors: ${listOrNone(context.scene.anchors)}`,
    `- proper nouns: ${listOrNone(context.scene.properNouns)}`,
    ...sceneLemmas
  ].join("\n");
}

export function formatNpcContext(context: DirectorContext): string {
  return [
    "NPC CONTEXT:",
    `- npcDefinitionId: ${context.npc.npcDefinitionId ?? "(none)"}`,
    `- displayName: ${context.npc.displayName ?? "(unknown)"}`,
    `- lorePageId: ${context.npc.lorePageId ?? "(none)"}`,
    `- metadata: ${
      context.npc.metadata ? JSON.stringify(context.npc.metadata, null, 2) : EMPTY_SECTION
    }`
  ].join("\n");
}

export function formatGameMoment(context: DirectorContext): string {
  return [
    "GAME MOMENT:",
    `- conversationId: ${context.conversationId}`,
    `- selection metadata: ${
      context.selectionMetadata
        ? JSON.stringify(context.selectionMetadata, null, 2)
        : EMPTY_SECTION
    }`,
    `- probe floor: ${formatProbeFloorState(context)}`
  ].join("\n");
}

export function formatRecentDialogue(context: DirectorContext): string {
  const turns = context.recentTurns
    .slice(-MAX_RECENT_TURNS)
    .map(
      (turn) =>
        `- [${turn.turnId}] ${turn.speaker.toUpperCase()}${
          turn.lang ? ` (${turn.lang})` : ""
        }: ${turn.text}`
    );

  return ["RECENT DIALOGUE:", ...(turns.length > 0 ? turns : ["- (none)"])].join("\n");
}

export function formatPrescription(context: DirectorContext): string {
  const prescription = context.prescription;
  return [
    "LEXICAL PRESCRIPTION:",
    `- introduce: ${formatLemmaRefList(prescription.introduce)}`,
    `- reinforce: ${formatLemmaRefList(prescription.reinforce)}`,
    `- avoid: ${formatLemmaRefList(prescription.avoid)}`,
    `- anchor: ${
      prescription.anchor
        ? formatLemmaRefList([prescription.anchor])
        : EMPTY_SECTION
    }`,
    `- budget newItemsAllowed: ${prescription.budget.newItemsAllowed}`,
    `- rationale summary: ${prescription.rationale.summary ?? EMPTY_SECTION}`,
    `- quest-essential exclusions: ${
      listOrNone(prescription.rationale.questEssentialExclusionLemmaIds ?? [])
    }`
  ].join("\n");
}

export function formatProbeFloorState(context: DirectorContext): string {
  const state = context.probeFloorState;
  const soft = state.softFloorReached ? "SOFT FLOOR - probe recommended" : "soft floor not reached";
  const hard = state.hardFloorReached
    ? `HARD FLOOR - probe REQUIRED this turn (reason: ${state.hardFloorReason ?? "unspecified"})`
    : "hard floor not reached";

  return `turnsSinceLastProbe=${state.turnsSinceLastProbe}; totalPendingLemmas=${state.totalPendingLemmas}; ${soft}; ${hard}`;
}

export function formatPendingProvisional(context: DirectorContext): string {
  if (context.pendingProvisionalLemmas.length === 0) {
    return ["PENDING PROVISIONAL EVIDENCE:", "", "No pending provisional evidence."].join(
      "\n"
    );
  }

  const lines = context.pendingProvisionalLemmas.map((pending) => {
    const sceneLemma = context.scene.lemmas[pending.lemmaRef.lemmaId];
    const cefrBand = sceneLemma?.cefrPriorBand ?? "unknown";
    return `- ${pending.lemmaRef.lemmaId} (${cefrBand}): ${pending.evidenceAmount} units, pending for ${pending.turnsPending} turns`;
  });

  const floorState = context.probeFloorState;
  const floorSummary = [
    floorState.softFloorReached ? "SOFT FLOOR - probe recommended" : "",
    floorState.hardFloorReached
      ? `HARD FLOOR - probe REQUIRED this turn (reason: ${floorState.hardFloorReason ?? "unspecified"})`
      : ""
  ]
    .filter(Boolean)
    .join(" ");

  return [
    "PENDING PROVISIONAL EVIDENCE:",
    "",
    "The following lemmas have accumulated unconfirmed exposure. The player has read past",
    "them quickly without hovering or producing them. Their FSRS stability has NOT been",
    "updated because the evidence is unconfirmed. A comprehension check on any of these",
    "lemmas would convert the evidence to mastery (on pass) or discard it (on fail).",
    "",
    ...lines,
    "",
    `Total pending: ${context.pendingProvisionalLemmas.length} lemmas, ${floorState.turnsSinceLastProbe} turns since last probe.`,
    `Probe floor state: ${floorSummary || "no probe floor active"}`
  ].join("\n");
}

export function formatQuestEssentialLemmas(context: DirectorContext): string {
  if (context.activeQuestEssentialLemmas.length === 0) {
    return ["QUEST-ESSENTIAL LEMMAS:", "", "No active quest-essential lemmas."].join("\n");
  }

  const lines = context.activeQuestEssentialLemmas.map(
    (lemma) =>
      `- ${lemma.lemmaRef.lemmaId} (${lemma.cefrBand}) - from objective "${lemma.sourceObjectiveDisplayName}"\n  gloss: "${lemma.supportLanguageGloss}"`
  );

  return [
    "QUEST-ESSENTIAL LEMMAS (Linguistic Deadlock fix - Proposal 001):",
    "",
    "The player's currently-active quest objectives contain vocabulary that is ABOVE their",
    "CEFR envelope but cannot be simplified without losing the quest meaning. These words",
    "are classifier-exempt - you may use them freely, regardless of learner level. However,",
    "because the player cannot understand them natively, you MUST provide an inline",
    `parenthetical translation in ${context.lang.supportLanguage} immediately after the first use of`,
    "each such word this turn.",
    "",
    ...lines,
    "",
    'REQUIREMENT: If any of your reply references the current objective at all, you MUST',
    'use at least one of these lemmas. You MUST set glossingStrategy to "parenthetical"',
    '(preferred) or "inline". You may NOT set glossingStrategy to "hover-only" or "none"',
    "when quest-essential lemmas are present - the player needs immediate translations.",
    "",
    'Example of correct output for "altar" in Spanish with English support:',
    '  "Ve al altar (the altar) detras del templo."',
    "",
    "Example of INCORRECT output (no parenthetical):",
    '  "Ve al altar detras del templo."  <- player has no idea what "altar" means'
  ].join("\n");
}

export function buildDirectorPrompt(context: DirectorContext): DirectorPrompt {
  const system = [
    DIRECTOR_SYSTEM_ROLE_PROMPT,
    DIRECTOR_PEDAGOGICAL_RUBRIC_PROMPT,
    DIRECTOR_CEFR_DESCRIPTORS_PROMPT,
    DIRECTOR_OUTPUT_SCHEMA_PROMPT,
    DIRECTOR_HARD_CONSTRAINTS_PROMPT,
    DIRECTOR_COMPREHENSION_GUIDANCE_BLOCK
  ].join("\n\n");

  const sections: string[] = [];
  if (context.probeFloorState.hardFloorReached) {
    sections.push(
      "REQUIREMENT: This turn MUST trigger a comprehension check. Set comprehensionCheck.trigger = true in your output. Pick target lemmas from the pending provisional list. Do not defer."
    );
  }

  sections.push(
    formatLearnerSummary(context),
    formatLemmaSummary(context),
    formatSceneTeachableIndex(context),
    formatNpcContext(context),
    formatGameMoment(context),
    formatRecentDialogue(context),
    formatPrescription(context),
    formatPendingProvisional(context)
  );

  if (context.activeQuestEssentialLemmas.length > 0) {
    sections.push(formatQuestEssentialLemmas(context));
  }

  return {
    system,
    user: sections.join("\n\n"),
    cacheMarkers: [...DIRECTOR_CACHE_MARKERS]
  };
}
