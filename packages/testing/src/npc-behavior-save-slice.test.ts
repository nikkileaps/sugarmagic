/**
 * packages/testing/src/npc-behavior-save-slice.test.ts
 *
 * Purpose: Verifies the npc.behavior save-participant pipeline.
 * The behavior system's serialize captures per-NPC position +
 * target + status; deserialize overwrites the ECS Position
 * component and re-populates the internal movementStateByNpcId.
 * Unknown NPC ids drop with a warn.
 *
 * Implements: Plan 056 §056.2 tests
 *
 * Status: active
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultRegion } from "@sugarmagic/domain";
import {
  Position,
  World,
  createNpcBehaviorSaveParticipant,
  createRuntimeBlackboard,
  createRuntimeNpcBehaviorSystem
} from "@sugarmagic/runtime-core";
import type {
  NpcBehaviorSlice,
  SaveSlice
} from "@sugarmagic/runtime-core";

function buildWorldWithNpc(npcDefinitionId: string, spawn: {
  x: number;
  y: number;
  z: number;
}) {
  const world = new World();
  const entity = world.createEntity();
  world.addComponent(entity, new Position(spawn.x, spawn.y, spawn.z));
  return { world, entity };
}

describe("RuntimeNpcBehaviorSystem save slice", () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  describe("serialize", () => {
    it("captures per-NPC position from the ECS Position component", () => {
      const { world, entity } = buildWorldWithNpc("npc:alpha", {
        x: 10,
        y: 0,
        z: 20
      });
      const region = createDefaultRegion({ regionId: "region:test", displayName: "Test" });
      const blackboard = createRuntimeBlackboard();
      const system = createRuntimeNpcBehaviorSystem({
        region,
        world,
        blackboard,
        npcEntities: [
          {
            npcDefinitionId: "npc:alpha",
            presenceId: "presence:alpha",
            entity
          }
        ]
      });
      const slice = system.serializeSaveSlice();
      expect(slice.npcs["npc:alpha"]!.position).toEqual({
        x: 10,
        y: 0,
        z: 20
      });
      expect(slice.npcs["npc:alpha"]!.status).toBe("idle");
      expect(slice.npcs["npc:alpha"]!.target).toBeNull();
    });

    it("returns an empty slice when no NPCs are registered", () => {
      const world = new World();
      const system = createRuntimeNpcBehaviorSystem({
        region: createDefaultRegion({ regionId: "region:test", displayName: "Test" }),
        world,
        blackboard: createRuntimeBlackboard(),
        npcEntities: []
      });
      expect(system.serializeSaveSlice()).toEqual({ npcs: {} });
    });
  });

  describe("deserialize", () => {
    it("overwrites the ECS Position component from a restored slice", () => {
      const { world, entity } = buildWorldWithNpc("npc:alpha", {
        x: 0,
        y: 0,
        z: 0
      });
      const system = createRuntimeNpcBehaviorSystem({
        region: createDefaultRegion({ regionId: "region:test", displayName: "Test" }),
        world,
        blackboard: createRuntimeBlackboard(),
        npcEntities: [
          {
            npcDefinitionId: "npc:alpha",
            presenceId: "presence:alpha",
            entity
          }
        ]
      });
      system.deserializeSaveSlice({
        schemaVersion: 1,
        data: {
          npcs: {
            "npc:alpha": {
              position: { x: 15, y: 1, z: 25 },
              target: null,
              status: "at_target"
            }
          }
        }
      });
      const position = world.getComponent(entity, Position)!;
      expect(position.x).toBe(15);
      expect(position.y).toBe(1);
      expect(position.z).toBe(25);
      // Post-deserialize serialize should reflect the restored state.
      const slice = system.serializeSaveSlice();
      expect(slice.npcs["npc:alpha"]!.status).toBe("at_target");
    });

    it("drops NPCs whose definition isn't in the region, with a warn", () => {
      const { world, entity } = buildWorldWithNpc("npc:alpha", {
        x: 0,
        y: 0,
        z: 0
      });
      const system = createRuntimeNpcBehaviorSystem({
        region: createDefaultRegion({ regionId: "region:test", displayName: "Test" }),
        world,
        blackboard: createRuntimeBlackboard(),
        npcEntities: [
          {
            npcDefinitionId: "npc:alpha",
            presenceId: "presence:alpha",
            entity
          }
        ]
      });
      system.deserializeSaveSlice({
        schemaVersion: 1,
        data: {
          npcs: {
            "npc:alpha": {
              position: { x: 5, y: 0, z: 5 },
              target: null,
              status: "idle"
            },
            "npc:stale": {
              position: { x: 100, y: 0, z: 100 },
              target: null,
              status: "idle"
            }
          }
        }
      });
      expect(consoleWarnSpy).toHaveBeenCalledOnce();
      // Known NPC's position was updated.
      expect(world.getComponent(entity, Position)!.x).toBe(5);
    });

    it("deserialize(null) is a no-op", () => {
      const { world, entity } = buildWorldWithNpc("npc:alpha", {
        x: 0,
        y: 0,
        z: 0
      });
      const system = createRuntimeNpcBehaviorSystem({
        region: createDefaultRegion({ regionId: "region:test", displayName: "Test" }),
        world,
        blackboard: createRuntimeBlackboard(),
        npcEntities: [
          {
            npcDefinitionId: "npc:alpha",
            presenceId: "presence:alpha",
            entity
          }
        ]
      });
      system.deserializeSaveSlice(null);
      expect(world.getComponent(entity, Position)!.x).toBe(0);
    });

    it("restores target + status per NPC", () => {
      const { world, entity } = buildWorldWithNpc("npc:alpha", {
        x: 0,
        y: 0,
        z: 0
      });
      const system = createRuntimeNpcBehaviorSystem({
        region: createDefaultRegion({ regionId: "region:test", displayName: "Test" }),
        world,
        blackboard: createRuntimeBlackboard(),
        npcEntities: [
          {
            npcDefinitionId: "npc:alpha",
            presenceId: "presence:alpha",
            entity
          }
        ]
      });
      system.deserializeSaveSlice({
        schemaVersion: 1,
        data: {
          npcs: {
            "npc:alpha": {
              position: { x: 3, y: 0, z: 4 },
              target: { areaId: "area:dock", taskId: "task:go-to-dock" },
              status: "en_route"
            }
          }
        }
      });
      const slice = system.serializeSaveSlice();
      expect(slice.npcs["npc:alpha"]!.target).toEqual({
        areaId: "area:dock",
        taskId: "task:go-to-dock"
      });
      expect(slice.npcs["npc:alpha"]!.status).toBe("en_route");
    });
  });
});

describe("createNpcBehaviorSaveParticipant", () => {
  it("declares participantId, tier, schemaVersion per the contract", () => {
    const p = createNpcBehaviorSaveParticipant({
      getNpcBehaviorSystem: () => null
    });
    expect(p.participantId).toBe("npc.behavior");
    expect(p.tier).toBe("default");
    expect(p.schemaVersion).toBe(1);
  });

  it("serialize returns an empty slice when the getter yields null", () => {
    const p = createNpcBehaviorSaveParticipant({
      getNpcBehaviorSystem: () => null
    });
    expect(p.serialize()).toEqual({ npcs: {} });
  });

  it("deserialize is a no-op when the getter yields null", () => {
    const p = createNpcBehaviorSaveParticipant({
      getNpcBehaviorSystem: () => null
    });
    expect(() =>
      p.deserialize({
        schemaVersion: 1,
        data: { npcs: {} }
      } as SaveSlice<NpcBehaviorSlice>)
    ).not.toThrow();
  });
});
