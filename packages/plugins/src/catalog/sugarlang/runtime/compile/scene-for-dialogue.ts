/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/scene-for-dialogue.ts
 *
 * Purpose: Which SCENE does a dialogue line belong to? Build-time realization
 *   cannot ask the Teacher what a line should teach without knowing where the
 *   line is said.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A NEW LOOKUP
 *   A dialogue belongs to an NPC, and an NPC can stand in several scenes, so
 *   "which scene" looks like a question needing a policy -- pick the first
 *   placement, bake per scene, give up. It is not. `SceneAuthoringContext`
 *   already carries `dialogues` (scene-traversal.ts:98), because scene traversal
 *   is what DEFINES the content reachable from a scene. Scene membership is
 *   therefore already decided, by the same function the compiler uses.
 *
 *   That matters beyond convenience: the scene context model a line would be
 *   baked against was extracted from this same traversal. Resolving through
 *   anything else -- NPC placement, the Studio selection -- could disagree with
 *   it, and a line baked against concepts the runtime will not have is worse
 *   than one baked against none.
 *
 * WHERE THIS IS CALLED FROM
 *   The bake belongs in `rebuildSugarlangCompileCache` (ui/shell/editor-support),
 *   which already holds every `SceneAuthoringContext` and already makes gateway
 *   calls to extract scene context. The variants popover cannot answer this --
 *   Studio's dialogue editor has no scene at all, which is why the earlier
 *   attempt to thread one down from the UI had nothing to thread.
 *
 * AMBIGUITY IS REPORTED, NOT RESOLVED
 *   A dialogue reachable from two scenes returns the first in a stable order
 *   AND reports the alternatives. Silently picking one would bake a line against
 *   an arbitrary scene and look correct; the caller can log, warn, or bake per
 *   scene once it knows. What must not happen is the ambiguity vanishing.
 *
 * Exports:
 *   - SceneForDialogueResult, resolveSceneForDialogue
 *
 * Relationships:
 *   - Pure. Reads SceneAuthoringContexts; no I/O, no store, no clock.
 *
 * Implements: Plan 090 story 090.11
 *
 * Status: active
 */

import type { SceneAuthoringContext } from "./scene-traversal";

export interface SceneForDialogueResult {
  /** The scene whose authored content reaches this dialogue. */
  scene: SceneAuthoringContext;
  /**
   * Other scenes that also reach it. Empty in the common case. Non-empty means
   * the caller is choosing, and should say so rather than let `scene` imply
   * there was nothing to choose.
   */
  alsoIn: SceneAuthoringContext[];
}

/**
 * The scene a dialogue belongs to, or null when no scene reaches it.
 *
 * Null is a real answer, not a failure: a dialogue attached to an NPC who is not
 * placed anywhere is unreachable content. Baking it against no scene is correct;
 * inventing a scene for it is not.
 */
export function resolveSceneForDialogue(
  dialogueDefinitionId: string,
  scenes: SceneAuthoringContext[]
): SceneForDialogueResult | null {
  if (!dialogueDefinitionId) {
    return null;
  }

  // Sorted by sceneId so a dialogue reachable from two scenes resolves the same
  // way on every build. An unstable choice here would silently rebake variants
  // against a different scene run to run, and the cache key would not notice.
  const matches = scenes
    .filter((scene) =>
      scene.dialogues.some(
        (dialogue) => dialogue.definitionId === dialogueDefinitionId
      )
    )
    .sort((left, right) => left.sceneId.localeCompare(right.sceneId));

  if (matches.length === 0) {
    return null;
  }

  return { scene: matches[0]!, alsoIn: matches.slice(1) };
}
