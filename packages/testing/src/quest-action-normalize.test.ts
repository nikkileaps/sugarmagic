/**
 * Reading quest actions out of a project file.
 *
 * Actions used to share one `targetId` that meant a different thing per action
 * type, plus a `value` that meant a count, a flag value, or display text. Each
 * action now declares its own fields, so the normalizer maps the old pair into
 * the right named field and a project authored before the change keeps working.
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultQuestDefinition,
  createDefaultQuestNodeDefinition,
  createDefaultQuestStageDefinition,
  createQuestAction,
  normalizeQuestDefinition,
  type QuestActionDefinition
} from "@sugarmagic/domain";

/** Runs actions through the real load path, as a project file would. */
function loadActions(actions: unknown[]): QuestActionDefinition[] {
  const node = {
    ...createDefaultQuestNodeDefinition({ displayName: "Node" }),
    onEnterActions: actions
  };
  const stage = createDefaultQuestStageDefinition({
    nodeDefinitions: [node as never]
  });
  const quest = {
    ...createDefaultQuestDefinition({ definitionId: "quest:test" }),
    startStageId: stage.stageId,
    stageDefinitions: [stage]
  };
  return normalizeQuestDefinition(quest).stageDefinitions[0]!.nodeDefinitions[0]!
    .onEnterActions;
}

describe("quest action load path", () => {
  it("maps a legacy targetId into each action's own field", () => {
    expect(
      loadActions([
        { type: "setFlag", targetId: "gate-open", value: true },
        { type: "emitEvent", targetId: "bell-rung" },
        { type: "giveItem", targetId: "item:key", value: "3" },
        { type: "removeItem", targetId: "item:key" },
        { type: "unlockScene", targetId: "scene:two" },
        { type: "advanceToNextScene" },
        { type: "playCue", targetId: "cue:bell" },
        { type: "set-time-of-day", targetId: "dusk" },
        { type: "learn-fact", targetId: "fact:name", value: "The bell rings" }
      ])
    ).toEqual([
      // The legacy name lands in `worldFlagId` as-is; the load-time flag migration
      // turns it into a real registry reference once it sees the whole project.
      { type: "setFlag", worldFlagId: "gate-open", value: true },
      { type: "emitEvent", eventName: "bell-rung" },
      { type: "giveItem", itemDefinitionId: "item:key", count: 3 },
      { type: "removeItem", itemDefinitionId: "item:key", count: 1 },
      { type: "unlockScene", sceneId: "scene:two" },
      { type: "advanceToNextScene", sceneId: null },
      { type: "playCue", cueDefinitionId: "cue:bell" },
      { type: "set-time-of-day", band: "dusk" },
      {
        type: "learn-fact",
        factId: "fact:name",
        displayText: "The bell rings"
      }
    ]);
  });

  it("round-trips an action already written in its own fields", () => {
    const actions: QuestActionDefinition[] = [
      { type: "giveItem", itemDefinitionId: "item:key", count: 2 },
      { type: "playCue", cueDefinitionId: "cue:bell" },
      { type: "advance-day" }
    ];
    expect(loadActions(actions)).toEqual(actions);
  });

  it("keeps an action whose reference the author has not chosen yet", () => {
    // Adding an action and saving before picking a target must not delete it.
    expect(loadActions([createQuestAction("playCue")])).toEqual([
      { type: "playCue", cueDefinitionId: null }
    ]);
  });

  it("keeps a playAnimation slot only when it is a real slot", () => {
    expect(
      loadActions([
        {
          type: "playAnimation",
          npcDefinitionId: "npc:guard",
          slot: "walk",
          repeatCount: 2
        },
        { type: "playAnimation", npcDefinitionId: "npc:guard", slot: "cheer" }
      ])
    ).toEqual([
      {
        type: "playAnimation",
        npcDefinitionId: "npc:guard",
        slot: "walk",
        repeatCount: 2
      },
      {
        type: "playAnimation",
        npcDefinitionId: "npc:guard",
        slot: null,
        repeatCount: 1
      }
    ]);
  });

  it("reads an objective authored under the old custom name", () => {
    // `custom` said nothing about how the objective completes. It waits for a
    // named quest event, so it is an awaitEvent objective.
    const node = {
      ...createDefaultQuestNodeDefinition({ displayName: "Wait" }),
      nodeBehavior: "objective" as const,
      objectiveSubtype: "custom",
      eventName: "bell-rung"
    };
    const stage = createDefaultQuestStageDefinition({
      nodeDefinitions: [node as never]
    });
    const quest = {
      ...createDefaultQuestDefinition({ definitionId: "quest:legacy" }),
      startStageId: stage.stageId,
      stageDefinitions: [stage]
    };
    const loaded = normalizeQuestDefinition(quest).stageDefinitions[0]!
      .nodeDefinitions[0]!;

    expect(loaded.objectiveSubtype).toBe("awaitEvent");
    expect(loaded.eventName).toBe("bell-rung");
  });

  it("drops an action with no recognizable type", () => {
    expect(loadActions([{ type: "notAnAction" }, {}, null])).toEqual([]);
  });

  it("falls back to a real band when the stored one is not one", () => {
    expect(loadActions([{ type: "set-time-of-day", targetId: "teatime" }])).toEqual(
      [{ type: "set-time-of-day", band: "morning" }]
    );
  });
});
