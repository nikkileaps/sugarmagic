/**
 * packages/plugins/src/catalog/sugarlang/runtime/telemetry/telemetry.ts
 *
 * Purpose: Defines sugarlang's telemetry event schema and the sink its
 *   services emit through.
 *
 * Exports:
 *   - Telemetry event/query types
 *   - Telemetry sink interfaces and helpers
 *   - TELEMETRY_DB_NAME
 *   - MemoryTelemetrySink
 *   - NoOpTelemetrySink
 *   - HostTelemetrySink
 *
 * Relationships:
 *   - Is the single telemetry contract consumed by middlewares, Teacher, and learner-state.
 *   - Delivery only. Reading happens where the gateway writes: `docker compose
 *     logs` locally, Cloud Logging in production.
 *
 * Implements: Proposal 001 §v2 Training Path / §Verification, Failure Modes, and Guardrails
 *
 * Status: active
 *
 * WHERE EVENTS GO
 *
 *   Delivery is not sugarlang's job. `HostTelemetrySink` forwards to the
 *   host's `TelemetryCollector` (runtime-core), which batches and POSTs to the
 *   gateway; the gateway writes each event as one JSON line to stdout. Cloud
 *   Run collects that into Cloud Logging; locally the same line shows up in
 *   `docker compose logs`. Sugaragent's events take the same path, which is
 *   why the collector lives in core rather than here.
 *
 *   Aggregating them -- sessions per week, turns per session, probe pass rate --
 *   needs a log sink into BigQuery, which is configuration on the Cloud Run
 *   project rather than code here. Every event already carries sessionId,
 *   conversationId, turnId and a timestamp to join on.
 */

import type {
  CEFRBand,
  EnvelopeVerdict,
  LearnerProfile,
  LemmaRef,
  ObservationEvent,
  PedagogicalDirective,
  PlacementScoreResult,
  ProbeFloorState,
  SugarlangConstraint
} from "../types";
import type { LearnerSnapshot } from "../middlewares/shared";
import {
  TELEMETRY_SCHEMA_VERSION,
  type TelemetryEventBase as SharedTelemetryEventBase
} from "@sugarmagic/runtime-core";

/**
 * The schema version every event carries. Core owns the number so sugarlang's
 * events and sugaragent's cannot end up claiming different versions of the
 * same envelope; this alias is kept because sugarlang's own event union refers
 * to it throughout.
 */
export const SUGARLANG_TELEMETRY_SCHEMA_VERSION = TELEMETRY_SCHEMA_VERSION;

/**
 * The IndexedDB database telemetry used to be written to. Nothing writes it
 * now -- events go to the gateway -- but the learner-data reset
 * (learner/reset-learner-data.ts) still deletes it, so a player who authored
 * or played before this change does not keep the orphaned store forever.
 * Do not hard-code the literal anywhere else.
 */
export const TELEMETRY_DB_NAME = "sugarlang-telemetry";

let telemetryEventCounter = 0;

export interface TelemetryTimeRange {
  startMs?: number;
  endMs?: number;
}

export interface TelemetryLearnerDelta {
  updatedLemmaIds?: string[];
  committedLemmaIds?: string[];
  discardedLemmaIds?: string[];
  decayedLemmaIds?: string[];
  changedAssessment?: boolean;
  notes?: string[];
}

export interface QuestEssentialTelemetryState {
  activeQuestEssentialLemmas: Array<{
    lemmaRef: LemmaRef;
    sourceObjectiveNodeId?: string;
    sourceObjectiveDisplayName: string;
    sourceQuestId?: string;
    cefrBand?: CEFRBand;
    supportLanguageGloss?: string;
  }>;
}

export interface ProbeLifecycleOutcome {
  passedLemmaIds: string[];
  failedLemmaIds: string[];
  classifierReasoning: string;
  detectedLang?: string | null;
}

/**
 * The shared envelope, re-exported under the name sugarlang's event union
 * already uses. Declared in packages/runtime-core/src/telemetry -- one
 * envelope, so a field added for one producer is available to the other and
 * neither can drift.
 */
export type TelemetryEventBase = SharedTelemetryEventBase;

type TelemetryEventOf<TKind extends string, TPayload> = TelemetryEventBase & {
  kind: TKind;
} & TPayload;

