/**
 * packages/plugins/src/catalog/sugarlang/runtime/telemetry/telemetry.ts
 *
 * Purpose: Defines the canonical sugarlang telemetry event schema, safe sink helpers, and sink implementations.
 *
 * Exports:
 *   - Telemetry event/query types
 *   - Telemetry sink interfaces and helpers
 *   - TELEMETRY_DB_NAME
 *   - MemoryTelemetrySink
 *   - IndexedDBTelemetrySink
 *   - NoOpTelemetrySink
 *   - GatewaySugarlangTelemetrySink
 *   - CompositeTelemetrySink
 *   - resolveSugarlangTelemetrySink
 *
 * Relationships:
 *   - Is the single telemetry contract consumed by middlewares, Director, learner-state, and Studio debug readers.
 *   - Owns persistence/query behavior so gameplay producers stay fire-and-forget.
 *
 * Implements: Proposal 001 §v2 Training Path / §Verification, Failure Modes, and Guardrails
 *
 * Status: active
 *
 * TODO (v1.1): Production analytics via GCP Cloud Logging + BigQuery
 *
 *   The three current sink implementations are all local (Memory, IndexedDB, NoOp).
 *   Published builds use NoOp, which drops every event. To get production analytics
 *   (sessions per week, turns per session, probe pass rate, CEFR distribution,
 *   rough-spot detection, error analysis), implement a GCPCloudLoggingSink that:
 *
 *   1. Batches events and POSTs them as structured log entries to the GCP Cloud
 *      Logging API (events are already structured JSON with typed payloads).
 *   2. Set up a GCP log sink that routes sugarlang.* events to BigQuery.
 *   3. Query BigQuery for aggregations — session.started / session.ended give
 *      sessions-per-week and turns-per-session; comprehension.probe-passed/failed
 *      give probe pass rates; verify.repair-triggered spikes flag rough-spot scenes.
 *   4. Wire via a config flag so published builds use GCPCloudLoggingSink instead
 *      of NoOpTelemetrySink.
 *
 *   The TelemetrySink interface (`emit` + `flush`) is the extension point — the new
 *   sink is ~100 lines implementing the same interface. No schema or middleware
 *   changes required. Every event already carries sessionId, conversationId, turnId,
 *   and timestamp as join keys for BigQuery.
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
import type { RuntimeBootModel } from "@sugarmagic/runtime-core";

export const SUGARLANG_TELEMETRY_SCHEMA_VERSION = 1 as const;
export const SUGARLANG_STUDIO_TELEMETRY_WORKSPACE_ID =
  "sugarlang-telemetry:studio";

/**
 * Owned here: the telemetry sink's database name. The shared learner-data
 * reset (learner/reset-learner-data.ts) is the only other consumer -- do not
 * hard-code the literal anywhere else.
 */
export const TELEMETRY_DB_NAME = "sugarlang-telemetry";
const TELEMETRY_DB_VERSION = 1;
const TELEMETRY_STORE_NAME = "sugarlang-telemetry";

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

export interface TelemetryEventBase {
  eventId: string;
  schemaVersion: typeof SUGARLANG_TELEMETRY_SCHEMA_VERSION;
  timestamp: number;
  kind: string;
  conversationId?: string;
  turnId?: string;
  sessionId?: string;
}

type TelemetryEventOf<TKind extends string, TPayload> = TelemetryEventBase & {
  kind: TKind;
} & TPayload;

