/**
 * packages/plugins/src/catalog/sugarlang/tests/teacher/directive-cache.test.ts
 *
 * Purpose: Verifies blackboard-backed directive caching and invalidation behavior.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/teacher/directive-cache with a real runtime blackboard.
 *   - Depends on sugarlang learner fact definitions plus runtime-core invalidation facts.
 *
 * Implements: Epic 9 Story 9.5
 *
 * Status: active
 */

import {
  ENTITY_LOCATION_FACT,
  QUEST_ACTIVE_STAGE_FACT,
  RUNTIME_BLACKBOARD_FACT_DEFINITIONS,
  createBlackboardScope,
  createRuntimeBlackboard
} from "@sugarmagic/runtime-core";
import { describe, expect, it } from "vitest";
import { DirectiveCache } from "../../runtime/teacher/directive-cache";
import { SUGARLANG_BLACKBOARD_FACT_DEFINITIONS } from "../../runtime/learner/fact-definitions";
import { createDirectiveFixture } from "./test-helpers";

function createCache() {
  const blackboard = createRuntimeBlackboard({
    definitions: [
      ...RUNTIME_BLACKBOARD_FACT_DEFINITIONS,
      ...SUGARLANG_BLACKBOARD_FACT_DEFINITIONS
    ]
  });
  return {
    blackboard,
    cache: new DirectiveCache({ blackboard, now: () => 1000 })
  };
}

