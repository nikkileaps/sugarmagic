/**
 * packages/runtime-core/src/telemetry/index.ts
 *
 * Purpose: One way for any runtime system to emit a telemetry event, and one
 *   way for those events to reach the gateway.
 *
 * Exports:
 *   - TelemetryEventBase, TelemetryEvent, TelemetryCollector, TelemetryLogger
 *   - TELEMETRY_SCHEMA_VERSION, TELEMETRY_INGEST_ROUTE_PATH
 *   - createTelemetryEvent, emitTelemetry, flushTelemetry
 *   - GatewayTelemetryCollector, NoOpTelemetryCollector
 *   - createNoOpTelemetryCollector
 *
 * WHY IT LIVES IN RUNTIME-CORE
 *   Telemetry is not owned by one plugin. Sugarlang records what it taught,
 *   sugaragent records the turns it could not answer, and the runtime records
 *   its own lifecycle. Every one of them already depends on runtime-core, so
 *   this is the one place all of them can reach. A plugin cannot import
 *   another plugin's catalog, so a sink owned by one of them can only ever
 *   serve that one.
 *
 * WHERE EVENTS GO
 *   The collector batches and POSTs to the gateway, which writes each event as
 *   one JSON line to stdout. Cloud Run collects that into Cloud Logging, where
 *   the event is a `jsonPayload` keyed on `kind`; locally the same line shows
 *   up in `docker compose logs`.
 *
 * THE EVENT SHAPE IS OPEN
 *   Each producer declares its own `kind` values and its own payload fields
 *   over the shared envelope. A closed union here would mean one producer's
 *   events cannot typecheck against another producer's sink.
 *
 * Status: active
 */

import { getActiveAccessToken } from "../identity";

/** v2: sugarlang event payloads carry `regionId` where v1 wrote the same
 *  region value as `sceneId`. Log queries filtering on that field pin by
 *  schemaVersion to keep old and new records separable. */
export const TELEMETRY_SCHEMA_VERSION = 2 as const;

/**
 * The gateway path every producer POSTs to. The deployment requirement that
 * declares the route reads this too, so the path is written once.
 */
export const TELEMETRY_INGEST_ROUTE_PATH = "/api/telemetry";

/** Matches the gateway's per-request cap, so a batch is never partly dropped. */
const BATCH_SIZE_CAP = 100;

const DEFAULT_FLUSH_INTERVAL_MS = 5000;

/**
 * What every event carries, whoever produced it. `kind` is
 * `family.kebab-case-event` -- Cloud Logging queries key on it, so the naming
 * is load-bearing rather than cosmetic.
 *
 * The three ids are optional because not every event happens inside a turn,
 * but an event that can carry them should: they are what joins one producer's
 * events to another's.
 */
export interface TelemetryEventBase {
  eventId: string;
  schemaVersion: typeof TELEMETRY_SCHEMA_VERSION;
  timestamp: number;
  kind: string;
  conversationId?: string;
  turnId?: string;
  sessionId?: string;
}

/**
 * An event as a producer builds one: the envelope plus its own fields,
 * flattened onto it rather than nested under a payload key.
 *
 * A producer with a typed event union of its own emits it directly -- the
 * collector takes `TelemetryEventBase`, so a narrower type is accepted and
 * its extra fields ride along to the gateway untouched.
 */
export type TelemetryEvent = TelemetryEventBase & Record<string, unknown>;

export interface TelemetryLogger {
  warn: (message: string, payload?: Record<string, unknown>) => void;
}

/**
 * The contract a runtime system emits through. Emitting must never block or
 * fail a turn, so `emit` returns void and the collector swallows delivery
 * problems -- see `GatewayTelemetryCollector.flush` for what it says when
 * delivery stops working.
 */
export interface TelemetryCollector {
  emit: (event: TelemetryEventBase) => void | Promise<void>;
  flush?: () => Promise<void>;
  /** Flushes buffered events and tears down timers and listeners. */
  dispose?: () => Promise<void> | void;
}

let eventCounter = 0;

function createEventId(): string {
  eventCounter += 1;
  return `telemetry:${Date.now()}:${eventCounter}`;
}

/**
 * Stamps the envelope fields a producer should not have to think about. The
 * producer supplies `timestamp` and whichever ids it has.
 */
export function createTelemetryEvent(
  kind: string,
  payload: Record<string, unknown> &
    Partial<
      Pick<TelemetryEventBase, "eventId" | "conversationId" | "turnId" | "sessionId">
    > & { timestamp: number }
): TelemetryEvent {
  return {
    eventId: payload.eventId ?? createEventId(),
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    kind,
    ...payload
  };
}

