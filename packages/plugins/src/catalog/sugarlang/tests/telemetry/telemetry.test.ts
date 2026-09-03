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

import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayTelemetryCollector } from "@sugarmagic/runtime-core";
import {
  HostTelemetrySink,
  MemoryTelemetrySink,
  NoOpTelemetrySink,
  createTelemetryEvent
} from "../../runtime/telemetry/telemetry";

function stubFetch(): {
  fetchMock: ReturnType<typeof vi.fn>;
  bodies: Array<{ events: Array<Record<string, unknown>> }>;
} {
  const bodies: Array<{ events: Array<Record<string, unknown>> }> = [];
  const fetchMock = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    bodies.push(JSON.parse(String(init?.body)));
    return { ok: true };
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, bodies };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

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

  it("stores and queries the chunk telemetry event family", async () => {
    const sink = new MemoryTelemetrySink();
    sink.emit(
      createTelemetryEvent("chunk.extraction-started", {
        timestamp: 1,
        regionId: "scene-1",
        contentHash: "hash-1",
        lang: "es",
        extractorModel: "claude-sonnet-4-6",
        extractorPromptVersion: "1"
      })
    );
    sink.emit(
      createTelemetryEvent("chunk.hit-during-classification", {
        timestamp: 2,
        conversationId: "conversation-1",
        turnId: "turn-1",
        regionId: "scene-1",
        matchedChunks: [
          {
            chunkId: "de_vez_en_cuando",
            cefrBand: "A2",
            surfaceMatched: "de vez en cuando"
          }
        ]
      })
    );

    const events = await sink.query({
      eventKinds: [
        "chunk.extraction-started",
        "chunk.hit-during-classification"
      ]
    });
    expect(events.map((event) => event.kind)).toEqual([
      "chunk.extraction-started",
      "chunk.hit-during-classification"
    ]);
  });
});


describe("HostTelemetrySink", () => {
  it("forwards to the host's collector once bound", async () => {
    const emitted: Array<{ kind: string }> = [];
    const sink = new HostTelemetrySink();
    sink.bind({ emit: (event) => void emitted.push({ kind: event.kind }) });

    sink.emit(createTelemetryEvent("session.started", { timestamp: 1 }));

    expect(emitted.map((event) => event.kind)).toEqual(["session.started"]);
  });

  it("drops events before the runtime binds instead of throwing", () => {
    const sink = new HostTelemetrySink();
    expect(() =>
      sink.emit(createTelemetryEvent("session.started", { timestamp: 1 }))
    ).not.toThrow();
  });

  it("drops events when the host supplies no collector", () => {
    const sink = new HostTelemetrySink();
    sink.bind(null);
    expect(() =>
      sink.emit(createTelemetryEvent("session.started", { timestamp: 1 }))
    ).not.toThrow();
  });

  it("unbinds on dispose without disposing the host's collector, which outlives this plugin", () => {
    const dispose = vi.fn();
    const emit = vi.fn();
    const sink = new HostTelemetrySink();
    sink.bind({ emit, dispose });

    sink.dispose();
    sink.emit(createTelemetryEvent("session.started", { timestamp: 1 }));

    expect(dispose).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
});

describe("sugarlang events on the shared collector", () => {
  it("THE PII CONTRACT: the shared default policy strips sugarlang's player text", async () => {
    // Sugarlang no longer owns the strip -- the collector does, from one list.
    // This asserts the real event shapes sugarlang produces are covered by
    // that list, so a player's typing cannot reach the gateway.
    const { bodies } = stubFetch();
    const collector = new GatewayTelemetryCollector({
      proxyBaseUrl: "http://gateway.test",
      flushIntervalMs: 60_000,
      getAccessToken: async () => null
    });
    const sink = new HostTelemetrySink();
    sink.bind(collector);

    sink.emit(
      createTelemetryEvent("observe.observations-applied", {
        timestamp: 1,
        regionId: "scene-1",
        observations: [
          {
            observation: {
              kind: "produced-typed",
              inputText: "manzana",
              observedAtMs: 1
            },
            lemma: { lemmaId: "manzana", lang: "es" },
            context: {
              sessionId: "session-pii",
              turnId: "turn-1",
              regionId: "scene-1",
              lang: "es",
              conversationId: "conversation-1"
            }
          }
        ],
        learnerDelta: {}
      })
    );
    sink.emit(
      createTelemetryEvent("comprehension.probe-passed", {
        timestamp: 2,
        probeId: "probe-1",
        regionId: "scene-1",
        npcId: null,
        npcDisplayName: null,
        targetLemmas: [{ lemmaId: "manzana", lang: "es" }],
        playerResponseText: "una manzana",
        lemmasPassed: ["manzana"],
        classifierReasoning: "matched",
        predictedRetrievabilities: { manzana: 0.9 }
      })
    );

    await collector.flush();

    const [applied, probePassed] = bodies[0]!.events;
    const observationEntry = (
      applied!.observations as Array<{ observation: Record<string, unknown> }>
    )[0]!;
    expect(observationEntry.observation).not.toHaveProperty("inputText");
    expect(observationEntry.observation).toMatchObject({
      kind: "produced-typed",
      observedAtMs: 1
    });
    expect(probePassed).not.toHaveProperty("playerResponseText");
    expect(probePassed).toMatchObject({
      predictedRetrievabilities: { manzana: 0.9 },
      lemmasPassed: ["manzana"]
    });
    await collector.dispose();
  });
});
