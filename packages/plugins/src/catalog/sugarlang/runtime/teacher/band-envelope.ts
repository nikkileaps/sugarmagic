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
