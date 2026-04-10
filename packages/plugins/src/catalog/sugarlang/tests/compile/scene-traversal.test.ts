/**
 * packages/plugins/src/catalog/sugarlang/tests/compile/scene-traversal.test.ts
 *
 * Purpose: Verifies deterministic text-blob traversal for scene compilation.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/compile/scene-traversal.
 *   - Depends on ./test-helpers for compact authored scene fixtures.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { collectSceneText } from "../../runtime/compile/scene-traversal";
import { createTestSceneAuthoringContext } from "./test-helpers";

describe("collectSceneText", () => {
  it("collects the expected text blobs for a minimal scene", () => {
    const blobs = collectSceneText(createTestSceneAuthoringContext());

    expect(blobs.map((blob) => blob.sourceKind)).toEqual(
      expect.arrayContaining([
        "dialogue",
        "npc-bio",
        "quest-objective",
        "quest-objective-display-name",
        "item-label",
        "region-label",
        "lore-page"
      ])
    );
  });

  it("is deterministic across repeated traversals", () => {
    const context = createTestSceneAuthoringContext();

    expect(collectSceneText(context)).toEqual(collectSceneText(context));
  });

  it("returns an empty array for an empty scene", () => {
    const blobs = collectSceneText(
      createTestSceneAuthoringContext({
        npcDefinitions: [],
        dialogueDefinitions: [],
        questDefinitions: [],
        itemDefinitions: [],
        documentDefinitions: [],
        region: {
          ...createTestSceneAuthoringContext().region,
          displayName: "",
          lorePageId: null,
          scene: {
            ...createTestSceneAuthoringContext().region.scene,
            npcPresences: [],
            itemPresences: []
          },
          areas: []
        }
      })
    );

    expect(blobs).toEqual([]);
  });
});
