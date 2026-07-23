/**
 * packages/runtime-core/src/state/world-narrative.test.ts
 *
 * Purpose: Verifies the world-narrative blackboard facts (Plan 077
 * §077.3a / D4): GOAL_SURFACED_COUNT_FACT definition, bump/get helpers,
 * and the blackboard write firewall (wrong sourceSystem throws).
 *
 * Why this matters: the firewall test documents WHY the proposal
 * indirection exists (sugaragent cannot write the fact directly;
 * runtime-core's handleConversationActionProposal is the only write path).
 *
 * Implements: Plan 077 §077.3a tests
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  bumpGoalSurfacedCount,
  createRuntimeBlackboard,
  GOAL_SURFACED_COUNT_FACT,
  getGoalSurfacedCount,
  NARRATIVE_SOURCE_SYSTEM,
  RUNTIME_BLACKBOARD_FACT_DEFINITIONS,
  createBlackboardScope
} from "./blackboard";

function makeBlackboard() {
  return createRuntimeBlackboard({ definitions: RUNTIME_BLACKBOARD_FACT_DEFINITIONS });
}

describe("GOAL_SURFACED_COUNT_FACT definition", () => {
  it("is owned by narrative-system, not quest-system or sugaragent", () => {
    expect(GOAL_SURFACED_COUNT_FACT.ownerSystem).toBe("narrative-system");
    expect(GOAL_SURFACED_COUNT_FACT.ownerSystem).toBe(NARRATIVE_SOURCE_SYSTEM);
    expect(GOAL_SURFACED_COUNT_FACT.ownerSystem).not.toBe("quest-system");
  });

  it("is scoped to quest", () => {
    expect(GOAL_SURFACED_COUNT_FACT.allowedScopeKinds).toContain("quest");
  });

  it("is registered in RUNTIME_BLACKBOARD_FACT_DEFINITIONS", () => {
    expect(RUNTIME_BLACKBOARD_FACT_DEFINITIONS).toContain(GOAL_SURFACED_COUNT_FACT);
  });
});

describe("getGoalSurfacedCount / bumpGoalSurfacedCount", () => {
  it("returns 0 for a quest with no bumps yet", () => {
    const blackboard = makeBlackboard();
    expect(getGoalSurfacedCount(blackboard, "quest.find-the-luggage")).toBe(0);
  });

  it("increments from 0 to 1 after one bump", () => {
    const blackboard = makeBlackboard();
    bumpGoalSurfacedCount(blackboard, "quest.find-the-luggage");
    expect(getGoalSurfacedCount(blackboard, "quest.find-the-luggage")).toBe(1);
  });

  it("accumulates across multiple bumps", () => {
    const blackboard = makeBlackboard();
    bumpGoalSurfacedCount(blackboard, "quest.find-the-luggage");
    bumpGoalSurfacedCount(blackboard, "quest.find-the-luggage");
    bumpGoalSurfacedCount(blackboard, "quest.find-the-luggage");
    expect(getGoalSurfacedCount(blackboard, "quest.find-the-luggage")).toBe(3);
  });

  it("keeps counts independent across different quests", () => {
    const blackboard = makeBlackboard();
    bumpGoalSurfacedCount(blackboard, "quest.find-the-luggage");
    bumpGoalSurfacedCount(blackboard, "quest.find-the-luggage");
    bumpGoalSurfacedCount(blackboard, "quest.return-the-gem");
    expect(getGoalSurfacedCount(blackboard, "quest.find-the-luggage")).toBe(2);
    expect(getGoalSurfacedCount(blackboard, "quest.return-the-gem")).toBe(1);
  });
});

describe("blackboard write firewall (D4 -- why proposal indirection exists)", () => {
  it("throws when sugaragent tries to write the narrative fact directly (wrong sourceSystem)", () => {
    const blackboard = makeBlackboard();
    // This is the exact call sugaragent's stages would make if they had a
    // blackboard handle. It must throw -- enforcing that the only write path
    // is via the "bump-goal-surfaced" ConversationActionProposal handled by
    // runtime-core's handleConversationActionProposal in gameplay-session.ts.
    expect(() =>
      blackboard.setFact({
        definition: GOAL_SURFACED_COUNT_FACT,
        scope: createBlackboardScope("quest", "quest.find-the-luggage"),
        value: 1,
        sourceSystem: "sugaragent"
      })
    ).toThrow(/owned by "narrative-system"/);
  });

  it("succeeds when called with the correct sourceSystem (narrative-system)", () => {
    const blackboard = makeBlackboard();
    expect(() =>
      blackboard.setFact({
        definition: GOAL_SURFACED_COUNT_FACT,
        scope: createBlackboardScope("quest", "quest.find-the-luggage"),
        value: 1,
        sourceSystem: NARRATIVE_SOURCE_SYSTEM
      })
    ).not.toThrow();
  });
});
