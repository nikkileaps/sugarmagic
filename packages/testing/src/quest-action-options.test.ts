import { describe, expect, it } from "vitest";
import {
  createQuestAction,
  isBlankWorldFlagValue,
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

  it("starts a setFlag action with a value the author can see", () => {
    const action = createQuestAction("setFlag");
    expect(action.type).toBe("setFlag");
    expect(isBlankWorldFlagValue("value" in action ? action.value : undefined)).toBe(
      false
    );
  });
});

describe("blank flag values", () => {
  it("treats missing, null and empty string as blank", () => {
    expect(isBlankWorldFlagValue(undefined)).toBe(true);
    expect(isBlankWorldFlagValue(null)).toBe(true);
    expect(isBlankWorldFlagValue("")).toBe(true);
  });

  it("treats a written value as present, including false and zero", () => {
    expect(isBlankWorldFlagValue("true")).toBe(false);
    expect(isBlankWorldFlagValue("blah")).toBe(false);
    expect(isBlankWorldFlagValue(false)).toBe(false);
    expect(isBlankWorldFlagValue(0)).toBe(false);
  });
});
