/**
 * packages/plugins/src/catalog/sugarlang/runtime/telemetry/comprehension-monitor-data.ts
 *
 * Purpose: Aggregates probe lifecycle telemetry into developer-facing monitor views.
 *
 * Exports:
 *   - ProbeSummary
 *   - ProbeDetail
 *   - SessionProbeRollup
 *   - LemmaProbeHistory
 *   - ComprehensionMonitorDataSource
 *
 * Relationships:
 *   - Depends on the queryable telemetry sink and canonical comprehension event schema.
 *   - Is consumed by the Studio comprehension monitor section.
 *
 * Implements: Proposal 001 §Observer Latency Bias and In-Character Comprehension Checks
 *
 * Status: active
 */

import type { LemmaRef } from "../types";
import type { QueryableTelemetrySink, TelemetryEvent, TelemetryTimeRange } from "./telemetry";

type ProbeLifecycleEvent = Extract<
  TelemetryEvent,
  {
    kind:
      | "comprehension.probe-triggered"
      | "comprehension.probe-fired"
      | "comprehension.probe-response-received"
      | "comprehension.probe-passed"
      | "comprehension.probe-failed"
      | "comprehension.probe-mixed-result"
      | "comprehension.probe-language-fallback";
  }
>;

export interface ProbeSummary {
  probeId: string;
  sessionId: string | null;
  conversationId: string;
  turnId: string;
  npcId: string | null;
  npcDisplayName: string | null;
  triggerReason: string;
  targetLemmas: LemmaRef[];
  outcome:
    | "triggered"
    | "passed"
    | "failed"
    | "mixed"
    | "language-fallback";
  timestamp: number;
}

export interface ProbeDetail {
  probeId: string;
  events: TelemetryEvent[];
}

export interface SessionProbeRollup {
  sessionId: string;
  probeCount: number;
  passCount: number;
  failCount: number;
  mixedCount: number;
  languageFallbackCount: number;
  hardFloorViolationCount: number;
  avgTurnsSinceLastProbe: number;
  perNpc: Array<{
    npcId: string | null;
    npcDisplayName: string | null;
    probeCount: number;
  }>;
}

export interface LemmaProbeHistory {
  learnerId: string;
  lemmaRef: LemmaRef;
  probes: ProbeSummary[];
}

export interface ComprehensionMonitorDataSourceOptions {
  telemetrySink: QueryableTelemetrySink;
}

function isProbeEvent(event: TelemetryEvent): event is ProbeLifecycleEvent {
  return (
    event.kind === "comprehension.probe-triggered" ||
    event.kind === "comprehension.probe-fired" ||
    event.kind === "comprehension.probe-response-received" ||
    event.kind === "comprehension.probe-passed" ||
    event.kind === "comprehension.probe-failed" ||
    event.kind === "comprehension.probe-mixed-result" ||
    event.kind === "comprehension.probe-language-fallback"
  );
}

function outcomeFromEvents(events: ProbeLifecycleEvent[]): ProbeSummary["outcome"] {
  if (events.some((event) => event.kind === "comprehension.probe-language-fallback")) {
    return "language-fallback";
  }
  if (events.some((event) => event.kind === "comprehension.probe-mixed-result")) {
    return "mixed";
  }
  if (events.some((event) => event.kind === "comprehension.probe-passed")) {
    return "passed";
  }
  if (events.some((event) => event.kind === "comprehension.probe-failed")) {
    return "failed";
  }
  return "triggered";
}

export class ComprehensionMonitorDataSource {
  private readonly telemetrySink: QueryableTelemetrySink;

  constructor(options: ComprehensionMonitorDataSourceOptions) {
    this.telemetrySink = options.telemetrySink;
  }

