/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/scene-teach-plan.ts
 *
 * Purpose: What should the lines in this scene TEACH, at each band? One Teacher
 *   call per (scene, band), producing the directive every dialogue line in that
 *   scene bakes against.
 *
 * WHY PER SCENE AND NOT PER LINE
 *   The obvious reading of "call the Teacher at bake time" is one call per line
 *   per band, which is what this ticket estimated and what made the work look
 *   unaffordable. It is not per line, because THE BUILD-TIME SITUATION IS
 *   SCENE-LEVEL. There is no quest state, no time of day, no NPC, no recent
 *   turns at build time -- every node in a scene composes an identical
 *   `Situation`, so every node would get an identical directive. Asking again
 *   per line buys nothing and costs a gateway call.
 *
 *   A scene with 50 dialogue nodes across 6 bands is 6 calls, not 300.
 *
 * WHY THERE IS NO NPC IN THE SITUATION
 *   Two reasons, and the second is the load-bearing one. An NPC's bio is
 *   ALREADY in the scene's concepts, carried with `provenance: "npc:<id>:bio"`
 *   -- extraction read it. And `situationKey` deliberately excludes the NPC, so
 *   two different NPCs in one scene produce the same key; adding an NPC to the
 *   situation would change the PROMPT while leaving the KEY identical, which is
 *   the precise shape that makes a cache return one NPC's directive for another.
 *
 * WHY THE LEARNER IS SYNTHETIC AND EMPTY
 *   The variant cache key has no learner in it -- a variant is per BAND, not per
 *   person -- so a bake cannot be personalised and must not pretend to be. An
 *   empty profile at band B is the honest representation of "some learner at
 *   band B": every lemma reads `unseen`, so everything is introduce-eligible and
 *   nothing is spuriously "due". Feeding a real player's cards in here would
 *   bake one person's review schedule into content every player reads.
 *
 * WHAT A FAILURE MEANS
 *   A null directive for a band. The caller bakes that band with no slate,
 *   which is exactly what it did before this existed -- level-graded, no
 *   vocabulary steer. A bake that fails LOUDLY into no-teaching is much better
 *   than one that silently invents a slate.
 *
 * Exports:
 *   - SceneTeachPlan, planSceneTeaching
 *
 * Relationships:
 *   - Studio/build only. This makes gateway calls; the runtime must never call
 *     it (the runtime receives baked variants and seeded scene context).
 *   - Consumes `composeSituation`, which is total -- the compile half alone is a
 *     valid situation, which is what makes a scene-context-only call legal.
 *
 * Implements: Plan 090 story 090.11
 *
 * Status: active
 */

import type { CEFRBand } from "../cefr";
import type { PedagogicalDirective } from "../contracts/pedagogy";
import type { SceneContextModel } from "../contracts/scene-context";
import type { LexicalAtlasProvider, TeacherPolicy } from "../contracts/providers";
import type { LearnerId } from "../learner/learner-profile";
import type { GradedTextSlate } from "../grading/graded-text-service";
import { composeSituation } from "../situation";
import { situationKey } from "../situation/situation-key";
import { createEmptyLearnerProfile } from "../learner/persistence";
import { seedCefrPosteriorFromPlacement } from "../learner/cefr-posterior";

/** One directive per band, plus the slate the bake actually consumes. */
export interface SceneTeachPlan {
  sceneId: string;
  /** Absent band = the Teacher failed for it; bake that band without a slate. */
  byBand: Map<CEFRBand, { directive: PedagogicalDirective; slate: GradedTextSlate }>;
}

/**
 * The Teacher's answer for one scene, at every band it will be baked at.
 *
 * `sceneContext` may be null -- an unbuilt or stale scene. The situation is
 * still composed (composition is total) and the Teacher still answers, it just
 * answers from runtime facts that are all `unavailable`. That is a weak
 * directive rather than a wrong one, and the caller can tell the difference by
 * checking whether the scene context was there.
 */
export async function planSceneTeaching(args: {
  sceneId: string;
  sceneContext: SceneContextModel | null;
  bands: readonly CEFRBand[];
  targetLanguage: string;
  supportLanguage: string;
  teacher: TeacherPolicy;
  atlas: LexicalAtlasProvider;
  onLog?: (message: string, detail?: Record<string, unknown>) => void;
}): Promise<SceneTeachPlan> {
  const {
    sceneId,
    sceneContext,
    bands,
    targetLanguage,
    supportLanguage,
    teacher,
    atlas,
    onLog
  } = args;

  const situation = composeSituation({
    sceneId,
    sceneContext,
    runtimeContext: undefined
  });
  const key = situationKey(situation);

  const byBand = new Map<
    CEFRBand,
    { directive: PedagogicalDirective; slate: GradedTextSlate }
  >();

  // Sequential, not Promise.all. These are gateway calls and a rebuild already
  // fans out over scenes; firing every band of every scene at once is how a
  // rebuild turns into a rate-limit incident.
  for (const band of bands) {
    const learner = {
      ...createEmptyLearnerProfile({
        // Branded id. Not a real learner and deliberately labelled as such, so a
        // bake directive turning up in learner telemetry is obviously synthetic
        // rather than looking like a player whose cards are all empty.
        learnerId: `bake:${band}` as LearnerId,
        targetLanguage,
        supportLanguage,
        estimatedCefrBand: band
      }),
      // The band is not a guess here -- the bake hardcodes it, one variant per
      // band. An empty profile is cold-start by construction (unassessed,
      // confidence 1/6, uniform posterior), and the Teacher reads that as "we
      // do not know this learner" and teaches to the uncertainty rather than to
      // the band: `isA1OrLowerConfidence` emits the beginner hint,
      // `getDefaultSupportPosture` returns `anchored` under 0.3, and
      // `getDefaultInteractionStyle` returns `listening_first` while the status
      // is not `evaluated`. All three fired at every band, so C1 baked at the
      // A1 support ratio and every variant came out almost entirely English.
      //
      // So state the certainty we actually have. evaluatedAtMs stays null: a
      // bake must be deterministic, and nothing reads the timestamp.
      assessment: {
        status: "evaluated" as const,
        evaluatedCefrBand: band,
        cefrConfidence: 1,
        evaluatedAtMs: null
      },
      cefrPosterior: seedCefrPosteriorFromPlacement(band, 1)
    };

    try {
      const directive = await teacher.invoke({
        // Not a real conversation. The id only has to be stable and unique per
        // (scene, band) so a directive cache, if one is ever put in front of
        // this, cannot serve one band's answer for another.
        conversationId: `bake:${sceneId}:${band}`,
        learner,
        atlas,
        situation,
        situationKey: key,
        lang: { targetLanguage, supportLanguage },
        calibrationActive: false
      });

      byBand.set(band, {
        directive,
        slate: {
          introduce: directive.targetVocab.introduce,
          reinforce: directive.targetVocab.reinforce,
          avoid: directive.targetVocab.avoid
        }
      });
    } catch (error) {
      // Loud, and then carry on. One band failing must not abandon the others,
      // and a silent failure here surfaces later as "the bake stopped teaching"
      // with nothing pointing at the Teacher.
      onLog?.("teach-plan-failed", {
        sceneId,
        band,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  onLog?.("teach-plan", {
    sceneId,
    sceneContextAvailable: sceneContext !== null,
    conceptCount: sceneContext?.concepts.length ?? 0,
    bandsPlanned: [...byBand.keys()],
    bandsFailed: bands.filter((band) => !byBand.has(band))
  });

  return { sceneId, byBand };
}
