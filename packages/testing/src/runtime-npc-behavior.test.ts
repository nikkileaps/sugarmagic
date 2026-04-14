import { describe, expect, it } from "vitest";
import type { RegionDocument } from "@sugarmagic/domain";
import { World, Position } from "@sugarmagic/runtime-core";
import {
  createRuntimeBlackboard,
  createRuntimeNpcBehaviorSystem,
  getEntityCurrentActivity,
  getEntityCurrentGoal,
  getEntityMovement
} from "@sugarmagic/runtime-core";

function makeRegion(): RegionDocument {
  return {
    identity: { id: "wordlark-hollow", schema: "RegionDocument", version: 1 },
    displayName: "Wordlark Hollow Station",
    placement: {
      gridPosition: { x: 0, y: 0 },
      placementPolicy: "world-grid"
    },
    scene: {
      folders: [],
      placedAssets: [],
      playerPresence: null,
      npcPresences: [
        {
          presenceId: "presence:rick-roll",
          npcDefinitionId: "npc:rick-roll",
          shaderOverride: null,
          shaderParameterOverrides: [],
          transform: {
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1]
          }
        }
      ],
      itemPresences: []
    },
    environmentBinding: {
      defaultEnvironmentId: null
    },
    areas: [
      {
        areaId: "dock",
        displayName: "Dock",
        lorePageId: null,
        parentAreaId: null,
        kind: "platform",
        bounds: {
          kind: "box",
          center: [10, 6, 0],
          size: [8, 12, 8]
        }
      },
      {
        areaId: "shop",
        displayName: "Cheese Shop",
        lorePageId: null,
        parentAreaId: null,
        kind: "shop",
        bounds: {
          kind: "box",
          center: [20, 6, 0],
          size: [8, 12, 8]
        }
      }
    ],
    behaviors: [
      {
        behaviorId: "behavior:rick-roll",
        npcDefinitionId: "npc:rick-roll",
        displayName: "Rick Roll Behavior",
        tasks: [
          {
            taskId: "task:delivery",
            displayName: "Collect Delivery",
            description: "Rick is gathering the fresh morning cheese shipment at the dock.",
            targetAreaId: "dock",
            currentActivity: "collecting_delivery",
            currentGoal: "collect_delivery",
            activation: {
              questDefinitionId: "quest:find-suitcase",
              questStageId: "stage:arrival",
              worldFlagEquals: {
                key: "airship_arrived",
                valueType: "boolean",
                value: "true"
              }
            }
          },
          {
            taskId: "task:shop",
            displayName: "Run Shop",
            description: "Rick is back inside the cheese shop serving customers.",
            targetAreaId: "shop",
            currentActivity: "running_shop",
            currentGoal: "serve_customers",
            activation: {
              questDefinitionId: "quest:find-suitcase",
              questStageId: "stage:search",
              worldFlagEquals: null
            }
          },
          {
            taskId: "task:idle",
            displayName: "Wait for Delivery",
            description: "Rick is waiting around the station before the delivery arrives.",
            targetAreaId: null,
            currentActivity: "waiting",
            currentGoal: "wait_for_delivery",
            activation: {
              questDefinitionId: null,
              questStageId: null,
              worldFlagEquals: null
            }
          }
        ]
      }
    ],
    landscape: {
      enabled: false,
      size: 100,
      subdivisions: 8,
      channels: [],
      paintPayload: null
    },
    markers: [],
    gameplayPlacements: []
  };
}

function expectPositionWithinArea(
  position: Position | undefined,
  region: RegionDocument,
  areaId: string
): void {
  const area = region.areas.find((candidate) => candidate.areaId === areaId);
  expect(area).toBeDefined();
  expect(position).toBeDefined();
  const halfSizeX = (area?.bounds.size[0] ?? 0) / 2;
  const halfSizeZ = (area?.bounds.size[2] ?? 0) / 2;
  expect(position!.x).toBeGreaterThanOrEqual((area?.bounds.center[0] ?? 0) - halfSizeX);
  expect(position!.x).toBeLessThanOrEqual((area?.bounds.center[0] ?? 0) + halfSizeX);
  expect(position!.z).toBeGreaterThanOrEqual((area?.bounds.center[2] ?? 0) - halfSizeZ);
  expect(position!.z).toBeLessThanOrEqual((area?.bounds.center[2] ?? 0) + halfSizeZ);
}

