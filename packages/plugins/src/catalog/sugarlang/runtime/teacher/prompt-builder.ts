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
 *   - DIRECTOR_PRAGMATIC_FEEDBACK_BLOCK
 *   - buildTeacherPrompt
 *   - estimatePromptTokens
 *   - formatLearnerSummary
 *   - formatRelationshipState
 *   - formatSceneSnapshot
 *   - formatNpcContext
 *   - formatGameMoment
 *   - formatRecentDialogue
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
import { EMPTY_NPC_CONTEXT, type RuntimeFact } from "../situation";
import { computePacingSignals } from "../learner";
import { resolveSceneTeachables } from "../inventory/scene-teachable-resolver";
import { loadCompetencyInventory } from "../inventory/competency-inventory-loader";
import { DUE_RETRIEVABILITY_FLOOR } from "../learner";
import { cardDisplayName } from "../inventory/card-display-name";
import type { Competency } from "../contracts/competency-inventory";
import {
  TARGET_LANGUAGE_RATIO_BY_POSTURE,
  TARGET_LANGUAGE_RATIO_TOLERANCE
} from "./band-envelope";
import {
  DIRECTOR_SYSTEM_TEMPLATE,
  DIRECTOR_USER_TEMPLATE,
  renderDirectorPromptTemplate
} from "./prompt-template";

const EMPTY_SECTION = "(none)";
/**
 * Distinct from `(none)` on purpose. `(none)` asserts a fact -- there is nothing
 * here. `(unknown)` asserts nothing, because we could not read it. See
 * `formatRuntimeFact`.
 */
const UNKNOWN_SECTION = "(unknown)";
const MAX_DUE_LEMMAS = 8;
const MAX_RECENT_TURNS = 4;
const MAX_SCENE_LEMMAS = 6;
const MAX_STRUGGLING_LEMMAS = 4;
const MAX_RECENTLY_ACTIVE = 6;
/**
 * How many introduce items the Teacher may put on a slate.
 *
 * A situation-scoped working set, not a per-turn quota -- see the note above
 * DIRECTOR_HARD_CONSTRAINTS_PROMPT. Six is small enough to stay coherent and
 * large enough that a conversation is not locked to whatever fit its opening
 * line.
 */
const MAX_SLATE_INTRODUCE = 6;

export interface DirectorPrompt {
  system: string;
  user: string;
  cacheMarkers: string[];
}

export const DIRECTOR_SYSTEM_ROLE_PROMPT = `You are the Sugarlang Teacher.

Your job is to decide what this learner should be working on in this situation.
You do not write any line yourself. You return a JSON directive that the
Generator follows across the turns this situation lasts -- so choose a working
set that suits the moment, not a single sentence.`;

export const DIRECTOR_PEDAGOGICAL_RUBRIC_PROMPT = `PEDAGOGICAL RUBRIC:

- Preserve the illusion of normal in-character conversation.
- Prefer the language and length of natural response that fits the moment in the conversation and situation.
- The situation tells you what this moment is about. Choose the items it genuinely affords; the Generator picks which of them fit each individual turn.
- What you choose should feel organic, not forced. If something does not belong in this situation at all, leave it out.
- If nothing fits this moment, do NOT force teaching. A brief greeting or short social response is acceptable.
- Reinforcement words can surface more naturally than new introductions.
- For low-confidence learners, keep sentence structure simple, but still try to include what you chose to teach.`;

export const DIRECTOR_CEFR_DESCRIPTORS_PROMPT = `CEFR DESCRIPTORS:

- A1: isolated words, routines, tiny greetings, single-clause turns, heavy support.
- A2: simple everyday exchanges, short linked clauses.
- B1: straightforward connected speech about familiar goals, moderate support.
- B2+: more flexible phrasing, inference, and lower support when scene context allows.`;

/**
 * The ratio guidance, GENERATED FROM THE TABLE rather than retyped.
 *
 * 090.4, nikki: "the value should be set in one place for each band, it should
 * come from that place, and go into the prompt." Writing `anchored 0.3` as prose
 * here would create a second copy that drifts the first time the table changes
 * -- and the prompt is the copy nobody thinks to grep.
 *
 * The Teacher never saw these numbers at all before this; it was asked for
 * `targetLanguageRatio: number in [0, 1]` and nothing else, which is why an
 * anchored A1 turn came back at 0.4.
 */
