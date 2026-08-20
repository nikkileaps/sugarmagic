/**
 * Behavior task fields survive a load.
 *
 * `createRegionNPCBehaviorTask` rebuilds a task field by field, so a field it
 * does not name is dropped however it arrived on disk. `timeWindow` is the
 * proof that the naming is required, and `nodeCompleted` is the field this
 * guards.
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultRegionLandscapeState,
  createEmptyContentLibrarySnapshot,
  normalizeRegionDocumentForLoad,
  type RegionDocument
} from "@sugarmagic/domain";

const library = createEmptyContentLibrarySnapshot("wordlark");

function regionWithTask(
  task: Partial<RegionDocument["behaviors"][number]["tasks"][number]>
): RegionDocument {
  return {
    identity: { id: "region-task", schema: "RegionDocument", version: 1 },
    displayName: "Task Region",
    placement: { gridPosition: { x: 0, y: 0 }, placementPolicy: "world-grid" },
    placedAssets: [],
    folders: [],
    environmentBinding: { defaultEnvironmentId: null },
    areas: [],
    behaviors: [
      {
        behaviorId: "behavior:keeper",
        npcDefinitionId: "npc:keeper",
        displayName: "Keeper",
        tasks: [
          {
            taskId: "task:hold",
            displayName: "Hold At Well",
            description: null,
            targetAreaId: "area:well",
            currentActivity: "waiting",
            currentGoal: "wait_for_delivery",
            activation: {
              questDefinitionId: null,
              questStageId: null,
              worldFlagEquals: null
            },
            ...task
          }
        ]
      }
    ],
    landscape: createDefaultRegionLandscapeState({}),
    audio: { emitters: [], ambienceZones: [] },
    markers: [],
    gameplayPlacements: []
  };
}

function loadedTask(region: RegionDocument) {
  return normalizeRegionDocumentForLoad(region, library).behaviors[0]!.tasks[0]!;
}

describe("behavior task round-trip", () => {
  it("keeps a node-completed clause", () => {
    const task = loadedTask(
      regionWithTask({
        nodeCompleted: {
          questDefinitionId: "quest:offering",
          nodeId: "node:offered"
        }
      })
    );
    expect(task.nodeCompleted).toEqual({
      questDefinitionId: "quest:offering",
      nodeId: "node:offered"
    });
  });

  it("keeps a time window, the field this one is modelled on", () => {
    const task = loadedTask(
      regionWithTask({ timeWindow: { bands: ["dusk", "evening"] } })
    );
    expect(task.timeWindow).toEqual({ bands: ["dusk", "evening"] });
  });

  it("reads a task written before either field existed", () => {
    const task = loadedTask(regionWithTask({}));
    expect(task.nodeCompleted).toBeNull();
    expect(task.timeWindow).toBeNull();
    expect(task.taskId).toBe("task:hold");
  });
});
