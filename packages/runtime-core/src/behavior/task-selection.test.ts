/**
 * packages/runtime-core/src/behavior/task-selection.test.ts
 *
 * Purpose: which task an NPC behavior runs when several could.
 *
 * The rule is MOST SPECIFIC WINS, not first in the list. The natural
 * way to author an NPC is one task with no conditions -- what he does
 * unless something else applies -- plus narrower ones that override it.
 * Under a first-match rule that exact shape failed: the condition-free
 * task matched every frame, so anything after it could never run, with
 * no error and nothing visible in Studio.
 *
 * Observed live: Horace had "supervise the docks" (no conditions) above
 * "block the way while the Introduction quest runs". He walked off at
 * the start of a new game and the blocking task never ran once.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { createDefaultRegion, type RegionNPCBehaviorTask } from "@sugarmagic/domain";
import { World, Position } from "../ecs";
import { createRuntimeBlackboard } from "../state/blackboard";
import { createRuntimeNpcBehaviorSystem } from "./system";

const NPC_ID = "npc:horace";
const QUEST_ID = "quest:introduction";
const STAGE_ID = "stage:start";

function task(
  displayName: string,
  activation: Partial<RegionNPCBehaviorTask["activation"]>
): RegionNPCBehaviorTask {
  return {
    taskId: `task:${displayName}`,
    displayName,
    description: "",
    targetAreaId: null,
    currentActivity: "idle",
    currentGoal: "idle",
    activation: {
      questDefinitionId: null,
      questStageId: null,
      nodeCompleted: null,
      worldFlagEquals: null,
      ...activation
    },
    timeWindow: null
  } as RegionNPCBehaviorTask;
}

/** Builds the system with these tasks, syncs once, returns the chosen task. */
function chosenTask(
  tasks: RegionNPCBehaviorTask[],
  options: {
    questActive?: boolean;
    completedNodes?: string[];
    flags?: Record<string, unknown>;
  } = {}
): string | null {
  const world = new World();
  const entity = world.createEntity();
  world.addComponent(entity, new Position(0, 0, 0));

  const region = {
    ...createDefaultRegion({ regionId: "region:town", displayName: "Town" }),
    behaviors: [
      {
        behaviorId: "behavior:horace",
        npcDefinitionId: NPC_ID,
        displayName: "Horace",
        tasks
      }
    ]
  };

  const system = createRuntimeNpcBehaviorSystem({
    region: region as never,
    world,
    blackboard: createRuntimeBlackboard(),
    npcEntities: [{ presenceId: "p:1", npcDefinitionId: NPC_ID, entity }],
    isNodeCompleted: (_questId, nodeId) =>
      (options.completedNodes ?? []).includes(nodeId),
    hasWorldFlag: (flagId, value) =>
      Object.prototype.hasOwnProperty.call(options.flags ?? {}, flagId) &&
      (options.flags ?? {})[flagId] === value
  });

  system.sync({
    deltaSeconds: 0.016,
    activeQuests: options.questActive
      ? [{ questDefinitionId: QUEST_ID, stageId: STAGE_ID }]
      : []
  });
  return system.getCurrentTask(NPC_ID)?.displayName ?? null;
}

describe("a condition-free task is a fallback, not a wall", () => {
  const supervise = task("Supervise the docks", {});
  const block = task("Block the way", {
    questDefinitionId: QUEST_ID,
    questStageId: STAGE_ID
  });

  it("the specific task wins while its quest is running, listed SECOND", () => {
    // The failing case: authored with the catch-all first.
    expect(chosenTask([supervise, block], { questActive: true })).toBe(
      "Block the way"
    );
  });

  it("and listed FIRST -- order does not decide it", () => {
    expect(chosenTask([block, supervise], { questActive: true })).toBe(
      "Block the way"
    );
  });

  it("falls back to the catch-all once the quest ends, either order", () => {
    expect(chosenTask([supervise, block], { questActive: false })).toBe(
      "Supervise the docks"
    );
    expect(chosenTask([block, supervise], { questActive: false })).toBe(
      "Supervise the docks"
    );
  });
});

describe("specificity is how many conditions a task asks for", () => {
  it("two conditions beat one", () => {
    const one = task("Quest only", { questDefinitionId: QUEST_ID });
    const two = task("Quest and stage", {
      questDefinitionId: QUEST_ID,
      questStageId: STAGE_ID
    });
    expect(chosenTask([one, two], { questActive: true })).toBe(
      "Quest and stage"
    );
    expect(chosenTask([two, one], { questActive: true })).toBe(
      "Quest and stage"
    );
  });

  it("counts a node condition", () => {
    const questOnly = task("Quest only", { questDefinitionId: QUEST_ID });
    const questAndNode = task("Quest and node", {
      questDefinitionId: QUEST_ID,
      nodeCompleted: { questDefinitionId: QUEST_ID, nodeId: "node:welcome" }
    });
    expect(
      chosenTask([questOnly, questAndNode], {
        questActive: true,
        completedNodes: ["node:welcome"]
      })
    ).toBe("Quest and node");
  });

  it("counts a world flag condition", () => {
    const plain = task("Plain", {});
    const flagged = task("Flagged", {
      worldFlagEquals: {
        worldFlagId: "flag:upset",
        valueType: "boolean",
        value: "true"
      } as never
    });
    expect(
      chosenTask([plain, flagged], { flags: { "flag:upset": true } })
    ).toBe("Flagged");
  });

  it("a more specific task that does NOT match is skipped", () => {
    // Specificity only breaks ties among tasks that already match.
    const supervise = task("Supervise the docks", {});
    const block = task("Block the way", {
      questDefinitionId: QUEST_ID,
      questStageId: STAGE_ID
    });
    expect(chosenTask([block, supervise], { questActive: false })).toBe(
      "Supervise the docks"
    );
  });
});

describe("ties keep list order", () => {
  it("two equally specific matching tasks resolve to the earlier one", () => {
    const first = task("First", { questDefinitionId: QUEST_ID });
    const second = task("Second", { questDefinitionId: QUEST_ID });
    expect(chosenTask([first, second], { questActive: true })).toBe("First");
    expect(chosenTask([second, first], { questActive: true })).toBe("Second");
  });
});

describe("no matching task", () => {
  it("resolves to nothing when every task is gated shut", () => {
    const block = task("Block the way", { questDefinitionId: QUEST_ID });
    expect(chosenTask([block], { questActive: false })).toBeNull();
  });
});
