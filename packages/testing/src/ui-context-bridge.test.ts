/**
 * Runtime UI context bridge tests.
 *
 * Guards the single ECS-to-UI projection and binding resolver used by targets.
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultMechanicsDefinition,
  literalUIValue,
  runtimeUIRef
} from "@sugarmagic/domain";
import {
  Caster,
  PlayerControlled,
  Position,
  UIContextSystem,
  World,
  createGameStateStore,
  createStatCarrier,
  createUIContextStore,
  createUIStateStore,
  resolveBinding
} from "@sugarmagic/runtime-core";

describe("runtime UI context bridge", () => {
  it("projects player, region, and game state into the UI context store", () => {
    const world = new World();
    const player = world.createEntity();
    world.addComponent(player, new PlayerControlled());
    world.addComponent(player, new Position(2, 0, 4.8));
    const stats = createStatCarrier(createDefaultMechanicsDefinition());
    stats.set("battery", 50);
    world.addComponent(player, new Caster(stats));

    const contextStore = createUIContextStore();
    const stateStore = createUIStateStore({
      activeOverlayMenuKey: "dialogue"
    });
    const gameStateStore = createGameStateStore({ lifecycle: "paused" });
    const system = new UIContextSystem({
      contextStore,
      stateStore,
      gameStateStore,
      getRegion: () => ({ id: "region:one", name: "Opening Meadow" })
    });

    system.update(world);

    expect(contextStore.getState().player.battery).toBe(50);
    expect(contextStore.getState().player.position).toEqual([2, 0, 4.8]);
    expect(contextStore.getState().region.name).toBe("Opening Meadow");
    expect(contextStore.getState().game.visibleMenuKey).toBe("pause-menu");
  });

  it("resolves literal and runtime-ref binding expressions in one place", () => {
    const context = createUIContextStore().getState();
    expect(resolveBinding(literalUIValue("New Game"), context)).toBe(
      "New Game"
    );
    expect(
      resolveBinding(runtimeUIRef("player.battery", "percent"), context)
    ).toBe("100%");
    expect(resolveBinding(runtimeUIRef("region.name"), context)).toBe("Region");
  });
});
