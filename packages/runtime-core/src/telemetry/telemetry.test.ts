/**
 * packages/runtime-core/src/telemetry/telemetry.test.ts
 *
 * Purpose: the shared collector batches, scrubs player text, authenticates,
 *   and says so when delivery stops working.
 *
 * The last one is why this file exists at all. The sink this replaces awaited
 * its POST and never read the status, so a route that answered 404 for nine
 * days looked exactly like one that was recording. The dashboards built on it
 * held nothing.
 *
 * Status: active
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTelemetryEvent,
  GatewayTelemetryCollector,
  TELEMETRY_INGEST_ROUTE_PATH,
  TELEMETRY_SCHEMA_VERSION
} from "./index";

const ORIGINAL_FETCH = globalThis.fetch;

function okResponse(): Response {
  return { ok: true, status: 200 } as Response;
}

function errorResponse(status: number): Response {
  return { ok: false, status } as Response;
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return createTelemetryEvent("test.event", {
    timestamp: 1000,
    sessionId: "session-1",
    turnId: "turn-1",
    ...overrides
  });
}

/** Reads the parsed body of the nth fetch call. */
function bodyOf(fetchMock: ReturnType<typeof vi.fn>, callIndex = 0) {
  const init = fetchMock.mock.calls[callIndex]?.[1] as RequestInit;
  return JSON.parse(String(init.body)) as {
    events: Array<Record<string, unknown>>;
    schemaVersion: number;
  };
}

