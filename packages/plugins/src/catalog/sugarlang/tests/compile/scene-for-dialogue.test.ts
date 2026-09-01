/**
 * packages/plugins/src/catalog/sugarlang/tests/compile/scene-for-dialogue.test.ts
 *
 * Purpose: Pins dialogue -> scene resolution, the lookup build-time realization
 *   needs before it can ask the Teacher what a line should teach.
 *
 * Implements: Plan 090 story 090.11
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { resolveSceneForDialogue } from "../../runtime/compile/scene-for-dialogue";
import type { SceneAuthoringContext } from "../../runtime/compile/scene-traversal";

function scene(regionId: string, dialogueIds: string[]): SceneAuthoringContext {
  return {
    regionId,
    dialogues: dialogueIds.map((definitionId) => ({ definitionId }))
  } as unknown as SceneAuthoringContext;
}

describe("which scene does a dialogue belong to", () => {
  it("resolves through scene traversal rather than NPC placement", () => {
    // Scene membership is already decided by the traversal that builds the
    // authoring context -- the same one the scene context model was extracted
    // from. Resolving any other way could disagree with it, and a line baked
    // against concepts the runtime will not have is worse than one baked
    // against none.
    const result = resolveSceneForDialogue("dlg-finnick", [
      scene("scene-dock", ["dlg-orrin"]),
      scene("scene-shop", ["dlg-finnick"])
    ]);

    expect(result?.scene.regionId).toBe("scene-shop");
    expect(result?.alsoIn).toEqual([]);
  });

  it("reports ambiguity instead of hiding it", () => {
    // A travelling NPC's dialogue is reachable from two scenes. Picking one
    // silently would bake against an arbitrary scene and look correct.
    const result = resolveSceneForDialogue("dlg-finnick", [
      scene("scene-shop", ["dlg-finnick"]),
      scene("scene-dock", ["dlg-finnick"])
    ]);

    expect(result?.scene.regionId).toBe("scene-dock");
    expect(result?.alsoIn.map((s) => s.regionId)).toEqual(["scene-shop"]);
  });

  it("resolves the same way on every build", () => {
    // Sorted, not input-ordered. An unstable choice would rebake variants
    // against a different scene run to run and the cache key would not notice,
    // because the scene is not part of it.
    const a = resolveSceneForDialogue("dlg-1", [
      scene("scene-b", ["dlg-1"]),
      scene("scene-a", ["dlg-1"])
    ]);
    const b = resolveSceneForDialogue("dlg-1", [
      scene("scene-a", ["dlg-1"]),
      scene("scene-b", ["dlg-1"])
    ]);

    expect(a?.scene.regionId).toBe(b?.scene.regionId);
  });

  it("returns null for a dialogue no scene reaches", () => {
    // Unreachable content. Baking it against no scene is correct; inventing a
    // scene for it is not.
    expect(resolveSceneForDialogue("dlg-orphan", [scene("scene-a", ["dlg-1"])])).toBeNull();
  });

  it("returns null for an empty dialogue id", () => {
    expect(resolveSceneForDialogue("", [scene("scene-a", ["dlg-1"])])).toBeNull();
  });
});
