/**
 * packages/plugins/src/catalog/sugarlang/tests/telemetry/telemetry.test.ts
 *
 * Purpose: Verifies Sugarlang telemetry sink behavior and query semantics.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/telemetry/telemetry.
 *   - Covers the Epic 13 sink contract directly instead of only through middleware side effects.
 *
 * Implements: Epic 13 Story 13.1 / Story 13.2
 *
 * Status: active
 */

import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  IndexedDBTelemetrySink,
  MemoryTelemetrySink,
  createTelemetryEvent
} from "../../runtime/telemetry/telemetry";

describe("telemetry sinks", () => {
  it("stores and queries events in memory with ring-buffer wraparound", async () => {
    const sink = new MemoryTelemetrySink({ capacity: 2 });
    sink.emit(
      createTelemetryEvent("session.started", {
        sessionId: "session-1",
        timestamp: 1,
        learnerId: "learner-1"
      })
    );
    sink.emit(
      createTelemetryEvent("session.started", {
        sessionId: "session-2",
        timestamp: 2,
        learnerId: "learner-2"
      })
    );
    sink.emit(
      createTelemetryEvent("session.started", {
        sessionId: "session-3",
        timestamp: 3,
        learnerId: "learner-3"
      })
    );

    const events = await sink.query({});
    expect(events).toHaveLength(2);
    expect(events[0]?.sessionId).toBe("session-2");
    expect(events[1]?.sessionId).toBe("session-3");
  });

  it("persists and queries events through IndexedDB", async () => {
    const sink = new IndexedDBTelemetrySink({
      workspaceId: "telemetry-test",
      flushIntervalMs: 0,
      capacity: 20
    });
    sink.emit(
      createTelemetryEvent("session.started", {
        sessionId: "session-idb",
        conversationId: "conversation-1",
        turnId: "turn-1",
        timestamp: 10,
        learnerId: "learner-idb"
      })
    );
    await sink.flush();

    const events = await sink.query({ conversationId: "conversation-1" });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        kind: "session.started",
        sessionId: "session-idb"
      })
    );
  });
});