describe("DirectiveCache", () => {
  it("returns a directive while still within maxTurns", () => {
    const { cache } = createCache();
    const directive = createDirectiveFixture();
    cache.set("conversation-1", directive);

    expect(cache.get("conversation-1")).toEqual(directive);
    expect(cache.get("conversation-1")).toEqual(directive);
  });

  it("expires after maxTurns is exceeded", () => {
    const { cache } = createCache();
    cache.set("conversation-1", createDirectiveFixture());

    expect(cache.get("conversation-1")).not.toBeNull();
    expect(cache.get("conversation-1")).not.toBeNull();
    expect(cache.get("conversation-1")).not.toBeNull();
    expect(cache.get("conversation-1")).toBeNull();
  });

  it("retires a directive when the situation key moves", () => {
    // 090.3b: the situation is the axis. A decision made for a different
    // situation is WRONG, not merely old, so it goes however few turns it has
    // consumed.
    const { cache } = createCache();
    cache.set("conversation-1", createDirectiveFixture(), { situationKey: "scene:dock|quest:q1/stage-1" });

    expect(cache.get("conversation-1", { situationKey: "scene:dock|quest:q1/stage-1" })).not.toBeNull();
    expect(cache.get("conversation-1", { situationKey: "scene:dock|quest:q1/stage-2" })).toBeNull();
  });

  it("keeps a directive across turns while the situation is unchanged", () => {
    // The lifecycle claim: an unchanged situation does not re-slate. Four reads
    // on a maxTurns-3 fixture would previously have expired it; here the key
    // holds it alive until the backstop, which is what the backstop is for.
    const { cache } = createCache();
    const key = "scene:dock|quest:q1/stage-1";
    cache.set("conversation-1", createDirectiveFixture(), { situationKey: key });

    expect(cache.peek("conversation-1", { situationKey: key })).not.toBeNull();
    expect(cache.peek("conversation-1", { situationKey: key })).not.toBeNull();
    expect(cache.peek("conversation-1", { situationKey: key })).not.toBeNull();
    expect(cache.peek("conversation-1", { situationKey: key })).not.toBeNull();
  });

  it("a quest-stage blackboard event alone no longer retires anything", () => {
    // This replaces an assertion that the event itself invalidated. It used to
    // call invalidateAll -- dropping EVERY conversation's directive on ANY quest
    // event, related or not. The key subsumes it: the same advance moves the key
    // for conversations it actually affects, and only those.
    const { cache, blackboard } = createCache();
    const key = "scene:dock|quest:q1/stage-1";
    cache.set("conversation-1", createDirectiveFixture(), { situationKey: key });

    blackboard.setFact({
      definition: QUEST_ACTIVE_STAGE_FACT,
      scope: createBlackboardScope("quest", "quest-ticket"),
      sourceSystem: "quest-system",
      value: {
        questId: "quest-ticket",
        stageId: "stage-2",
        stageDisplayName: "Buy the ticket"
      }
    });

    expect(cache.peek("conversation-1", { situationKey: key })).not.toBeNull();
  });

  it("an unverifiable directive is not treated as matching", () => {
    // A directive written with no situationKey cannot be checked. That must not
    // read as "still valid" -- it falls through to the turn backstop instead.
    const { cache } = createCache();
    cache.set("conversation-1", createDirectiveFixture());

    expect(cache.get("conversation-1", { situationKey: "any-key" })).not.toBeNull();
    expect(cache.get("conversation-1", { situationKey: "any-key" })).not.toBeNull();
    expect(cache.get("conversation-1", { situationKey: "any-key" })).not.toBeNull();
    expect(cache.get("conversation-1", { situationKey: "any-key" })).toBeNull();
  });

  it("peek reads without spending a turn; get spends one", () => {
    // 090.3b split these. turnsConsumed used to increment inside the read, so
    // merely LOOKING at a directive spent a turn the player never took.
    const { cache } = createCache();
    cache.set("conversation-1", createDirectiveFixture());

    cache.peek("conversation-1");
    cache.peek("conversation-1");
    cache.peek("conversation-1");
    cache.peek("conversation-1");
    expect(cache.peek("conversation-1")).not.toBeNull();

    cache.get("conversation-1");
    cache.get("conversation-1");
    cache.get("conversation-1");
    expect(cache.get("conversation-1")).toBeNull();
  });

  it("retires a directive when the LEARNER changes, independently of the situation", () => {
    // 090.4, and the whole point of two keys. The world is identical -- same
    // scene, same quest, same hour -- but the learner produced a word and its
    // ItemProgress flipped. That is a reason to re-decide, and with a single
    // merged key it would have been indistinguishable from the player walking
    // somewhere.
    const { cache } = createCache();
    const situationKey = "scene:dock|quest:q1/stage-1";
    cache.set("conversation-1", createDirectiveFixture(), {
      situationKey,
      learnerKey: "before-queso-landed"
    });

    expect(
      cache.peek("conversation-1", { situationKey, learnerKey: "before-queso-landed" })
    ).not.toBeNull();
    expect(
      cache.peek("conversation-1", { situationKey, learnerKey: "after-queso-landed" })
    ).toBeNull();
  });

  it("keeps the two axes separate -- a learner change does not need a situation change", () => {
    // Pin against the shortcut of folding learner state into the situation key.
    // If someone ever merges them, this test still passes with situationKey
    // alone moving -- so it asserts the situation key is UNCHANGED while the
    // directive retires.
    const { cache } = createCache();
    const situationKey = "scene:dock|quest:q1/stage-1";
    cache.set("conversation-1", createDirectiveFixture(), {
      situationKey,
      learnerKey: "k1"
    });

    const retired = cache.peek("conversation-1", { situationKey, learnerKey: "k2" });

    expect(retired).toBeNull();
  });

  it("supports manual invalidation", () => {
    const { cache } = createCache();
    cache.set("conversation-1", createDirectiveFixture());
    cache.invalidate("conversation-1", "manual");

    expect(cache.get("conversation-1")).toBeNull();
  });

  it("a location-change event alone no longer retires anything either", () => {
    // Same replacement as the quest-stage case above. A location change that
    // matters shows up as a different sceneId in the key; one that does not,
    // does not.
    const { cache, blackboard } = createCache();
    const key = "scene:dock|quest:q1/stage-1";
    cache.set("conversation-1", createDirectiveFixture(), { situationKey: key });

    blackboard.setFact({
      definition: ENTITY_LOCATION_FACT,
      scope: createBlackboardScope("entity", "npc-orrin"),
      sourceSystem: "scene-system",
      value: {
        entityId: "npc-orrin",
        location: {
          regionId: "region-1",
          regionDisplayName: "Railway",
          regionLorePageId: null,
          sceneId: "scene-2",
          sceneDisplayName: "Platform",
          area: null,
          parentArea: null
        }
      }
    });

    expect(cache.peek("conversation-1", { situationKey: key })).not.toBeNull();
    // ...but a key naming the new scene does retire it.
    expect(cache.peek("conversation-1", { situationKey: "scene:platform|quest:q1/stage-1" })).toBeNull();
  });
});