const RATIO_GUIDANCE_LINES = [
  "- targetLanguageRatio: number in [0, 1] -- how much of the reply is target language.",
  `  Each posture has an expected value; stay within ${TARGET_LANGUAGE_RATIO_TOLERANCE} of it:`,
  "    " +
    Object.entries(TARGET_LANGUAGE_RATIO_BY_POSTURE)
      .map(([posture, ratio]) => `${posture} ${ratio}`)
      .join(" | "),
  "  Lean lower for a tense or information-dense beat, higher when the learner is",
  "  relaxed and the moment is social. Values outside the band are clamped."
].join("\n");

export const DIRECTOR_OUTPUT_SCHEMA_PROMPT = `OUTPUT JSON SCHEMA:

Return valid JSON with:
- targetVocab: { introduce: Teachable[], reinforce: Teachable[], avoid: Teachable[] }
  A Teachable is EITHER a word or a competency. Both are valid; choose whichever
  actually fits this moment.
    word:       { "kind": "vocabulary", "lemmaId": string, "lang": string }
                e.g. { "kind": "vocabulary", "lemmaId": "queso", "lang": "es" }
    competency: { "kind": "competency", "competencyId": string, "lang": string }
                e.g. { "kind": "competency", "competencyId": "ask-where", "lang": "es" }
  A word is a thing to know. A competency is something the learner can DO --
  greeting someone, asking where something is. Teaching an act is often worth
  more than teaching another noun, so do not default to words.
- supportPosture: "anchored" | "supported" | "target-dominant" | "target-only"
${RATIO_GUIDANCE_LINES}
- interactionStyle: "listening_first" | "guided_dialogue" | "natural_dialogue" | "recast_mode" | "elicitation_mode"
- glossingStrategy: "none"
  (The UI handles vocabulary glossing via hover tooltips. Do NOT add parenthetical translations or inline glosses in the dialogue text. Let the NPC speak naturally.)
- sentenceComplexityCap: "single-clause" | "two-clause" | "free"
- comprehensionCheck: { trigger, probeStyle, targetLemmas, triggerReason?, characterVoiceReminder?, acceptableResponseForms? }
- directiveLifetime: { maxTurns, invalidateOn[] }
- citedSignals: string[]
- rationale: string
- confidenceBand: "high" | "medium" | "low"
- isFallbackDirective: false`;

/**
 * 090.4 REMOVED THE PRESCRIPTION FENCE.
 *
 * Three lines used to stand here:
 *   - "Only output targetVocab lemmas that already appear in the prescription."
 *   - "Never invent new target vocabulary."
 *   - "...only 1-2 items FROM THE PRESCRIPTION..."
 *
 * Together they meant the Teacher's entire freedom was picking one or two things
 * from three that a lexical scan had already chosen. It could not name a word
 * the scan had missed -- which is the motivating bug of the whole epic: an agent
 * NPC's lines do not exist at compile time, so `queso` never entered the scan,
 * so the Teacher was structurally FORBIDDEN from teaching cheese to a
 * cheese-obsessed character. It did not fail to think of it. It was not allowed
 * to say it.
 *
 * THE COUNT INSTRUCTION WAS WRONG AFTER 090.3b AND IT TOOK A PLAYTHROUGH TO SEE.
 *
 * It used to read "1-2 items that fit THIS TURN". That was right while the
 * Teacher ran every turn. Once the situation key became the invalidation axis
 * and `maxTurns` went 3 -> 20, ONE directive governs an entire conversation --
 * so "1-2 items for this turn" silently became "1-2 items for the whole
 * conversation", chosen before the learner had said anything.
 *
 * Observed: turn 1 was an opening greeting, the Teacher reasonably picked a
 * greeting competency, and cheese was then locked out for the rest of the
 * conversation. That is the pre-truncation the epic exists to remove,
 * reintroduced by changing the lifecycle without changing the instruction that
 * assumed the old one.
 *
 * A slate is a WORKING SET. The cap that matters is not on what the Teacher may
 * choose but on what reaches the agent prompt at once -- which is enforced in
 * `generator-prompt-overlay.ts`, not here.
 */
