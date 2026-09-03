/**
 * When a quest starts (epic #226 story 10).
 *
 * Every quest used to start at boot, so a Scene's quests were all running
 * before the player reached the Scene. A quest can now declare a start
 * condition and wait for it. The condition uses the grammar quest nodes
 * already use, so `questCompleted` chains one quest to the next -- which
 * is how an errand that spans two Scenes is authored.
 *
 * Absence of a condition is the migration: a project written before this
 * existed behaves exactly as it did.
 */

import { describe, expect, it } from "vitest";
import {
  collectWorldFlagReferences,
  createDefaultGameProject,
  createDefaultQuestDefinition,
  createDefaultQuestNodeDefinition,
  createDefaultQuestStageDefinition,
  createDefaultRegion,
  createQuestNodeId,
  createWorldFlagDefinition,
  validateProjectContent,
  type GameProject,
  type QuestConditionDefinition,
  type QuestDefinition
} from "@sugarmagic/domain";
import { QuestManager } from "@sugarmagic/runtime-core";

/** A one-node quest that finishes when its event fires. */
function questFinishedBy(options: {
  definitionId: string;
  eventName: string;
  startCondition?: QuestConditionDefinition;
}): QuestDefinition {
  const stage = createDefaultQuestStageDefinition({
    nodeDefinitions: [
      {
        ...createDefaultQuestNodeDefinition({
          nodeId: createQuestNodeId(),
          displayName: "Do the thing",
          description: "Do it",
          objectiveSubtype: "awaitEvent"
        }),
        eventName: options.eventName
      }
    ]
  });
  return {
    ...createDefaultQuestDefinition({
      definitionId: options.definitionId,
      displayName: options.definitionId
    }),
    startCondition: options.startCondition,
    startStageId: stage.stageId,
    stageDefinitions: [stage]
  };
}

/** Boot as the game does: register the definitions, then start. */
function bootedWith(definitions: QuestDefinition[]): QuestManager {
  const manager = new QuestManager();
  manager.registerDefinitions(definitions);
  manager.update();
  return manager;
}

describe("a quest with no start condition", () => {
  it("starts at boot, as every quest did before conditions existed", () => {
    const manager = bootedWith([
      questFinishedBy({ definitionId: "quest:errand", eventName: "done" })
    ]);

    expect(manager.isQuestActive("quest:errand")).toBe(true);
  });
});

describe("a quest with an unmet start condition", () => {
  it("does not start at boot", () => {
    const manager = bootedWith([
      questFinishedBy({ definitionId: "quest:first", eventName: "first-done" }),
      questFinishedBy({
        definitionId: "quest:second",
        eventName: "second-done",
        startCondition: {
          type: "questCompleted",
          questDefinitionId: "quest:first"
        }
      })
    ]);

    expect(manager.isQuestActive("quest:first")).toBe(true);
    expect(manager.isQuestActive("quest:second")).toBe(false);
  });

  it("starts mid-session when the condition becomes true", () => {
    // No reload: finishing the first quest is itself the trigger. This is
    // the chain an errand spanning two Scenes is built from.
    const manager = bootedWith([
      questFinishedBy({ definitionId: "quest:first", eventName: "first-done" }),
      questFinishedBy({
        definitionId: "quest:second",
        eventName: "second-done",
        startCondition: {
          type: "questCompleted",
          questDefinitionId: "quest:first"
        }
      })
    ]);

    manager.notifyEvent("first-done");

    expect(manager.isQuestCompleted("quest:first")).toBe(true);
    expect(manager.isQuestActive("quest:second")).toBe(true);
  });

  it("follows a chain of three without waiting for another update", () => {
    const manager = bootedWith([
      questFinishedBy({ definitionId: "quest:a", eventName: "a-done" }),
      questFinishedBy({
        definitionId: "quest:b",
        eventName: "b-done",
        startCondition: { type: "questCompleted", questDefinitionId: "quest:a" }
      }),
      questFinishedBy({
        definitionId: "quest:c",
        eventName: "c-done",
        startCondition: { type: "questActive", questDefinitionId: "quest:b" }
      })
    ]);

    manager.notifyEvent("a-done");

    expect(manager.isQuestActive("quest:b")).toBe(true);
    expect(manager.isQuestActive("quest:c")).toBe(true);
  });

  it("follows a chain declared back to front", () => {
    // An author lists quests in whatever order suits them, so the quest
    // waiting on another can be declared first. Checking every quest once
    // would leave this one shut until something else happened to run an
    // update, which reads as a quest that silently never started.
    const manager = bootedWith([
      questFinishedBy({
        definitionId: "quest:c",
        eventName: "c-done",
        startCondition: { type: "questActive", questDefinitionId: "quest:b" }
      }),
      questFinishedBy({
        definitionId: "quest:b",
        eventName: "b-done",
        startCondition: { type: "questCompleted", questDefinitionId: "quest:a" }
      }),
      questFinishedBy({ definitionId: "quest:a", eventName: "a-done" })
    ]);

    manager.notifyEvent("a-done");

    expect(manager.isQuestActive("quest:b")).toBe(true);
    expect(manager.isQuestActive("quest:c")).toBe(true);
  });
});

