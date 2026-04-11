/**
 * packages/plugins/src/catalog/sugarlang/runtime/teacher/prompt-builder.ts
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
 *   - buildTeacherPrompt
 *   - estimatePromptTokens
 *   - formatLearnerSummary
 *   - formatRelationshipState
 *   - formatSceneSnapshot
 *   - formatNpcContext
 *   - formatGameMoment
 *   - formatRecentDialogue
 *   - formatPrescription
 *   - formatPendingProvisional
 *   - formatProbeFloorState
 *   - formatTurnShapingHints
 *
 * Relationships:
 *   - Depends on the TeacherContext provider contract and the template source in ./prompt-template.
 *   - Is consumed by ClaudeTeacherPolicy as the single prompt-assembly entry point.
 *
 * Implements: Proposal 001 §3. Teacher's *
 * Status: active
 */

import type { TeacherContext } from "../types";
import {
  DIRECTOR_SYSTEM_TEMPLATE,
  DIRECTOR_USER_TEMPLATE,
  renderDirectorPromptTemplate
} from "./prompt-template";

const EMPTY_SECTION = "(none)";
const MAX_DUE_LEMMAS = 8;
const MAX_RECENT_TURNS = 4;
const MAX_SCENE_LEMMAS = 6;
const MAX_STRUGGLING_LEMMAS = 4;
const MAX_RECENTLY_ACTIVE = 6;

export interface DirectorPrompt {
  system: string;
  user: string;
  cacheMarkers: string[];
}

export const DIRECTOR_SYSTEM_ROLE_PROMPT = `You are the Sugarlang Teacher.

Your job is to choose the pedagogical shape of exactly one upcoming NPC turn.
You do not write the line itself. You return a JSON directive that the Generator
will follow.`;

export const DIRECTOR_PEDAGOGICAL_RUBRIC_PROMPT = `PEDAGOGICAL RUBRIC:

- Preserve the illusion of normal in-character conversation.
- Prefer the smallest natural move that fits the moment.
- If the learner is unassessed or A1-ish and this looks like a first meeting or opening social turn, favor a tiny beginner-safe greeting over content-heavy speech.
- If the lexical prescription is empty, do NOT force teaching. A brief greeting or short social response is acceptable.
- Reinforcement words can surface more naturally than new introductions.
- Favor caution over ambition for low-confidence learners.`;

export const DIRECTOR_CEFR_DESCRIPTORS_PROMPT = `CEFR DESCRIPTORS:

- A1: isolated words, routines, tiny greetings, single-clause turns, heavy support.
- A2: simple everyday exchanges, short linked clauses, explicit glossing often helps.
- B1: straightforward connected speech about familiar goals, moderate support.
- B2+: more flexible phrasing, inference, and lower support when scene context allows.`;

export const DIRECTOR_OUTPUT_SCHEMA_PROMPT = `OUTPUT JSON SCHEMA:

Return valid JSON with:
- targetVocab: { introduce: LemmaRef[], reinforce: LemmaRef[], avoid: LemmaRef[] }
  where LemmaRef = { "lemmaId": string, "lang": string } (e.g. { "lemmaId": "casa", "lang": "es" })
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

- Only output targetVocab lemmas that already appear in the prescription.
- Never invent new target vocabulary.
- If a hard probe floor is active, you must trigger a comprehension check this turn.
- Target lemmas for comprehension checks must come from the pending provisional list.
- Keep citedSignals short and factual.`;

export const DIRECTOR_COMPREHENSION_GUIDANCE_BLOCK = `COMPREHENSION CHECKS:

The learner's scheduler tracks committed evidence (real FSRS progress) and
provisional evidence (unconfirmed read-past exposure). Provisional evidence
means the learner may have skimmed past a word without hovering for a gloss or
producing it themselves. It is useful, but not fully trusted.

When provisional evidence is accumulating, you may choose to trigger a
comprehension check to convert that evidence into committed mastery. Set
\`comprehensionCheck.trigger: true\`, pick 1-3 target lemmas from the pending
list, and keep the probe short and in character.

Important rules:

1. Good probes feel like conversation, not a classroom quiz.
2. Keep probes short and easy to answer.
3. If the probe floor says soft floor reached, probing is recommended.
4. If the probe floor says hard floor reached, probing is required.`;

