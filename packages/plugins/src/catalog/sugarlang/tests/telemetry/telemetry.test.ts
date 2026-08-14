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
import {
  GatewaySugarlangTelemetrySink,
  MemoryTelemetrySink,
  NoOpTelemetrySink,
  createTelemetryEvent,
  resolveSugarlangTelemetrySink
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
        sceneId: "scene-1",
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
        sceneId: "scene-1",
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

describe("GatewaySugarlangTelemetrySink", () => {
  it("THE PROD BUG: sends the player's token, or the gateway 401s every event", async () => {
    // A deployed gateway in `supabase-jwt` mode rejected every telemetry POST
    // because this sink sent no Authorization header at all. Production
    // teaching analytics were silently empty for the life of the deployment.
    const { fetchMock } = stubFetch();
    const sink = new GatewaySugarlangTelemetrySink({
      proxyBaseUrl: "http://gateway.test",
      flushIntervalMs: 1,
      getAccessToken: async () => "jwt-abc"
    });
    sink.emit(createTelemetryEvent("session.started", { timestamp: 1 }));
    await sink.dispose();

    const headers = (fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> })
      .headers;
    expect(headers.authorization).toBe("Bearer jwt-abc");
  });

  it("sends NO auth header when there is no token, so an open gateway still works", async () => {
    const { fetchMock } = stubFetch();
    const sink = new GatewaySugarlangTelemetrySink({
      proxyBaseUrl: "http://gateway.test",
      flushIntervalMs: 1,
      getAccessToken: async () => null
    });
    sink.emit(createTelemetryEvent("session.started", { timestamp: 1 }));
    await sink.dispose();

    const headers = (fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> })
      .headers;
    expect(headers.authorization).toBeUndefined();
  });

  it("drains a burst larger than the batch cap without waiting for a later emit", async () => {
    vi.useFakeTimers();
    const { bodies } = stubFetch();
    const sink = new GatewaySugarlangTelemetrySink({
      proxyBaseUrl: "http://gateway.test",
      flushIntervalMs: 1000
    });
    for (let i = 0; i < 250; i += 1) {
      sink.emit(
        createTelemetryEvent("session.started", {
          timestamp: i,
          learnerId: `learner-${i}`
        })
      );
    }

    await vi.runAllTimersAsync();

    expect(bodies.map((body) => body.events.length)).toEqual([100, 100, 50]);
    await sink.dispose();
  });

  it("flushes every pending event on dispose and drops emits afterwards", async () => {
    const { fetchMock, bodies } = stubFetch();
    const sink = new GatewaySugarlangTelemetrySink({
      proxyBaseUrl: "http://gateway.test",
      flushIntervalMs: 60_000
    });
    for (let i = 0; i < 150; i += 1) {
      sink.emit(
        createTelemetryEvent("session.started", {
          timestamp: i,
          learnerId: `learner-${i}`
        })
      );
    }

    await sink.dispose();

    expect(bodies.map((body) => body.events.length)).toEqual([100, 50]);

    sink.emit(
      createTelemetryEvent("session.started", {
        timestamp: 151,
        learnerId: "learner-after-dispose"
      })
    );
    await sink.flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("strips top-level and nested observation PII before POSTing", async () => {
    const { bodies } = stubFetch();
    const sink = new GatewaySugarlangTelemetrySink({
      proxyBaseUrl: "http://gateway.test",
      flushIntervalMs: 60_000
    });
    sink.emit(
      createTelemetryEvent("observe.observations-applied", {
        timestamp: 1,
        sceneId: "scene-1",
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
              sceneId: "scene-1",
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
        sceneId: "scene-1",
        npcId: null,
        npcDisplayName: null,
        targetLemmas: [{ lemmaId: "manzana", lang: "es" }],
        playerResponseText: "una manzana",
        lemmasPassed: ["manzana"],
        classifierReasoning: "matched",
        predictedRetrievabilities: { manzana: 0.9 }
      })
    );

    await sink.flush();

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
    await sink.dispose();
  });
});

describe("resolveSugarlangTelemetrySink", () => {
  it("sends to the gateway when a proxy URL is configured", () => {
    const sink = resolveSugarlangTelemetrySink({
      proxyBaseUrl: "http://localhost:8080"
    });
    expect(sink).toBeInstanceOf(GatewaySugarlangTelemetrySink);
  });

  it("drops events when no proxy URL is configured", () => {
    expect(resolveSugarlangTelemetrySink()).toBeInstanceOf(NoOpTelemetrySink);
    expect(resolveSugarlangTelemetrySink({ proxyBaseUrl: "  " })).toBeInstanceOf(
      NoOpTelemetrySink
    );
  });

  it("gives Studio and the published game the same destination", async () => {
    // The whole point: no compile-profile branch. Preview cannot observe a
    // different system from the one that ships, so a gateway fault shows up
    // while authoring instead of only in production.
    const { fetchMock } = stubFetch();
    const sink = resolveSugarlangTelemetrySink({
      proxyBaseUrl: "http://gateway.test"
    });
    expect(sink).toBeInstanceOf(GatewaySugarlangTelemetrySink);

    sink.emit(
      createTelemetryEvent("session.started", {
        sessionId: "session-one-path",
        timestamp: 5,
        learnerId: "learner-one-path"
      })
    );
    await sink.flush?.();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await sink.dispose?.();
  });
});