export type TelemetryEvent =
  // 090.5: `budgeter.prescription-generated` deleted. 090.10 removed the only
  // emitter; the event type outlived it, so the debug surfaces still declared a
  // shape nothing could ever produce.
  | TelemetryEventOf<
      "teacher.invocation-started",
      {
        regionId: string;
        npcId: string | null;
        npcDisplayName: string | null;
        teacherContext: Record<string, unknown>;
        cacheHit: boolean;
        model?: string | null;
        cacheMarkers?: string[];
        pendingProvisionalSnapshot?: Array<{
          lemmaRef: LemmaRef;
          evidenceAmount: number;
          turnsPending: number;
        }>;
        probeFloorState?: ProbeFloorState;
      }
    >
  | TelemetryEventOf<
      "teacher.invocation-completed",
      {
        regionId?: string;
        npcId?: string | null;
        npcDisplayName?: string | null;
        directive: PedagogicalDirective;
        cacheHit: boolean;
        fallback: boolean;
        latencyMs: number;
        /**
         * Due items the Teacher was shown this turn and did not choose.
         * Counting an id across turns turns "due for three weeks" into "due
         * for three weeks and passed over forty times", which is the fact
         * that decides whether the stranded pile needs tuning.
         */
        dueItemsPassedOver?: string[];
        tokenCost?: {
          inputTokens: number;
          outputTokens: number;
          cacheReadInputTokens?: number | null;
          cacheCreationInputTokens?: number | null;
        };
        model?: string | null;
        requestId?: string | null;
        parseMode?: "validated" | "repaired" | "cached" | "fallback";
      }
    >
  | TelemetryEventOf<
      "teacher.invocation-failed",
      {
        regionId?: string;
        npcId?: string | null;
        npcDisplayName?: string | null;
        model?: string | null;
        latencyMs: number;
        reason: string;
      }
    >
  | TelemetryEventOf<
      /**
       * What the directive cache did on this turn. ONE event, three outcomes,
       * emitted once wherever the Teacher is consulted for a real turn.
       *
       * The questions it answers:
       *   working    -- rate of `hit` where firstTurnOfConversation is true
       *   regressed  -- any sustained rate of `blocking-miss`, the outcome the
       *                 cache exists to prevent
       *   what moved -- group by movedSegments when the world went stale
       */
      "directive-cache.decision",
      {
        outcome: "hit" | "stale-served" | "blocking-miss";
        /** Null on a hit. Which axis retired the entry otherwise. */
        staleness:
          | "situation_change"
          | "learner_change"
          | "max_turns_exceeded"
          | null;
        /**
         * SEGMENT NAMES ONLY -- ["nodes"], ["quest","time"] -- never values.
         * Every segment but `time` is a uuid or a hash, so values would give
         * this field one distinct value per player and nothing could be
         * grouped by it.
         */
        movedSegments: string[];
        /**
         * The turn the cache is measured on. Every later turn in a
         * conversation hits anyway, so a fleet-wide hit rate that does not
         * separate these says nothing.
         */
        firstTurnOfConversation: boolean;
        /** What the turn actually waited: ~0 served, seconds when blocking. */
        teacherMs: number;
        regionId?: string;
        npcId?: string | null;
        npcDisplayName?: string | null;
        fallback: boolean;
      }
    >
  | TelemetryEventOf<
      "teacher.invocation-resolved",
      {
        regionId?: string;
        npcId?: string | null;
        npcDisplayName?: string | null;
        outcome: "claude" | "fallback" | "cache";
        fallback: boolean;
        calibrationActive: boolean;
      }
    >
  | TelemetryEventOf<
      "classifier.verdict",
      {
        regionId: string | null;
        learnerSnapshot: LearnerSnapshot;
        verdict: EnvelopeVerdict;
        inputText: string;
        constraint?: SugarlangConstraint;
      }
    >
  | TelemetryEventOf<
      "chunk.extraction-started",
      {
        regionId: string;
        contentHash: string;
        lang: string;
        extractorPurpose: string;
        extractorPromptVersion: string;
      }
    >
  | TelemetryEventOf<
      "chunk.extraction-completed",
      {
        regionId: string;
        contentHash: string;
        lang: string;
        chunkCount: number;
        latencyMs: number;
        tokenCost: {
          input: number;
          output: number;
        };
        extractorPurpose: string;
      }
    >
  | TelemetryEventOf<
      "chunk.extraction-failed",
      {
        regionId: string;
        contentHash: string;
        lang: string;
        error: {
          code: string;
          message: string;
        };
        extractorPurpose: string;
      }
    >
  | TelemetryEventOf<
      "chunk.extraction-drift-detected",
      {
        regionId: string;
        contentHash: string;
        previousChunkCount: number;
        newChunkCount: number;
        previousExtractorModel: string;
        newExtractorModel: string;
        changedChunks: string[];
      }
    >
  // Plan 090.1 -- the scene-context pass: what authored content is ABOUT.
  // Keyed on supportLanguage, not target: concepts are English, so the same
  // scene shares one extraction across every target language.
  | TelemetryEventOf<
      "scene-context.extraction-started",
      {
        regionId: string;
        contentHash: string;
        supportLanguage: string;
        sourceCount: number;
        extractorPurpose: string;
        extractorPromptVersion: string;
      }
    >
  | TelemetryEventOf<
      "scene-context.extraction-completed",
      {
        regionId: string;
        contentHash: string;
        supportLanguage: string;
        conceptCount: number;
        /**
         * Concepts discarded because every sourceId they cited was one we never
         * sent -- i.e. the model invented its provenance. Non-zero is a prompt
         * or model problem, not a content problem, so it is counted separately
         * from conceptCount rather than being silently absent.
         */
        droppedForBadProvenance: number;
        latencyMs: number;
        tokenCost: {
          input: number;
          output: number;
        };
      }
    >
  | TelemetryEventOf<
      "scene-context.extraction-failed",
      {
        regionId: string;
        contentHash: string;
        supportLanguage: string;
        error: {
          code: string;
          message: string;
        };
      }
    >
  // Plan 090.1 -- line intent. Its own events rather than borrowing
  // `chunk.extraction-*`, which it did until now: three unrelated passes sharing
  // one event name made per-pass cost and failure rates unreadable.
  | TelemetryEventOf<
      "line-intent.extraction-started",
      {
        nodeId: string;
        dialogueDefinitionId: string;
        contentHash: string;
        extractorPurpose: string;
        extractorPromptVersion: string;
      }
    >
  | TelemetryEventOf<
      "line-intent.extraction-completed",
      {
        nodeId: string;
        dialogueDefinitionId: string;
        contentHash: string;
        factCount: number;
        latencyMs: number;
        tokenCost: {
          input: number;
          output: number;
        };
      }
    >
  | TelemetryEventOf<
      "line-intent.extraction-failed",
      {
        nodeId: string;
        dialogueDefinitionId: string;
        contentHash: string;
        error: {
          code: string;
          message: string;
        };
      }
    >
  | TelemetryEventOf<
      "chunk.hit-during-classification",
      {
        regionId: string;
        matchedChunks: Array<{
          chunkId: string;
          cefrBand: CEFRBand;
          surfaceMatched: string;
        }>;
      }
    >
  | TelemetryEventOf<
      "chunk.extraction-stale-discarded",
      {
        regionId: string;
        contentHash: string;
        reason: string;
      }
    >
  | TelemetryEventOf<
      "observe.observations-applied",
      {
        regionId: string;
        observations: ObservationEvent[];
        learnerDelta: TelemetryLearnerDelta;
      }
    >
  | TelemetryEventOf<
      "placement.completed",
      {
        finalBand: CEFRBand;
        confidence: number;
        turnCount: number;
        questionnaireVersion: string;
        result: PlacementScoreResult;
      }
    >
  | TelemetryEventOf<
      "session.started",
      {
        learnerId: string;
      }
    >
  | TelemetryEventOf<
      "session.ended",
      {
        learnerId: string;
        completedAtMs: number;
      }
    >
  | TelemetryEventOf<
      "pre-placement.opening-dialog-turn",
      {
        phase: "opening-dialog";
        lineId: string;
        npcDefinitionId: string | null;
      }
    >
  | TelemetryEventOf<
      "teacher.pre-placement-bypass",
      {
        regionId?: string | null;
        lineId: string;
      }
    >
  | TelemetryEventOf<
      "verify.pre-placement-bypass",
      {
        regionId?: string | null;
      }
    >
  | TelemetryEventOf<
      "verify.drift-sample",
      {
        regionId: string | null;
        /** Ordinal turn index within the conversation (0-based). */
        turnIndex: number;
        measuredRatio: number;
        directedRatio: number;
        ratioConformance: string;
        withinEnvelope: boolean;
        voiceRetentionScore: number;
        /** Canned/fallback turn: exclude from quality distributions. */
        deterministic: boolean;
      }
    >
  | TelemetryEventOf<
      "verify.ratio-verdict",
      {
        regionId: string | null;
        measuredRatio: number;
        directedRatio: number;
        posture: string;
        conformance: string;
        denominator: number;
        /** True when the scene was unavailable; proper-noun exclusion degraded. */
        degradedExclusion: boolean;
      }
    >
  | TelemetryEventOf<
      "observer.pre-placement-bypass",
      {
        regionId?: string | null;
      }
    >
  | TelemetryEventOf<
      "observer.placement-questionnaire-bypass",
      {
        regionId?: string | null;
      }
    >
  | TelemetryEventOf<
      "comprehension.probe-triggered",
      {
        probeId: string;
        regionId: string;
        npcId: string | null;
        npcDisplayName: string | null;
        targetLemmas: LemmaRef[];
        probeStyle: "recall" | "recognition" | "production";
        triggerReason: string;
        characterVoiceReminder: string;
        currentPendingProvisionalCount: number;
        turnsSinceLastProbe: number;
      }
    >
  | TelemetryEventOf<
      "comprehension.probe-fired",
      {
        probeId: string;
        regionId: string;
        npcId: string | null;
        npcDisplayName: string | null;
        targetLemmas: LemmaRef[];
        generatedText: string;
        probeQuestionExtract: string | null;
      }
    >
  | TelemetryEventOf<
      "comprehension.probe-response-received",
      {
        probeId: string;
        regionId: string;
        npcId: string | null;
        npcDisplayName: string | null;
        targetLemmas: LemmaRef[];
        playerResponseText: string;
        responseLatencyMs: number;
        responseInputKind: "free_text";
      }
    >
  | TelemetryEventOf<
      "comprehension.probe-passed",
      {
        probeId: string;
        regionId: string;
        npcId: string | null;
        npcDisplayName: string | null;
        targetLemmas: LemmaRef[];
        playerResponseText: string;
        lemmasPassed: string[];
        classifierReasoning: string;
        predictedRetrievabilities?: Record<string, number>;
      }
    >
  | TelemetryEventOf<
      "comprehension.probe-failed",
      {
        probeId: string;
        regionId: string;
        npcId: string | null;
        npcDisplayName: string | null;
        targetLemmas: LemmaRef[];
        playerResponseText: string;
        lemmasFailed: string[];
        classifierReasoning: string;
        predictedRetrievabilities?: Record<string, number>;
      }
    >
  | TelemetryEventOf<
      "comprehension.probe-mixed-result",
      {
        probeId: string;
        regionId: string;
        npcId: string | null;
        npcDisplayName: string | null;
        targetLemmas: LemmaRef[];
        playerResponseText: string;
        lemmasPassed: string[];
        lemmasFailed: string[];
        classifierReasoning: string;
        predictedRetrievabilities?: Record<string, number>;
      }
    >
  | TelemetryEventOf<
      "comprehension.probe-language-fallback",
      {
        probeId: string;
        regionId: string;
        npcId: string | null;
        npcDisplayName: string | null;
        targetLemmas: LemmaRef[];
        playerResponseText: string;
        detectedLang: string;
      }
    >
  | TelemetryEventOf<
      "comprehension.teacher-hard-floor-violated",
      {
        regionId?: string;
        teacherModel?: string | null;
        hardFloorReason?: string | null;
      }
    >
  | TelemetryEventOf<
      "fsrs.seeded-from-placement",
      {
        lemmaId: string;
        cefrBand: CEFRBand;
        completedAtMs: number;
      }
    >
  | TelemetryEventOf<
      "fsrs.provisional-evidence-accumulated",
      {
        lemmaId: string;
        previousEvidence: number;
        newEvidence: number;
        dwellMs: number;
        sessionTurn?: number;
      }
    >
  | TelemetryEventOf<
      "fsrs.provisional-evidence-committed",
      {
        probeId?: string | null;
        lemmaId: string;
        committedAmount: number;
        previousStability: number;
        newStability: number;
      }
    >
  | TelemetryEventOf<
      "fsrs.provisional-evidence-discarded",
      {
        probeId?: string | null;
        lemmaId: string;
        discardedAmount: number;
      }
    >
  | TelemetryEventOf<
      "fsrs.provisional-evidence-decayed",
      {
        lemmaId: string;
        decayedAmount?: number;
        turnsPending?: number;
      }
    >
  | TelemetryEventOf<
      "learner-profile.updated",
      {
        learnerId: string;
        eventType: string;
      }
    >
  | TelemetryEventOf<
      "quest-essential.classifier-exempted-lemma",
      {
        regionId: string;
        lemmaRef: LemmaRef;
        cefrBand: CEFRBand | "unknown";
        learnerBand: CEFRBand;
        sourceObjectiveNodeId?: string;
        sourceObjectiveDisplayName?: string;
      }
    >
  | TelemetryEventOf<
      "quest-essential.teacher-targetvocab-contamination",
      {
        regionId?: string;
        contaminatedLemmas: string[];
        contaminationSite?: "introduce" | "reinforce" | "avoid";
      }
    >
  | TelemetryEventOf<
      "quest-essential.generator-missed-gloss",
      {
        regionId: string;
        lemmaRef: LemmaRef;
        expectedGloss: string;
        generatedText: string;
        sourceObjectiveDisplayName?: string;
        sourceObjectiveNodeId?: string;
      }
    >
  | TelemetryEventOf<
      "quest-essential.generator-missed-required",
      {
        regionId: string;
        expectedLemmas: LemmaRef[];
        generatedText: string;
        sourceObjectiveDisplayName: string;
        sourceObjectiveNodeId?: string;
      }
    >
  | TelemetryEventOf<
      "quest-essential.compile-diagnostic-deadlock-prone",
      {
        regionId: string;
        sourceObjectiveNodeId: string;
        sourceObjectiveDisplayName: string;
        highBandLemmas: string[];
        suggestion: string;
      }
    >
  | TelemetryEventOf<
      "calibration.window-closed",
      {
        closeReason: "confidence" | "turn-backstop";
        placementBand: string;
        settledBand: string;
        bandDelta: number;
        settledConfidence: number;
        sessionTurn: number;
      }
    >
  | TelemetryEventOf<
      "learner.progress-derived",
      {
        regionId: string | null;
        isColdStart: boolean;
        learnerBand: string;
        /** Competencies the learner has been taught. */
        metCompetencyCount: number;
        /** Competencies in the inventory they have not. */
        unmetCompetencyCount: number;
        /** Cards below the due floor, including competency cards. */
        dueItemCount: number;
        /**
         * Due cards split by what they are. A conversation contains far more
         * words than competencies, so this pool skews toward words as a
         * learner plays -- which is what decides whether competencies are
         * being squeezed out of the shared top-N lists in the prompt.
         */
        dueCompetencyCount: number;
        dueWordCount: number;
        /**
         * Due cards for a band BELOW the learner's own. A baseline for the
         * band window (222.14): once the Teacher only sees its current band,
         * these are the items it can no longer reach to reinforce.
         */
        dueBelowLearnerBandCount: number;
        /**
         * The most-overdue items, longest first, with how many days each has
         * been past the due floor. Derived from stability and elapsed time,
         * not stored.
         *
         * This is what answers "these six have been due for three weeks and
         * were never chosen" -- a count alone shows a pile growing without
         * saying what is stuck. Capped, with the total beside it so the cap is
         * never mistaken for the whole.
         */
        mostOverdue: Array<{
          itemId: string;
          daysOverdue: number;
          isCompetency: boolean;
        }>;
        mostOverdueCap: number;
        /** True when the world-day axis was unavailable and diversity degrades to npc x scene. */
        dayAxisDegraded: boolean;
      }
    >
  | TelemetryEventOf<
      "debt.created",
      {
        itemId: string;
        itemKind: "vocabulary" | "competency";
        createdDayIndex: number | null;
        targetEncounters: number;
      }
    >
  | TelemetryEventOf<
      "debt.encounter",
      {
        itemId: string;
        itemKind: "vocabulary" | "competency";
        npcDefinitionId: string | null;
        regionId: string | null;
        dayIndex: number | null;
        diverseEncounterCountAfter: number;
        targetEncounters: number;
        /** True when diverseEncounterCountAfter >= targetEncounters. */
        debtPaid: boolean;
      }
    >
  /**
   * The learner's storage was built at boot, before the sync loop's first
   * pass. Emitted whether or not anything will sync it.
   */
  | TelemetryEventOf<
      "learner-storage.opened",
      {
        targetLanguage: string;
        supportLanguage: string;
        /** What was built. Short of two means one of them failed. */
        storeIds: string[];
        /**
         * Whether a sync loop exists to reconcile them. False in Studio
         * Preview, which deliberately syncs with nothing, and in any project
         * with no account backend.
         */
        syncLoopRunning: boolean;
      }
    >
  /**
   * The first reconcile attempt for that storage finished -- succeeded, failed,
   * or was never going to happen.
   *
   * ITS ABSENCE IS THE INTERESTING CASE. The wait ends on failure too, so no
   * event at all means the first pass neither finished nor threw: a request
   * that hung. That is the one shape that leaves a player waiting.
   */
  | TelemetryEventOf<
      "learner-storage.first-sync",
      {
        targetLanguage: string;
        supportLanguage: string;
        syncLoopRunning: boolean;
        /** From opening the storage to the wait ending. */
        waitedMs: number;
        /** Words held locally afterwards. Zero on a device that has never
         *  played AND could not reach the account. */
        wordCount: number;
        /** Whether a stored level arrived. False means placement runs. */
        levelPresent: boolean;
      }
    >;

