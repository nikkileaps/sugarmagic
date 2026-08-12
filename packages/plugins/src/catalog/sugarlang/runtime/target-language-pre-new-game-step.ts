/**
 * packages/plugins/src/catalog/sugarlang/runtime/target-language-pre-new-game-step.ts
 *
 * The question the player answers after pressing New Game: which language is
 * this game in?
 *
 * This builds the question as DATA and hands it over. The game draws it, which
 * is why there is no markup here -- sugarlang's player-facing surfaces are
 * data everywhere else too, and it keeps one place responsible for how the
 * game looks and which keys it swallows while a box is up.
 *
 * Composed from the two things that already know the answers:
 *
 *   - which languages can be taught, from the plugin config
 *   - what each one is called, from the display-name lookup
 *
 * so adding a third language never touches this file.
 *
 * WHY THERE IS NO WAY OUT OF IT. The game refuses to run with no language, so
 * a player who dismissed this would land in a broken game. One option is
 * always preselected and the only button confirms, which means the answer
 * always exists.
 */

import {
  SUGARLANG_TEACHABLE_LANGUAGES,
  SUGARLANG_TARGET_LANGUAGE_STEP_ID,
  type SugarLangPluginConfig
} from "../config";
import { languageDisplayName } from "./language-names";
import type { PreNewGameStepDefinition } from "@sugarmagic/runtime-core";

/**
 * Which language starts selected.
 *
 * The project's authored language, when it is one we can teach: the author
 * picked it as what this game is mostly for, so it is the least surprising
 * answer for a player who just clicks past. Otherwise the first we offer,
 * because a step with no valid selection would be one the player cannot leave.
 */
function defaultLanguageFor(config: SugarLangPluginConfig): string {
  const authored = config.targetLanguage;
  return SUGARLANG_TEACHABLE_LANGUAGES.includes(
    authored as (typeof SUGARLANG_TEACHABLE_LANGUAGES)[number]
  )
    ? authored
    : SUGARLANG_TEACHABLE_LANGUAGES[0];
}

export function buildTargetLanguagePreNewGameStep(
  config: SugarLangPluginConfig
): PreNewGameStepDefinition {
  return {
    stepId: SUGARLANG_TARGET_LANGUAGE_STEP_ID,
    title: "Choose your language",
    prompt: "You cannot change this later in this game.",
    options: SUGARLANG_TEACHABLE_LANGUAGES.map((code) => ({
      optionId: code,
      label: languageDisplayName(code)
    })),
    defaultOptionId: defaultLanguageFor(config),
    confirmLabel: "Start"
  };
}
