/**
 * packages/plugins/src/catalog/sugarlang/tests/situation/situation-key-change.test.ts
 *
 * Purpose: The key says which part of it moved, because `situation_change` is
 *   one name for five different events and they need different fixes.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises describeSituationKeyChange from ../../runtime/situation.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { describeSituationKeyChange } from "../../runtime/situation/situation-key";

const KEY = "scene:region-1|hash:abc|quest:q1/stage-1|nodes:n1,n2|time:morning";

describe("describeSituationKeyChange", () => {
  it("names the one segment that moved, and only that one", () => {
    // The case this exists for: a quest advanced during a conversation. Every
    // other segment is identical and saying so would bury the answer.
    const moved = describeSituationKeyChange(
      KEY,
      "scene:region-1|hash:abc|quest:q1/stage-2|nodes:n1,n2|time:morning"
    );

    expect(moved).toBe("quest: q1/stage-1 -> q1/stage-2");
  });

  it("names every segment when more than one moved", () => {
    const moved = describeSituationKeyChange(
      KEY,
      "scene:region-1|hash:abc|quest:q1/stage-2|nodes:n3|time:evening"
    );

    expect(moved).toContain("quest: q1/stage-1 -> q1/stage-2");
    expect(moved).toContain("nodes: n1,n2 -> n3");
    expect(moved).toContain("time: morning -> evening");
    // Unchanged segments stay out of it.
    expect(moved).not.toContain("scene:");
    expect(moved).not.toContain("hash:");
  });

  it("distinguishes the clock from the quest", () => {
    // These two lead to opposite conclusions about whether a walk between
    // characters is long enough to re-plan in: a quest advancing gives a whole
    // walk of warning, the clock crossing a band gives none.
    expect(
      describeSituationKeyChange(
        KEY,
        "scene:region-1|hash:abc|quest:q1/stage-1|nodes:n1,n2|time:evening"
      )
    ).toBe("time: morning -> evening");
  });

  it("says so when a key is missing rather than inventing a diff", () => {
    expect(describeSituationKeyChange(undefined, KEY)).toContain("missing");
    expect(describeSituationKeyChange(KEY, undefined)).toContain("missing");
  });

  it("reports no change for identical keys", () => {
    expect(describeSituationKeyChange(KEY, KEY)).toBe("no change");
  });
});