/** Emit without letting a broken collector reach the caller. */
export async function emitTelemetry(
  collector: TelemetryCollector,
  event: TelemetryEventBase,
  logger?: TelemetryLogger
): Promise<void> {
  try {
    await collector.emit(event);
  } catch (error) {
    logger?.warn("[telemetry] emit failed; dropping event.", {
      reason: error instanceof Error ? error.message : String(error),
      eventKind: event.kind
    });
  }
}

/** Flush without letting a broken collector reach the caller. */
export async function flushTelemetry(
  collector: TelemetryCollector,
  logger?: TelemetryLogger
): Promise<void> {
  try {
    await collector.flush?.();
  } catch (error) {
    logger?.warn("[telemetry] flush failed; dropping buffered events.", {
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Player text a producer may have put on an event, removed before it leaves
 * the browser. Each producer names its own fields; the gateway deletes the
 * same names again on the way in, because an old client is still a client.
 */
export interface TelemetryPiiPolicy {
  /** Top-level event keys to drop. */
  fields?: readonly string[];
  /**
   * Per-key rewriters for text nested inside a structure, keyed by the field
   * holding it. A producer that nests player text owns the knowledge of where.
   */
  nested?: Readonly<Record<string, (value: unknown) => unknown>>;
}

/**
 * Player words any producer might have put on an event, removed before it
 * leaves the browser.
 *
 * Every producer's fields sit in this one list on purpose. A strip that each
 * producer performed for itself would be enforced nowhere, and one producer
 * forgetting is a player's typing on the wire. The gateway keeps its own copy
 * of the same names and deletes them again on arrival -- it compiles
 * standalone and cannot import this -- so an old client still cannot log
 * player text. Add a field here, and there, when a new event carries words the
 * player wrote.
 */
export const PLAYER_TEXT_PII_POLICY: TelemetryPiiPolicy = {
  fields: ["inputText", "originalText", "repairedText", "playerResponseText"],
  nested: {
    // An observation array carries the player's typing one level down, at
    // observations[].observation.inputText. Strip that one known path;
    // anything broader belongs in a deliberate schema change rather than a
    // deep scrubber that guesses.
    observations: (value) => {
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
  }
};

function scrubEvent(
  event: TelemetryEventBase,
  policy: TelemetryPiiPolicy | undefined
): Record<string, unknown> {
  const drop = new Set(policy?.fields ?? []);
  const nested = policy?.nested ?? {};
  const scrubbed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (drop.has(key)) {
      continue;
    }
    const rewrite = nested[key];
    scrubbed[key] = rewrite ? rewrite(value) : value;
  }
  return scrubbed;
}

export interface GatewayTelemetryCollectorOptions {
  proxyBaseUrl: string;
  /** Defaults to TELEMETRY_INGEST_ROUTE_PATH. */
  routePath?: string;
  /** Defaults to PLAYER_TEXT_PII_POLICY. Pass a policy only to narrow or widen
   *  it in a test; production has one list so the strip is enforced in one
   *  place. */
  pii?: TelemetryPiiPolicy;
  flushIntervalMs?: number;
  /** Injectable so a test can assert the authorization header. */
  getAccessToken?: () => Promise<string | null>;
  /** Defaults to console, because a sink that cannot say it is broken is how
   *  this went unnoticed for nine days once already. */
  logger?: TelemetryLogger;
}

/**
 * Batches events and POSTs them to the gateway.
 *
 * Delivery is best-effort by design: a turn must never wait on telemetry and
 * must never fail because of it. But best-effort is not the same as silent --
 * `flush` reports the first failure after a run of successes, so a route that
 * stops accepting events is visible in the console instead of being inferred
 * months later from empty dashboards.
 */
export class GatewayTelemetryCollector implements TelemetryCollector {
  private readonly url: string;
  private readonly flushIntervalMs: number;
  private readonly pii: TelemetryPiiPolicy | undefined;
  private readonly logger: TelemetryLogger;
  private readonly pending: TelemetryEventBase[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  /** Bound so dispose() removes exactly what the constructor added. */
  private readonly handlePageHide = (): void => {
    this.flushOnHide();
  };
  private readonly handleVisibilityChange = (): void => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      this.flushOnHide();
    }
  };

  /** A gateway in `supabase-jwt` mode answers 401 without this. */
  private readonly getAccessToken: () => Promise<string | null>;

  /** Last token seen by `flush()`. The unload path is synchronous -- an awaited
   *  fetch never completes after unload -- so it reuses this rather than
   *  asking for a fresh one. Tokens last about an hour and unload follows play
   *  by seconds, so a stale value costs at worst the final batch. */
  private lastToken = "";

  /** Whether the last completed flush delivered. Starts true so the first
   *  failure is the one that gets reported. */
  private lastDeliveryOk = true;

  constructor(options: GatewayTelemetryCollectorOptions) {
    const base = options.proxyBaseUrl.endsWith("/")
      ? options.proxyBaseUrl.slice(0, -1)
      : options.proxyBaseUrl;
    this.url = `${base}${options.routePath ?? TELEMETRY_INGEST_ROUTE_PATH}`;
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.pii = options.pii ?? PLAYER_TEXT_PII_POLICY;
    this.logger = options.logger ?? {
      warn: (message, payload) => console.warn(message, payload ?? {})
    };
    this.getAccessToken = options.getAccessToken ?? getActiveAccessToken;
    this.warmToken();
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", this.handlePageHide);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }
  }

  /**
   * Warmed at construction so the unload path has a token even when nothing
   * flushed first. A session shorter than one flush interval sends exactly one
   * request -- the one on the way out -- and unauthenticated it is thrown away,
   * which loses precisely the short sessions worth looking at.
   *
   * Fire-and-forget: constructing a collector must not wait on the network.
   */
  private warmToken(): void {
    void this.getAccessToken()
      .then((token) => {
        if (!this.lastToken) this.lastToken = token?.trim() ?? "";
      })
      .catch(() => {
        // No token is the same as having none yet; nothing to add.
      });
  }

  emit(event: TelemetryEventBase): void {
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
    const batch = this.pending.splice(0, BATCH_SIZE_CAP);
    if (this.pending.length > 0) {
      // A burst larger than the cap must not strand the remainder until the
      // next emit; drain it on the next tick.
      this.scheduleFlush(0);
    }
    try {
      const token = (await this.getAccessToken())?.trim() ?? "";
      // Remembered for the unload path below, which cannot await.
      this.lastToken = token;
      const response = await fetch(this.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          events: batch.map((event) => scrubEvent(event, this.pii)),
          schemaVersion: TELEMETRY_SCHEMA_VERSION
        })
      });
      this.noteDelivery(response.ok, {
        status: response.status,
        droppedEvents: batch.length
      });
    } catch (error) {
      this.noteDelivery(false, {
        reason: error instanceof Error ? error.message : String(error),
        droppedEvents: batch.length
      });
    }
  }

  /**
   * Says something the first time delivery breaks and the first time it comes
   * back, and nothing in between -- a warning every five seconds for an hour
   * is its own kind of silence.
   */
  private noteDelivery(ok: boolean, payload: Record<string, unknown>): void {
    if (ok === this.lastDeliveryOk) {
      return;
    }
    this.lastDeliveryOk = ok;
    if (ok) {
      this.logger.warn("[telemetry] delivery recovered.", { url: this.url });
      return;
    }
    this.logger.warn(
      "[telemetry] delivery failed; events are being dropped. Later failures stay quiet until it recovers.",
      { url: this.url, ...payload }
    );
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
  // which matches the posture everywhere else here. Nothing can read the
  // response on this path, so it cannot report a failure either.
  private flushOnHide(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    while (this.pending.length > 0) {
      const batch = this.pending.splice(0, BATCH_SIZE_CAP);
      try {
        void fetch(this.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(this.lastToken ? { authorization: `Bearer ${this.lastToken}` } : {})
          },
          keepalive: true,
          body: JSON.stringify({
            events: batch.map((event) => scrubEvent(event, this.pii)),
            schemaVersion: TELEMETRY_SCHEMA_VERSION
          })
        });
      } catch {
        // drop-on-failure: never block unload
      }
    }
  }
}