const DIRECTOR_CACHE_MARKERS = [
  "director.system.role",
  "director.system.rubric",
  "director.system.cefr",
  "director.system.schema",
  "director.system.constraints",
  "director.system.comprehension-guidance",
  "director.user.template"
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

function estimateDueScore(card: TeacherContext["learner"]["lemmaCards"][string]): number {
  return (1 - Math.max(0, Math.min(1, card.retrievability))) * 10 +
    (card.lapseCount * 2) +
    card.provisionalEvidence;
}

function isProbableFirstMeeting(context: TeacherContext): boolean {
  return context.recentTurns.length === 0;
}

function isA1OrLowerConfidence(context: TeacherContext): boolean {
  return (
    context.learner.assessment.status === "unassessed" ||
    context.learner.estimatedCefrBand === "A1" ||
    context.learner.assessment.cefrConfidence < 0.35
  );
}

function hasEmptyPrescription(context: TeacherContext): boolean {
  return (
    context.prescription.introduce.length === 0 &&
    context.prescription.reinforce.length === 0 &&
    context.prescription.avoid.length === 0 &&
    !context.prescription.anchor
  );
}

export function estimatePromptTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function formatLearnerSummary(context: TeacherContext): string {
  const learner = context.learner;
  const due = Object.values(learner.lemmaCards)
    .sort((left, right) => estimateDueScore(right) - estimateDueScore(left))
    .slice(0, MAX_DUE_LEMMAS)
    .map((card) => `${card.lemmaId} (ret ${card.retrievability.toFixed(2)})`);
  const active = Object.values(learner.lemmaCards)
    .sort((left, right) => (right.lastReviewedAt ?? 0) - (left.lastReviewedAt ?? 0))
    .slice(0, MAX_RECENTLY_ACTIVE)
    .map((card) => `${card.lemmaId} (reviews ${card.reviewCount})`);
  const struggling = Object.values(learner.lemmaCards)
    .sort((left, right) => {
      const leftScore = left.lapseCount * 10 + left.provisionalEvidence;
      const rightScore = right.lapseCount * 10 + right.provisionalEvidence;
      return rightScore - leftScore;
    })
    .slice(0, MAX_STRUGGLING_LEMMAS)
    .map((card) => `${card.lemmaId} (lapses ${card.lapseCount})`);

  return [
    "LEARNER STATE:",
    `- learnerId: ${learner.learnerId}`,
    `- estimated CEFR: ${learner.estimatedCefrBand}`,
    `- assessment status: ${learner.assessment.status}`,
    `- CEFR confidence: ${learner.assessment.cefrConfidence.toFixed(2)}`,
    `- target/support language: ${context.lang.targetLanguage} / ${context.lang.supportLanguage}`,
    `- session turns: ${learner.currentSession?.turns ?? 0}`,
    `- known lemma cards: ${Object.keys(learner.lemmaCards).length}`,
    `- top due: ${listOrNone(due)}`,
    `- recently active: ${listOrNone(active)}`,
    `- struggling: ${listOrNone(struggling)}`
  ].join("\n");
}

export function formatRelationshipState(context: TeacherContext): string {
  const probableFirstMeeting = isProbableFirstMeeting(context);
  return [
    "RELATIONSHIP STATE:",
    `- prior dialogue turns with this NPC in prompt context: ${context.recentTurns.length}`,
    `- relationship state: ${
      probableFirstMeeting ? "probable_first_meeting" : "ongoing_conversation"
    }`,
    `- opening turn: ${probableFirstMeeting ? "yes" : "no"}`,
    `- calibration active: ${context.calibrationActive ? "yes" : "no"}`
  ].join("\n");
}

export function formatSceneSnapshot(context: TeacherContext): string {
  const teachableLemmas = Object.values(context.scene.lemmas)
    .sort((left, right) => {
      const leftRank = left.frequencyRank ?? Number.MAX_SAFE_INTEGER;
      const rightRank = right.frequencyRank ?? Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return left.lemmaId.localeCompare(right.lemmaId);
    })
    .slice(0, MAX_SCENE_LEMMAS)
    .map(
      (lemma) =>
        `${lemma.lemmaId} (${lemma.cefrPriorBand}, freq ${lemma.frequencyRank ?? "?"})`
    );

  return [
    "SCENE SNAPSHOT:",
    `- sceneId: ${context.scene.sceneId}`,
    `- anchors: ${listOrNone(context.scene.anchors)}`,
    `- teachable lemmas: ${listOrNone(teachableLemmas)}`,
    `- proper noun count: ${context.scene.properNouns.length}`
  ].join("\n");
}

export function formatNpcContext(context: TeacherContext): string {
  return [
    "NPC CONTEXT:",
    `- npcDefinitionId: ${context.npc.npcDefinitionId ?? "(none)"}`,
    `- displayName: ${context.npc.displayName ?? "(unknown)"}`,
    `- lorePageId: ${context.npc.lorePageId ?? "(none)"}`,
    `- metadata: ${
      context.npc.metadata ? JSON.stringify(context.npc.metadata) : EMPTY_SECTION
    }`
  ].join("\n");
}

export function formatProbeFloorState(context: TeacherContext): string {
  const state = context.probeFloorState;
  const soft = state.softFloorReached
    ? "SOFT FLOOR - probe recommended"
    : "soft floor not reached";
  const hard = state.hardFloorReached
    ? `HARD FLOOR - probe REQUIRED this turn (reason: ${state.hardFloorReason ?? "unspecified"})`
    : "hard floor not reached";

  return `turnsSinceLastProbe=${state.turnsSinceLastProbe}; totalPendingLemmas=${state.totalPendingLemmas}; ${soft}; ${hard}`;
}

export function formatGameMoment(context: TeacherContext): string {
  return [
    "GAME MOMENT:",
    `- conversationId: ${context.conversationId}`,
    `- selection metadata: ${
      context.selectionMetadata
        ? JSON.stringify(context.selectionMetadata)
        : EMPTY_SECTION
    }`,
    `- probe floor: ${formatProbeFloorState(context)}`
  ].join("\n");
}

export function formatRecentDialogue(context: TeacherContext): string {
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

export function formatPrescription(context: TeacherContext): string {
  const prescription = context.prescription;
  const lines = [
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
    `- rationale summary: ${prescription.rationale.summary ?? EMPTY_SECTION}`
  ];

  if (hasEmptyPrescription(context)) {
    lines.push(
      "- prescription status: empty; do not force pedagogical vocabulary this turn"
    );
  }

  return lines.join("\n");
}

export function formatPendingProvisional(context: TeacherContext): string {
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
    "The following lemmas have accumulated unconfirmed exposure. The learner may",
    "recognize them, but the scheduler has not yet upgraded them into committed",
    "mastery.",
    "",
    ...lines,
    "",
    `Total pending: ${context.pendingProvisionalLemmas.length} lemmas, ${floorState.turnsSinceLastProbe} turns since last probe.`,
    `Probe floor state: ${floorSummary || "no probe floor active"}`
  ].join("\n");
}

export function formatTurnShapingHints(context: TeacherContext): string {
  const hints: string[] = [];

  if (isProbableFirstMeeting(context)) {
    hints.push(
      "This appears to be the NPC's first meeting with the player. A brief greeting or tiny self-introduction is enough."
    );
  }

  if (isA1OrLowerConfidence(context)) {
    hints.push(
      "The learner is cold-start or low-confidence. Prefer anchored support, very short turns, and beginner-safe language."
    );
  }

  if (hasEmptyPrescription(context)) {
    hints.push(
      "The prescription is empty. Do not pad the turn with extra topic content just to teach something."
    );
  }

  if (context.probeFloorState.hardFloorReached) {
    hints.push(
      "The hard probe floor is active. This turn must trigger a comprehension check."
    );
  }

  if (hints.length === 0) {
    hints.push("Keep the move small, natural, and appropriate to the current moment.");
  }

  return ["TURN-SHAPING HINTS:", ...hints.map((hint) => `- ${hint}`)].join("\n");
}

export function buildTeacherPrompt(context: TeacherContext): DirectorPrompt {
  const system = renderDirectorPromptTemplate(DIRECTOR_SYSTEM_TEMPLATE, {
    rolePrompt: DIRECTOR_SYSTEM_ROLE_PROMPT,
    pedagogicalRubricPrompt: DIRECTOR_PEDAGOGICAL_RUBRIC_PROMPT,
    cefrDescriptorsPrompt: DIRECTOR_CEFR_DESCRIPTORS_PROMPT,
    outputSchemaPrompt: DIRECTOR_OUTPUT_SCHEMA_PROMPT,
    hardConstraintsPrompt: DIRECTOR_HARD_CONSTRAINTS_PROMPT,
    comprehensionGuidanceBlock: DIRECTOR_COMPREHENSION_GUIDANCE_BLOCK
  });

  const user = renderDirectorPromptTemplate(DIRECTOR_USER_TEMPLATE, {
    learnerSummary: formatLearnerSummary(context),
    relationshipState: formatRelationshipState(context),
    sceneSnapshot: formatSceneSnapshot(context),
    npcContext: formatNpcContext(context),
    gameMoment: formatGameMoment(context),
    recentDialogue: formatRecentDialogue(context),
    prescription: formatPrescription(context),
    pendingProvisional: formatPendingProvisional(context),
    turnShapingHints: formatTurnShapingHints(context)
  });

  return {
    system,
    user,
    cacheMarkers: [...DIRECTOR_CACHE_MARKERS]
  };
}