describe("GatewayTelemetryCollector", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn(async () => okResponse());
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("POSTs to the shared ingest route under the proxy base", async () => {
    const collector = new GatewayTelemetryCollector({
      proxyBaseUrl: "https://gateway.example.com",
      getAccessToken: async () => "token-abc"
    });

    collector.emit(makeEvent());
    await collector.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://gateway.example.com${TELEMETRY_INGEST_ROUTE_PATH}`
    );
  });

  it("trims one trailing slash off the proxy base rather than doubling it", async () => {
    const collector = new GatewayTelemetryCollector({
      proxyBaseUrl: "https://gateway.example.com/",
      getAccessToken: async () => null
    });

    collector.emit(makeEvent());
    await collector.flush();

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://gateway.example.com${TELEMETRY_INGEST_ROUTE_PATH}`
    );
  });

  it("sends the access token, because the gateway answers 401 without it", async () => {
    const collector = new GatewayTelemetryCollector({
      proxyBaseUrl: "https://gateway.example.com",
      getAccessToken: async () => "token-abc"
    });

    collector.emit(makeEvent());
    await collector.flush();

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer token-abc"
    );
  });

  it("omits the authorization header when there is no token", async () => {
    const collector = new GatewayTelemetryCollector({
      proxyBaseUrl: "https://gateway.example.com",
      getAccessToken: async () => null
    });

    collector.emit(makeEvent());
    await collector.flush();

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("stamps the envelope and keeps producer fields alongside it", async () => {
    const collector = new GatewayTelemetryCollector({
      proxyBaseUrl: "https://gateway.example.com",
      getAccessToken: async () => null
    });

    collector.emit(makeEvent({ trigger: "audit-violations" }));
    await collector.flush();

    const body = bodyOf(fetchMock);
    expect(body.schemaVersion).toBe(TELEMETRY_SCHEMA_VERSION);
    const [event] = body.events;
    expect(event?.kind).toBe("test.event");
    expect(event?.sessionId).toBe("session-1");
    expect(event?.turnId).toBe("turn-1");
    expect(event?.trigger).toBe("audit-violations");
    expect(event?.eventId).toEqual(expect.any(String));
  });

  it("strips the producer's declared PII fields before the event leaves", async () => {
    const collector = new GatewayTelemetryCollector({
      proxyBaseUrl: "https://gateway.example.com",
      getAccessToken: async () => null,
      pii: { fields: ["inputText", "playerResponseText"] }
    });

    collector.emit(
      makeEvent({
        inputText: "what the player typed",
        playerResponseText: "also the player",
        npcId: "npc-1"
      })
    );
    await collector.flush();

    const [event] = bodyOf(fetchMock).events;
    expect(event).not.toHaveProperty("inputText");
    expect(event).not.toHaveProperty("playerResponseText");
    expect(event?.npcId).toBe("npc-1");
  });

  it("runs the producer's nested scrubber on the field that holds nested text", async () => {
    const collector = new GatewayTelemetryCollector({
      proxyBaseUrl: "https://gateway.example.com",
      getAccessToken: async () => null,
      pii: {
        nested: {
          observations: (value) =>
            (value as Array<{ observation: Record<string, unknown> }>).map(
              (entry) => {
                const observation = { ...entry.observation };
                delete observation.inputText;
                return { observation };
              }
            )
        }
      }
    });

    collector.emit(
      makeEvent({
        observations: [{ observation: { inputText: "player text", lemmaId: "hola" } }]
      })
    );
    await collector.flush();

    const [event] = bodyOf(fetchMock).events;
    const observations = event?.observations as Array<{
      observation: Record<string, unknown>;
    }>;
    expect(observations[0]?.observation).not.toHaveProperty("inputText");
    expect(observations[0]?.observation.lemmaId).toBe("hola");
  });

  it("batches everything emitted before the flush timer fires", async () => {
    const collector = new GatewayTelemetryCollector({
      proxyBaseUrl: "https://gateway.example.com",
      getAccessToken: async () => null,
      flushIntervalMs: 5000
    });

    collector.emit(makeEvent({ kind: "test.one" }));
    collector.emit(makeEvent({ kind: "test.two" }));
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock).events).toHaveLength(2);
  });

  it("splits a burst larger than the batch cap instead of stranding the rest", async () => {
    const collector = new GatewayTelemetryCollector({
      proxyBaseUrl: "https://gateway.example.com",
      getAccessToken: async () => null,
      flushIntervalMs: 5000
    });

    for (let i = 0; i < 150; i++) {
      collector.emit(makeEvent());
    }
    await vi.advanceTimersByTimeAsync(5000);
    await vi.runOnlyPendingTimersAsync();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchMock, 0).events).toHaveLength(100);
    expect(bodyOf(fetchMock, 1).events).toHaveLength(50);
  });

  it("reports a non-2xx response instead of treating it as delivered", async () => {
    const warn = vi.fn();
    fetchMock.mockResolvedValue(errorResponse(404));
    const collector = new GatewayTelemetryCollector({
      proxyBaseUrl: "https://gateway.example.com",
      getAccessToken: async () => null,
      logger: { warn }
    });

    collector.emit(makeEvent());
    await collector.flush();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[1]).toMatchObject({ status: 404 });
  });

  it("reports a thrown request too", async () => {
    const warn = vi.fn();
    fetchMock.mockRejectedValue(new Error("network down"));
    const collector = new GatewayTelemetryCollector({
      proxyBaseUrl: "https://gateway.example.com",
      getAccessToken: async () => null,
      logger: { warn }
    });

    collector.emit(makeEvent());
    await collector.flush();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[1]).toMatchObject({ reason: "network down" });
  });

  it("does not fail the caller when delivery fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const collector = new GatewayTelemetryCollector({
      proxyBaseUrl: "https://gateway.example.com",
      getAccessToken: async () => null,
      logger: { warn: vi.fn() }
    });

    collector.emit(makeEvent());
    await expect(collector.flush()).resolves.toBeUndefined();
  });

  it("reports the first failure only, then the recovery", async () => {
    const warn = vi.fn();
    fetchMock.mockResolvedValue(errorResponse(500));
    const collector = new GatewayTelemetryCollector({
      proxyBaseUrl: "https://gateway.example.com",
      getAccessToken: async () => null,
      logger: { warn }
    });

    collector.emit(makeEvent());
    await collector.flush();
    collector.emit(makeEvent());
    await collector.flush();
    collector.emit(makeEvent());
    await collector.flush();

    expect(warn).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValue(okResponse());
    collector.emit(makeEvent());
    await collector.flush();

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1]?.[0]).toContain("recovered");
  });

  it("drops emits after dispose and drains what was already buffered", async () => {
    const collector = new GatewayTelemetryCollector({
      proxyBaseUrl: "https://gateway.example.com",
      getAccessToken: async () => null
    });

    collector.emit(makeEvent());
    await collector.dispose();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    collector.emit(makeEvent());
    await collector.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
