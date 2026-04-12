/**
 * packages/plugins/src/catalog/sugarlang/runtime/telemetry/debug-panel-data.ts
 *
 * Purpose: Aggregates telemetry-backed conversation and turn views for the Sugarlang Studio debug panels.
 *
 * Exports:
 *   - ConversationSummary
 *   - TurnSummary
 *   - DebugPanelDataSource
 *
 * Relationships:
 *   - Depends on the queryable telemetry sink and rationale trace builder.
 *   - Is consumed by Studio shell debug panels.
 *
 * Implements: Proposal 001 §Verification and Acceptance
 *
 * Status: active
 */

import type { QueryableTelemetrySink, TelemetryEvent } from "./telemetry";
import { RationaleTraceBuilder, type RationaleTrace } from "./rationale-trace";

export interface ConversationSummary {
  conversationId: string;
  sessionId: string | null;
  turnCount: number;
  lastEventAt: number;
}

export interface TurnSummary {
  turnId: string;
  sessionId: string | null;
  timestamp: number;
  eventKinds: string[];
}

export interface DebugPanelDataSourceOptions {
  telemetrySink: QueryableTelemetrySink;
}

function groupByConversation(
  events: TelemetryEvent[]
): Map<string, TelemetryEvent[]> {
  const grouped = new Map<string, TelemetryEvent[]>();
  for (const event of events) {
    if (!event.conversationId) {
      continue;
    }
    const bucket = grouped.get(event.conversationId) ?? [];
    bucket.push(event);
    grouped.set(event.conversationId, bucket);
  }
  return grouped;
}

export class DebugPanelDataSource {
  private readonly telemetrySink: QueryableTelemetrySink;
  private readonly rationaleTraceBuilder: RationaleTraceBuilder;

  constructor(options: DebugPanelDataSourceOptions) {
    this.telemetrySink = options.telemetrySink;
    this.rationaleTraceBuilder = new RationaleTraceBuilder({
      telemetrySink: options.telemetrySink
    });
  }

  async listRecentConversations(): Promise<ConversationSummary[]> {
    const events = await this.telemetrySink.query({
      limit: 500
    });
    const grouped = groupByConversation(events);

    return [...grouped.entries()]
      .map(([conversationId, bucket]) => ({
        conversationId,
        sessionId: bucket.at(-1)?.sessionId ?? null,
        turnCount: new Set(bucket.map((event) => event.turnId).filter(Boolean)).size,
        lastEventAt: bucket.reduce(
          (max, event) => Math.max(max, event.timestamp),
          0
        )
      }))
      .sort((left, right) => right.lastEventAt - left.lastEventAt);
  }

  async listTurnsInConversation(conversationId: string): Promise<TurnSummary[]> {
    const events = await this.telemetrySink.query({
      conversationId
    });
    const grouped = new Map<string, TelemetryEvent[]>();
    for (const event of events) {
      if (!event.turnId) {
        continue;
      }
      const bucket = grouped.get(event.turnId) ?? [];
      bucket.push(event);
      grouped.set(event.turnId, bucket);
    }

    return [...grouped.entries()]
      .map(([turnId, bucket]) => ({
        turnId,
        sessionId: bucket.at(-1)?.sessionId ?? null,
        timestamp: bucket.reduce((min, event) => Math.min(min, event.timestamp), Number.MAX_SAFE_INTEGER),
        eventKinds: [...new Set(bucket.map((event) => event.kind))]
      }))
      .sort((left, right) => right.timestamp - left.timestamp);
  }

  async getTurnRationale(
    conversationId: string,
    turnId: string
  ): Promise<RationaleTrace> {
    return this.rationaleTraceBuilder.buildTrace(conversationId, turnId);
  }
}