export type TelemetryEvent =
  // 090.5: `budgeter.prescription-generated` deleted. 090.10 removed the only
  // emitter; the event type outlived it, so the debug surfaces still declared a
  // shape nothing could ever produce.
  | TelemetryEventOf<
      "director.invocation-started",
      {
        sceneId: string;
        npcId: string | null;
        npcDisplayName: string | null;
        directorContext: Record<string, unknown>;
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
      "director.invocation-completed",
      {
        sceneId?: string;
        npcId?: string | null;
        npcDisplayName?: string | null;
        directive: PedagogicalDirective;
        cacheHit: boolean;
        fallback: boolean;
        latencyMs: number;
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
      "director.invocation-failed",
      {
        sceneId?: string;
        npcId?: string | null;
        npcDisplayName?: string | null;
        model?: string | null;
        latencyMs: number;
        reason: string;
      }
    >
  | TelemetryEventOf<
      "director.cache-hit",
      {
        sceneId?: string;
        npcId?: string | null;
        npcDisplayName?: string | null;
        fallback: boolean;
      }
    >
  | TelemetryEventOf<
      "director.invocation-resolved",
      {
        sceneId?: string;
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
        sceneId: string | null;
        learnerSnapshot: LearnerSnapshot;
        verdict: EnvelopeVerdict;
        inputText: string;
        constraint?: SugarlangConstraint;
      }
    >
  | TelemetryEventOf<
      "chunk.extraction-started",
      {
        sceneId: string;
        contentHash: string;
        lang: string;
        extractorPurpose: string;
        extractorPromptVersion: string;
      }
    >
  | TelemetryEventOf<
      "chunk.extraction-completed",
      {
        sceneId: string;
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
        sceneId: string;
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
        sceneId: string;
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
        sceneId: string;
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
        sceneId: string;
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
        sceneId: string;
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
        sceneId: string;
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
        sceneId: string;
        contentHash: string;
        reason: string;
      }
    >
  | TelemetryEventOf<
      "verify.repair-triggered",
      {
        sceneId: string;
        originalText: string;
        repairedText?: string | null;
        violations: string[];
        repairPrompt: string[];
        candidateCount: number;
        selectedIndex: number;
        candidateScores: Array<{
          score: number;
          passes: boolean;
          coverageRatio: number;
          measuredRatio: number;
          conformance: string;
        }>;
      }
    >
  | TelemetryEventOf<
      "observe.observations-applied",
      {
        sceneId: string;
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
      "director.pre-placement-bypass",
      {
        sceneId?: string | null;
        lineId: string;
      }
    >
  | TelemetryEventOf<
      "verify.pre-placement-bypass",
      {
        sceneId?: string | null;
      }
    >
  | TelemetryEventOf<
      "verify.deterministic-bypass",
      {
        sceneId?: string | null;
        reason: string;
      }
    >
  | TelemetryEventOf<
      "verify.drift-sample",
      {
        sceneId: string | null;
        /** Ordinal turn index within the conversation (0-based). */
        turnIndex: number;
        measuredRatio: number;
        directedRatio: number;
        ratioConformance: string;
        withinEnvelope: boolean;
        voiceRetentionScore: number;
      }
    >
  | TelemetryEventOf<
      "verify.ratio-verdict",
      {
        sceneId: string | null;
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
        sceneId?: string | null;
      }
    >
  | TelemetryEventOf<
      "observer.placement-questionnaire-bypass",
      {
        sceneId?: string | null;
      }
    >
  | TelemetryEventOf<
      "comprehension.probe-triggered",
      {
        probeId: string;
        sceneId: string;
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
        sceneId: string;
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
        sceneId: string;
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
        sceneId: string;
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
        sceneId: string;
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
        sceneId: string;
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
        sceneId: string;
        npcId: string | null;
        npcDisplayName: string | null;
        targetLemmas: LemmaRef[];
        playerResponseText: string;
        detectedLang: string;
      }
    >
  | TelemetryEventOf<
      "comprehension.director-hard-floor-violated",
      {
        sceneId?: string;
        directorModel?: string | null;
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
        sceneId: string;
        lemmaRef: LemmaRef;
        cefrBand: CEFRBand | "unknown";
        learnerBand: CEFRBand;
        sourceObjectiveNodeId?: string;
        sourceObjectiveDisplayName?: string;
      }
    >
  | TelemetryEventOf<
      "quest-essential.director-targetvocab-contamination",
      {
        sceneId?: string;
        contaminatedLemmas: string[];
        contaminationSite?: "introduce" | "reinforce" | "avoid";
      }
    >
  | TelemetryEventOf<
      "quest-essential.generator-missed-gloss",
      {
        sceneId: string;
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
        sceneId: string;
        expectedLemmas: LemmaRef[];
        generatedText: string;
        sourceObjectiveDisplayName: string;
        sourceObjectiveNodeId?: string;
      }
    >
  | TelemetryEventOf<
      "quest-essential.compile-diagnostic-deadlock-prone",
      {
        sceneId: string;
        sourceObjectiveNodeId: string;
        sourceObjectiveDisplayName: string;
        highBandLemmas: string[];
        suggestion: string;
      }
    >
  | TelemetryEventOf<
      "directive-cache.invalidated",
      {
        conversationId: string;
        reason:
          | "max_turns_exceeded"
          | "quest_stage_change"
          | "location_change"
          | "player_code_switch"
          | "manual";
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
        sceneId: string | null;
        isColdStart: boolean;
        learnerBand: string;
        /** Competencies the learner has been taught. */
        metCompetencyCount: number;
        /** Competencies in the inventory they have not. */
        unmetCompetencyCount: number;
        /** Cards below the due floor, including competency cards. */
        dueItemCount: number;
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
        sceneId: string | null;
        dayIndex: number | null;
        diverseEncounterCountAfter: number;
        targetEncounters: number;
        /** True when diverseEncounterCountAfter >= targetEncounters. */
        debtPaid: boolean;
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

interface StoredTelemetryEvent {
  workspaceId: string;
  event: TelemetryEvent;
}

function openTelemetryDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(TELEMETRY_DB_NAME, TELEMETRY_DB_VERSION);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to open sugarlang telemetry IndexedDB."));
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(TELEMETRY_STORE_NAME)
        ? request.transaction!.objectStore(TELEMETRY_STORE_NAME)
        : db.createObjectStore(TELEMETRY_STORE_NAME, {
            keyPath: ["workspaceId", "event.eventId"]
          });
      if (!store.indexNames.contains("workspaceId")) {
        store.createIndex("workspaceId", "workspaceId", { unique: false });
      }
      if (!store.indexNames.contains("timestamp")) {
        store.createIndex("timestamp", "event.timestamp", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => void | Promise<T>
): Promise<T> {
  const db = await openTelemetryDatabase();
  return await new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(TELEMETRY_STORE_NAME, mode);
    const store = transaction.objectStore(TELEMETRY_STORE_NAME);
    Promise.resolve(run(store))
      .then((value) => {
        transaction.oncomplete = () => {
          db.close();
          resolve(value as T);
        };
      })
      .catch((error) => {
        db.close();
        reject(error);
      });
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Sugarlang telemetry transaction failed."));
    };
  });
}

async function getAllStoredEvents(workspaceId: string): Promise<TelemetryEvent[]> {
  return withStore("readonly", (store) => {
    return new Promise<TelemetryEvent[]>((resolve, reject) => {
      const request = store.index("workspaceId").getAll(IDBKeyRange.only(workspaceId));
      request.onerror = () =>
        reject(request.error ?? new Error("Failed to read sugarlang telemetry events."));
      request.onsuccess = () => {
        const rows = (request.result as StoredTelemetryEvent[] | undefined) ?? [];
        resolve(
          rows
            .map((row) => row.event)
            .sort((left, right) => left.timestamp - right.timestamp)
        );
      };
    });
  });
}

export interface IndexedDBTelemetrySinkOptions {
  workspaceId?: string;
  capacity?: number;
  flushIntervalMs?: number;
}

export class IndexedDBTelemetrySink implements QueryableTelemetrySink {
  private readonly workspaceId: string;
  private readonly capacity: number;
  private readonly flushIntervalMs: number;
  private readonly pending: TelemetryEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: IndexedDBTelemetrySinkOptions = {}) {
    this.workspaceId =
      options.workspaceId ?? SUGARLANG_STUDIO_TELEMETRY_WORKSPACE_ID;
    this.capacity = Math.max(1, options.capacity ?? 50_000);
    this.flushIntervalMs = Math.max(0, options.flushIntervalMs ?? 100);
  }

  emit(event: TelemetryEvent): void {
    this.pending.push(event);
    if (this.flushTimer !== null) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.flushIntervalMs);
  }

  async flush(): Promise<void> {
    if (typeof indexedDB === "undefined") {
      this.pending.length = 0;
      return;
    }

    if (this.pending.length === 0) {
      return;
    }

    const batch = this.pending.splice(0, this.pending.length);
    await withStore("readwrite", async (store) => {
      for (const event of batch) {
        store.put({
          workspaceId: this.workspaceId,
          event
        } satisfies StoredTelemetryEvent);
      }
    });

    const events = await getAllStoredEvents(this.workspaceId);
    if (events.length <= this.capacity) {
      return;
    }

    const deleteIds = events
      .slice(0, events.length - this.capacity)
      .map((event) => [this.workspaceId, event.eventId]);
    await withStore("readwrite", async (store) => {
      for (const key of deleteIds) {
        store.delete(key);
      }
    });
  }

  async query(filter: TelemetryQuery = {}): Promise<TelemetryEvent[]> {
    await this.flush();
    const events = await getAllStoredEvents(this.workspaceId);
    return applyLimit(
      events.filter((event) => matchesTelemetryQuery(event, filter)),
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

const GATEWAY_BATCH_SIZE_CAP = 100;

// Keep in sync with SUGARLANG_TELEMETRY_PII_FIELDS in
// packages/plugins/src/deployment/gateway/core.ts (the gateway compiles
// standalone and cannot import from the sugarlang runtime).
const SERVER_BOUND_PII_FIELDS: ReadonlySet<string> = new Set([
  "inputText",
  "originalText",
  "repairedText",
  "playerResponseText"
]);

// observe.observations-applied nests player-typed text at
// observations[].observation.inputText (produced-typed observations, see
// contracts/observation.ts). Strip that one known nested path; anything
// broader belongs in a deliberate schema change, not a deep scrubber.
function stripObservationPii(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      return entry;
    }
    const observation = (entry as { observation?: unknown }).observation;
    if (
      typeof observation !== "object" ||
      observation === null ||
      !("inputText" in observation)
    ) {
      return entry;
    }
    const rest = { ...(observation as Record<string, unknown>) };
    delete rest.inputText;
    return { ...(entry as Record<string, unknown>), observation: rest };
  });
}

