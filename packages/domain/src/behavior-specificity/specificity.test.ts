/**
 * packages/domain/src/behavior-specificity/specificity.test.ts
 *
 * Purpose: which of two NPC tasks is the more specific instruction.
 *
 * The rule these tests pin down: task A beats task B when every situation
 * that turns A on would also have turned B on. A is then the sharper
 * version of the same instruction, and when A stops applying the NPC
 * falls back to B without anyone authoring the fallback.
 *
 * The cases worth reading first are the ones counting conditions gets
 * wrong -- "counting cannot see" below -- since counting is what this
 * replaced.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import type { QuestDefinition, RegionNPCBehaviorTask } from "../index";
import { createRegionBehaviorQuestBinding } from "../region-authoring/index";
import { compareTaskSpecificity, tasksAreAmbiguous } from "./index";

const QUEST = "quest:introduction";
const OTHER_QUEST = "quest:harvest";
const STAGE = "stage:arrival";
const NODE = "node:farewell";

/** One quest with one stage holding one node, so paths can be resolved. */
const QUEST_DEFINITIONS = [
  {
    definitionId: QUEST,
    displayName: "Introduction",
    stageDefinitions: [
      {
        stageId: STAGE,
        displayName: "Arrival",
        nodeDefinitions: [{ nodeId: NODE, displayName: "Farewell" }]
      }
    ]
  }
] as unknown as QuestDefinition[];

function task(
  options: {
    quest?: string;
    stage?: string;
    node?: string;
    side?: "while" | "after";
    flag?: { worldFlagId: string; value: string };
    bands?: string[];
  } = {}
): RegionNPCBehaviorTask {
  return {
    taskId: "task:x",
    displayName: "Task",
    description: null,
    targetAreaId: null,
    currentActivity: "idle",
    currentGoal: "idle",
    activation: {
      questDefinitionId: options.quest ?? null,
      questStageId: options.stage ?? null,
      questNodeId: options.node ?? null,
      storyPointSide: options.side ?? "while",
      worldFlagEquals: options.flag
        ? {
            worldFlagId: options.flag.worldFlagId,
            valueType: "boolean",
            value: options.flag.value
          }
        : null
    },
    timeWindow: options.bands ? { bands: options.bands } : null
  } as RegionNPCBehaviorTask;
}

/** Shorthand: how does the first task rank against the second. */
function compare(
  left: RegionNPCBehaviorTask,
  right: RegionNPCBehaviorTask
): string {
  return compareTaskSpecificity(left, right, QUEST_DEFINITIONS);
}

describe("the quest structure is a nest, so deeper wins", () => {
  it("a quest task is narrower than the baseline", () => {
    expect(compare(task({ quest: QUEST }), task())).toBe("narrower");
    expect(compare(task(), task({ quest: QUEST }))).toBe("wider");
  });

  it("a stage is narrower than its quest", () => {
    expect(
      compare(task({ quest: QUEST, stage: STAGE }), task({ quest: QUEST }))
    ).toBe("narrower");
  });

  it("a node is narrower than the stage holding it", () => {
    // The whole point: Horace blocks the way for the quest, then does the
    // node task, then falls back to blocking when the node task stops.
    const atNode = task({ quest: QUEST, stage: STAGE, node: NODE });
    expect(compare(atNode, task({ quest: QUEST, stage: STAGE }))).toBe(
      "narrower"
    );
    expect(compare(atNode, task({ quest: QUEST }))).toBe("narrower");
    expect(compare(atNode, task())).toBe("narrower");
  });

  it("two different quests are not versions of each other", () => {
    expect(compare(task({ quest: QUEST }), task({ quest: OTHER_QUEST }))).toBe(
      "incomparable"
    );
  });
});

describe("counting cannot see these, which is why it is gone", () => {
  it("one condition can be narrower than two", () => {
    // "During the Introduction quest" really is a sharper instruction than
    // "any quest, mornings only", despite filling in fewer boxes.
    const questOnly = task({ quest: QUEST });
    const routine = task({ bands: ["morning"] });
    expect(compare(questOnly, routine)).toBe("narrower");
    expect(compare(routine, questOnly)).toBe("wider");
  });

  it("two conditions each are not automatically equal", () => {
    // Same box count, and only one of them is a sharper version of
    // "during the Introduction quest". Counting called these a tie.
    const stage = task({ quest: QUEST, stage: STAGE });
    const flagged = task({
      quest: QUEST,
      flag: { worldFlagId: "flag:upset", value: "true" }
    });
    expect(compare(stage, task({ quest: QUEST }))).toBe("narrower");
    expect(compare(flagged, task({ quest: QUEST }))).toBe("narrower");
    expect(compare(stage, flagged)).toBe("incomparable");
  });

  it("more conditions does not win when they are a different question", () => {
    // Two boxes against one, but neither encloses the other. Counting
    // handed this to the two-box task.
    const unrelated = task({
      flag: { worldFlagId: "flag:upset", value: "true" },
      quest: OTHER_QUEST
    });
    expect(compare(unrelated, task({ quest: QUEST }))).toBe("incomparable");
  });
});

