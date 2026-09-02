/**
 * Talking to an NPC grants a side quest (epic #226 story 11).
 *
 * The recipe end to end: a Talk objective completes when that NPC's
 * conversation ends, its on-complete action sets a world flag, and a
 * second quest whose start condition reads that flag becomes active.
 *
 * Each hop is covered elsewhere. What is only covered here is that they
 * connect -- the failure this guards against is a chain whose every link
 * passes its own test while the chain does nothing.
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultQuestDefinition,
  createDefaultQuestNodeDefinition,
  createDefaultQuestStageDefinition,
  createQuestNodeId,
  type QuestDefinition
} from "@sugarmagic/domain";
import { QuestManager, WorldFlagManager } from "@sugarmagic/runtime-core";

const MARISOL_DIALOGUE = "dialogue:marisol";
const ERRAND_FLAG = "flag:marisol-asked-for-help";

/** The quest giver's own quest: talk to her, and that sets the flag. */
function talkToMarisol(options: { completeOn?: string }): QuestDefinition {
  const stage = createDefaultQuestStageDefinition({
    nodeDefinitions: [
      {
        ...createDefaultQuestNodeDefinition({
          nodeId: createQuestNodeId(),
          displayName: "Talk to Marisol",
          description: "Talk to her",
          objectiveSubtype: "talk"
        }),
        dialogueDefinitionId: MARISOL_DIALOGUE,
        completeOn: options.completeOn,
        onCompleteActions: [
          { type: "setFlag", worldFlagId: ERRAND_FLAG, value: true }
        ]
      }
    ]
  });
  return {
    ...createDefaultQuestDefinition({
      definitionId: "quest:meet-marisol",
      displayName: "Meet Marisol"
    }),
    startStageId: stage.stageId,
    stageDefinitions: [stage]
  };
}

/** The side quest, which does not exist for the player until the flag is set. */
function marisolsErrand(): QuestDefinition {
  const stage = createDefaultQuestStageDefinition({
    nodeDefinitions: [
      {
        ...createDefaultQuestNodeDefinition({
          nodeId: createQuestNodeId(),
          displayName: "Fetch the parcel",
          description: "Fetch it",
          objectiveSubtype: "awaitEvent"
        }),
        eventName: "parcel-fetched"
      }
    ]
  });
  return {
    ...createDefaultQuestDefinition({
      definitionId: "quest:marisols-errand",
      displayName: "Marisol's Errand"
    }),
    startCondition: {
      type: "hasFlag",
      worldFlagId: ERRAND_FLAG,
      value: true
    },
    startStageId: stage.stageId,
    stageDefinitions: [stage]
  };
}

/** Flags are stored by NAME and authored by id, so a manager with no
 *  resolver refuses every write. Boot installs one; this is that. */
function flagManager(): WorldFlagManager {
  const worldFlags = new WorldFlagManager();
  worldFlags.setWorldFlagNameResolver((worldFlagId) =>
    worldFlagId === ERRAND_FLAG ? "marisol-asked-for-help" : null
  );
  return worldFlags;
}

function bootedWith(definitions: QuestDefinition[]): {
  manager: QuestManager;
  worldFlags: WorldFlagManager;
} {
  const manager = new QuestManager();
  const worldFlags = flagManager();
  manager.setWorldFlagManager(worldFlags);
  manager.registerDefinitions(definitions);
  manager.update();
  return { manager, worldFlags };
}

describe("talking to an NPC grants a side quest", () => {
  it("the side quest does not exist before the conversation", () => {
    const { manager } = bootedWith([talkToMarisol({}), marisolsErrand()]);

    expect(manager.isQuestActive("quest:meet-marisol")).toBe(true);
    expect(manager.isQuestActive("quest:marisols-errand")).toBe(false);
  });

  it("finishing her conversation grants it, with no reload", () => {
    const { manager, worldFlags } = bootedWith([
      talkToMarisol({}),
      marisolsErrand()
    ]);

    manager.notifyDialogueFinished(MARISOL_DIALOGUE);

    expect(worldFlags.hasFlagById(ERRAND_FLAG, true)).toBe(true);
    expect(manager.isQuestActive("quest:marisols-errand")).toBe(true);
  });

  it("an unrelated conversation does not grant it", () => {
    const { manager } = bootedWith([talkToMarisol({}), marisolsErrand()]);

    manager.notifyDialogueFinished("dialogue:someone-else");

    expect(manager.isQuestActive("quest:marisols-errand")).toBe(false);
  });
});

describe("a branch the player did not take", () => {
  const AGREED_NODE = "node:agreed-to-help";

  it("does not grant the quest when the conversation ends elsewhere", () => {
    // `completeOn` names the line the conversation has to END on, which is
    // how "the player said yes" is distinguished from "the player declined".
    const { manager } = bootedWith([
      talkToMarisol({ completeOn: AGREED_NODE }),
      marisolsErrand()
    ]);

    manager.notifyDialogueFinished(MARISOL_DIALOGUE, "node:declined");

    expect(manager.isQuestActive("quest:marisols-errand")).toBe(false);
  });

  it("grants it when the conversation ends on the named line", () => {
    const { manager } = bootedWith([
      talkToMarisol({ completeOn: AGREED_NODE }),
      marisolsErrand()
    ]);

    manager.notifyDialogueFinished(MARISOL_DIALOGUE, AGREED_NODE);

    expect(manager.isQuestActive("quest:marisols-errand")).toBe(true);
  });
});

describe("reloading after the quest was granted", () => {
  it("restores it as granted rather than re-granting or losing it", () => {
    const { manager, worldFlags } = bootedWith([
      talkToMarisol({}),
      marisolsErrand()
    ]);
    manager.notifyDialogueFinished(MARISOL_DIALOGUE);
    const saved = manager.serializeSaveSlice();
    const savedFlags = worldFlags.serializeSaveSlice();

    // A fresh session, restored the way boot does it: definitions
    // registered, then the save applied, then the first update.
    const restored = new QuestManager();
    const restoredFlags = flagManager();
    restoredFlags.deserializeSaveSlice({ schemaVersion: 1, data: savedFlags });
    restored.setWorldFlagManager(restoredFlags);
    restored.registerDefinitions([talkToMarisol({}), marisolsErrand()]);
    restored.deserializeSaveSlice({ schemaVersion: 1, data: saved });
    restored.update();

    expect(restored.isQuestActive("quest:marisols-errand")).toBe(true);
    expect(restored.isQuestCompleted("quest:meet-marisol")).toBe(true);
  });
});
