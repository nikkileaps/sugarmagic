import { describe, expect, it } from "vitest";
import { createRegionVolumeDefinition, type RegionDocument } from "@sugarmagic/domain";
import { World, Position } from "@sugarmagic/runtime-core";
import {
  buildCollisionWorld,
  createEmptyCollisionWorld,
  createRuntimeBlackboard,
  createRuntimeNpcBehaviorSystem,
  getEntityCurrentActivity,
  getEntityCurrentGoal,
  getEntityMovement,
  type NavMeshPathfinder,
  type NpcMovementCollisionContext
} from "@sugarmagic/runtime-core";

function makeRegion(): RegionDocument {
  return {
    identity: { id: "wordlark-hollow", schema: "RegionDocument", version: 1 },
    displayName: "Wordlark Hollow Station",
    placement: {
      gridPosition: { x: 0, y: 0 },
      placementPolicy: "world-grid"
    },
    // Plan 058 §058.1 — presences live on Scene overlays now; this
    // test drives the behavior system via explicit `npcEntities`,
    // so the region fixture only needs the base shape.
    placedAssets: [],
    folders: [],
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
      surfaceSlots: [],
      deform: null,
      effect: null,
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

  it("follows navmesh waypoints (069.9) instead of heading straight to the target", () => {
    const region = makeRegion(); // dock target at +X (10, _, 0)
    const world = new World();
    const blackboard = createRuntimeBlackboard();
    const entity = world.createEntity();
    world.addComponent(entity, new Position(0, 0, 0));

    // A detour route that first heads +Z (a wall between the NPC and the dock).
    const detourPathfinder: NavMeshPathfinder = {
      findPath: () => [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 8 },
        { x: 10, y: 0, z: 0 }
      ],
      destroy: () => {}
    };

    const system = createRuntimeNpcBehaviorSystem({
      region,
      world,
      blackboard,
      hasWorldFlag: (key, value) => key === "airship_arrived" && value === true,
      getPathfinder: () => detourPathfinder,
      npcEntities: [
        { presenceId: "presence:rick-roll", npcDefinitionId: "npc:rick-roll", entity }
      ]
    });

    system.sync({
      deltaSeconds: 1,
      activeQuest: { questDefinitionId: "quest:find-suitcase", stageId: "stage:arrival" }
    });

    const position = world.getComponent(entity, Position);
    // Took the +Z detour toward the first waypoint, not a straight +X beeline.
    expect(position!.z).toBeGreaterThan(1);
    expect(position!.x).toBeLessThan(1);
  });

  it("falls back to a straight line when there is no pathfinder (unbaked regions)", () => {
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
      // no getPathfinder
      npcEntities: [
        { presenceId: "presence:rick-roll", npcDefinitionId: "npc:rick-roll", entity }
      ]
    });

    system.sync({
      deltaSeconds: 1,
      activeQuest: { questDefinitionId: "quest:find-suitcase", stageId: "stage:arrival" }
    });

    const position = world.getComponent(entity, Position);
    // Straight beeline toward the dock (+X), no lateral detour.
    expect(position!.x).toBeGreaterThan(1);
    expect(Math.abs(position!.z)).toBeLessThan(1);
  });
});