export const DIRECTOR_HARD_CONSTRAINTS_PROMPT = `HARD CONSTRAINTS:

- Choose targetVocab from what this situation makes teachable.
- Only use lemmas that exist in the target language; never invent words.
- You are choosing a WORKING SET for this whole situation, not a single turn. Pick up to ${MAX_SLATE_INTRODUCE} introduce items that this situation genuinely affords. The NPC will use whichever fit each turn; you do not need to make them all fit one line.
- If a hard probe floor is active, you must trigger a comprehension check this turn.
- Target lemmas for comprehension checks must come from the pending provisional list.
- Keep citedSignals short and factual.`;

export const DIRECTOR_PRAGMATIC_FEEDBACK_BLOCK = `PRAGMATIC FEEDBACK RULES:

When a player uses or attempts a competency the NPC has modeled
(greetings, farewells, expressions of gratitude, acknowledgements, requests):

- Correct use: respond with natural in-fiction warmth -- a smile, a matching
  social beat, delight at being understood. Keep it brief and diegetic.
- Misuse or awkward phrasing: react with gentle in-fiction confusion or a
  light clarifying recast ("Perdona, no entiendo bien..."). The NPC never
  corrects grammar explicitly; confusion is social, not pedagogical.
- NEVER punish pragmatic mistakes with scolding, correction-as-correction,
  or breaking the fourth wall. The NPC's job is to model, not to evaluate.`;

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
  "director.system.pragmatic-feedback",
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
  return (context.situation?.recentTurns ?? []).length === 0;
}

/**
 * 090.4: probe-pacing signals, derived rather than carried. See
 * learner/pacing-signals.ts.
 */
function pacingSignals(context: TeacherContext) {
  return computePacingSignals(
    context.learner,
    context.situation?.turnsSinceLastProbe ?? 0
  );
}

function isA1OrLowerConfidence(context: TeacherContext): boolean {
  return (
    context.learner.assessment.status === "unassessed" ||
    context.learner.estimatedCefrBand === "A1" ||
    context.learner.assessment.cefrConfidence < 0.35
  );
}

export function estimatePromptTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function formatLearnerSummary(context: TeacherContext): string {
  const learner = context.learner;
  const lang = context.lang.targetLanguage;
  const cards = Object.values(learner.lemmaCards);
  const name = (card: { lemmaId: string }) => cardDisplayName(card.lemmaId, lang);

  const due = cards
    .filter((card) => card.retrievability < DUE_RETRIEVABILITY_FLOOR)
    .sort((left, right) => estimateDueScore(right) - estimateDueScore(left))
    .slice(0, MAX_DUE_LEMMAS)
    .map((card) => `${name(card)} (ret ${card.retrievability.toFixed(2)})`);
  const active = cards
    .sort((left, right) => (right.lastReviewedAt ?? 0) - (left.lastReviewedAt ?? 0))
    .slice(0, MAX_RECENTLY_ACTIVE)
    .map((card) => `${name(card)} (reviews ${card.reviewCount})`);
  const struggling = cards
    .sort((left, right) => {
      const leftScore = left.lapseCount * 10 + left.provisionalEvidence;
      const rightScore = right.lapseCount * 10 + right.provisionalEvidence;
      return rightScore - leftScore;
    })
    .slice(0, MAX_STRUGGLING_LEMMAS)
    .map((card) => `${name(card)} (lapses ${card.lapseCount})`);

  return [
    "LEARNER STATE:",
    `- learnerId: ${learner.learnerId}`,
    `- estimated CEFR: ${learner.estimatedCefrBand}`,
    `- assessment status: ${learner.assessment.status}`,
    `- CEFR confidence: ${learner.assessment.cefrConfidence.toFixed(2)}`,
    `- target/support language: ${context.lang.targetLanguage} / ${context.lang.supportLanguage}`,
    `- session turns: ${learner.currentSession?.turns ?? 0}`,
    `- cards: ${cards.length}`,
    `- top due: ${listOrNone(due)}`,
    `- recently active: ${listOrNone(active)}`,
    `- struggling: ${listOrNone(struggling)}`,
    ...formatCompetencyStandingLines(context)
  ].join("\n");
}

