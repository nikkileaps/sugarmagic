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

  it("invalidates when a quest stage change event hits the blackboard", () => {
    const { cache, blackboard } = createCache();
    const directive = createDirectiveFixture();
    cache.set("conversation-1", directive);

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

    expect(cache.get("conversation-1")).toBeNull();
  });

  it("supports manual invalidation", () => {
    const { cache } = createCache();
    cache.set("conversation-1", createDirectiveFixture());
    cache.invalidate("conversation-1", "manual");

    expect(cache.get("conversation-1")).toBeNull();
  });

  it("reacts to real location-change blackboard events", () => {
    const { cache, blackboard } = createCache();
    cache.set("conversation-1", createDirectiveFixture());

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

    expect(cache.get("conversation-1")).toBeNull();
  });
});