  async listRecentProbes(filter: {
    sessionId?: string;
    conversationId?: string;
    npcId?: string;
    timeRange?: TelemetryTimeRange;
  } = {}): Promise<ProbeSummary[]> {
    const events = await this.telemetrySink.query({
      sessionId: filter.sessionId,
      conversationId: filter.conversationId,
      npcId: filter.npcId,
      timeRange: filter.timeRange,
      eventKinds: [
        "comprehension.probe-triggered",
        "comprehension.probe-fired",
        "comprehension.probe-response-received",
        "comprehension.probe-passed",
        "comprehension.probe-failed",
        "comprehension.probe-mixed-result",
        "comprehension.probe-language-fallback"
      ]
    });
    const grouped = new Map<string, ProbeLifecycleEvent[]>();
    for (const event of events) {
      if (!isProbeEvent(event)) {
        continue;
      }
      const bucket = grouped.get(event.probeId) ?? [];
      bucket.push(event);
      grouped.set(event.probeId, bucket);
    }

    return [...grouped.entries()]
      .map(([probeId, bucket]) => {
        const sorted = bucket.sort((left, right) => left.timestamp - right.timestamp);
        const trigger = sorted.find(
          (event): event is Extract<TelemetryEvent, { kind: "comprehension.probe-triggered" }> =>
            event.kind === "comprehension.probe-triggered"
        );
        if (!trigger) {
          return null;
        }
        return {
          probeId,
          sessionId: trigger.sessionId ?? null,
          conversationId: trigger.conversationId ?? "unknown-conversation",
          turnId: trigger.turnId ?? "unknown-turn",
          npcId: trigger.npcId,
          npcDisplayName: trigger.npcDisplayName,
          triggerReason: trigger.triggerReason,
          targetLemmas: trigger.targetLemmas,
          outcome: outcomeFromEvents(sorted),
          timestamp: trigger.timestamp
        } satisfies ProbeSummary;
      })
      .filter((value): value is ProbeSummary => value !== null)
      .sort((left, right) => right.timestamp - left.timestamp);
  }

  async getProbeDetail(probeId: string): Promise<ProbeDetail> {
    const events = await this.telemetrySink.query({ probeId });
    return {
      probeId,
      events: events.sort((left, right) => left.timestamp - right.timestamp)
    };
  }

  async getSessionRollup(sessionId: string): Promise<SessionProbeRollup> {
    const probes = await this.listRecentProbes({ sessionId });
    const hardFloorViolationEvents = await this.telemetrySink.query({
      sessionId,
      eventKinds: ["comprehension.director-hard-floor-violated"]
    });
    const perNpcMap = new Map<string, { npcId: string | null; npcDisplayName: string | null; probeCount: number }>();
    let totalTurnsSinceLastProbe = 0;
    for (const probe of probes) {
      const key = `${probe.npcId ?? "none"}:${probe.npcDisplayName ?? "none"}`;
      const bucket =
        perNpcMap.get(key) ?? {
          npcId: probe.npcId,
          npcDisplayName: probe.npcDisplayName,
          probeCount: 0
        };
      bucket.probeCount += 1;
      perNpcMap.set(key, bucket);
      const detail = await this.getProbeDetail(probe.probeId);
      const trigger = detail.events.find(
        (event): event is Extract<TelemetryEvent, { kind: "comprehension.probe-triggered" }> =>
          event.kind === "comprehension.probe-triggered"
      );
      totalTurnsSinceLastProbe += trigger?.turnsSinceLastProbe ?? 0;
    }

    return {
      sessionId,
      probeCount: probes.length,
      passCount: probes.filter((probe) => probe.outcome === "passed").length,
      failCount: probes.filter((probe) => probe.outcome === "failed").length,
      mixedCount: probes.filter((probe) => probe.outcome === "mixed").length,
      languageFallbackCount: probes.filter(
        (probe) => probe.outcome === "language-fallback"
      ).length,
      hardFloorViolationCount: hardFloorViolationEvents.length,
      avgTurnsSinceLastProbe:
        probes.length > 0 ? totalTurnsSinceLastProbe / probes.length : 0,
      perNpc: [...perNpcMap.values()].sort(
        (left, right) => right.probeCount - left.probeCount
      )
    };
  }

  async getLemmaProbeHistory(
    lemmaRef: LemmaRef,
    learnerId: string
  ): Promise<LemmaProbeHistory> {
    const probes = await this.listRecentProbes();
    return {
      learnerId,
      lemmaRef,
      probes: probes.filter((probe) =>
        probe.targetLemmas.some(
          (target) =>
            target.lemmaId === lemmaRef.lemmaId && target.lang === lemmaRef.lang
        )
      )
    };
  }
}