/**
 * What the learner has done with the curriculum.
 *
 * Counts, not verdicts. "met in 4 situations" is a fact; "needs 6 more" would
 * be a judgement about what to teach, and the Teacher makes those against the
 * situation, which is the only place the answer lives.
 *
 * The count is DIVERSE encounters -- distinct (npc, scene, day) slots -- so
 * meeting a competency five times with one NPC in one room counts once. The
 * wording has to say that: "seen 4x" reads as four repetitions and would
 * overstate a learner who has only ever met it in one place.
 *
 * Competencies are named by id because that is the id space the Teacher must
 * answer in -- a display name here and an id in the answer is a translation
 * step nobody asked for.
 */
function formatCompetencyStandingLines(context: TeacherContext): string[] {
  const state = context.learnerProgress;
  // Absent is not the same claim as "has met nothing", so say so.
  if (!state) return ["- competencies met: (unknown)"];

  const met = state.met.map((entry) =>
    entry.encounterCount === 1
      ? `${entry.competencyId} (met in 1 situation)`
      : `${entry.competencyId} (met in ${entry.encounterCount} situations)`
  );
  return [
    `- competencies met: ${listOrNone(met)}`,
    `- competencies not yet met: ${listOrNone([...state.unmetCompetencyIds])}`
  ];
}

export function formatRelationshipState(context: TeacherContext): string {
  const probableFirstMeeting = isProbableFirstMeeting(context);
  return [
    "RELATIONSHIP STATE:",
    `- prior dialogue turns with this NPC in prompt context: ${(context.situation?.recentTurns ?? []).length}`,
    `- relationship state: ${
      probableFirstMeeting ? "probable_first_meeting" : "ongoing_conversation"
    }`,
    `- opening turn: ${probableFirstMeeting ? "yes" : "no"}`,
    `- calibration active: ${context.calibrationActive ? "yes" : "no"}`
  ].join("\n");
}

export function formatSceneSnapshot(context: TeacherContext): string {
  // 090.4: `teachable lemmas` DELETED from this block, found in play.
  //
  // It sorted the scene lexicon by frequency and took six -- which at the top of
  // any frequency list means `el, de, a, para, haber, por`. Six function words,
  // under a heading that told the Teacher they were what to teach, sitting
  // directly above the real affordances. Actively steering, not merely useless.
  //
  // What this scene can teach now lives in the SITUATION block as concept ->
  // lemma pairs. `properNouns` went with `scene` -- it lived on the vocabulary
  // model (SceneVocabularyModel), not on situational content, and this block
  // has no scene door to read it from anymore.
  return [
    "SCENE SNAPSHOT:",
    `- sceneId: ${context.situation?.sceneId ?? UNKNOWN_SECTION}`
  ].join("\n");
}

/**
 * The competencies this curriculum can actually teach, by id.
 *
 * `targetVocab` accepts `{kind: "competency", competencyId}`, so the prompt
 * has to state which ids exist. Without this list the Teacher can only guess
 * an id, and a guess fails as an unknown competency.
 *
 * Read at prompt time from the inventory, deliberately: it is ten entries, it
 * is the same read-time resolution `resolveSceneTeachables` already does above,
 * and it means a curriculum edit shows up without a recompile
 * (competency-tag-resolver.ts:5-6 protects the same property).
 *
 * The BAND is shown because the Teacher already has the learner's band and can
 * therefore judge reach; the DESCRIPTOR is shown because "ask-where" alone does
 * not say what the learner would be able to do.
 */
export function formatAvailableCompetencies(context: TeacherContext): string {
  let competencies: Competency[] = [];
  try {
    competencies = loadCompetencyInventory(context.lang.targetLanguage).competencies;
  } catch {
    // A missing or malformed inventory is not fatal to a teaching decision --
    // the Teacher simply has no competencies to choose from this turn, which is
    // the same state as an empty curriculum and reads identically below.
    competencies = [];
  }

  if (competencies.length === 0) {
    return ["COMPETENCIES THIS CURRICULUM CAN TEACH:", `- ${EMPTY_SECTION}`].join("\n");
  }

  return [
    "COMPETENCIES THIS CURRICULUM CAN TEACH:",
    "These are the ONLY valid competencyId values. Never invent one.",
    ...competencies.map(
      (competency) =>
        `- ${competency.competencyId} (${competency.band}): ${competency.cefrDescriptor}`
    )
  ].join("\n");
}

