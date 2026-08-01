/**
 * packages/plugins/src/catalog/sugarlang/tests/target-language-resolution.test.ts
 *
 * Purpose: Pins the SINGLE precedence for target language -- player -> config,
 *   with no environment rung -- and that the lookup is TOTAL: it returns null
 *   rather than deciding for its callers.
 *
 *   WHERE THE POLICY LIVES INSTEAD (nikki, 2026-07-31). The same lookup serves
 *   Studio, preview, and a shipped game, and they want different things from a
 *   null: Studio must come up (a freshly installed plugin has no language yet),
 *   preview must refuse to launch, and the runtime must throw. Those rules are
 *   tested where they are enforced, not here.
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

  it("returns NULL when nothing is configured, rather than throwing", () => {
    // IT DOES NOT GET TO DECIDE. This threw for a while, which forced Studio to
    // hold the runtime's opinion: an unconfigured project could not open its own
    // Build panel, and the preview -- whose builder is called inside a
    // postMessage argument -- went blank with no error at all.
    //
    // Total lookup, policy at the callers.
    expect(resolveSugarLangTargetLanguage({})).toBeNull();
    expect(resolveSugarLangTargetLanguage({ player: null, config: undefined })).toBeNull();
  });

  it("still exports a named error for the callers that DO fail loudly", () => {
    // The runtime throws this (see the conversation context middleware). It
    // stays a distinct type so a catch-all cannot absorb it as generic, and its
    // message names both places the author can fix it.
    const error = new SugarlangMissingTargetLanguageError();

    expect(error).toBeInstanceOf(SugarlangMissingTargetLanguageError);
    expect(error.name).toBe("SugarlangMissingTargetLanguageError");
    expect(error.message).toMatch(/Language panel/);
    expect(error.message).toMatch(/player/);
  });

  it.each([
    ["empty string", ""],
    ["whitespace", "   "]
  ])("treats a %s rung as absent and falls through", (_label, blank) => {
    expect(
      resolveSugarLangTargetLanguage({ player: blank, config: "es" })
    ).toBe("es");
    expect(
      resolveSugarLangTargetLanguage({ player: blank, config: blank })
    ).toBeNull();
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
