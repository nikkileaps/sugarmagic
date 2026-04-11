/**
 * packages/plugins/src/catalog/sugarlang/runtime/middlewares/shared.ts
 *
 * Purpose: Centralizes shared annotation keys, session-state keys, and helper logic for Sugarlang middlewares.
 *
 * Exports:
 *   - annotation/session key constants
 *   - no-op logger helpers
 *   - placement/probe/observation helper functions
 *   - Sugarlang conversation eligibility guard
 *
 * Relationships:
 *   - Depends on runtime-core execution and turn contracts plus sugarlang runtime types.
 *   - Is consumed by all four Sugarlang middlewares to keep annotation handling single-sourced.
 *
 * Implements: Epic 10 middleware annotation discipline
 *
 * Status: active
 */

import type {
  ConversationChoice,
  ConversationExecutionContext,
  ConversationPlayerInput,
  ConversationTurnEnvelope
} from "@sugarmagic/runtime-core";
import { PLAYER_SPEAKER, PLAYER_VO_SPEAKER } from "@sugarmagic/domain";
import type {
  ActiveQuestEssentialLemma,
  TeacherContext,
  LearnerProfile,
  LemmaObservation,
  LemmaRef,
  LexicalPrescription,
  PendingProvisional,
  PlacementScoreResult,
  ProbeFloorState,
  SugarlangConstraint
} from "../types";

export interface SugarlangLoggerLike {
  debug: (message: string, payload?: Record<string, unknown>) => void;
  info: (message: string, payload?: Record<string, unknown>) => void;
  warn: (message: string, payload?: Record<string, unknown>) => void;
  error: (message: string, payload?: Record<string, unknown>) => void;
}

export interface LearnerSnapshot {
  learnerId: string;
  cefrBand: LearnerProfile["estimatedCefrBand"];
  cefrConfidence: number;
  targetLanguage: string;
  supportLanguage: string;
  currentSessionTurns: number;
  knownLemmaCount: number;
}

export interface PlacementFlowAnnotation {
  phase: "opening-dialog" | "questionnaire" | "closing-dialog" | "not-active";
  minAnswersForValid?: number;
  questionnaireVersion?: string;
  scoreResult?: PlacementScoreResult;
}

export interface StoredComprehensionCheck {
  probeId: string;
  targetLemmas: LemmaRef[];
  probeStyle: "recall" | "recognition" | "production";
  characterVoiceReminder: string;
  sceneId: string | null;
  npcId: string | null;
  npcDisplayName: string | null;
  promptedAtMs: number;
  triggerReason: string;
}

export const SUGARLANG_PRESCRIPTION_ANNOTATION = "sugarlang.prescription";
export const SUGARLANG_LEARNER_SNAPSHOT_ANNOTATION = "sugarlang.learnerSnapshot";
export const SUGARLANG_PENDING_PROVISIONAL_ANNOTATION =
  "sugarlang.pendingProvisionalLemmas";
export const SUGARLANG_PROBE_FLOOR_ANNOTATION = "sugarlang.probeFloorState";
export const SUGARLANG_FORCE_COMPREHENSION_CHECK_ANNOTATION =
  "sugarlang.forceComprehensionCheck";
export const SUGARLANG_ACTIVE_QUEST_ESSENTIAL_ANNOTATION =
  "sugarlang.activeQuestEssentialLemmas";
export const SUGARLANG_QUEST_ESSENTIAL_IDS_ANNOTATION =
  "sugarlang.questEssentialLemmaIds";
export const SUGARLANG_PLACEMENT_FLOW_ANNOTATION = "sugarlang.placementFlow";
export const SUGARLANG_PREPLACEMENT_LINE_ANNOTATION =
  "sugarlang.prePlacementOpeningLine";
export const SUGARLANG_CONSTRAINT_ANNOTATION = "sugarlang.constraint";
export const SUGARLANG_DIRECTIVE_ANNOTATION = "sugarlang.directive";
export const SUGARLANG_COMPREHENSION_IN_FLIGHT_ANNOTATION =
  "sugarlang.comprehensionCheckInFlight";
export const SUGARLANG_COMPREHENSION_PROBE_ID_ANNOTATION =
  "sugarlang.comprehensionProbeId";