export type TelemetryEventKind = TelemetryEvent["kind"];

export interface TelemetryQuery {
  conversationId?: string;
  turnId?: string;
  sessionId?: string;
  eventKinds?: TelemetryEventKind[];
  probeId?: string;
  lemmaId?: string;
  npcId?: string;
  timeRange?: TelemetryTimeRange;
  limit?: number;
}

export interface TelemetrySink {
  emit: (event: TelemetryEvent) => void | Promise<void>;
  flush?: () => Promise<void>;
  query?: (filter: TelemetryQuery) => Promise<TelemetryEvent[]>;
  /**
   * Flushes any buffered events and tears down timers/listeners. Called from
   * the sugarlang plugin's dispose(). Emits after dispose are dropped.
   */
  dispose?: () => Promise<void> | void;
}

export interface QueryableTelemetrySink extends TelemetrySink {
  flush: () => Promise<void>;
  query: (filter: TelemetryQuery) => Promise<TelemetryEvent[]>;
}

export interface TelemetryLogger {
  warn: (message: string, payload?: Record<string, unknown>) => void;
}

export class NotSupportedTelemetryQueryError extends Error {
  constructor(message = "This telemetry sink does not support query().") {
    super(message);
    this.name = "NotSupportedTelemetryQueryError";
  }
}

