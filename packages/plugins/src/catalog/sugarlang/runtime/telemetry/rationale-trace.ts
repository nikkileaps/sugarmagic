/**
 * packages/plugins/src/catalog/sugarlang/runtime/telemetry/rationale-trace.ts
 *
 * Purpose: Reconstructs per-turn Sugarlang rationale traces from persisted telemetry events.
 *
 * Exports:
 *   - RationaleTrace
 *   - RationaleTraceBuilder
 *
 * Relationships:
 *   - Depends on the canonical telemetry event stream.
 *   - Is consumed by Studio-side debug readers and Epic 13 UI panels.
 *
 * Implements: Proposal 001 §Verification and Acceptance
 *
 * Status: active
 */

import type {
  EnvelopeVerdict,
  PedagogicalDirective,
  ProbeFloorState
} from "../types";
import type { LearnerSnapshot } from "../middlewares/shared";
import type {
  QueryableTelemetrySink,
  TelemetryEvent,
  TelemetryLearnerDelta
} from "./telemetry";

export interface RationaleTraceTurnContext {
  conversationId: string;
  turnId: string;
  sessionId: string | null;
  sceneId: string | null;
  npcId: string | null;
  npcDisplayName: string | null;
  learnerSnapshot: LearnerSnapshot | null;
  timestamp: number | null;
}

export interface RationaleTraceDirective {
  directive: PedagogicalDirective;
  cacheHit: boolean;
  fallback: boolean;
  latencyMs: number;
  model?: string | null;
}

export interface RationaleTraceVerdict {
  verdict: EnvelopeVerdict;
  inputText: string;
  constraint?: Record<string, unknown>;
}

export interface RationaleTraceRepair {
  kind: "repair";
  originalText: string;
  resultText?: string | null;
  details: string[];
}

export interface RationaleTraceComprehensionCheck {
  probeId: string;
  lifecycle: TelemetryEvent[];
}

export interface RationaleTrace {
  turnContext: RationaleTraceTurnContext;
  // 090.5: `prescription` deleted. It was sourced entirely from
  // `budgeter.prescription-generated`, which 090.10 stopped emitting -- so this
  // section had been null on every trace since. What the Teacher decided, and
  // why, is the `directive` section below.
  directive: RationaleTraceDirective | null;
  verdict: RationaleTraceVerdict | null;
  repair: RationaleTraceRepair | null;
  observations: TelemetryEvent[];
  learnerDelta: TelemetryLearnerDelta | null;
  comprehensionCheck: RationaleTraceComprehensionCheck | null;
  pendingProvisionalSnapshot: Array<{
    lemmaRef: { lemmaId: string; lang: string };
    evidenceAmount: number;
    turnsPending: number;
  }>;
  probeFloorState: ProbeFloorState | null;
  matchedChunks: Array<{
    chunkId: string;
    cefrBand: string;
    surfaceMatched: string;
  }>;
  events: TelemetryEvent[];
}

export interface RationaleTraceBuilderOptions {
  telemetrySink: QueryableTelemetrySink;
}

function eventTimestamp(event: TelemetryEvent): number {
  return event.timestamp;
}

function firstOfKind<TKind extends TelemetryEvent["kind"]>(
  events: TelemetryEvent[],
  kind: TKind
): Extract<TelemetryEvent, { kind: TKind }> | null {
  return (
    events.find(
      (event): event is Extract<TelemetryEvent, { kind: TKind }> => event.kind === kind
    ) ?? null
  );
}

export class RationaleTraceBuilder {
  private readonly telemetrySink: QueryableTelemetrySink;

  constructor(options: RationaleTraceBuilderOptions) {
    this.telemetrySink = options.telemetrySink;
  }

  async buildTrace(
    conversationId: string,
    turnId: string
  ): Promise<RationaleTrace> {
    const events = await this.telemetrySink.query({
      conversationId,
      turnId
    });
    const sorted = [...events].sort((left, right) => eventTimestamp(left) - eventTimestamp(right));
      const directiveEvent = firstOfKind(sorted, "teacher.invocation-completed");
    // 090.5: the pacing snapshot rides the STARTED event, not the completed one.
    const directiveStartedEvent = firstOfKind(sorted, "teacher.invocation-started");
    const verdictEvent = firstOfKind(sorted, "classifier.verdict");
    const chunkHitEvent = firstOfKind(sorted, "chunk.hit-during-classification");
    const observeEvent = firstOfKind(sorted, "observe.observations-applied");
    const probeTriggerEvent = firstOfKind(sorted, "comprehension.probe-triggered");
    const probeLifecycle =
      probeTriggerEvent?.probeId != null
        ? await this.telemetrySink.query({
            conversationId,
            probeId: probeTriggerEvent.probeId
          })
        : [];

    return {
      turnContext: {
        conversationId,
        turnId,
        sessionId:
          directiveEvent?.sessionId ??
          verdictEvent?.sessionId ??
          observeEvent?.sessionId ??
          null,
        sceneId:
          directiveEvent?.sceneId ??
          verdictEvent?.sceneId ??
          observeEvent?.sceneId ??
          null,
        npcId: directiveEvent?.npcId ?? probeTriggerEvent?.npcId ?? null,
        npcDisplayName:
          directiveEvent?.npcDisplayName ?? probeTriggerEvent?.npcDisplayName ?? null,
        // 090.5: was the prescription event's snapshot; the verdict carries one too.
        learnerSnapshot: verdictEvent?.learnerSnapshot ?? null,
        timestamp: sorted[0]?.timestamp ?? null
      },
      directive: directiveEvent
        ? {
            directive: directiveEvent.directive,
            cacheHit: directiveEvent.cacheHit,
            fallback: directiveEvent.fallback,
            latencyMs: directiveEvent.latencyMs,
            model: directiveEvent.model ?? null
          }
        : null,
      verdict: verdictEvent
        ? {
            verdict: verdictEvent.verdict,
            inputText: verdictEvent.inputText,
            constraint: verdictEvent.constraint as Record<string, unknown> | undefined
          }
        : null,
      // The repair mechanism was deleted (latency epic); the trace leg with it.
      repair: null,
      observations:
        observeEvent != null
          ? [observeEvent]
          : sorted.filter((event) => event.kind === "observe.observations-applied"),
      learnerDelta: observeEvent?.learnerDelta ?? null,
      comprehensionCheck:
        probeTriggerEvent != null
          ? {
              probeId: probeTriggerEvent.probeId,
              lifecycle: probeLifecycle.sort(
                (left, right) => left.timestamp - right.timestamp
              )
            }
          : null,
      // 090.5: re-sourced from the Teacher's own invocation event, which has
      // carried both since 087 -- the budgeter event that used to supply them
      // no longer exists.
      pendingProvisionalSnapshot: directiveStartedEvent?.pendingProvisionalSnapshot ?? [],
      probeFloorState: directiveStartedEvent?.probeFloorState ?? null,
      matchedChunks: chunkHitEvent?.matchedChunks ?? [],
      events: sorted
    };
  }
}

// 090.5: `buildRationaleTrace` deleted -- exported and never called, and its
// first parameter was a LexicalPrescription, which no longer exists.
