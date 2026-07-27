/**
 * packages/plugins/src/catalog/sugarlang/tests/contracts/line-intent.test.ts
 *
 * Purpose: Verifies the LineIntentArtifact contract shape and LineIntentCacheKey shape.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Depends on ../../runtime/contracts/line-intent.
 *   - Guards Epic 086 Story 086.1 contract stability.
 *
 * Implements: Epic 086 Story 086.1 -- line-intent model
 *
 * Status: active
 */

import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  LineIntentArtifact,
  LineIntentCacheKey
} from "../../runtime/contracts/line-intent";

describe("LineIntentArtifact", () => {
  it("accepts a fully-derived artifact", () => {
    const artifact: LineIntentArtifact = {
      nodeId: "node-abc",
      dialogueDefinitionId: "dialogue-xyz",
      anchorText: "Hello traveler.",
      mustConveyFacts: ["The traveler is greeted", "NPC is friendly"],
      beat: "welcoming opener",
      voiceNote: "warm, unhurried",
      derived: true,
      reviewFlag: false,
      extractedAtMs: 1000,
      extractedByModel: "claude-sonnet-4-6"
    };

    expect(artifact.nodeId).toBe("node-abc");
    expect(artifact.mustConveyFacts).toHaveLength(2);
    expect(artifact.derived).toBe(true);
    expect(artifact.reviewFlag).toBe(false);
  });

  it("accepts a hand-authored artifact", () => {
    const artifact: LineIntentArtifact = {
      nodeId: "node-1",
      dialogueDefinitionId: "dialogue-1",
      anchorText: "Farewell.",
      mustConveyFacts: [],
      beat: "dismissal",
      voiceNote: "curt",
      derived: false,
      reviewFlag: false,
      extractedAtMs: 2000,
      extractedByModel: "hand-authored"
    };

    expect(artifact.derived).toBe(false);
    expect(artifact.beat).toBe("dismissal");
  });

  it("accepts null for beat and voiceNote when not present", () => {
    const artifact: LineIntentArtifact = {
      nodeId: "node-2",
      dialogueDefinitionId: "dialogue-2",
      anchorText: "...",
      mustConveyFacts: [],
      beat: null,
      voiceNote: null,
      derived: true,
      reviewFlag: true,
      extractedAtMs: 500,
      extractedByModel: "claude-sonnet-4-6"
    };

    expect(artifact.beat).toBeNull();
    expect(artifact.voiceNote).toBeNull();
    expect(artifact.reviewFlag).toBe(true);
  });

  it("has the correct field types", () => {
    expectTypeOf<LineIntentArtifact["nodeId"]>().toEqualTypeOf<string>();
    expectTypeOf<LineIntentArtifact["mustConveyFacts"]>().toEqualTypeOf<string[]>();
    expectTypeOf<LineIntentArtifact["beat"]>().toEqualTypeOf<string | null>();
    expectTypeOf<LineIntentArtifact["voiceNote"]>().toEqualTypeOf<string | null>();
    expectTypeOf<LineIntentArtifact["derived"]>().toEqualTypeOf<boolean>();
    expectTypeOf<LineIntentArtifact["reviewFlag"]>().toEqualTypeOf<boolean>();
  });
});

describe("LineIntentCacheKey", () => {
  it("accepts a valid cache key", () => {
    const key: LineIntentCacheKey = {
      contentHash: "abc123",
      intentPromptVersion: "086.1.0"
    };

    expect(key.contentHash).toBe("abc123");
    expect(key.intentPromptVersion).toBe("086.1.0");
  });

  it("has the correct field types", () => {
    expectTypeOf<LineIntentCacheKey["contentHash"]>().toEqualTypeOf<string>();
    expectTypeOf<LineIntentCacheKey["intentPromptVersion"]>().toEqualTypeOf<string>();
  });
});
