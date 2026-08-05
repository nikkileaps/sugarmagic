/**
 * packages/plugins/src/catalog/sugarlang/runtime/teacher/band-envelope.ts
 *
 * Purpose: Single source of truth for the per-posture / per-band language
 *   envelope: how much target language a posture directs, and how complex a
 *   sentence a band tolerates. Any code path that builds a PedagogicalDirective
 *   MUST read these instead of inlining its own table -- divergent copies
 *   silently change the envelope 083's verified level control enforces.
 *
 * Exports:
 *   - TARGET_LANGUAGE_RATIO_BY_POSTURE
 *   - getSentenceComplexityCap
 *   - postureForBand
 *
 * Relationships:
 *   - Consumed by FallbackTeacherPolicy (confidence-driven posture) and the
 *     teacher middleware's schedule-driven realizer (band-driven posture).
 *     Both share the RATIO and COMPLEXITY tables; only the posture INPUT differs.
 *
 * Implements: AGENTS.md single-enforcer rule (087.6 mini-review finding)
 *
 * Status: active
 */

import type { CEFRBand, PedagogicalDirective } from "../types";

type SupportPosture = PedagogicalDirective["supportPosture"];

/**
 * Directed target-language share per posture. One table, repo-wide.
 *
 * FOLDED 2026-07-30 (Plan 090.8b). 087.6 recorded a second, divergent table --
 * 0.2/0.5/0.8 -- and deferred merging it until "scripted rendering next
 * changes". 090.8 is that change, so the trigger fired and the inline table is
 * gone. This is now the only target-language ratio in the codebase.
 *
 * The 087.6 note said that table lived in the scripted middleware; it was
 * actually in the TEACHER middleware, which is where it was deleted from. The
 * scripted middleware only ever read the resulting `constraint.targetLanguageRatio`.
 *
 * PLAYER-VISIBLE CONSEQUENCE of the fold: A1 scripted lines went from 20% to 30%
 * target language. nikki's call. If beginner dialogue suddenly reads as denser,
 * this is why -- it is intended, not a regression.
 */
/**
 * How far the Teacher may move off the table's number for a posture.
 *
 * 090.4: the table used to govern NOTHING on the Teacher's path. The prompt
 * asked for `targetLanguageRatio: number in [0, 1]` with no guidance at all, and
 * nothing clamped the answer -- so an anchored A1 turn came back at 0.4 while
 * the table said 0.3, and the model had no way to know it was wrong.
 *
 * A hard clamp was the other option. This band exists because density really is
 * a moment-to-moment call -- a tense beat wants less target language than a
 * relaxed one -- and posture alone is too coarse a lever for that. The table
 * sets the centre; the Teacher may lean.
 */
export const TARGET_LANGUAGE_RATIO_TOLERANCE = 0.1;

export const TARGET_LANGUAGE_RATIO_BY_POSTURE = {
  anchored: 0.3,
  supported: 0.65,
  "target-dominant": 0.85,
  "target-only": 1
} as const;

/** Sentence-complexity ceiling per band. A1 stays single-clause. */
/**
 * Bounds a Teacher-chosen ratio to its posture's band.
 *
 * The single place the table becomes a GOVERNOR rather than a suggestion.
 * Callers must not re-derive this arithmetic; a second clamp with its own
 * tolerance is the same divergence 090.8b just finished folding.
 */
export function clampRatioToPosture(
  ratio: number,
  posture: keyof typeof TARGET_LANGUAGE_RATIO_BY_POSTURE
): number {
  const centre = TARGET_LANGUAGE_RATIO_BY_POSTURE[posture];
  if (!Number.isFinite(ratio)) return centre;
  const low = Math.max(0, centre - TARGET_LANGUAGE_RATIO_TOLERANCE);
  const high = Math.min(1, centre + TARGET_LANGUAGE_RATIO_TOLERANCE);
  return Math.max(low, Math.min(high, ratio));
}