describe("a quest already running or finished", () => {
  it("is never restarted by a later update", () => {
    const manager = bootedWith([
      questFinishedBy({ definitionId: "quest:errand", eventName: "done" })
    ]);
    manager.notifyEvent("done");
    expect(manager.isQuestCompleted("quest:errand")).toBe(true);

    manager.update();

    expect(manager.isQuestActive("quest:errand")).toBe(false);
    expect(manager.isQuestCompleted("quest:errand")).toBe(true);
  });
});

describe("restoring a save", () => {
  it("does not start conditions during registration", () => {
    // The save lands AFTER registerDefinitions and BEFORE the first
    // update. Anything that started during registration would already be
    // running by the time the save says the player finished it.
    const manager = new QuestManager();
    manager.registerDefinitions([
      questFinishedBy({ definitionId: "quest:errand", eventName: "done" })
    ]);

    expect(manager.isQuestActive("quest:errand")).toBe(false);
  });

  it("does not restart a quest the player already finished", () => {
    const manager = new QuestManager();
    const definitions = [
      questFinishedBy({ definitionId: "quest:first", eventName: "first-done" }),
      questFinishedBy({
        definitionId: "quest:second",
        eventName: "second-done",
        startCondition: {
          type: "questCompleted",
          questDefinitionId: "quest:first"
        }
      })
    ];
    manager.registerDefinitions(definitions);
    manager.deserializeSaveSlice({
      schemaVersion: 1,
      data: {
        activeQuests: {},
        completedQuestIds: ["quest:first", "quest:second"],
        trackedQuestDefinitionId: null
      }
    });
    manager.update();

    expect(manager.isQuestActive("quest:first")).toBe(false);
    expect(manager.isQuestActive("quest:second")).toBe(false);
  });

  it("starts a gated quest whose condition the save already satisfies", () => {
    const manager = new QuestManager();
    manager.registerDefinitions([
      questFinishedBy({ definitionId: "quest:first", eventName: "first-done" }),
      questFinishedBy({
        definitionId: "quest:second",
        eventName: "second-done",
        startCondition: {
          type: "questCompleted",
          questDefinitionId: "quest:first"
        }
      })
    ]);
    manager.deserializeSaveSlice({
      schemaVersion: 1,
      data: {
        activeQuests: {},
        completedQuestIds: ["quest:first"],
        trackedQuestDefinitionId: null
      }
    });
    manager.update();

    expect(manager.isQuestActive("quest:second")).toBe(true);
  });
});

const WALK_REGION_ID = "region:walks";

/** A project whose one quest is gated on a world flag. */
function projectGatedOnFlag(options: {
  worldFlagId: string;
  value: string | null;
  declareFlag: boolean;
}): GameProject {
  const quest = questFinishedBy({
    definitionId: "quest:gated",
    eventName: "done",
    startCondition: {
      type: "hasFlag",
      worldFlagId: options.worldFlagId,
      value: options.value
    }
  });
  const base = createDefaultGameProject("Test", "test");
  return {
    ...base,
    worldFlagDefinitions: options.declareFlag
      ? [
          createWorldFlagDefinition({
            definitionId: options.worldFlagId,
            name: "gate-open"
          })
        ]
      : [],
    episodes: base.episodes.map((episode) => ({
      ...episode,
      scenes: episode.scenes.map((scene, index) => ({
        ...scene,
        regionId: WALK_REGION_ID,
        questDefinitions: index === 0 ? [quest] : scene.questDefinitions
      }))
    }))
  };
}

function walkRegion() {
  return createDefaultRegion({
    regionId: WALK_REGION_ID,
    displayName: "Walk Region"
  });
}

describe("a start condition is content like any other", () => {
  it("its flag reference is found when the flag is renamed or deleted", () => {
    // Both walks used to descend only stage nodes. A condition on the
    // QUEST would have been invisible to them, so deleting the flag it
    // names would report no references and leave the quest unstartable.
    const references = collectWorldFlagReferences(
      projectGatedOnFlag({
        worldFlagId: "flag:gate",
        value: "true",
        declareFlag: true
      }),
      []
    );

    expect(references).toHaveLength(1);
    expect(references[0]!.worldFlagId).toBe("flag:gate");
    expect(references[0]!.target.kind).toBe("quest-start-condition");
  });

  it("validation reports a start condition with no value picked", () => {
    const result = validateProjectContent(
      projectGatedOnFlag({
        worldFlagId: "flag:gate",
        value: null,
        declareFlag: true
      }),
      [walkRegion()]
    );

    expect(
      result.issues.some((issue) => issue.message.includes("never starts"))
    ).toBe(true);
  });

  it("validation reports a start condition naming a deleted flag", () => {
    const result = validateProjectContent(
      projectGatedOnFlag({
        worldFlagId: "flag:gone",
        value: "true",
        declareFlag: false
      }),
      [walkRegion()]
    );

    expect(result.valid).toBe(false);
  });
});