export const SUGARLANG_CHOICE_LEMMA_ANNOTATION = "sugarlang.choiceLemma";
export const SUGARLANG_HOVER_LEMMA_ANNOTATION = "sugarlang.hoverLemma";
export const SUGARLANG_COMPLETED_OBJECTIVE_IDS_ANNOTATION =
  "sugarlang.completedObjectiveNodeIds";

export const SUGARLANG_LAST_TURN_COMPREHENSION_CHECK_STATE =
  "sugarlang.lastTurnComprehensionCheck";
export const SUGARLANG_PLACEMENT_PHASE_STATE = "sugarlang.placementPhase";
export const SUGARLANG_TURNS_SINCE_LAST_PROBE_STATE =
  "sugarlang.turnsSinceLastProbe";

const NO_OP_LOGGER: SugarlangLoggerLike = {
  debug() {
    return undefined;
  },
  info() {
    return undefined;
  },
  warn() {
    return undefined;
  },
  error() {
    return undefined;
  }
};

export function createNoOpSugarlangLogger(): SugarlangLoggerLike {
  return NO_OP_LOGGER;
}

export function getSceneId(execution: ConversationExecutionContext): string | null {
  return execution.runtimeContext?.here?.sceneId ?? null;
}

export function shouldRunSugarlangForExecution(
  execution: ConversationExecutionContext
): boolean {
  return execution.selection.interactionMode === "agent";
}

export function isPlayerSpokenTurn(
  turn: ConversationTurnEnvelope,
  playerDefinitionId: string | null
): boolean {
  const speakerId = turn.speakerId ?? null;
  if (!speakerId) {
    return false;
  }

  return (
    speakerId === playerDefinitionId ||
    speakerId === PLAYER_SPEAKER.speakerId ||
    speakerId === PLAYER_VO_SPEAKER.speakerId
  );
}

export function buildLearnerSnapshot(profile: LearnerProfile): LearnerSnapshot {
  return {
    learnerId: profile.learnerId,
    cefrBand: profile.estimatedCefrBand,
    cefrConfidence: profile.assessment.cefrConfidence,
    targetLanguage: profile.targetLanguage,
    supportLanguage: profile.supportLanguage,
    currentSessionTurns: profile.currentSession?.turns ?? 0,
    knownLemmaCount: Object.keys(profile.lemmaCards).length
  };
}

export function computePendingProvisionalLemmas(
  learner: LearnerProfile
): PendingProvisional[] {
  const currentTurn = learner.currentSession?.turns ?? 0;
  return Object.values(learner.lemmaCards)
    .filter((card) => card.provisionalEvidence > 0)
    .map((card) => ({
      lemmaRef: {
        lemmaId: card.lemmaId,
        lang: learner.targetLanguage
      },
      evidenceAmount: card.provisionalEvidence,
      turnsPending:
        card.provisionalEvidenceFirstSeenTurn === null
          ? 0
          : Math.max(0, currentTurn - card.provisionalEvidenceFirstSeenTurn)
    }))
    .sort((left, right) => {
      if (left.turnsPending !== right.turnsPending) {
        return right.turnsPending - left.turnsPending;
      }
      return left.lemmaRef.lemmaId.localeCompare(right.lemmaRef.lemmaId);
    });
}

export function computeProbeFloorState(
  pending: PendingProvisional[],
  turnsSinceLastProbe: number
): ProbeFloorState {
  const oldestPending = pending[0]?.turnsPending ?? 0;
  const hardFloorReached =
    turnsSinceLastProbe >= 25 || oldestPending >= 25;
  const hardFloorReason =
    turnsSinceLastProbe >= 25
      ? "turns-since-probe"
      : oldestPending >= 25
        ? "lemma-age"
        : undefined;

  return {
    turnsSinceLastProbe,
    totalPendingLemmas: pending.length,
    softFloorReached: turnsSinceLastProbe >= 15 && pending.length >= 5,
    hardFloorReached,
    ...(hardFloorReason ? { hardFloorReason } : {})
  };
}

export function buildEmptyPrescription(summary: string): LexicalPrescription {
  return {
    introduce: [],
    reinforce: [],
    avoid: [],
    budget: {
      newItemsAllowed: 0
    },
    rationale: {
      summary,
      candidateSetSize: 0,
      envelopeSurvivorCount: 0,
      priorityScores: [],
      reasons: []
    }
  };
}

