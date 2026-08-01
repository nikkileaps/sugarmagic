/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/teach-plan-state.ts
 *
 * Purpose: Studio-session store for what each dialogue's lines should teach, at
 *   each band. Written by the rebuild pass; read when a variant is baked.
 *
 * WHY KEYED BY DIALOGUE AND NOT BY SCENE
 *   The Teacher answers per SCENE (see scene-teach-plan.ts -- the build-time
 *   situation is scene-level, so a per-line call would be identical work). But
 *   the CONSUMER is the variants popover, which holds a `dialogueDefinitionId`
 *   and has no scene at all -- Studio's dialogue editor never had one, which is
 *   what defeated the earlier attempt to thread a scene down from the UI.
 *
 *   So the rebuild fans the scene's answer out across the dialogues reachable
 *   from that scene and files it under the id the consumer actually has. Small
 *   duplication, and it removes the lookup from the consumer entirely.
 *
 * IT IS PERSISTED TO THE PROJECT (nikki, 2026-07-31)
 *   The in-memory Map is a read cache, not the storage. The document below is
 *   serialized into the project's `pluginConfigurations[pluginId="sugarlang"]`
 *   slot, because every derived artifact here eventually has to DEPLOY WITH THE
 *   GAME, and a workspace-local store does not travel.
 *
 *   It goes in the plugin's namespaced config rather than as a new field on
 *   `GameProject`, following the rule stated on that type: the domain carries
 *   game-authoring concerns, plugin-shaped concerns live in the plugin's slot.
 *
 * STORED PER SCENE, READ PER DIALOGUE
 *   The Teacher answers per scene, so storing per dialogue would duplicate the
 *   same answer across every dialogue in it. The document keeps one entry per
 *   (scene, band) plus a dialogue -> scene index, and hydration fans it out into
 *   the lookup shape the consumer wants.
 *
 * EVERY ENTRY CARRIES ITS SCENE'S CONTENT HASH
 *   A teach plan is derived from a scene's CONCEPTS, so it goes stale the moment
 *   that scene's authored content changes -- and unlike a baked variant, whose
 *   key includes the line's text, nothing about a plan would otherwise notice.
 *   Persisting a derived artifact without a staleness signal is how a JSON blob
 *   becomes quietly wrong; the hash is what lets a reader tell.
 *
 * Exports:
 *   - getSugarlangTeachPlan, seedSugarlangTeachPlan, clearSugarlangTeachPlan
 *   - SugarlangTeachPlanDocument, serializeTeachPlans, hydrateTeachPlans
 *
 * Relationships:
 *   - Studio/build only. Nothing in a shipped game reads or writes this; the
 *     runtime consumes BAKED VARIANTS, which already carry the result.
 *
 * Implements: Plan 090 story 090.11
 *
 * Status: active
 */

import type { CEFRBand } from "../cefr";
import type { SupportPosture } from "../contracts/pedagogy";
import type { GradedTextSlate } from "../grading/graded-text-service";

/** What one dialogue's lines should teach at one band. */
export interface TeachPlanEntry {
  slate: GradedTextSlate;
  /**
   * The Teacher's posture, which supersedes `postureForBand` for this bake.
   * Present here is the whole reason a build-time Teacher call is worth making
   * for posture at all -- absent, the caller falls back to the band's posture.
   */
  posture: SupportPosture;
  /**
   * False when the scene had no context model at plan time. The slate is then
   * whatever the Teacher could infer from nothing, which is worth being able to
   * see rather than having it look like a considered choice.
   */
  fromSceneContext: boolean;
}

function planKey(
  dialogueDefinitionId: string,
  lang: string,
  band: CEFRBand
): string {
  return `${dialogueDefinitionId}|${lang}|${band}`;
}

const teachPlans = new Map<string, TeachPlanEntry>();

export function getSugarlangTeachPlan(
  dialogueDefinitionId: string,
  lang: string,
  band: CEFRBand
): TeachPlanEntry | undefined {
  return teachPlans.get(planKey(dialogueDefinitionId, lang, band));
}

export function seedSugarlangTeachPlan(
  entries: {
    dialogueDefinitionId: string;
    lang: string;
    band: CEFRBand;
    entry: TeachPlanEntry;
  }[]
): void {
  for (const { dialogueDefinitionId, lang, band, entry } of entries) {
    teachPlans.set(planKey(dialogueDefinitionId, lang, band), entry);
  }
}

export function clearSugarlangTeachPlan(): void {
  teachPlans.clear();
}

/** Config-slot key. One string, so reader and writer cannot disagree. */
export const SUGARLANG_TEACH_PLAN_CONFIG_KEY = "teachPlans";

/**
 * Bumped when the persisted SHAPE changes. A document from an older version is
 * ignored rather than migrated -- a rebuild reproduces it in one press, so
 * migration code would be carried forever to save an action that is already
 * cheap.
 */