function createEventId(): string {
  telemetryEventCounter += 1;
  return `sugarlang-telemetry:${Date.now()}:${telemetryEventCounter}`;
}

function hasOwn<TKey extends string>(
  value: unknown,
  key: TKey
): value is Record<TKey, unknown> {
  return typeof value === "object" && value !== null && key in value;
}

function collectStringMatches(value: unknown, target: string): boolean {
  if (typeof value === "string") {
    return value === target;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => collectStringMatches(entry, target));
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).some((entry) => collectStringMatches(entry, target));
  }
  return false;
}

function eventContainsLemma(event: TelemetryEvent, lemmaId: string): boolean {
  return collectStringMatches(event, lemmaId);
}

function eventContainsProbeId(event: TelemetryEvent, probeId: string): boolean {
  return hasOwn(event, "probeId") && event.probeId === probeId;
}

function eventContainsNpcId(event: TelemetryEvent, npcId: string): boolean {
  return hasOwn(event, "npcId") && event.npcId === npcId;
}

export function matchesTelemetryQuery(
  event: TelemetryEvent,
  query: TelemetryQuery
): boolean {
  if (query.conversationId && event.conversationId !== query.conversationId) {
    return false;
  }
  if (query.turnId && event.turnId !== query.turnId) {
    return false;
  }
  if (query.sessionId && event.sessionId !== query.sessionId) {
    return false;
  }
  if (query.eventKinds && !query.eventKinds.includes(event.kind)) {
    return false;
  }
  if (
    query.timeRange?.startMs !== undefined &&
    event.timestamp < query.timeRange.startMs
  ) {
    return false;
  }
  if (
    query.timeRange?.endMs !== undefined &&
    event.timestamp > query.timeRange.endMs
  ) {
    return false;
  }
  if (query.probeId && !eventContainsProbeId(event, query.probeId)) {
    return false;
  }
  if (query.lemmaId && !eventContainsLemma(event, query.lemmaId)) {
    return false;
  }
  if (query.npcId && !eventContainsNpcId(event, query.npcId)) {
    return false;
  }
  return true;
}