describe("runtime NPC behavior system", () => {
  it("resolves quest-driven tasks and publishes movement, activity, and goal facts", () => {
    const region = makeRegion();
    const world = new World();
    const blackboard = createRuntimeBlackboard();
    const entity = world.createEntity();
    world.addComponent(entity, new Position(0, 0, 0));

    const system = createRuntimeNpcBehaviorSystem({
      region,
      world,
      blackboard,
      hasWorldFlag: (key, value) => key === "airship_arrived" && value === true,
      npcEntities: [
        {
          presenceId: "presence:rick-roll",
          npcDefinitionId: "npc:rick-roll",
          entity
        }
      ]
    });

    system.sync({
      deltaSeconds: 1,
      activeQuest: {
        questDefinitionId: "quest:find-suitcase",
        stageId: "stage:arrival"
      }
    });

    expect(getEntityCurrentActivity(blackboard, "npc:rick-roll")?.activity).toBe(
      "collecting_delivery"
    );
    expect(getEntityCurrentGoal(blackboard, "npc:rick-roll")?.goal).toBe(
      "collect_delivery"
    );
    expect(getEntityMovement(blackboard, "npc:rick-roll")).toMatchObject({
      targetAreaId: "dock"
    });
    expect(system.getCurrentTask("npc:rick-roll")).toEqual({
      npcDefinitionId: "npc:rick-roll",
      taskId: "task:delivery",
      displayName: "Collect Delivery",
      description: "Rick is gathering the fresh morning cheese shipment at the dock."
    });
  });

  it("moves NPCs toward the target area and switches tasks when quest stage changes", () => {
    const region = makeRegion();
    const world = new World();
    const blackboard = createRuntimeBlackboard();
    const entity = world.createEntity();
    world.addComponent(entity, new Position(0, 0, 0));

    const system = createRuntimeNpcBehaviorSystem({
      region,
      world,
      blackboard,
      hasWorldFlag: (key, value) => key === "airship_arrived" && value === true,
      npcEntities: [
        {
          presenceId: "presence:rick-roll",
          npcDefinitionId: "npc:rick-roll",
          entity
        }
      ]
    });

    for (let index = 0; index < 10; index += 1) {
      system.sync({
        deltaSeconds: 1,
        activeQuest: {
          questDefinitionId: "quest:find-suitcase",
          stageId: "stage:arrival"
        }
      });
    }

    expect(getEntityMovement(blackboard, "npc:rick-roll")?.status).toBe("at_target");
    expectPositionWithinArea(world.getComponent(entity, Position), region, "dock");

    for (let index = 0; index < 10; index += 1) {
      system.sync({
        deltaSeconds: 1,
        activeQuest: {
          questDefinitionId: "quest:find-suitcase",
          stageId: "stage:search"
        }
      });
    }

    expect(getEntityCurrentActivity(blackboard, "npc:rick-roll")?.activity).toBe(
      "running_shop"
    );
    expect(getEntityCurrentGoal(blackboard, "npc:rick-roll")?.goal).toBe(
      "serve_customers"
    );
    expect(getEntityMovement(blackboard, "npc:rick-roll")).toMatchObject({
      targetAreaId: "shop",
      status: "at_target"
    });
    expectPositionWithinArea(world.getComponent(entity, Position), region, "shop");
  });

  it("falls back to an unconditional default task when a world flag condition is not met", () => {
    const region = makeRegion();
    const world = new World();
    const blackboard = createRuntimeBlackboard();
    const entity = world.createEntity();
    world.addComponent(entity, new Position(0, 0, 0));

    const system = createRuntimeNpcBehaviorSystem({
      region,
      world,
      blackboard,
      hasWorldFlag: () => false,
      npcEntities: [
        {
          presenceId: "presence:rick-roll",
          npcDefinitionId: "npc:rick-roll",
          entity
        }
      ]
    });

    system.sync({
      deltaSeconds: 1,
      activeQuest: {
        questDefinitionId: "quest:find-suitcase",
        stageId: "stage:arrival"
      }
    });

    expect(getEntityCurrentActivity(blackboard, "npc:rick-roll")?.activity).toBe("waiting");
    expect(getEntityCurrentGoal(blackboard, "npc:rick-roll")?.goal).toBe("wait_for_delivery");
    expect(getEntityMovement(blackboard, "npc:rick-roll")?.status).toBe("idle");
    expect(system.getCurrentTask("npc:rick-roll")?.taskId).toBe("task:idle");
  });

  it("retries after a blocked movement state instead of staying stuck forever", () => {
    const region = makeRegion();
    const world = new World();
    const blackboard = createRuntimeBlackboard();
    const entity = world.createEntity();
    world.addComponent(entity, new Position(0, 0, 0));

    let currentTimeMs = 0;
    const system = createRuntimeNpcBehaviorSystem({
      region,
      world,
      blackboard,
      hasWorldFlag: (key, value) => key === "airship_arrived" && value === true,
      npcEntities: [
        {
          presenceId: "presence:rick-roll",
          npcDefinitionId: "npc:rick-roll",
          entity
        }
      ],
      now: () => currentTimeMs
    });

    system.sync({
      deltaSeconds: 0,
      activeQuest: {
        questDefinitionId: "quest:find-suitcase",
        stageId: "stage:arrival"
      }
    });

    currentTimeMs = 3000;
    system.sync({
      deltaSeconds: 0,
      activeQuest: {
        questDefinitionId: "quest:find-suitcase",
        stageId: "stage:arrival"
      }
    });

    expect(getEntityMovement(blackboard, "npc:rick-roll")?.status).toBe("blocked");

    currentTimeMs = 6000;
    system.sync({
      deltaSeconds: 1,
      activeQuest: {
        questDefinitionId: "quest:find-suitcase",
        stageId: "stage:arrival"
      }
    });

    expect(getEntityMovement(blackboard, "npc:rick-roll")?.status).toBe("en_route");
    expect(world.getComponent(entity, Position)?.x).toBeGreaterThan(0);
  });

  it("assigns different target points for different tasks in the same area", () => {
    const region = makeRegion();
    region.behaviors[0] = {
      ...region.behaviors[0]!,
      tasks: [
        {
          taskId: "task:shop-a",
          displayName: "Sweep Shop",
          description: null,
          targetAreaId: "shop",
          currentActivity: "working",
          currentGoal: "work",
          activation: {
            questDefinitionId: "quest:find-suitcase",
            questStageId: "stage:a",
            worldFlagEquals: null
          }
        },
        {
          taskId: "task:shop-b",
          displayName: "Stock Shelves",
          description: null,
          targetAreaId: "shop",
          currentActivity: "working",
          currentGoal: "work",
          activation: {
            questDefinitionId: "quest:find-suitcase",
            questStageId: "stage:b",
            worldFlagEquals: null
          }
        }
      ]
    };

    const world = new World();
    const blackboard = createRuntimeBlackboard();
    const entity = world.createEntity();
    world.addComponent(entity, new Position(0, 0, 0));

    const system = createRuntimeNpcBehaviorSystem({
      region,
      world,
      blackboard,
      npcEntities: [
        {
          presenceId: "presence:rick-roll",
          npcDefinitionId: "npc:rick-roll",
          entity
        }
      ]
    });

    for (let index = 0; index < 10; index += 1) {
      system.sync({
        deltaSeconds: 1,
        activeQuest: {
          questDefinitionId: "quest:find-suitcase",
          stageId: "stage:a"
        }
      });
    }

    const firstPosition = world.getComponent(entity, Position);
    expect(firstPosition).toBeDefined();
    const firstX = firstPosition!.x;
    const firstZ = firstPosition!.z;

    for (let index = 0; index < 10; index += 1) {
      system.sync({
        deltaSeconds: 1,
        activeQuest: {
          questDefinitionId: "quest:find-suitcase",
          stageId: "stage:b"
        }
      });
    }

    const secondPosition = world.getComponent(entity, Position);
    expect(secondPosition).toBeDefined();
    expect(secondPosition!.x !== firstX || secondPosition!.z !== firstZ).toBe(true);
    expectPositionWithinArea(secondPosition, region, "shop");
  });

  it("reads NPC entities from a live getter so mid-session additions are picked up", () => {
    const region = makeRegion();
    const world = new World();
    const blackboard = createRuntimeBlackboard();
    const firstEntity = world.createEntity();
    world.addComponent(firstEntity, new Position(0, 0, 0));

    const npcEntities = [
      {
        presenceId: "presence:rick-roll",
        npcDefinitionId: "npc:rick-roll",
        entity: firstEntity
      }
    ];

    const system = createRuntimeNpcBehaviorSystem({
      region,
      world,
      blackboard,
      getNpcEntities: () => npcEntities,
      hasWorldFlag: (key, value) => key === "airship_arrived" && value === true
    });

    system.sync({
      deltaSeconds: 1,
      activeQuest: {
        questDefinitionId: "quest:find-suitcase",
        stageId: "stage:arrival"
      }
    });

    const secondEntity = world.createEntity();
    world.addComponent(secondEntity, new Position(0, 0, 0));
    npcEntities.push({
      presenceId: "presence:late-rick",
      npcDefinitionId: "npc:rick-roll",
      entity: secondEntity
    });

    const result = system.sync({
      deltaSeconds: 1,
      activeQuest: {
        questDefinitionId: "quest:find-suitcase",
        stageId: "stage:arrival"
      }
    });

    expect(result.snapshots).toHaveLength(2);
  });
});
