/**
 * packages/runtime-core/src/save/participant.test.ts
 *
 * Purpose: Verifies the SaveParticipant registry contract —
 * dispatch order, tier ordering, error isolation, and slice
 * envelope wrapping.
 *
 * Implements: Plan 055 §055.1 tests
 *
 * Status: active
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type SaveParticipant,
  type SaveSlice,
  SaveParticipantRegistry
} from "./participant";

interface RecordedCall {
  id: string;
  slice: SaveSlice<unknown> | null;
}

function makeParticipant(overrides: {
  id: string;
  tier?: SaveParticipant["tier"];
  schemaVersion?: number;
  data?: unknown;
  onDeserialize?: (slice: SaveSlice<unknown> | null) => void;
  onSerialize?: () => unknown;
}): SaveParticipant<unknown> {
  return {
    participantId: overrides.id,
    tier: overrides.tier,
    schemaVersion: overrides.schemaVersion ?? 1,
    serialize: overrides.onSerialize ?? (() => overrides.data ?? null),
    deserialize:
      overrides.onDeserialize ??
      (() => {
        /* default noop */
      })
  };
}

describe("SaveParticipantRegistry", () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe("register / unregister / list", () => {
    it("tracks registered participants in registration order", () => {
      const registry = new SaveParticipantRegistry();
      registry.register(makeParticipant({ id: "b" }));
      registry.register(makeParticipant({ id: "a" }));
      registry.register(makeParticipant({ id: "c" }));

      expect(registry.list().map((p) => p.participantId)).toEqual([
        "b",
        "a",
        "c"
      ]);
    });

    it("unregister removes the participant and preserves order", () => {
      const registry = new SaveParticipantRegistry();
      registry.register(makeParticipant({ id: "a" }));
      registry.register(makeParticipant({ id: "b" }));
      registry.register(makeParticipant({ id: "c" }));

      registry.unregister("b");
      expect(registry.list().map((p) => p.participantId)).toEqual(["a", "c"]);
    });

    it("unregister of unknown id is a no-op", () => {
      const registry = new SaveParticipantRegistry();
      registry.register(makeParticipant({ id: "a" }));
      registry.unregister("nope");
      expect(registry.list().map((p) => p.participantId)).toEqual(["a"]);
    });

    it("registering a duplicate id warns and replaces (moving to end)", () => {
      const registry = new SaveParticipantRegistry();
      const first = makeParticipant({ id: "dup", data: "first" });
      const second = makeParticipant({ id: "dup", data: "second" });

      registry.register(makeParticipant({ id: "a" }));
      registry.register(first);
      registry.register(makeParticipant({ id: "b" }));
      registry.register(second);

      expect(consoleWarnSpy).toHaveBeenCalledOnce();
      expect(registry.list().map((p) => p.participantId)).toEqual([
        "a",
        "b",
        "dup"
      ]);
      const slices = registry.serializeAll();
      expect(slices["dup"]?.data).toBe("second");
    });
  });

  describe("deserializeAll", () => {
    it("dispatches each participant with its slice by participantId", () => {
      const registry = new SaveParticipantRegistry();
      const calls: RecordedCall[] = [];
      registry.register(
        makeParticipant({
          id: "a",
          onDeserialize: (slice) => calls.push({ id: "a", slice })
        })
      );
      registry.register(
        makeParticipant({
          id: "b",
          onDeserialize: (slice) => calls.push({ id: "b", slice })
        })
      );

      registry.deserializeAll({
        a: { schemaVersion: 1, data: { hello: "a" } },
        b: { schemaVersion: 2, data: { hello: "b" } }
      });

      expect(calls).toEqual([
        { id: "a", slice: { schemaVersion: 1, data: { hello: "a" } } },
        { id: "b", slice: { schemaVersion: 2, data: { hello: "b" } } }
      ]);
    });

    it("passes null for participants missing from the slice map", () => {
      const registry = new SaveParticipantRegistry();
      const calls: RecordedCall[] = [];
      registry.register(
        makeParticipant({
          id: "a",
          onDeserialize: (slice) => calls.push({ id: "a", slice })
        })
      );
      registry.register(
        makeParticipant({
          id: "missing",
          onDeserialize: (slice) => calls.push({ id: "missing", slice })
        })
      );

      registry.deserializeAll({
        a: { schemaVersion: 1, data: 42 }
      });

      expect(calls).toEqual([
        { id: "a", slice: { schemaVersion: 1, data: 42 } },
        { id: "missing", slice: null }
      ]);
    });

    it("orders by tier: host-owned first, then region-aware, then default", () => {
      const registry = new SaveParticipantRegistry();
      const order: string[] = [];
      // Register in a deliberately shuffled order to prove the
      // tier reordering is happening, not just registration order.
      registry.register(
        makeParticipant({
          id: "d1",
          tier: "default",
          onDeserialize: () => order.push("d1")
        })
      );
      registry.register(
        makeParticipant({
          id: "r1",
          tier: "region-aware",
          onDeserialize: () => order.push("r1")
        })
      );
      registry.register(
        makeParticipant({
          id: "h1",
          tier: "host-owned",
          onDeserialize: () => order.push("h1")
        })
      );
      registry.register(
        makeParticipant({
          id: "h2",
          tier: "host-owned",
          onDeserialize: () => order.push("h2")
        })
      );
      registry.register(
        makeParticipant({
          id: "d2",
          // No tier -> should default to "default".
          onDeserialize: () => order.push("d2")
        })
      );

      registry.deserializeAll({});

      // Within a tier, registration order is preserved.
      expect(order).toEqual(["h1", "h2", "r1", "d1", "d2"]);
    });

    it("tier filter restricts dispatch to matching tiers only", () => {
      const registry = new SaveParticipantRegistry();
      const order: string[] = [];
      registry.register(
        makeParticipant({
          id: "h",
          tier: "host-owned",
          onDeserialize: () => order.push("h")
        })
      );
      registry.register(
        makeParticipant({
          id: "r",
          tier: "region-aware",
          onDeserialize: () => order.push("r")
        })
      );
      registry.register(
        makeParticipant({
          id: "d",
          tier: "default",
          onDeserialize: () => order.push("d")
        })
      );

      // Phase 1: host-owned only
      registry.deserializeAll({}, ["host-owned"]);
      expect(order).toEqual(["h"]);

      // Phase 2: everyone else
      order.length = 0;
      registry.deserializeAll({}, ["region-aware", "default"]);
      expect(order).toEqual(["r", "d"]);
    });

    it("isolates a throwing deserialize — others still run and error is logged", () => {
      const registry = new SaveParticipantRegistry();
      const order: string[] = [];
      registry.register(
        makeParticipant({
          id: "before",
          onDeserialize: () => order.push("before")
        })
      );
      registry.register(
        makeParticipant({
          id: "broken",
          onDeserialize: () => {
            order.push("broken-entered");
            throw new Error("kaboom");
          }
        })
      );
      registry.register(
        makeParticipant({
          id: "after",
          onDeserialize: () => order.push("after")
        })
      );

      registry.deserializeAll({});

      expect(order).toEqual(["before", "broken-entered", "after"]);
      expect(consoleErrorSpy).toHaveBeenCalledOnce();
    });
  });

  describe("serializeAll", () => {
    it("wraps each participant's slice with its schemaVersion", () => {
      const registry = new SaveParticipantRegistry();
      registry.register(
        makeParticipant({
          id: "a",
          schemaVersion: 3,
          data: { count: 1 }
        })
      );
      registry.register(
        makeParticipant({
          id: "b",
          schemaVersion: 1,
          data: { name: "bob" }
        })
      );

      expect(registry.serializeAll()).toEqual({
        a: { schemaVersion: 3, data: { count: 1 } },
        b: { schemaVersion: 1, data: { name: "bob" } }
      });
    });

    it("drops a throwing participant from the map but includes the rest", () => {
      const registry = new SaveParticipantRegistry();
      registry.register(makeParticipant({ id: "ok-1", data: "one" }));
      registry.register(
        makeParticipant({
          id: "broken",
          onSerialize: () => {
            throw new Error("kaboom");
          }
        })
      );
      registry.register(makeParticipant({ id: "ok-2", data: "two" }));

      const slices = registry.serializeAll();
      expect(Object.keys(slices).sort()).toEqual(["ok-1", "ok-2"]);
      expect(slices["ok-1"]?.data).toBe("one");
      expect(slices["ok-2"]?.data).toBe("two");
      expect(consoleErrorSpy).toHaveBeenCalledOnce();
    });

    it("returns an empty map for an empty registry", () => {
      const registry = new SaveParticipantRegistry();
      expect(registry.serializeAll()).toEqual({});
    });
  });
});
