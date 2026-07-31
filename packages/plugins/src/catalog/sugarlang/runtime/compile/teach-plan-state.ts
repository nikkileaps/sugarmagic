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
 * WHY A PLAIN MAP AND NOT AN INDEXEDDB CACHE
 *   Same shape as the runtime scene-context store next door: a small derived
 *   record, written by one pass, read in the same Studio session. Persisting it
 *   would mean ~400 lines of IDB boilerplate to make a REBUILD ARTEFACT survive
 *   a page reload, which is the one thing a rebuild trivially reproduces.
 *
 *   THE DEGRADATION IS DELIBERATE AND SAFE. After a reload the plan is gone and
 *   a bake proceeds with no slate -- level-graded, no vocabulary steer, which is
 *   exactly what every bake did before slates existed. Missing plan means "no
 *   steer", never "steer toward nothing". If baking-after-reload-without-slate
 *   turns out to matter in practice, THAT is the trigger to persist this; until
 *   then a reload just means pressing Rebuild again.
 *
 * Exports:
 *   - getSugarlangTeachPlan, seedSugarlangTeachPlan, clearSugarlangTeachPlan
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
