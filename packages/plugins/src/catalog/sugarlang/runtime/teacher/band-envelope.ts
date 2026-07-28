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
 * NOTE (087.6): the scripted middleware still carries its own pre-existing
 * 0.2/0.5/0.8 table (sugar-lang-scripted-middleware.ts, shipped in 086) for the
 * weave/baked-variant path. Folding that path onto this table is a behavior
 * change to shipped scripted rendering and is deliberately NOT done here --
 * revisit when scripted rendering next changes, and delete its inline table then.
 */
export const TARGET_LANGUAGE_RATIO_BY_POSTURE = {
  anchored: 0.3,
  supported: 0.65,
  "target-dominant": 0.85,
  "target-only": 1
} as const;

/** Sentence-complexity ceiling per band. A1 stays single-clause. */
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