function stripPii(event: TelemetryEvent): Record<string, unknown> {
  const stripped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event as unknown as Record<string, unknown>)) {
    if (SERVER_BOUND_PII_FIELDS.has(key)) {
      continue;
    }
    stripped[key] = key === "observations" ? stripObservationPii(value) : value;
  }
  return stripped;
}

export class GatewaySugarlangTelemetrySink implements TelemetrySink {
  private readonly url: string;
  private readonly flushIntervalMs: number;
  private readonly pending: TelemetryEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  // Bound handlers so dispose() can remove exactly what was added.
  private readonly handlePageHide = (): void => {
    this.flushOnHide();
  };
  private readonly handleVisibilityChange = (): void => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      this.flushOnHide();
    }
  };

  constructor(options: { proxyBaseUrl: string; flushIntervalMs?: number }) {
    const base = options.proxyBaseUrl.endsWith("/")
      ? options.proxyBaseUrl.slice(0, -1)
      : options.proxyBaseUrl;
    this.url = `${base}/api/sugarlang/telemetry`;
    this.flushIntervalMs = options.flushIntervalMs ?? 5000;
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", this.handlePageHide);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }
  }

  emit(event: TelemetryEvent): void {
    if (this.disposed) {
      return;
    }
    this.pending.push(event);
    this.scheduleFlush(this.flushIntervalMs);
  }

  async flush(): Promise<void> {
    if (this.pending.length === 0) {
      return;
    }
    const batch = this.pending.splice(0, GATEWAY_BATCH_SIZE_CAP);
    if (this.pending.length > 0) {
      // A burst larger than the cap must not strand the remainder until the
      // next emit; drain it on the next tick.
      this.scheduleFlush(0);
    }
    try {
      await fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          events: batch.map(stripPii),
          schemaVersion: SUGARLANG_TELEMETRY_SCHEMA_VERSION
        })
      });
    } catch {
      // drop-on-failure: never block a turn
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", this.handlePageHide);
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    }
    while (this.pending.length > 0) {
      await this.flush();
    }
  }

  private scheduleFlush(delayMs: number): void {
    if (this.disposed || this.flushTimer !== null) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, delayMs);
  }

  // Tab-close path: awaited fetches never complete after unload, so fire
  // keepalive requests for every pending batch without awaiting. keepalive
  // bodies share a 64KB in-flight quota; overflow requests fail and drop,
  // which matches the drop-on-failure posture.
  private flushOnHide(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    while (this.pending.length > 0) {
      const batch = this.pending.splice(0, GATEWAY_BATCH_SIZE_CAP);
      try {
        void fetch(this.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          keepalive: true,
          body: JSON.stringify({
            events: batch.map(stripPii),
            schemaVersion: SUGARLANG_TELEMETRY_SCHEMA_VERSION
          })
        });
      } catch {
        // drop-on-failure: never block unload
      }
    }
  }
}

