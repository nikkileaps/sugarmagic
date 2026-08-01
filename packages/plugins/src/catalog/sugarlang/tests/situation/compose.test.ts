/**
 * packages/plugins/src/catalog/sugarlang/tests/situation/compose.test.ts
 *
 * Purpose: Pins situation composition -- that it is total under absence, and
 *   that empty never collapses into missing.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises runtime/situation.
 *
 * Implements: Plan 090 story 090.3
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { composeSituation, isAvailable } from "../../runtime/situation";
import type { SceneContextModel } from "../../runtime/contracts/scene-context";
import type { ConversationRuntimeContext } from "@sugarmagic/runtime-core";

function sceneContext(): SceneContextModel {
  return {
    sceneId: "scene-dock",
    contentHash: "hash",
    promptVersion: "090.1.0",
    supportLanguage: "en",
    prose: "A dock where cargo boats tie up.",
    concepts: [],
    extractedAtMs: 1,
    extractedByModel: "gateway-resolved",
    reviewFlag: false
  };
}

function runtimeContext(
  overrides: Partial<ConversationRuntimeContext> = {}
): ConversationRuntimeContext {
  return {
    here: null,
    playerLocation: null,
    playerPosition: null,
    npcLocation: null,
    npcPosition: null,
    trackedQuest: null,
    activeQuestStage: null,
    activeQuestObjectives: null,
    ...overrides
  } as ConversationRuntimeContext;
}

describe("composeSituation -- total under absence", () => {
  it("composes from a sceneId alone", () => {
    // The blackboard guarantees nothing. A situation with everything missing is
    // still a situation, and must not throw or return null -- otherwise the
    // Teacher becomes unreachable whenever the world is mid-transition.
    const situation = composeSituation({ sceneId: "scene-dock" });

    expect(situation.sceneId).toBe("scene-dock");
    expect(situation.sceneContext.available).toBe(false);
    expect(situation.runtime.questObjectives.available).toBe(false);
    expect(situation.runtime.knownFacts.available).toBe(false);
    expect(situation.runtime.recentWorldEvents.available).toBe(false);
    expect(situation.runtime.timeOfDay.available).toBe(false);
  });

  it("an unbuilt scene does not prevent a situation", () => {
    // The runtime half alone is worth handing to the Teacher.
    const situation = composeSituation({
      sceneId: "scene-dock",
      runtimeContext: runtimeContext({ timeOfDay: "morning" })
    });

    expect(situation.sceneContext.available).toBe(false);
    expect(situation.runtime.timeOfDay).toEqual({ available: true, value: "morning" });
  });

  it("one absent field does not invalidate the others", () => {
    const situation = composeSituation({
      sceneId: "scene-dock",
      sceneContext: sceneContext(),
      runtimeContext: runtimeContext({ knownFacts: ["The dock is closed."] })
    });

    expect(situation.sceneContext.available).toBe(true);
    expect(situation.runtime.knownFacts).toEqual({
      available: true,
      value: ["The dock is closed."]
    });
    expect(situation.runtime.questObjectives.available).toBe(false);
  });
});

describe("composeSituation -- empty is not missing", () => {
  it("an empty knownFacts is AVAILABLE, not unavailable", () => {
    // "The player has learned nothing yet" is a fact the Teacher may act on.
    // "We could not read what the player knows" is not. A `?? []` anywhere in
    // the compose path makes these identical and the Teacher then teaches
    // confidently from a fact we never had.
    const situation = composeSituation({
      sceneId: "scene-dock",
      runtimeContext: runtimeContext({ knownFacts: [] })
    });

    expect(situation.runtime.knownFacts).toEqual({ available: true, value: [] });
  });

  it("distinguishes empty from missing on every list-valued fact", () => {
    const empty = composeSituation({
      sceneId: "s",
      runtimeContext: runtimeContext({ knownFacts: [], recentWorldEvents: [] })
    });
    const missing = composeSituation({
      sceneId: "s",
      runtimeContext: runtimeContext()
    });

    expect(empty.runtime.knownFacts).not.toEqual(missing.runtime.knownFacts);
    expect(empty.runtime.recentWorldEvents).not.toEqual(
      missing.runtime.recentWorldEvents
    );
  });

  it("treats null and undefined alike -- the blackboard uses them interchangeably", () => {
    const nulled = composeSituation({
      sceneId: "s",
      runtimeContext: runtimeContext({ knownFacts: null })
    });
    const undef = composeSituation({
      sceneId: "s",
      runtimeContext: runtimeContext({ knownFacts: undefined })
    });

    expect(nulled.runtime.knownFacts).toEqual(undef.runtime.knownFacts);
    expect(nulled.runtime.knownFacts.available).toBe(false);
  });

  it("an empty string time-of-day is available, not treated as missing", () => {
    // Falsy-but-present is the classic way this collapse sneaks back in.
    const situation = composeSituation({
      sceneId: "s",
      runtimeContext: runtimeContext({ timeOfDay: "" as never })
    });

    expect(situation.runtime.timeOfDay.available).toBe(true);
  });
});

describe("composeSituation -- reading a fact", () => {
  it("isAvailable narrows to the value", () => {
    const situation = composeSituation({
      sceneId: "scene-dock",
      sceneContext: sceneContext()
    });

    if (!isAvailable(situation.sceneContext)) {
      throw new Error("expected the scene context to be available");
    }
    expect(situation.sceneContext.value.prose).toContain("dock");
  });
});