/**
 * How many NEW teachables one NPC turn may introduce, by learner band.
 *
 * ONE TABLE, ONE ENFORCER (nikki, 2026-07-30). There were two answers to this
 * and they disagreed: `generator-prompt-overlay` capped every learner at a flat
 * 2 (raised to 3), while `fallback-teacher-policy.getIntroduceLevelCap` ran a
 * per-band curve of 1/2/3/4/5. So the gateway going down silently changed how
 * much an A1 learner was taught -- from 3 down to 1 -- with nothing saying why.
 * Same shape as the 0.2/0.5/0.8-vs-0.3/0.65/0.85 ratio divergence 090.8b folded.
 *
 * The per-band curve was the right idea in the wrong place: capacity is a
 * property of the learner, not of whichever code path happened to be running.
 * It lives here beside the other band-keyed pedagogical tables until 090.5
 * (learner capacity) takes it further -- fatigue, session depth and
 * conversation depth all modulate this, and none of them are read yet.
 *
 * Values shifted up from the old curve (nikki, 2026-07-30): the old A1 of 1
 * made a conversation read as light on teachables even when the Teacher had
 * chosen well. A competency counts as one item here; its exponents do not
 * (they are how the act is performed, not extra things to learn).
 *
 *   A1 3   A2 4   B1 5   B2 5   C1 6   C2 6
 */
/**
 * Does a line at this band say the subject pronoun out loud, or drop it?
 *
 * Spanish drops it: `Vendo queso` is the natural sentence and `Yo vendo queso`
 * is emphatic. Forcing it for beginners is a deliberate trade -- pro-drop hides
 * the person inside a verb ending they cannot parse yet, so their first
 * sentences would read as "sell cheese" with nobody in them. `yo vendo` makes
 * I -> yo and sell -> vendo legible, and dropping it later teaches pro-drop as
 * a real feature rather than one they never noticed was there.
 *
 * The cost is a learner who over-generalizes and says `yo` constantly, which
 * corrects at exactly the band where this stops applying.
 *
 * Here rather than beside the word list (`always-target-words.ts`) because it
 * is band-keyed, and every band-keyed pedagogical number lives in this file.
 * They are also two different rules wearing one face: WHICH LANGUAGE the
 * subject is in is always the target one; WHETHER IT IS SAID AT ALL is this.
 *
 *   A1 yes   A2 yes   B1+ no
 */
export function saysSubjectPronounExplicitly(cefrBand: CEFRBand): boolean {
  return cefrBand === "A1" || cefrBand === "A2";
}

export function getIntroduceCapForBand(cefrBand: CEFRBand): number {
  switch (cefrBand) {
    case "A1":
      return 3;
    case "A2":
      return 4;
    case "B1":
    case "B2":
      return 5;
    case "C1":
    case "C2":
      return 6;
  }
}

/**
 * THE READABILITY CEILING: above this share of target language, a line stops
 * being hard and starts being unreadable, and the turn is regenerated.
 *
 * NOT THE SAME THING AS `over-ratio`, and the distinction is the whole point.
 *   `TARGET_LANGUAGE_RATIO_BY_POSTURE` says what a line SHOULD be (A1: 0.3) and
 *   `clampRatioToPosture` allows the Teacher +/-0.1 around it. A line at 0.45 is
 *   already `over-ratio` -- off-target, worth measuring, and completely readable.
 *   Repairing every one of those would mean a second LLM call on most turns for
 *   a tuning miss.
 *
 *   This is the OTHER question: is the line still comprehensible to this learner
 *   at all? An A1 beginner handed 90% Spanish cannot read it -- that is a broken
 *   turn, not a drifted one. So the ceiling sits FAR above the directed ratio
 *   (0.3 directed vs 0.7 ceiling at A1) and is expected to fire rarely.
 *
 * NULL MEANS NO CEILING. From B1 up a fully target-language line is the goal,
 * not a failure, so there is nothing to guard against. `null` rather than 1.0
 * because "no guard" and "guard at 100%" differ the moment anyone makes the
 * comparison inclusive.
 *
 * Values from nikki, 2026-07-31:
 *   A1 0.70   A2 0.80   B1 none   B2 none   C1 none   C2 none
 *
 * B1/B2 STARTED AT 0.90 AND WERE DROPPED THE SAME DAY. Both sit at
 * `target-dominant`, directed 0.85, so a 0.90 ceiling left FIVE POINTS of
 * headroom -- and a generator told "mostly Spanish, about 85%" routinely lands
 * at 95-100%. The guard fired on ordinary output instead of rare breakage.
 *
 * The end-to-end test showed it concretely: an all-English B2 turn triggered the
 * existing under-ratio repair, the repair came back fully Spanish, and the
 * ceiling immediately flagged that CORRECT repair as too dense and repaired
 * again. Two model calls to undo a system that was already doing the right
 * thing.
 *
 * The headroom is what makes this table work, not the absolute number: A1 is
 * directed at 0.30 and guarded at 0.70, forty points clear.
 */