export function getTurnsSinceLastProbe(execution: ConversationExecutionContext): number {
  const value = execution.state[SUGARLANG_TURNS_SINCE_LAST_PROBE_STATE];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function setTurnsSinceLastProbe(
  execution: ConversationExecutionContext,
  turns: number
): void {
  execution.state[SUGARLANG_TURNS_SINCE_LAST_PROBE_STATE] = turns;
}

export function getStoredComprehensionCheck(
  execution: ConversationExecutionContext
): StoredComprehensionCheck | null {
  const value = execution.state[SUGARLANG_LAST_TURN_COMPREHENSION_CHECK_STATE];
  if (
    typeof value !== "object" ||
    value === null ||
    !Array.isArray((value as StoredComprehensionCheck).targetLemmas)
  ) {
    return null;
  }
  return value as StoredComprehensionCheck;
}

export function setStoredComprehensionCheck(
  execution: ConversationExecutionContext,
  value: StoredComprehensionCheck | null
): void {
  if (value === null) {
    delete execution.state[SUGARLANG_LAST_TURN_COMPREHENSION_CHECK_STATE];
    return;
  }
  execution.state[SUGARLANG_LAST_TURN_COMPREHENSION_CHECK_STATE] = value;
}

export function extractCharacterVoiceReminder(
  context: TeacherContext
): string {
  if (typeof context.npc.metadata?.voice === "string" && context.npc.metadata.voice.trim()) {
    return context.npc.metadata.voice.trim();
  }
  if (context.npc.displayName) {
    return `Stay in ${context.npc.displayName}'s voice.`;
  }
  return "Stay in the NPC's established voice.";
}

export function findQuestEssentialUses(
  text: string,
  constraint: SugarlangConstraint
): Array<{
  lemmaId: string;
  supportLanguageGloss: string;
  hasParentheticalGloss: boolean;
}> {
  const normalized = text.normalize("NFC");
  return (constraint.questEssentialLemmas ?? []).map((entry) => {
    const pattern = new RegExp(
      `\\b${escapeRegExp(entry.lemmaRef.lemmaId)}\\b\\s*\\([^)]*${escapeRegExp(
        entry.supportLanguageGloss
      )}[^)]*\\)`,
      "i"
    );
    return {
      lemmaId: entry.lemmaRef.lemmaId,
      supportLanguageGloss: entry.supportLanguageGloss,
      hasParentheticalGloss: pattern.test(normalized)
    };
  });
}

function normalizeQuestFocusText(text: string): string {
  return text.normalize("NFC").toLocaleLowerCase();
}

type QuestFocusEntry = {
  lemmaRef: LemmaRef;
  supportLanguageGloss: string;
  sourceObjectiveDisplayName: string;
};

export function isQuestObjectiveInFocus(
  execution: ConversationExecutionContext,
  questEssentials: QuestFocusEntry[]
): boolean {
  if (
    questEssentials.length === 0 ||
    (execution.runtimeContext?.activeQuestObjectives?.objectives.length ?? 0) === 0
  ) {
    return false;
  }

  if (execution.input?.kind !== "free_text" || typeof execution.input.text !== "string") {
    return false;
  }

  const haystack = normalizeQuestFocusText(execution.input.text);
  if (!haystack) {
    return false;
  }

  const candidates = new Set<string>();
  for (const entry of questEssentials) {
    candidates.add(normalizeQuestFocusText(entry.lemmaRef.lemmaId));
    candidates.add(normalizeQuestFocusText(entry.supportLanguageGloss));
    candidates.add(normalizeQuestFocusText(entry.sourceObjectiveDisplayName));
  }

  for (const candidate of candidates) {
    if (!candidate || candidate.length < 3) {
      continue;
    }
    if (haystack.includes(candidate)) {
      return true;
    }
  }

  return false;
}

export function textMentionsLemma(text: string, lemmaId: string): boolean {
  return new RegExp(`\\b${escapeRegExp(lemmaId)}\\b`, "i").test(text.normalize("NFC"));
}

export function getChoiceLemmaRef(
  input: ConversationPlayerInput | null,
  choices: ConversationChoice[] | undefined,
  execution: ConversationExecutionContext
): LemmaRef | null {
  if (input?.kind !== "choice") {
    return null;
  }

  const annotated = execution.annotations[SUGARLANG_CHOICE_LEMMA_ANNOTATION];
  if (
    typeof annotated === "object" &&
    annotated !== null &&
    typeof (annotated as LemmaRef).lemmaId === "string" &&
    typeof (annotated as LemmaRef).lang === "string"
  ) {
    return annotated as LemmaRef;
  }

  const selectedChoice = choices?.find((choice) => choice.choiceId === input.choiceId);
  const metadata = selectedChoice?.metadata;
  if (
    metadata &&
    typeof metadata.lemmaId === "string" &&
    typeof metadata.lang === "string"
  ) {
    return {
      lemmaId: metadata.lemmaId,
      lang: metadata.lang
    };
  }

  return null;
}

export function getHoverLemma(
  execution: ConversationExecutionContext
): { lemma: LemmaRef; dwellMs?: number } | null {
  const value = execution.annotations[SUGARLANG_HOVER_LEMMA_ANNOTATION];
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.lemmaId !== "string" || typeof record.lang !== "string") {
    return null;
  }
  return {
    lemma: {
      lemmaId: record.lemmaId,
      lang: record.lang
    },
    dwellMs:
      typeof record.dwellMs === "number" && Number.isFinite(record.dwellMs)
        ? record.dwellMs
        : undefined
  };
}

