/**
 * Behavior task fields survive a load.
 *
 * `createRegionNPCBehaviorTask` rebuilds a task field by field, so a field it
 * does not name is dropped however it arrived on disk. `timeWindow` is the
 * proof that the naming is required.
 *
 * The load is also where a file written before the story point had a side is
 * read into the current shape, so these cover that too: a task saved with
 * `nodeCompleted` has always meant "once that node is done", which is the
 * node point on the "after" side.
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
            target: { kind: "area", areaId: "area:well" },
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
    audio: { emitters: [] },
    markers: [],
    npcPresences: [],
    itemPresences: [],
    playerPresence: null
  };
}

function loadedTask(region: RegionDocument) {
  return normalizeRegionDocumentForLoad(region, library).behaviors[0]!.tasks[0]!;
}

describe("behavior task round-trip", () => {
  it("reads an old node-completed clause as that node, after side", () => {
    const task = loadedTask(
      regionWithTask({
        activation: {
          questDefinitionId: null,
          questStageId: null,
          worldFlagEquals: null,
          nodeCompleted: {
            questDefinitionId: "quest:offering",
            nodeId: "node:offered"
          }
        }
      })
    );
    // The node names the quest it belongs to, so the point is complete even
    // though the old file never set the quest field.
    expect(task.activation.questDefinitionId).toBe("quest:offering");
    expect(task.activation.questNodeId).toBe("node:offered");
    expect(task.activation.storyPointSide).toBe("after");
  });

  it("keeps a story point authored with a side", () => {
    const task = loadedTask(
      regionWithTask({
        activation: {
          questDefinitionId: "quest:offering",
          questStageId: "stage:arrival",
          questNodeId: "node:offered",
          storyPointSide: "after",
          worldFlagEquals: null
        }
      })
    );
    expect(task.activation.questStageId).toBe("stage:arrival");
    expect(task.activation.questNodeId).toBe("node:offered");
    expect(task.activation.storyPointSide).toBe("after");
  });

  it("keeps a time window, the field this one is modelled on", () => {
    const task = loadedTask(
      regionWithTask({ timeWindow: { bands: ["dusk", "evening"] } })
    );
    expect(task.timeWindow).toEqual({ bands: ["dusk", "evening"] });
  });

  it("reads a task written before any of these fields existed", () => {
    const task = loadedTask(regionWithTask({}));
    expect(task.activation.questNodeId).toBeNull();
    // No quest named means no story point, so the side says nothing. It
    // still gets a value rather than being left undefined.
    expect(task.activation.storyPointSide).toBe("while");
    expect(task.timeWindow).toBeNull();
    expect(task.taskId).toBe("task:hold");
  });
});