export function formatNpcContext(context: TeacherContext): string {
  const npc = context.situation?.npc ?? EMPTY_NPC_CONTEXT;
  return [
    "NPC CONTEXT:",
    `- npcDefinitionId: ${npc.npcDefinitionId ?? "(none)"}`,
    `- displayName: ${npc.displayName ?? "(unknown)"}`,
    `- lorePageId: ${npc.lorePageId ?? "(none)"}`,
    `- metadata: ${
      npc.metadata ? JSON.stringify(npc.metadata) : EMPTY_SECTION
    }`
  ].join("\n");
}

export function formatProbeFloorState(context: TeacherContext): string {
  const state = pacingSignals(context).probeFloorState;
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
    `- probe floor: ${formatProbeFloorState(context)}`
  ].join("\n");
}

/**
 * Renders one runtime fact.
 *
 * THE WHOLE POINT IS THAT THESE THREE ARE DIFFERENT STRINGS:
 *
 *   unavailable            "(unknown)"   we could not read it
 *   available, empty       "(none)"      we read it; there is nothing
 *   available, non-empty   the values
 *
 * Collapsing the first two is how the Teacher ends up stating something we never
 * knew -- "the player knows nothing" when the truth is "we could not find out".
 * It teaches from that with full confidence, and no test fails.
 *
 * Implements: Plan 090 story 090.3
 */
function formatRuntimeFact<T>(
  fact: RuntimeFact<T>,
  render: (value: T) => string
): string {
  return fact.available ? render(fact.value) : UNKNOWN_SECTION;
}

/** SITUATION -- the live half of what the Teacher is deciding against. */
/**
 * What this scene actually affords, as CONCEPT -> LEMMA pairs.
 *
 * THIS LINE WAS MISSING AND IT WAS THE WHOLE BUG (found in play, 2026-07-30).
 * The situation block rendered the prose and the runtime facts and silently
 * dropped the concept list -- so a scene whose model held 15 concepts including
 * `cheese` reached the Teacher as a paragraph mentioning "a cheesemaker" and
 * nothing else. The Teacher then could not name `queso`: the hard constraints
 * forbid inventing lemmas, and it had never been shown that `queso` exists.
 *
 * It is not enough to list the concepts in English either. A concept is DEMAND;
 * the Teacher needs the SUPPLY to name it, which is the resolved lemma. So this
 * prints the pair, and a concept the atlas cannot supply is shown as such rather
 * than omitted -- an unteachable concept is information, and silently dropping
 * it is how a slate looks mysteriously short.
 */
function formatTeachableHere(context: TeacherContext): string {
  const situation = context.situation;
  if (!situation || !situation.sceneContext.available) {
    return `- teachable here: ${UNKNOWN_SECTION}`;
  }

  const concepts = situation.sceneContext.value.concepts;
  if (concepts.length === 0) {
    return `- teachable here: ${EMPTY_SECTION}`;
  }

  const { teachables } = resolveSceneTeachables({
    concepts,
    atlas: context.atlas,
    targetLanguage: context.lang.targetLanguage,
    supportLanguage: context.lang.supportLanguage
  });

  const lemmaByConcept = new Map<string, string>();
  for (const teachable of teachables) {
    if (teachable.kind !== "vocabulary") continue;
    for (const label of teachable.concepts) {
      if (!lemmaByConcept.has(label)) lemmaByConcept.set(label, teachable.id);
    }
  }

  const pairs = concepts.map((concept) => {
    const lemmaId = lemmaByConcept.get(concept.label);
    return lemmaId
      ? `${concept.label} -> ${lemmaId}`
      : `${concept.label} -> (no single word)`;
  });

  return `- teachable here: ${pairs.join(", ")}`;
}