/**
 * A collector a plugin can hold before the host has handed one over.
 *
 * A plugin builds its services when it is constructed, but only receives the
 * host's collector at `init`. Without this, everything built in between would
 * capture whatever was available at construction -- which is nothing -- and
 * silently emit into it forever. Anything emitted before the bind is dropped,
 * the same answer it would get with no gateway configured.
 */
export class BindableTelemetryCollector implements TelemetryCollector {
  private collector: TelemetryCollector | null = null;

  bind(collector: TelemetryCollector | null): void {
    this.collector = collector;
  }

  emit(event: TelemetryEventBase): void | Promise<void> {
    return this.collector?.emit(event);
  }

  async flush(): Promise<void> {
    await this.collector?.flush?.();
  }

  /**
   * Unbinds only. The collector belongs to the host, which outlives any one
   * plugin and has other producers on it -- disposing it here would take their
   * telemetry down too.
   */
  dispose(): void {
    this.collector = null;
  }
}

/** What a runtime with no gateway to POST to emits through. */
export class NoOpTelemetryCollector implements TelemetryCollector {
  emit(): void {
    // Nowhere to send it.
  }

  async flush(): Promise<void> {
    // Nothing buffered.
  }
}

export function createNoOpTelemetryCollector(): TelemetryCollector {
  return new NoOpTelemetryCollector();
}