export function getReadabilityCeilingForBand(cefrBand: CEFRBand): number | null {
  switch (cefrBand) {
    case "A1":
      return 0.7;
    case "A2":
      return 0.8;
    case "B1":
    case "B2":
    case "C1":
    case "C2":
      return null;
  }
}

/**
 * Is this line too dense in the target language to be readable by this learner?
 *
 * The single enforcer for that question. A caller comparing against
 * `getReadabilityCeilingForBand` itself has to remember that null means "no
 * ceiling" and that the comparison is strictly-greater; two callers doing that
 * by hand is how the ratio tables diverged before.
 */
export function exceedsReadabilityCeiling(
  measuredRatio: number,
  cefrBand: CEFRBand
): boolean {
  const ceiling = getReadabilityCeilingForBand(cefrBand);
  if (ceiling === null) return false;
  if (!Number.isFinite(measuredRatio)) return false;
  return measuredRatio > ceiling;
}

export function getSentenceComplexityCap(
  cefrBand: CEFRBand
): PedagogicalDirective["sentenceComplexityCap"] {
  switch (cefrBand) {
    case "A1":
      return "single-clause";
    case "A2":
    case "B1":
      return "two-clause";
    case "B2":
    case "C1":
    case "C2":
      return "free";
  }
}

/**
 * Band-driven posture pick, for paths that have a settled band rather than a
 * placement confidence (the schedule-driven realizer). The fallback policy
 * picks posture from confidence instead and then reads the SAME ratio table.
 */
export function postureForBand(
  cefrBand: CEFRBand
): PedagogicalDirective["supportPosture"] {
  if (cefrBand === "A1") return "anchored";
  if (cefrBand === "A2") return "supported";
  return "target-dominant";
}

/**
 * How much of a line should be target language, as an INSTRUCTION to whichever
 * model is writing it.
 *
 * ONE WORDING, TWO CALLERS. The agent path (generator-prompt-overlay) and the
 * build-time bake (graded-text-service) both have to tell a model how much
 * target language to use, and they had drifted to the point of contradiction:
 * the bake's prompt said "predominantly or entirely in the target language"
 * for EVERY band, so an A1 line was generated fully in Spanish while the
 * envelope said 30%. The ratio reached the verifier and never the generator,
 * which is a hard failure to see -- the text looks deliberate.
 *
 * Both callers read this, so a posture cannot mean two things again.
 *
 * Implements: Plan 090 story 090.11
 */
export function describeLanguageMix(
  posture: SupportPosture,
  targetLanguageName: string,
  ratio: number = TARGET_LANGUAGE_RATIO_BY_POSTURE[posture]
): string {
  const percent = Math.round(ratio * 100);
  switch (posture) {
    case "anchored":
      return `Write mostly in the support language (English), sprinkling in a few ${targetLanguageName} words -- about ${percent}% of the text. A beginner must be able to follow the sentence from the English alone.`;
    case "supported":
      return `Write a mixed text: roughly ${percent}% ${targetLanguageName}, the rest in the support language (English), so meaning stays easy to follow.`;
    case "target-dominant":
      return `Write mostly in ${targetLanguageName} -- about ${percent}% -- with brief support-language anchoring only where it aids comprehension.`;
    case "target-only":
      return `Write entirely in ${targetLanguageName}.`;
  }
}
