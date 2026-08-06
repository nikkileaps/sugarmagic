/**
 * packages/runtime-core/tests/quest/stage-time-of-day.test.ts
 *
 * Purpose: A quest stage declares the time of day it happens at, and the world
 *   clock follows when the stage becomes active.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultQuestDefinition,
  createDefaultQuestStageDefinition,
  normalizeQuestStageDefinition,
  type QuestDefinition,
  type TimeOfDayBand
} from "@sugarmagic/domain";
import { QuestManager } from "../../src/quest/QuestManager";

const ADVANCE_EVENT = "advance-the-stage";

function questWithStages(
  first: TimeOfDayBand | null,
  second: TimeOfDayBand | null
): QuestDefinition {
  const stageTwo = createDefaultQuestStageDefinition({
    displayName: "Second",
    timeOfDay: second
  });
  const stageOne = createDefaultQuestStageDefinition({
    displayName: "First",
    timeOfDay: first
  });
  stageOne.nextStageId = stageTwo.stageId;
  // One event-completable node, so the test can drive the stage to advance.
  stageOne.nodeDefinitions[0]!.eventName = ADVANCE_EVENT;

  return {
    ...createDefaultQuestDefinition({ displayName: "Clock Quest" }),
    startStageId: stageOne.stageId,
    stageDefinitions: [stageOne, stageTwo]
  };
}

function trackBands(definition: QuestDefinition) {
  const bands: TimeOfDayBand[] = [];
  const manager = new QuestManager();
  manager.registerDefinitions([definition]);
  manager.setStageTimeOfDayHandler((band) => bands.push(band));
  return { manager, bands };
}

describe("a stage's time of day", () => {
  it("THE ONE THAT MATTERS: starting a quest sets the clock to the start stage's time", () => {
    // The dock scene reads as late afternoon, but nothing ever wrote the fact,
    // so every NPC was told "morning" and the Judge flunked the contradiction.
    const definition = questWithStages("afternoon", null);
    const { manager, bands } = trackBands(definition);

    manager.startQuest(definition.definitionId);

    expect(bands).toEqual(["afternoon"]);
  });

  it("advancing to the next stage sets the clock to ITS time", () => {
    const definition = questWithStages("afternoon", "night");
    const { manager, bands } = trackBands(definition);

    manager.startQuest(definition.definitionId);
    manager.notifyEvent(ADVANCE_EVENT);

    expect(bands).toEqual(["afternoon", "night"]);
  });

  it("advancing into a stage with no time leaves the clock where it was", () => {
    const definition = questWithStages("afternoon", null);
    const { manager, bands } = trackBands(definition);

    manager.startQuest(definition.definitionId);
    manager.notifyEvent(ADVANCE_EVENT);

    expect(bands).toEqual(["afternoon"]);
  });

  it("a stage with no time leaves the clock alone", () => {
    const definition = questWithStages(null, null);
    const { manager, bands } = trackBands(definition);

    manager.startQuest(definition.definitionId);

    expect(bands).toEqual([]);
  });

  it("normalizes a missing time to null rather than inventing one", () => {
    const stage = normalizeQuestStageDefinition({ displayName: "Legacy" });
    expect(stage.timeOfDay).toBeNull();
  });

  it("round-trips an authored band", () => {
    const stage = normalizeQuestStageDefinition({
      displayName: "Dock",
      timeOfDay: "evening"
    });
    expect(stage.timeOfDay).toBe("evening");
  });
});
