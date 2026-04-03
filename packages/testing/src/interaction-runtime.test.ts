import { describe, expect, it, vi } from "vitest";
import {
  World,
  Position,
  PlayerControlled,
  InteractionSystem,
  Interactable
} from "@sugarmagic/runtime-core";

describe("InteractionSystem", () => {
  it("tracks the nearest interactable within range", () => {
    const world = new World();
    const player = world.createEntity();
    world.addComponent(player, new PlayerControlled(5));
    world.addComponent(player, new Position(0, 0, 0));

    const npcNear = world.createEntity();
    world.addComponent(npcNear, new Position(1, 0, 0));
    world.addComponent(
      npcNear,
      new Interactable("npc", "npc-near", "dialogue-near", "Talk to Guard")
    );

    const npcFar = world.createEntity();
    world.addComponent(npcFar, new Position(1.8, 0, 0));
    world.addComponent(
      npcFar,
      new Interactable("npc", "npc-far", "dialogue-far", "Talk to Clerk")
    );

    const system = new InteractionSystem();
    world.addSystem(system);
    world.update(1 / 60);

    expect(system.getNearestInteractable()).toEqual({
      type: "npc",
      instanceId: "npc-near",
      targetId: "dialogue-near",
      promptText: "Talk to Guard",
      available: true
    });
  });

  it("fires interaction on E for the current nearest interactable", () => {
    const world = new World();
    const player = world.createEntity();
    world.addComponent(player, new PlayerControlled(5));
    world.addComponent(player, new Position(0, 0, 0));

    const npc = world.createEntity();
    world.addComponent(npc, new Position(1, 0, 0));
    world.addComponent(
      npc,
      new Interactable("npc", "npc-guard", "dialogue-guard", "Talk to Guard")
    );

    const onNearby = vi.fn();
    const onInteract = vi.fn();
    const system = new InteractionSystem();
    system.setNearbyChangeHandler(onNearby);
    system.setInteractHandler(onInteract);
    system.setInteractPressedProvider(() => true);

    world.addSystem(system);
    world.update(1 / 60);

    expect(onNearby).toHaveBeenCalledWith({
      type: "npc",
      instanceId: "npc-guard",
      targetId: "dialogue-guard",
      promptText: "Talk to Guard",
      available: true
    });
    expect(onInteract).toHaveBeenCalledWith({
      type: "npc",
      instanceId: "npc-guard",
      targetId: "dialogue-guard",
      promptText: "Talk to Guard",
      available: true
    });
  });
});
