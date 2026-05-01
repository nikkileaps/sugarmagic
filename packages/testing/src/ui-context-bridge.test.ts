/**
 * Runtime UI context bridge tests.
 *
 * Guards the single ECS-to-UI projection and binding resolver used by targets.
 */

import { describe, expect, it } from "vitest";
import { literalUIValue, runtimeUIRef } from "@sugarmagic/domain";
import {
  Caster,
  PlayerControlled,
  Position,
  UIContextSystem,
  World,
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
    world.addComponent(player, new Caster(0.5, 1));

    const contextStore = createUIContextStore();
    const stateStore = createUIStateStore({
      visibleMenuKey: "pause-menu",
      isPaused: true
    });
    const system = new UIContextSystem({
      contextStore,
      stateStore,
      getRegion: () => ({ id: "region:one", name: "Opening Meadow" })
    });

    system.update(world);

    expect(contextStore.getState().player.battery).toBe(0.5);
    expect(contextStore.getState().player.position).toEqual([2, 0, 4.8]);
    expect(contextStore.getState().region.name).toBe("Opening Meadow");
    expect(contextStore.getState().game.visibleMenuKey).toBe("pause-menu");
  });

  it("resolves literal and runtime-ref binding expressions in one place", () => {
    const context = createUIContextStore().getState();
    expect(resolveBinding(literalUIValue("New Game"), context)).toBe("New Game");
    expect(resolveBinding(runtimeUIRef("player.battery", "percent"), context)).toBe("100%");
    expect(resolveBinding(runtimeUIRef("region.name"), context)).toBe("Region");
  });
});