describe("069.3 — NPC collision-context adapter (commitNpcMove)", () => {
  function makeCollisionSystem(context: NpcMovementCollisionContext | null) {
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
      stuckTimeoutMs: 100,
      now: (() => {
        let t = 0;
        return () => (t += 200); // every call advances past stuckTimeoutMs
      })(),
      getCollisionContext: () => context,
      npcEntities: [
        { presenceId: "p:rick", npcDefinitionId: "npc:rick-roll", entity }
      ]
    });
    return { system, world, blackboard, entity };
  }
  const arrival = {
    questDefinitionId: "quest:find-suitcase",
    stageId: "stage:arrival"
  };

  it("a wall across the path pins the NPC and stuck-detection reports blocked", () => {
    // Blocker volume spanning z, between the NPC (0,0) and the dock (+X).
    // Small dt so the per-frame step (0.25m) can't discretely tunnel the 1m
    // wall — walking-speed steps are the resolver's contract (CCD deferred).
    const wallWorld = buildCollisionWorld(
      [],
      [
        createRegionVolumeDefinition({
          volumeId: "vol:wall",
          roles: ["blocker"],
          blockDirection: "in",
          bounds: { kind: "box", center: [2.5, 0, 0], size: [1, 4, 100] }
        })
      ]
    );
    const { system, world, blackboard, entity } = makeCollisionSystem({
      world: wallWorld,
      agents: []
    });
    for (let i = 0; i < 20; i += 1) {
      system.sync({ deltaSeconds: 0.1, activeQuest: arrival });
    }
    const pos = world.getComponent(entity, Position)!;
    expect(pos.x).toBeLessThan(2); // pinned at the wall face, never crossed
    // The RESOLVED (pinned) position fed stuck-detection.
    expect(getEntityMovement(blackboard, "npc:rick-roll")?.status).toBe("blocked");
  });

  it("the NPC's OWN circle in the agent snapshot does not perturb its motion", () => {
    // Same directive with and without the self-only agent snapshot must land
    // on the IDENTICAL position (the sampled task target has nonzero z, so
    // assert against a control run rather than a straight +X line).
    const withSelf = makeCollisionSystem({
      world: createEmptyCollisionWorld(),
      agents: [{ id: "p:rick", x: 0, z: 0, radius: 0.35 }] // itself only
    });
    const control = makeCollisionSystem(null);
    withSelf.system.sync({ deltaSeconds: 1, activeQuest: arrival });
    control.system.sync({ deltaSeconds: 1, activeQuest: arrival });
    const a = withSelf.world.getComponent(withSelf.entity, Position)!;
    const b = control.world.getComponent(control.entity, Position)!;
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.z).toBeCloseTo(b.z, 6);
    expect(a.x).toBeGreaterThan(1); // and it actually walked
  });

  it("another agent in the path pushes the NPC out (no interpenetration)", () => {
    const other = { id: "p:other", x: 2.5, z: 0, radius: 0.4 };
    const { system, world, entity } = makeCollisionSystem({
      world: createEmptyCollisionWorld(),
      agents: [other]
    });
    system.sync({ deltaSeconds: 1, activeQuest: arrival });
    const pos = world.getComponent(entity, Position)!;
    // Separated by at least combined radii (0.4 + DEFAULT 0.35).
    expect(Math.hypot(pos.x - other.x, pos.z - other.z)).toBeGreaterThanOrEqual(
      0.75 - 1e-6
    );
  });
});

describe("069.9 — path-following state machine across frames", () => {
  /** A spy-able fake mesh: a detour that always ENDS at the requested target,
   *  so the follower advances corners then arrives at the final point. */
  function detourPathfinder(): { pf: NavMeshPathfinder; calls: () => number } {
    let calls = 0;
    const pf: NavMeshPathfinder = {
      findPath: (from, to) => {
        calls += 1;
        return [
          { x: from.x, y: 0, z: from.z },
          { x: from.x, y: 0, z: from.z + 5 }, // a corner to advance past
          { x: to.x, y: 0, z: to.z }
        ];
      },
      destroy: () => {}
    };
    return { pf, calls: () => calls };
  }

  function makeSystem(pf: NavMeshPathfinder) {
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
      getPathfinder: () => pf,
      npcEntities: [
        { presenceId: "p:rick", npcDefinitionId: "npc:rick-roll", entity }
      ]
    });
    return { system, world, blackboard, entity };
  }

  const arrival = {
    questDefinitionId: "quest:find-suitcase",
    stageId: "stage:arrival"
  };

  it("advances corners across ticks and arrives at the final target", () => {
    const { pf, calls } = detourPathfinder();
    const { system, blackboard } = makeSystem(pf);
    for (let i = 0; i < 30; i += 1) {
      system.sync({ deltaSeconds: 1, activeQuest: arrival });
    }
    // Reached the authored area via the mesh, and the route was computed ONCE
    // (followed, not re-pathed every frame).
    expect(getEntityMovement(blackboard, "npc:rick-roll")?.status).toBe(
      "at_target"
    );
    expect(calls()).toBe(1);
  });

  it("re-paths when collision shoves the NPC off its route (drift)", () => {
    const { pf, calls } = detourPathfinder();
    const { system, world, entity } = makeSystem(pf);
    system.sync({ deltaSeconds: 0.1, activeQuest: arrival });
    expect(calls()).toBe(1);
    // Teleport far off the current waypoint (> REPATH_DRIFT_METERS).
    const pos = world.getComponent(entity, Position)!;
    pos.z = 60;
    system.sync({ deltaSeconds: 0.1, activeQuest: arrival });
    expect(calls()).toBeGreaterThanOrEqual(2);
  });

  it("re-paths when the task target moves (arrival stage -> search stage)", () => {
    const { pf, calls } = detourPathfinder();
    const { system, blackboard } = makeSystem(pf);
    system.sync({ deltaSeconds: 0.1, activeQuest: arrival }); // -> dock
    expect(calls()).toBe(1);
    // stage:search activates task:shop -> target area changes to "shop".
    system.sync({
      deltaSeconds: 0.1,
      activeQuest: { questDefinitionId: "quest:find-suitcase", stageId: "stage:search" }
    });
    expect(calls()).toBeGreaterThanOrEqual(2);
    expect(getEntityMovement(blackboard, "npc:rick-roll")?.targetAreaId).toBe(
      "shop"
    );
  });
});