describe("which side of the point", () => {
  it("the two sides of one point never rank against each other", () => {
    // They also never happen at once, so there is nothing to rank.
    const during = task({ quest: QUEST, side: "while" });
    const everSince = task({ quest: QUEST, side: "after" });
    expect(compare(during, everSince)).toBe("incomparable");
  });

  it("and are never reported as unclear, because they cannot overlap", () => {
    // This is the clean handoff: "while the quest runs" ends at the exact
    // moment "ever since it finished" begins. Horace blocks the way, the
    // quest ends, he walks. No gap, no overlap, nothing to decide.
    expect(
      tasksAreAmbiguous(
        task({ quest: QUEST, side: "while" }),
        task({ quest: QUEST, side: "after" }),
        QUEST_DEFINITIONS
      )
    ).toBe(false);
  });

  it("a stage is over before its quest is, so those hand over too", () => {
    expect(
      tasksAreAmbiguous(
        task({ quest: QUEST, stage: STAGE, side: "while" }),
        task({ quest: QUEST, side: "after" }),
        QUEST_DEFINITIONS
      )
    ).toBe(false);
  });

  it("on the after side the deeper point is the WIDER one", () => {
    // Things finish innermost first. The node is done, then the stage, then
    // the quest -- so "ever since the quest finished" starts last and covers
    // the least time.
    const afterNode = task({ quest: QUEST, stage: STAGE, node: NODE, side: "after" });
    const afterQuest = task({ quest: QUEST, side: "after" });
    expect(compare(afterQuest, afterNode)).toBe("narrower");
    expect(compare(afterNode, afterQuest)).toBe("wider");
  });

  it("but a quest task still beats the baseline on either side", () => {
    expect(compare(task({ quest: QUEST, side: "after" }), task())).toBe(
      "narrower"
    );
    expect(compare(task({ quest: QUEST, side: "while" }), task())).toBe(
      "narrower"
    );
  });

  it("while a quest runs still overlaps ever since a node in it", () => {
    // The node completes before the quest ends, so both hold in between.
    // This is the shape the side toggle exists to let authors avoid.
    expect(
      tasksAreAmbiguous(
        task({ quest: QUEST, side: "while" }),
        task({ quest: QUEST, stage: STAGE, node: NODE, side: "after" }),
        QUEST_DEFINITIONS
      )
    ).toBe(true);
  });
});

describe("story outranks the clock", () => {
  it("a routine on a timer never displaces a quest task", () => {
    const routine = task({ bands: ["morning"] });
    const quest = task({ quest: QUEST });
    expect(compare(quest, routine)).toBe("narrower");
  });

  it("ticking every band is the same as leaving it blank", () => {
    const everyBand = task({
      bands: ["dawn", "morning", "midday", "afternoon", "dusk", "evening", "night"]
    });
    expect(compare(everyBand, task())).toBe("equal");
  });

  it("the clock decides only when the story conditions match exactly", () => {
    const mornings = task({ quest: QUEST, bands: ["morning"] });
    const anyTime = task({ quest: QUEST });
    expect(compare(mornings, anyTime)).toBe("narrower");
  });

  it("windows that only overlap have no winner", () => {
    const early = task({ quest: QUEST, bands: ["morning", "midday"] });
    const late = task({ quest: QUEST, bands: ["midday", "evening"] });
    expect(compare(early, late)).toBe("incomparable");
  });
});

describe("a file written before the point had a side", () => {
  it("reads a completed node as that node on the after side", () => {
    // `nodeCompleted` always meant "the node has been completed", which is
    // exactly the node point, after side. The node names its own quest.
    const migrated = createRegionBehaviorQuestBinding({
      nodeCompleted: { questDefinitionId: QUEST, nodeId: NODE }
    });
    expect(migrated.questDefinitionId).toBe(QUEST);
    expect(migrated.questNodeId).toBe(NODE);
    expect(migrated.storyPointSide).toBe("after");
  });

  it("defaults anything else to the while side", () => {
    const plain = createRegionBehaviorQuestBinding({
      questDefinitionId: QUEST
    });
    expect(plain.storyPointSide).toBe("while");
    expect(plain.questNodeId).toBeNull();
  });

  it("drops a node with no quest to name it", () => {
    const orphan = createRegionBehaviorQuestBinding({ questNodeId: NODE });
    expect(orphan.questNodeId).toBeNull();
  });
});

describe("ambiguity is only reported when both can really be live", () => {
  it("flags a quest task against an unrelated flag task", () => {
    expect(
      tasksAreAmbiguous(
        task({ quest: QUEST }),
        task({ flag: { worldFlagId: "flag:upset", value: "true" } }),
        QUEST_DEFINITIONS
      )
    ).toBe(true);
  });

  it("stays quiet for two different quests", () => {
    // Incomparable, but a binding matches one active quest, so these can
    // never both be the answer. Nothing for the author to fix.
    expect(
      tasksAreAmbiguous(
        task({ quest: QUEST }),
        task({ quest: OTHER_QUEST }),
        QUEST_DEFINITIONS
      )
    ).toBe(false);
  });

  it("stays quiet for the same flag at two values", () => {
    expect(
      tasksAreAmbiguous(
        task({ flag: { worldFlagId: "flag:mood", value: "true" } }),
        task({ flag: { worldFlagId: "flag:mood", value: "false" } }),
        QUEST_DEFINITIONS
      )
    ).toBe(false);
  });

  it("stays quiet for windows that share no band", () => {
    expect(
      tasksAreAmbiguous(
        task({ quest: QUEST, bands: ["morning"] }),
        task({ flag: { worldFlagId: "flag:upset", value: "true" }, bands: ["night"] }),
        QUEST_DEFINITIONS
      )
    ).toBe(false);
  });

  it("stays quiet when one task is simply narrower", () => {
    expect(
      tasksAreAmbiguous(
        task({ quest: QUEST, stage: STAGE }),
        task({ quest: QUEST }),
        QUEST_DEFINITIONS
      )
    ).toBe(false);
  });
});
