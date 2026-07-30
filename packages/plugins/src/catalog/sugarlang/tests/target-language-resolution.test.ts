/**
 * packages/plugins/src/catalog/sugarlang/tests/target-language-resolution.test.ts
 *
 * Purpose: Pins the SINGLE precedence for target language -- player -> config,
 *   with no environment rung -- and that an unresolved language THROWS rather
 *   than degrading.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises resolveSugarLangTargetLanguage in ../config.
 *
 * Implements: Plan 090 story 090.1 (cleanup)
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  SugarlangMissingTargetLanguageError,
  resolveSugarLangTargetLanguage
} from "../config";

describe("resolveSugarLangTargetLanguage", () => {
  it("prefers the player's choice over the project default", () => {
    // The whole point of the ordering: target language belongs to a PERSON.
    // Two players of one deployment must be able to choose differently.
    expect(
      resolveSugarLangTargetLanguage({ player: "it", config: "es" })
    ).toBe("it");
  });

  it("falls back to the authored project default", () => {
    // The rung that was invisible before: Studio's Language panel writes config,
    // and the preview payload read the environment ONLY -- so setting the
    // language in Studio silently shipped nothing.
    expect(resolveSugarLangTargetLanguage({ config: "it" })).toBe("it");
  });

  it("THROWS when nothing is configured", () => {
    // Not a degraded state -- a misconfiguration. A language-learning system
    // with no language cannot make a single meaningful downstream decision, and
    // returning null let a broken preview boot "successfully" for months.
    expect(() => resolveSugarLangTargetLanguage({})).toThrow(
      SugarlangMissingTargetLanguageError
    );
  });

  it("names both fixable places in the error", () => {
    // The old failure mode was a blank screen with no clue which knob was missing.
    expect(() => resolveSugarLangTargetLanguage({})).toThrow(/Language panel/);
    expect(() => resolveSugarLangTargetLanguage({})).toThrow(/player/);
  });

  it("has its own error type, so a catch-all cannot absorb it as generic", () => {
    try {
      resolveSugarLangTargetLanguage({ player: null, config: undefined });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(SugarlangMissingTargetLanguageError);
      expect((error as Error).name).toBe("SugarlangMissingTargetLanguageError");
    }
  });

  it.each([
    ["empty string", ""],
    ["whitespace", "   "]
  ])("treats a %s rung as absent and falls through", (_label, blank) => {
    expect(
      resolveSugarLangTargetLanguage({ player: blank, config: "es" })
    ).toBe("es");
    expect(() =>
      resolveSugarLangTargetLanguage({ player: blank, config: blank })
    ).toThrow(SugarlangMissingTargetLanguageError);
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(resolveSugarLangTargetLanguage({ player: "  IT  " })).toBe("it");
    expect(resolveSugarLangTargetLanguage({ config: " ES " })).toBe("es");
  });

  it("takes no environment argument at all", () => {
    // Guard against the env rung creeping back: target language is a player
    // choice and an env var is one value per deployment, which cannot express
    // two players choosing differently.
    expect(resolveSugarLangTargetLanguage).toHaveLength(1);
  });
});
