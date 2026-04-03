import { describe, expect, it } from "vitest";
import { createDefaultPlayerDefinition } from "@sugarmagic/domain";
import {
  Caster,
  World,
  applyBatteryRechargePerMinute,
  resolveBatteryTier,
  resolveChaosChance,
  spawnRuntimePlayerEntity
} from "@sugarmagic/runtime-core";

describe("runtime caster math", () => {
  it("matches Sugarengine battery tier thresholds", () => {
    expect(resolveBatteryTier(100, 100)).toBe("full");
    expect(resolveBatteryTier(75, 100)).toBe("full");
    expect(resolveBatteryTier(74, 100)).toBe("unstable");
    expect(resolveBatteryTier(25, 100)).toBe("unstable");
    expect(resolveBatteryTier(24, 100)).toBe("critical");
    expect(resolveBatteryTier(1, 100)).toBe("critical");
    expect(resolveBatteryTier(0, 100)).toBe("empty");
  });

  it("recharges battery in percent per minute, not per second", () => {
    expect(applyBatteryRechargePerMinute(50, 1, 60, 100)).toBeCloseTo(51, 5);
    expect(applyBatteryRechargePerMinute(50, 1, 30, 100)).toBeCloseTo(50.5, 5);
    expect(applyBatteryRechargePerMinute(99.8, 1, 60, 100)).toBeCloseTo(100, 5);
  });

  it("matches Sugarengine chaos stabilization math", () => {
    expect(resolveChaosChance(50, 0, 100)).toBeCloseTo(0.4, 5);
    expect(resolveChaosChance(50, 100, 100)).toBeCloseTo(0.08, 5);
    expect(resolveChaosChance(15, 50, 100)).toBeCloseTo(0.48, 5);
  });

  it("spawns the runtime caster with a 100-point battery scale", () => {
    const world = new World();
    const playerDefinition = createDefaultPlayerDefinition("project:test", {
      definitionId: "project:test:player:default"
    });
    playerDefinition.casterProfile.initialBattery = 35;
    playerDefinition.casterProfile.initialResonance = 40;

    const spawn = spawnRuntimePlayerEntity(world, null, playerDefinition);
    const caster = world.getComponent(spawn.entity, Caster);

    expect(caster).not.toBeNull();
    expect(caster?.battery).toBe(35);
    expect(caster?.maxBattery).toBe(100);
    expect(caster?.resonance).toBe(40);
  });
});
