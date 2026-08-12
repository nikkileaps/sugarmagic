/**
 * The question the player answers after pressing New Game.
 *
 * The load-bearing property is THE STEP ALWAYS YIELDS A LANGUAGE. The game
 * refuses to run without one, so a step the player could leave unanswered --
 * or one preselecting something it never offered -- would strand them in a
 * game that cannot start. Every case below is a way that could happen.
 *
 * The second property is ONE LIST. The languages offered come from the same
 * place the config validator reads, so a language cannot exist for the author
 * and be missing for the player.
 */

import { describe, expect, it } from "vitest";
import { isRenderablePreNewGameStep } from "@sugarmagic/runtime-core";
import {
  SUGARLANG_TEACHABLE_LANGUAGES,
  SUGARLANG_TARGET_LANGUAGE_STEP_ID,
  normalizeSugarLangPluginConfig
} from "../config";
import { buildTargetLanguagePreNewGameStep } from "../runtime/target-language-pre-new-game-step";

const configWith = (targetLanguage: unknown) =>
  normalizeSugarLangPluginConfig({ targetLanguage });

describe("the new-game language picker", () => {
  it("offers every language that can be taught, by name", () => {
    const step = buildTargetLanguagePreNewGameStep(configWith("es"));
    expect(step.options.map((option) => option.optionId)).toEqual([
      ...SUGARLANG_TEACHABLE_LANGUAGES
    ]);
    expect(step.options.map((option) => option.label)).toEqual([
      "Spanish",
      "Italian"
    ]);
  });

  it("starts on the language the project was authored for", () => {
    // The least surprising answer for a player who just clicks past.
    expect(
      buildTargetLanguagePreNewGameStep(configWith("it")).defaultOptionId
    ).toBe("it");
  });

  it("THE ONE THAT MATTERS: there is always a valid selection", () => {
    // A default naming an option that is not offered would leave the player
    // confirming nothing. The runner skips a step in that state, so the game
    // would start with no language at all.
    for (const authored of [undefined, null, "", "   ", "fr", 42, {}]) {
      const step = buildTargetLanguagePreNewGameStep(configWith(authored));
      expect(
        step.options.some(
          (option) => option.optionId === step.defaultOptionId
        ),
        `default must be one of the offered options for authored ${JSON.stringify(authored)}`
      ).toBe(true);
      expect(isRenderablePreNewGameStep(step)).toBe(true);
    }
  });

  it("answers under the step id sugarlang reads back at boot", () => {
    // The answer travels keyed by this id and nothing else looks it up. A
    // mismatch here would lose the pick silently, with the game falling back
    // to the project default as though nothing had been asked.
    expect(buildTargetLanguagePreNewGameStep(configWith("es")).stepId).toBe(
      SUGARLANG_TARGET_LANGUAGE_STEP_ID
    );
  });

  it("says the choice is final, and offers no way out of it", () => {
    const step = buildTargetLanguagePreNewGameStep(configWith("es"));
    expect(step.prompt).toBe("You cannot change this later in this game.");
    expect(step.confirmLabel).toBe("Start");
  });
});
