/**
 * Caster mechanics execution tests.
 *
 * Guards that spell casting flows through authored mechanics rather than the
 * old hardcoded battery/chaos path.
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultMechanicsDefinition,
  createDefaultPlayerDefinition,
  createDefaultSpellDefinition
} from "@sugarmagic/domain";
import {
  Caster,
  CasterManager,
  World,
  spawnRuntimePlayerEntity
} from "@sugarmagic/runtime-core";

describe("caster mechanics execution", () => {
  it("casts a spell through the mechanics executor", () => {
    const mechanics = createDefaultMechanicsDefinition();
    const world = new World();
    const player = createDefaultPlayerDefinition("project:test");
    const spawn = spawnRuntimePlayerEntity(world, null, player, mechanics);
    const caster = world.getComponent(spawn.entity, Caster)!;
    const spell = createDefaultSpellDefinition({
      displayName: "Spark",
      castable: {
        id: mechanics.castables[0]!.id,
        args: { batteryCost: 20, chaosBase: 0 }
      },
      effects: [],
      chaosEffects: []
    });
    const manager = new CasterManager();
    manager.setWorld(world);
    manager.registerMechanics(mechanics);
    manager.registerDefinitions([spell]);

    const result = manager.castSpell(spell.definitionId);

    expect(result.success).toBe(true);
    expect(caster.stats.get("battery")).toBe(80);
  });
});