/**
 * Fans out emit/flush/dispose to every sink; query is served by the first
 * queryable sink (the Studio inspector reads from IndexedDB).
 */
export class CompositeTelemetrySink implements TelemetrySink {
  private readonly sinks: TelemetrySink[];

  constructor(sinks: TelemetrySink[]) {
    this.sinks = sinks;
  }

  emit(event: TelemetryEvent): void {
    for (const sink of this.sinks) {
      void sink.emit(event);
    }
  }

  async flush(): Promise<void> {
    await Promise.all(this.sinks.map((sink) => sink.flush?.()));
  }

  async query(filter: TelemetryQuery): Promise<TelemetryEvent[]> {
    for (const sink of this.sinks) {
      if (sink.query) {
        return sink.query(filter);
      }
    }
    throw new NotSupportedTelemetryQueryError();
  }

  async dispose(): Promise<void> {
    await Promise.all(this.sinks.map((sink) => sink.dispose?.()));
  }
}

export function resolveSugarlangTelemetrySink(
  boot: RuntimeBootModel,
  options?: { proxyBaseUrl?: string }
): TelemetrySink {
  const proxyBaseUrl = options?.proxyBaseUrl?.trim() ?? "";

  if (boot.compileProfile === "published-target") {
    return proxyBaseUrl
      ? new GatewaySugarlangTelemetrySink({ proxyBaseUrl })
      : new NoOpTelemetrySink();
  }

  if (typeof indexedDB === "undefined") {
    return new NoOpTelemetrySink();
  }

  const indexedDbSink = new IndexedDBTelemetrySink({
    workspaceId: SUGARLANG_STUDIO_TELEMETRY_WORKSPACE_ID
  });

  // Studio/preview with a configured proxy also ships events to the gateway
  // (same production path as published targets); IndexedDB stays first so
  // the Studio inspector keeps its queryable local copy.
  if (proxyBaseUrl) {
    return new CompositeTelemetrySink([
      indexedDbSink,
      new GatewaySugarlangTelemetrySink({ proxyBaseUrl })
    ]);
  }

  return indexedDbSink;
}
