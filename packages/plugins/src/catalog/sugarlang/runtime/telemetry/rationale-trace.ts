/**
 * packages/plugins/src/catalog/sugarlang/runtime/telemetry/rationale-trace.ts
 *
 * Purpose: Reconstructs per-turn Sugarlang rationale traces from persisted telemetry events.
 *
 * Exports:
 *   - RationaleTrace
 *   - RationaleTraceBuilder
 *   - buildRationaleTrace
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
  LexicalRationale,
  LexicalPrescription,
  PedagogicalDirective,
  ProbeFloorState
} from "../types";
import type { LearnerSnapshot } from "../middlewares/shared";
import type {
  QueryableTelemetrySink,
  QuestEssentialTelemetryState,
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
  kind: "repair" | "auto-simplify";
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
  prescription: {
    prescription: LexicalPrescription;
    rationale: LexicalRationale;
  } | null;
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
  questEssentialState: QuestEssentialTelemetryState | null;
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
    const prescriptionEvent = firstOfKind(sorted, "budgeter.prescription-generated");
    const directiveEvent = firstOfKind(sorted, "director.invocation-completed");
    const verdictEvent = firstOfKind(sorted, "classifier.verdict");
    const repairEvent = firstOfKind(sorted, "verify.repair-triggered");
    const simplifyEvent = firstOfKind(sorted, "verify.auto-simplify-triggered");
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
          prescriptionEvent?.sessionId ??
          directiveEvent?.sessionId ??
          verdictEvent?.sessionId ??
          observeEvent?.sessionId ??
          null,
        sceneId:
          prescriptionEvent?.sceneId ??
          directiveEvent?.sceneId ??
          verdictEvent?.sceneId ??
          observeEvent?.sceneId ??
          null,
        npcId: directiveEvent?.npcId ?? probeTriggerEvent?.npcId ?? null,
        npcDisplayName:
          directiveEvent?.npcDisplayName ?? probeTriggerEvent?.npcDisplayName ?? null,
        learnerSnapshot: prescriptionEvent?.learnerSnapshot ?? null,
        timestamp: sorted[0]?.timestamp ?? null
      },
      prescription: prescriptionEvent
        ? {
            prescription: prescriptionEvent.prescription,
            rationale: prescriptionEvent.rationale
          }
        : null,
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
      repair: repairEvent
        ? {
            kind: "repair",
            originalText: repairEvent.originalText,
            resultText: repairEvent.repairedText ?? null,
            details: [...repairEvent.violations]
          }
        : simplifyEvent
          ? {
              kind: "auto-simplify",
              originalText: simplifyEvent.originalText,
              resultText: simplifyEvent.simplifiedText,
              details: [...simplifyEvent.substitutions]
            }
          : null,
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
      pendingProvisionalSnapshot:
        prescriptionEvent?.pendingProvisionalSnapshot ?? [],
      probeFloorState: prescriptionEvent?.probeFloorState ?? null,
      questEssentialState: prescriptionEvent?.questEssentialState ?? null,
      events: sorted
    };
  }
}

export function buildRationaleTrace(
  prescription: LexicalPrescription,
  directive: PedagogicalDirective,
  verdict: EnvelopeVerdict
): Record<string, unknown> {
  return {
    prescription,
    directive,
    verdict
  };
}
