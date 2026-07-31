/**
 * packages/plugins/src/catalog/sugarlang/tests/teacher/target-language-ratio.test.ts
 *
 * Purpose: Pins how much target language a band gets, and that ONE table says so.
 *
 * WHY BOTH HALVES ARE NEEDED
 *   A value assertion alone passes happily against a duplicated constant -- which
 *   is exactly the state this replaced: two live tables, 0.3/0.65/0.85 and
 *   0.2/0.5/0.8, disagreeing about A1 for months. A grep assertion alone passes
 *   against a single table holding the wrong number. Neither is sufficient; the
 *   pair is.
 *
 *   The fold changed A1 scripted rendering from 20% to 30% target language and
 *   NO test failed, because nothing had ever pinned it. That is the gap this
 *   file closes.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Reads band-envelope, and scans sugarlang's runtime source for a second table.
 *
 * Implements: Plan 090 story 090.8b
 *
 * Status: active
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TARGET_LANGUAGE_RATIO_BY_POSTURE,
  exceedsReadabilityCeiling,
  getReadabilityCeilingForBand,
  postureForBand
} from "../../runtime/teacher/band-envelope";

const RUNTIME_ROOT = new URL("../../runtime", import.meta.url).pathname;

function everyRuntimeSourceFile(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return everyRuntimeSourceFile(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}

describe("target-language ratio", () => {
  it("gives an A1 learner 30% target language", () => {
    // nikki's call, 2026-07-30. Player-visible: this was 20% on the scripted
    // path until the fold.
    expect(TARGET_LANGUAGE_RATIO_BY_POSTURE[postureForBand("A1")]).toBe(0.3);
  });

  it("rises with band", () => {
    expect(TARGET_LANGUAGE_RATIO_BY_POSTURE[postureForBand("A2")]).toBe(0.65);
    expect(TARGET_LANGUAGE_RATIO_BY_POSTURE[postureForBand("B1")]).toBe(0.85);
  });

  it("is declared in exactly one place", () => {
    // The deleted table was `posture === "anchored" ? 0.2 : ... 0.5 : 0.8`.
    // Scanning source rather than comparing values, because a duplicate that
    // happens to agree today is still a duplicate -- and the last one drifted.
    //
    // Comments are stripped first: a comment EXPLAINING the deleted table (there
    // is one, at the deletion site) is documentation, not a declaration, and the
    // first version of this test failed on its own explanation.
    const offenders = everyRuntimeSourceFile(RUNTIME_ROOT).filter((file) => {
      if (file.endsWith("band-envelope.ts")) return false;
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      // A ratio triple written inline: three decimals in one expression.
      return /0\.2\b[\s\S]{0,80}0\.5\b[\s\S]{0,80}0\.8\b/.test(code);
    });

    expect(offenders).toEqual([]);
  });
});

describe("readability ceiling", () => {
  // The OTHER ratio question. TARGET_LANGUAGE_RATIO_BY_POSTURE says what a line
  // SHOULD be; this says when it has stopped being readable at all. They are far
  // apart on purpose -- A1 is directed at 0.3 and does not get repaired until
  // 0.7 -- because repairing every off-target line means a second LLM call on
  // most turns for a tuning miss rather than a broken turn.
  it.each([
    ["A1", 0.7],
    ["A2", 0.8]
  ] as const)("guards %s at %s", (band, ceiling) => {
    expect(getReadabilityCeilingForBand(band)).toBe(ceiling);
  });

  it.each(["B1", "B2", "C1", "C2"] as const)("does NOT guard %s", (band) => {
    // From B1 up a fully target-language line is the GOAL, not a failure. null
    // rather than 1.0 so "no guard" and "guard at 100%" cannot be confused.
    expect(getReadabilityCeilingForBand(band)).toBeNull();
  });

  it("leaves REAL headroom above the directed ratio at every guarded band", () => {
    // NOT just `> directed`. B1/B2 were briefly guarded at 0.90 while directed
    // at 0.85 -- five points, which passes a greater-than check and still fires
    // on ordinary output, because a generator told "about 85%" routinely lands
    // at 95-100%. The end-to-end test caught it: a correct all-Spanish repair at
    // B2 was immediately flagged as too dense and repaired again.
    //
    // A ceiling is for RARE breakage. If it sits within a generator's normal
    // spread of the target, it is a second cost centre, not a guard.
    const MIN_HEADROOM = 0.15;

    for (const band of ["A1", "A2", "B1", "B2", "C1", "C2"] as const) {
      const ceiling = getReadabilityCeilingForBand(band);
      if (ceiling === null) continue;
      const directed = TARGET_LANGUAGE_RATIO_BY_POSTURE[postureForBand(band)];
      expect(ceiling - directed).toBeGreaterThanOrEqual(MIN_HEADROOM);
    }
  });

  it("an A1 line at the DIRECTED ratio is not too dense", () => {
    expect(exceedsReadabilityCeiling(0.3, "A1")).toBe(false);
  });

  it("an A1 line that is merely off-target is not too dense either", () => {
    // 0.45 is already `over-ratio` against a 0.3 directed ratio. Readable.
    expect(exceedsReadabilityCeiling(0.45, "A1")).toBe(false);
  });

  it("a B2 line at 100% target language is NOT too dense", () => {
    // target-dominant IS the intent from B1 up. This was guarded at 0.90 for
    // part of 2026-07-31 and it made correct output repairable.
    expect(exceedsReadabilityCeiling(1, "B2")).toBe(false);
  });

  it("an A1 line at 90% target language IS too dense", () => {
    // The motivating case: "an A1 learner could be handed a full-Spanish
    // paragraph and every gate passed it."
    expect(exceedsReadabilityCeiling(0.9, "A1")).toBe(true);
  });

  it("a C2 line at 100% target language is never too dense", () => {
    expect(exceedsReadabilityCeiling(1, "C2")).toBe(false);
  });

  it("treats the ceiling as strictly-greater, not inclusive", () => {
    expect(exceedsReadabilityCeiling(0.7, "A1")).toBe(false);
    expect(exceedsReadabilityCeiling(0.71, "A1")).toBe(true);
  });

  it("a non-finite measurement never triggers repair", () => {
    // A measurement failure must not spend an LLM call on a turn nobody has
    // shown to be broken.
    expect(exceedsReadabilityCeiling(Number.NaN, "A1")).toBe(false);
  });
});
