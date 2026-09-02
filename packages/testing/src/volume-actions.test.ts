/**
 * A volume runs actions when the player crosses it (#216).
 *
 * The trigger role could play one cue and set one flag, through fields
 * that existed nowhere else. A volume now carries the same action list a
 * quest node carries, so an author reaches every action and every picker.
 *
 * What only these cover is the shared seam: the SAME action, run from a
 * volume rather than a quest node, keyed so an ambient bed started on
 * enter is the instance stopped on exit.
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultQuestDefinition,
  createDefaultQuestNodeDefinition,
  createDefaultQuestStageDefinition,
  createQuestNodeId,
  createRegionVolumeDefinition,
  normalizeQuestAction,
  QUEST_ACTION_TYPE_OPTIONS,
  type QuestDefinition
} from "@sugarmagic/domain";
import { QuestManager, questActionInstanceKey } from "@sugarmagic/runtime-core";

describe("a volume carries the quest action list", () => {
  it("defaults to no actions on either side", () => {
    const volume = createRegionVolumeDefinition({ volumeId: "vol:market" });

    expect(volume.onEnterActions).toEqual([]);
    expect(volume.onExitActions).toEqual([]);
  });

  it("keeps the actions it is given, normalized", () => {
    const volume = createRegionVolumeDefinition({
      volumeId: "vol:market",
      onEnterActions: [{ type: "playCue", cueDefinitionId: "cue:crowd" }],
      onExitActions: [{ type: "stopCue", cueDefinitionId: "cue:crowd" }]
    });

    expect(volume.onEnterActions).toEqual([
      { type: "playCue", cueDefinitionId: "cue:crowd" }
    ]);
    expect(volume.onExitActions).toEqual([
      { type: "stopCue", cueDefinitionId: "cue:crowd" }
    ]);
  });

  it("drops an action it cannot read rather than storing a broken one", () => {
    const volume = createRegionVolumeDefinition({
      volumeId: "vol:market",
      // A type no version of the union ever had.
      onEnterActions: [{ type: "summonDragon" } as never]
    });

    expect(volume.onEnterActions).toEqual([]);
  });
});

describe("stopCue", () => {
  it("is offered by the one action picker every surface renders", () => {
    // The volume inspector and the quest node inspector read this same
    // list, so an action missing here is authorable from neither.
    expect(QUEST_ACTION_TYPE_OPTIONS.map((option) => option.value)).toContain(
      "stopCue"
    );
  });

  it("round-trips through the normalizer", () => {
    expect(
      normalizeQuestAction({ type: "stopCue", cueDefinitionId: "cue:crowd" })
    ).toEqual({ type: "stopCue", cueDefinitionId: "cue:crowd" });
  });

  it("reaches a quest node too, not only a volume", () => {
    // The point of sharing the union: a quest can stop a cue it started,
    // which the trigger role could never express in either direction.
    const nodeId = createQuestNodeId();
    const stage = createDefaultQuestStageDefinition({
      nodeDefinitions: [
        {
          ...createDefaultQuestNodeDefinition({
            nodeId,
            displayName: "Silence the bell",
            description: "Stop it",
            objectiveSubtype: "awaitEvent"
          }),
          eventName: "bell-silenced",
          onCompleteActions: [
            { type: "stopCue", cueDefinitionId: "cue:bell" }
          ]
        }
      ]
    });
    const definition: QuestDefinition = {
      ...createDefaultQuestDefinition({
        definitionId: "quest:bell",
        displayName: "Bell"
      }),
      startStageId: stage.stageId,
      stageDefinitions: [stage]
    };

    const invocations: unknown[] = [];
    const manager = new QuestManager();
    manager.registerDefinitions([definition]);
    manager.setActionHandler((invocation) => invocations.push(invocation));
    manager.startQuest("quest:bell");
    manager.notifyEvent("bell-silenced");

    expect(invocations).toEqual([
      {
        action: { type: "stopCue", cueDefinitionId: "cue:bell" },
        source: {
          kind: "quest-node",
          questDefinitionId: "quest:bell",
          stageId: stage.stageId,
          nodeId
        }
      }
    ]);
  });
});

describe("the sounding instance a cue action names", () => {
  const volume = {
    kind: "volume" as const,
    regionId: "region:hollow",
    volumeId: "vol:market"
  };

  it("is the same for a volume's enter and exit, so the bed stops", () => {
    // The whole reason an ambient bed can be authored as a pair: both
    // actions resolve to one instance because the key names the volume,
    // not the action.
    expect(questActionInstanceKey(volume, "cue:crowd")).toBe(
      questActionInstanceKey(volume, "cue:crowd")
    );
    expect(questActionInstanceKey(volume, "cue:crowd")).toContain("vol:market");
  });

  it("separates two volumes playing the same cue", () => {
    const other = { ...volume, volumeId: "vol:square" };

    expect(questActionInstanceKey(volume, "cue:crowd")).not.toBe(
      questActionInstanceKey(other, "cue:crowd")
    );
  });

  it("separates a volume from a quest node", () => {
    const node = {
      kind: "quest-node" as const,
      questDefinitionId: "quest:bell",
      stageId: "stage:1",
      nodeId: "node:1"
    };

    expect(questActionInstanceKey(volume, "cue:crowd")).not.toBe(
      questActionInstanceKey(node, "cue:crowd")
    );
  });

  it("separates two cues in the same volume", () => {
    expect(questActionInstanceKey(volume, "cue:crowd")).not.toBe(
      questActionInstanceKey(volume, "cue:wind")
    );
  });
});
