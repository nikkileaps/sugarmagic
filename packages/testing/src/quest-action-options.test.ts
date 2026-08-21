import { describe, expect, it } from "vitest";
import {
  QUEST_ACTION_TYPE_OPTIONS,
  type QuestActionType
} from "@sugarmagic/domain";

/**
 * Every action type the runtime can be handed must be offered by the one
 * picker list. The label Record is exhaustive at compile time; these check
 * the derivation from it holds at runtime.
 */
describe("quest action type options", () => {
  it("offers every action type the quest action handler dispatches on", () => {
    // The union has no runtime form, so the expected set is written out. A
    // member added to QuestActionType shows up here as a missing entry.
    const expected: QuestActionType[] = [
      "setFlag",
      "giveItem",
      "removeItem",
      "playCue",
      "playAnimation",
      "teleportNpc",
      "emitEvent",
      "unlockScene",
      "advanceToNextScene",
      "set-time-of-day",
      "advance-day",
      "learn-fact"
    ];
    const offered = QUEST_ACTION_TYPE_OPTIONS.map((option) => option.value);
    expect([...offered].sort()).toEqual([...expected].sort());
  });

  it("gives each option a distinct value and a non-empty label", () => {
    const values = QUEST_ACTION_TYPE_OPTIONS.map((option) => option.value);
    expect(new Set(values).size).toBe(values.length);
    for (const option of QUEST_ACTION_TYPE_OPTIONS) {
      expect(option.label.trim()).not.toBe("");
      expect(option.label).not.toBe(option.value);
    }
  });
});