export const TEACH_PLAN_DOCUMENT_VERSION = "090.11.1";

/** What gets written into the project. JSON only -- no functions, no Maps. */
export interface SugarlangTeachPlanDocument {
  version: string;
  lang: string;
  scenes: {
    sceneId: string;
    /**
     * The scene content hash the plan was derived from. A reader comparing this
     * against the scene's current hash learns the plan is stale; without it a
     * persisted plan is indistinguishable from a current one.
     */
    contentHash: string | null;
    fromSceneContext: boolean;
    bands: { band: CEFRBand; slate: GradedTextSlate; posture: SupportPosture }[];
  }[];
  /** dialogueDefinitionId -> sceneId. The index that makes per-dialogue reads work. */
  dialogueScenes: { dialogueDefinitionId: string; sceneId: string }[];
}

export function serializeTeachPlans(args: {
  lang: string;
  scenes: {
    sceneId: string;
    contentHash: string | null;
    fromSceneContext: boolean;
    dialogueDefinitionIds: string[];
    bands: { band: CEFRBand; slate: GradedTextSlate; posture: SupportPosture }[];
  }[];
}): SugarlangTeachPlanDocument {
  return {
    version: TEACH_PLAN_DOCUMENT_VERSION,
    lang: args.lang,
    scenes: args.scenes.map((scene) => ({
      sceneId: scene.sceneId,
      contentHash: scene.contentHash,
      fromSceneContext: scene.fromSceneContext,
      bands: scene.bands
    })),
    dialogueScenes: args.scenes.flatMap((scene) =>
      scene.dialogueDefinitionIds.map((dialogueDefinitionId) => ({
        dialogueDefinitionId,
        sceneId: scene.sceneId
      }))
    )
  };
}

export interface HydrateTeachPlansResult {
  /** Entries loaded into the lookup. */
  hydrated: number;
  /**
   * Scene ids whose stored plan no longer matches the scene's current content,
   * and were therefore NOT loaded. Non-empty means someone edited a scene since
   * the last Rebuild.
   */
  staleScenes: string[];
}

/**
 * Loads a persisted document into the in-memory lookup, replacing whatever was
 * there.
 *
 * Unknown or malformed input hydrates NOTHING rather than throwing: a project
 * written by a different version must not stop Studio from opening, and a bake
 * with no plan is a valid bake.
 *
 * STALE PLANS ARE DROPPED, NOT LOADED.
 *   Pass `currentHashesBySceneId` and every scene whose stored `contentHash`
 *   disagrees with its current one is skipped. A teach plan is derived from a
 *   scene's CONCEPTS, so editing that scene's authored content invalidates it --
 *   and unlike a baked variant, whose key includes the line's text, nothing
 *   about a plan notices on its own.
 *
 *   Dropping is the safe direction because of the rule this module is built on:
 *   a MISSING plan means "no vocabulary steer", which is exactly what every bake
 *   did before slates existed. A STALE plan means "steer toward what this scene
 *   used to be about", which is a wrong answer wearing a right answer's clothes.
 *
 *   Omitting the hashes loads everything unchecked. That is for callers that
 *   genuinely cannot compute them; it is not the recommended path.
 */
export function hydrateTeachPlans(
  input: unknown,
  currentHashesBySceneId?: Map<string, string> | null
): HydrateTeachPlansResult {
  const doc = input as SugarlangTeachPlanDocument | undefined;
  if (
    !doc ||
    typeof doc !== "object" ||
    doc.version !== TEACH_PLAN_DOCUMENT_VERSION ||
    !Array.isArray(doc.scenes) ||
    !Array.isArray(doc.dialogueScenes)
  ) {
    return { hydrated: 0, staleScenes: [] };
  }

  const staleSceneIds = new Set<string>();
  if (currentHashesBySceneId) {
    for (const scene of doc.scenes) {
      const current = currentHashesBySceneId.get(scene.sceneId);
      // An unknown scene is NOT stale -- it may simply not be loaded right now.
      // Only a scene we can currently hash, whose hash disagrees, is stale.
      if (current && scene.contentHash && current !== scene.contentHash) {
        staleSceneIds.add(scene.sceneId);
      }
    }
  }

  const bySceneId = new Map(doc.scenes.map((scene) => [scene.sceneId, scene]));
  teachPlans.clear();

  let hydrated = 0;
  for (const { dialogueDefinitionId, sceneId } of doc.dialogueScenes) {
    if (staleSceneIds.has(sceneId)) continue;
    const scene = bySceneId.get(sceneId);
    if (!scene) continue;
    for (const { band, slate, posture } of scene.bands ?? []) {
      teachPlans.set(planKey(dialogueDefinitionId, doc.lang, band), {
        slate,
        posture,
        fromSceneContext: scene.fromSceneContext
      });
      hydrated += 1;
    }
  }
  return { hydrated, staleScenes: [...staleSceneIds].sort() };
}