export function createObservationEvent(options: {
  lemma: LemmaRef;
  execution: ConversationExecutionContext;
  observation: LemmaObservation;
}): {
  lemma: LemmaRef;
  context: {
    sessionId: string;
    turnId: string;
    sceneId: string;
    lang: string;
    conversationId: string;
  };
  observation: LemmaObservation;
} {
  const turnId =
    options.execution.input?.kind === "choice"
      ? `turn:${options.execution.input.choiceId}`
      : options.execution.input?.kind === "free_text"
        ? `turn:${options.execution.input.text.slice(0, 16)}`
        : "turn:opening";
  return {
    lemma: options.lemma,
    context: {
      sessionId: getSugarAgentSessionId(options.execution),
      turnId,
      sceneId: getSceneId(options.execution) ?? "unknown-scene",
      lang: options.lemma.lang,
      conversationId:
        options.execution.selection.npcDefinitionId ??
        options.execution.selection.dialogueDefinitionId ??
        "conversation"
    },
    observation: options.observation
  };
}

export function getSugarAgentSessionId(execution: ConversationExecutionContext): string {
  const state = execution.state["sugaragent.session"];
  if (
    typeof state === "object" &&
    state !== null &&
    typeof (state as { sessionId?: unknown }).sessionId === "string"
  ) {
    return (state as { sessionId: string }).sessionId;
  }
  return "sugarlang-session";
}

export function getSugarAgentTurnCount(execution: ConversationExecutionContext): number {
  const state = execution.state["sugaragent.session"];
  if (
    typeof state === "object" &&
    state !== null &&
    typeof (state as { turnCount?: unknown }).turnCount === "number"
  ) {
    return (state as { turnCount: number }).turnCount;
  }
  return 0;
}

export function getSugarlangTelemetryTurnId(
  execution: ConversationExecutionContext,
  phase: "prepare" | "finalize" = "finalize"
): string {
  const sessionId = getSugarAgentSessionId(execution);
  const turnCount = getSugarAgentTurnCount(execution);
  const ordinal = phase === "prepare" ? turnCount + 1 : Math.max(1, turnCount);
  return `sugarlang:${sessionId}:turn:${ordinal}`;
}

export function getSugarlangConversationId(
  execution: ConversationExecutionContext
): string {
  return (
    execution.selection.npcDefinitionId ??
    execution.selection.dialogueDefinitionId ??
    "conversation"
  );
}

export function normalizeTurn(
  turn: ConversationTurnEnvelope | null
): ConversationTurnEnvelope | null {
  if (!turn) {
    return null;
  }
  if (!turn.annotations) {
    turn.annotations = {};
  }
  if (!turn.diagnostics) {
    turn.diagnostics = {};
  }
  return turn;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