export function createTelemetryEvent<
  TKind extends TelemetryEvent["kind"]
>(
  kind: TKind,
  payload: Record<string, unknown> &
    Partial<
      Pick<
        TelemetryEventBase,
        "eventId" | "conversationId" | "turnId" | "sessionId"
      >
    > & {
      timestamp: number;
    }
): Extract<TelemetryEvent, { kind: TKind }> {
  return {
    eventId: payload.eventId ?? createEventId(),
    schemaVersion: SUGARLANG_TELEMETRY_SCHEMA_VERSION,
    kind,
    ...payload
  } as Extract<TelemetryEvent, { kind: TKind }>;
}

export async function emitTelemetry(
  sink: TelemetrySink,
  event: TelemetryEvent,
  logger?: TelemetryLogger
): Promise<void> {
  try {
    await sink.emit(event);
  } catch (error) {
    logger?.warn("Sugarlang telemetry emit failed; dropping event.", {
      reason: error instanceof Error ? error.message : String(error),
      eventKind: event.kind
    });
  }
}

export async function flushTelemetry(
  sink: TelemetrySink,
  logger?: TelemetryLogger
): Promise<void> {
  try {
    await sink.flush?.();
  } catch (error) {
    logger?.warn("Sugarlang telemetry flush failed; dropping buffered events.", {
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

function applyLimit(
  events: TelemetryEvent[],
  limit: number | undefined
): TelemetryEvent[] {
  if (!limit || limit <= 0 || events.length <= limit) {
    return events;
  }
  return events.slice(-limit);
}

export class MemoryTelemetrySink implements QueryableTelemetrySink {
  private readonly capacity: number;
  private readonly events: TelemetryEvent[] = [];

  constructor(options: { capacity?: number } = {}) {
    this.capacity = Math.max(1, options.capacity ?? 1000);
  }

  emit(event: TelemetryEvent): void {
    this.events.push(event);
    if (this.events.length > this.capacity) {
      this.events.splice(0, this.events.length - this.capacity);
    }
  }

  async flush(): Promise<void> {
    return undefined;
  }

  async query(filter: TelemetryQuery = {}): Promise<TelemetryEvent[]> {
    return applyLimit(
      this.events.filter((event) => matchesTelemetryQuery(event, filter)),
      filter.limit
    );
  }
}

export class NoOpTelemetrySink implements TelemetrySink {
  emit(_event: TelemetryEvent): void {
    return undefined;
  }

  async flush(): Promise<void> {
    return undefined;
  }

  async query(_filter: TelemetryQuery): Promise<TelemetryEvent[]> {
    throw new NotSupportedTelemetryQueryError();
  }
}

export function createNoOpTelemetrySink(): TelemetrySink {
  return new NoOpTelemetrySink();
}

/**
 * ONE DESTINATION, EVERYWHERE.
 *
 * Events go to the gateway or nowhere. Studio, Preview and the published game
 * all take the same path, so what you watch while authoring is what the
 * deployed game does. The gateway writes each event to stdout, so reading is
 * `docker compose logs` locally and Cloud Logging in production.
 *
 * A stable sink handed to every service at construction, forwarding to the
 * host's collector once the runtime binds. Sugarlang's services and
 * middlewares are built before `init` runs, so they need something to hold
 * that is real from the start; anything emitted before the bind has nowhere
 * to go and is dropped, which is the same answer they would get with no
 * gateway configured.
 */
export { BindableTelemetryCollector as HostTelemetrySink } from "@sugarmagic/runtime-core";
