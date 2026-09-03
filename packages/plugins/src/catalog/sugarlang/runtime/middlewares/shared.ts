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

import { requireSugarlangTargetLanguage } from "../target-language-save-participant";
import type {
  ConversationChoice,
  ConversationExecutionContext,
  ConversationPlayerInput,
  ConversationTurnEnvelope
} from "@sugarmagic/runtime-core";
import { isPlayerSpeaker, resolveDialogueSpeaker } from "@sugarmagic/domain";
import type {
  ActiveQuestEssentialLemma,
  LearnerProfile,
  LemmaObservation,
  LemmaRef,
  PendingProvisional,
  PlacementScoreResult,
  ProbeFloorState,
  SugarlangConstraint
} from "../types";
import type { TeacherNpcContext } from "../situation";
export type { SugarlangLoggerLike } from "../logger";

export interface LearnerSnapshot {
  learnerId: string;
  cefrBand: LearnerProfile["estimatedCefrBand"];
  cefrConfidence: number;
  targetLanguage: string;
  supportLanguage: string;
  currentSessionTurns: number;
  knownLemmaCount: number;
}

export interface StoredComprehensionCheck {
  probeId: string;
  targetLemmas: LemmaRef[];
  probeStyle: "recall" | "recognition" | "production";
  characterVoiceReminder: string;
  regionId: string | null;
  npcId: string | null;
  npcDisplayName: string | null;
  promptedAtMs: number;
  triggerReason: string;
}

// 090.10: SUGARLANG_PRESCRIPTION_ANNOTATION deleted with the budgeter that wrote it.
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
/** 087.1: outer-loop schedule written by context middleware, read by scripted (087.5) and teacher (087.6). */
export const SUGARLANG_LEARNER_PROGRESS_ANNOTATION = "sugarlang.learnerProgress";

export const SUGARLANG_LAST_TURN_COMPREHENSION_CHECK_STATE =
  "sugarlang.lastTurnComprehensionCheck";
export const SUGARLANG_PLACEMENT_PHASE_STATE = "sugarlang.placementPhase";
export const SUGARLANG_TURNS_SINCE_LAST_PROBE_STATE =
  "sugarlang.turnsSinceLastProbe";

export function getRegionId(execution: ConversationExecutionContext): string | null {
  return execution.runtimeContext?.here?.regionId ?? null;
}

export function shouldRunSugarlangForExecution(
  execution: ConversationExecutionContext
): boolean {
  const kind = execution.selection.conversationKind;
  switch (kind) {
    case "scripted-dialogue":
      return true;
    case "free-form":
      return (
        typeof execution.selection.npcDefinitionId === "string" &&
        execution.selection.npcDefinitionId.length > 0
      );
    default: {
      const _exhaustive: never = kind;
      return false;
    }
  }
}

export function isScriptedMode(
  execution: ConversationExecutionContext
): boolean {
  return execution.selection.conversationKind === "scripted-dialogue";
}

export function isPlayerSpokenTurn(
  turn: ConversationTurnEnvelope,
  playerDefinitionId: string | null
): boolean {
  const speakerId = turn.speakerId ?? null;
  if (!speakerId) {
    return false;
  }

  // playerDefinitionId is a RUNTIME-supplied id (the player's own definition),
  // not an authored built-in, so it stays a separate check.
  return (
    speakerId === playerDefinitionId ||
    isPlayerSpeaker(resolveDialogueSpeaker(speakerId, null))
  );
}

export function buildLearnerSnapshot(profile: LearnerProfile): LearnerSnapshot {
  return {
    learnerId: profile.learnerId,
    cefrBand: profile.estimatedCefrBand,
    cefrConfidence: profile.assessment.cefrConfidence,
    targetLanguage: requireSugarlangTargetLanguage(),
    supportLanguage: profile.supportLanguage,
    currentSessionTurns: profile.currentSession?.turns ?? 0,
    knownLemmaCount: Object.keys(profile.lemmaCards).length
  };
}

// 090.4: `computePendingProvisionalLemmas` and `computeProbeFloorState` moved to
// learner/pacing-signals.ts and are re-exported below for existing callers.
// They are learner-derived signals, and living here meant the teacher could not
// derive them without depending on middleware -- so they were computed once and
// carried as data instead, which is what put two non-learner fields on the
// Teacher's learner door.
export {
  computePacingSignals,
  computePendingProvisionalLemmas,
  computeProbeFloorState
} from "../learner";

// 090.10: `buildEmptyPrescription` deleted -- nothing produces a prescription now.

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

/**
 * 090.4: takes just the NPC slice, not a whole TeacherContext -- this was the
 * only reader of npc.metadata/displayName in its caller, so building a full
 * (mostly fake) context to satisfy the old signature was pure overhead.
 */
export function extractCharacterVoiceReminder(
  npc: TeacherNpcContext | undefined
): string {
  if (typeof npc?.metadata?.voice === "string" && npc.metadata.voice.trim()) {
    return npc.metadata.voice.trim();
  }
  if (npc?.displayName) {
    return `Stay in ${npc.displayName}'s voice.`;
  }
  return "Stay in the NPC's established voice.";
}

// 090.2d: `findQuestEssentialUses` DELETED. It regex-matched a rendered line for
// `billete (ticket)` and reported `hasParentheticalGloss` per quest-essential
// lemma -- and it was imported by the verify middleware and never called. So the
// one thing that looked like it enforced inline glossing on quest-critical words
// checked nothing, which is worse than absent: it reads as covered.
//
// Nothing enforces glossing on quest-critical words any more, and that is
// deliberate as of 2026-07-31: the rule in `enforceDirectiveRequirements` that
// rejected "none"/"hover-only" glossing was deleted. It rejected the only value
// the Teacher prompt ever offers, so it forced every quest-essential scene onto
// the deterministic fallback for four months.
//
// HOVER IS THE MECHANISM NOW, and it is also the SIGNAL: a hover becomes a
// hovered-introduce observation, so a player who did not know a word tells us
// so. An inline gloss would have destroyed that evidence.

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
    regionId: string;
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
      regionId: getRegionId(options.execution) ?? "unknown-scene",
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
