/**
 * packages/testing/src/caster-stats-save-slice.test.ts
 *
 * Purpose: Verifies the caster.stats save-participant pipeline.
 * CasterManager serialize/deserialize preserves battery +
 * resonance + any authored stats. StatCarrier's clamp-to-
 * definition handles legacy out-of-range values. Unknown stat
 * IDs drop with a warn. Participant factory forwards through the
 * getter and tolerates null (unset) CasterManager.
 *
 * Implements: Plan 056 §056.1 tests
 *
 * Status: active
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MechanicsDefinition } from "@sugarmagic/domain";
import { createDefaultMechanicsDefinition } from "@sugarmagic/domain";
import {
  Caster,
  CasterManager,
  PlayerControlled,
  World,
  createCasterStatsSaveParticipant,
  createStatCarrier
} from "@sugarmagic/runtime-core";
import type {
  CasterStatsSlice,
  SaveSlice
} from "@sugarmagic/runtime-core";

function buildWorldWithPlayerCaster(mechanics: MechanicsDefinition): {
  world: World;
  manager: CasterManager;
} {
  const world = new World();
  const player = world.createEntity();
  world.addComponent(player, new PlayerControlled());
  world.addComponent(player, new Caster(createStatCarrier(mechanics), [], []));
  const manager = new CasterManager();
  manager.setWorld(world);
  manager.registerMechanics(mechanics);
  return { world, manager };
}

describe("CasterManager save slice", () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  describe("round-trip", () => {
    it("preserves stat values through serialize/deserialize", () => {
      const mechanics = createDefaultMechanicsDefinition();
      const { manager: source } = buildWorldWithPlayerCaster(mechanics);

      // Drain battery to some intermediate value
      const batteryStatId = mechanics.stats.find(
        (s) => s.role === "battery"
      )!.id;
      const casterA = source.serializeSaveSlice();
      const initialBattery = casterA.casters["player"]!.stats[batteryStatId]!;

      // Poke the source directly to a value below max
      const world = new World();
      const entity = world.createEntity();
      world.addComponent(entity, new PlayerControlled());
      const stats = createStatCarrier(mechanics);
      stats.set(batteryStatId, Math.max(1, initialBattery - 3));
      world.addComponent(entity, new Caster(stats, [], []));
      const drained = new CasterManager();
      drained.setWorld(world);
      drained.registerMechanics(mechanics);

      const slice = drained.serializeSaveSlice();
      expect(slice.casters["player"]!.stats[batteryStatId]).toBe(
        Math.max(1, initialBattery - 3)
      );

      // Restore into a fresh manager and confirm the value came back
      const { manager: restored } = buildWorldWithPlayerCaster(mechanics);
      restored.deserializeSaveSlice({ schemaVersion: 1, data: slice });
      expect(restored.serializeSaveSlice().casters["player"]!.stats[batteryStatId]).toBe(
        Math.max(1, initialBattery - 3)
      );
    });

    it("returns an empty slice when the world has no caster", () => {
      const world = new World();
      const manager = new CasterManager();
      manager.setWorld(world);
      manager.registerMechanics(createDefaultMechanicsDefinition());
      expect(manager.serializeSaveSlice()).toEqual({ casters: {} });
    });
  });

  describe("tolerance", () => {
    it("drops unknown stat IDs with a warn", () => {
      const mechanics = createDefaultMechanicsDefinition();
      const { manager } = buildWorldWithPlayerCaster(mechanics);

      const slice: CasterStatsSlice = {
        casters: {
          player: {
            stats: {
              "stale.stat": 42
            }
          }
        }
      };
      manager.deserializeSaveSlice({ schemaVersion: 1, data: slice });
      expect(consoleWarnSpy).toHaveBeenCalledOnce();
      // Known stats untouched — the caster's default for each
      // real mechanics stat still equals its baseline.
      const post = manager.serializeSaveSlice();
      expect(post.casters["player"]!.stats["stale.stat"]).toBeUndefined();
    });

    it("clamps values to authored bounds via StatCarrier.set", () => {
      const mechanics = createDefaultMechanicsDefinition();
      const batteryStat = mechanics.stats.find((s) => s.role === "battery")!;
      const { manager } = buildWorldWithPlayerCaster(mechanics);

      // Feed in a value well above the authored max
      const wayTooHigh = (batteryStat.max ?? 100) + 500;
      manager.deserializeSaveSlice({
        schemaVersion: 1,
        data: {
          casters: {
            player: {
              stats: { [batteryStat.id]: wayTooHigh }
            }
          }
        }
      });
      const restored =
        manager.serializeSaveSlice().casters["player"]!.stats[batteryStat.id]!;
      expect(restored).toBeLessThanOrEqual(batteryStat.max ?? Infinity);
    });
  });

  describe("null / missing / partial slices", () => {
    it("deserialize(null) is a no-op", () => {
      const mechanics = createDefaultMechanicsDefinition();
      const { manager } = buildWorldWithPlayerCaster(mechanics);
      const before = manager.serializeSaveSlice();
      manager.deserializeSaveSlice(null);
      expect(manager.serializeSaveSlice()).toEqual(before);
    });

    it("slice with no player entry is a no-op", () => {
      const mechanics = createDefaultMechanicsDefinition();
      const { manager } = buildWorldWithPlayerCaster(mechanics);
      const before = manager.serializeSaveSlice();
      manager.deserializeSaveSlice({
        schemaVersion: 1,
        data: { casters: {} }
      });
      expect(manager.serializeSaveSlice()).toEqual(before);
    });
  });
});

describe("createCasterStatsSaveParticipant", () => {
  it("declares participantId, tier, schemaVersion per the contract", () => {
    const p = createCasterStatsSaveParticipant({
      getCasterManager: () => null
    });
    expect(p.participantId).toBe("caster.stats");
    expect(p.tier).toBe("default");
    expect(p.schemaVersion).toBe(1);
  });

  it("serialize returns an empty slice when the getter yields null", () => {
    const p = createCasterStatsSaveParticipant({
      getCasterManager: () => null
    });
    expect(p.serialize()).toEqual({ casters: {} });
  });

  it("serialize forwards to the manager when available", () => {
    const mechanics = createDefaultMechanicsDefinition();
    const { manager } = buildWorldWithPlayerCaster(mechanics);
    const p = createCasterStatsSaveParticipant({
      getCasterManager: () => manager
    });
    const slice = p.serialize();
    expect(slice.casters["player"]).toBeDefined();
  });

  it("deserialize is a no-op when the getter yields null", () => {
    const p = createCasterStatsSaveParticipant({
      getCasterManager: () => null
    });
    expect(() =>
      p.deserialize({
        schemaVersion: 1,
        data: { casters: {} }
      } as SaveSlice<CasterStatsSlice>)
    ).not.toThrow();
  });

  it("deserialize forwards to the manager when available", () => {
    const mechanics = createDefaultMechanicsDefinition();
    const batteryStat = mechanics.stats.find((s) => s.role === "battery")!;
    const { manager } = buildWorldWithPlayerCaster(mechanics);
    const p = createCasterStatsSaveParticipant({
      getCasterManager: () => manager
    });
    p.deserialize({
      schemaVersion: 1,
      data: {
        casters: {
          player: {
            stats: { [batteryStat.id]: 1 }
          }
        }
      }
    });
    expect(
      manager.serializeSaveSlice().casters["player"]!.stats[batteryStat.id]
    ).toBe(1);
  });
});