export function formatSituation(context: TeacherContext): string {
  const situation = context.situation;
  if (!situation) {
    return ["SITUATION:", `- ${UNKNOWN_SECTION}`].join("\n");
  }

  const runtime = situation.runtime;
  return [
    "SITUATION:",
    `- scene: ${situation.sceneId}`,
    `- about: ${formatRuntimeFact(
      situation.sceneContext,
      (model) => model.prose || EMPTY_SECTION
    )}`,
    formatTeachableHere(context),
    `- current quest node: ${formatRuntimeFact(runtime.questObjectives, (fact) =>
      listOrNone(fact.objectives.map((objective) => objective.displayName))
    )}`,
    `- quest stage: ${formatRuntimeFact(
      runtime.questStage,
      (stage) => stage.stageDisplayName ?? stage.stageId ?? EMPTY_SECTION
    )}`,
    `- time of day: ${formatRuntimeFact(runtime.timeOfDay, (band) => band)}`,
    `- player has learned: ${formatRuntimeFact(runtime.knownFacts, listOrNone)}`,
    `- recently in the world: ${formatRuntimeFact(
      runtime.recentWorldEvents,
      listOrNone
    )}`
  ].join("\n");
}

export function formatRecentDialogue(context: TeacherContext): string {
  const turns = (context.situation?.recentTurns ?? [])
    .slice(-MAX_RECENT_TURNS)
    .map(
      (turn) =>
        `- [${turn.turnId}] ${turn.speaker.toUpperCase()}${
          turn.lang ? ` (${turn.lang})` : ""
        }: ${turn.text}`
    );

  return ["RECENT DIALOGUE:", ...(turns.length > 0 ? turns : ["- (none)"])].join("\n");
}

// 090.4b: `formatPrescription` deleted. The block left the prompt when the
// fence came out; the formatter went with the field.

export function formatPendingProvisional(context: TeacherContext): string {
  const { pendingProvisionalLemmas, probeFloorState } = pacingSignals(context);
  if (pendingProvisionalLemmas.length === 0) {
    return ["PENDING PROVISIONAL EVIDENCE:", "", "No pending provisional evidence."].join(
      "\n"
    );
  }

  const lines = pendingProvisionalLemmas.map((pending) => {
    const cefrBand =
      context.atlas.getBand(
        pending.lemmaRef.lemmaId,
        context.lang.targetLanguage
      ) ?? "unknown";
    return `- ${pending.lemmaRef.lemmaId} (${cefrBand}): ${pending.evidenceAmount} units, pending for ${pending.turnsPending} turns`;
  });

  const floorState = probeFloorState;
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
    `Total pending: ${pendingProvisionalLemmas.length} lemmas, ${floorState.turnsSinceLastProbe} turns since last probe.`,
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

  // 090.4b: was gated on an empty PRESCRIPTION. The hint is still worth giving
  // -- "nothing to teach here" is a legitimate turn -- but it now keys on the
  // situation having no concepts, which is the thing that actually means it.
  if (
    context.situation &&
    context.situation.sceneContext.available &&
    context.situation.sceneContext.value.concepts.length === 0
  ) {
    hints.push(
      "This scene surfaced nothing worth teaching. Do not pad the turn with extra topic content just to teach something."
    );
  }

  if (pacingSignals(context).probeFloorState.hardFloorReached) {
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
    comprehensionGuidanceBlock: DIRECTOR_COMPREHENSION_GUIDANCE_BLOCK,
    pragmaticFeedbackBlock: DIRECTOR_PRAGMATIC_FEEDBACK_BLOCK
  });

  const user = renderDirectorPromptTemplate(DIRECTOR_USER_TEMPLATE, {
    learnerSummary: formatLearnerSummary(context),
    relationshipState: formatRelationshipState(context),
    sceneSnapshot: formatSceneSnapshot(context),
    situation: formatSituation(context),
    availableCompetencies: formatAvailableCompetencies(context),
    npcContext: formatNpcContext(context),
    gameMoment: formatGameMoment(context),
    recentDialogue: formatRecentDialogue(context),
    pendingProvisional: formatPendingProvisional(context),
    turnShapingHints: formatTurnShapingHints(context)
  });

  return {
    system,
    user,
    cacheMarkers: [...DIRECTOR_CACHE_MARKERS]
  };
}
