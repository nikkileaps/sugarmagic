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
