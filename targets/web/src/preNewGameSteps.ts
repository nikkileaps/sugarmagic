/**
 * targets/web/src/preNewGameSteps.ts
 *
 * Runs the questions plugins ask between the New Game press and the wipe, and
 * carries the answers across the reload.
 *
 * Two pieces:
 *
 *   - `runPreNewGameSteps` — asks each contributed step in turn and collects
 *     the answers. The host calls this before it destroys the save. How a step
 *     reaches the screen is passed in: the host sets `preNewGameStepOpen` on
 *     the UI state store and GameUILayer renders PreNewGameStepOverlay, the
 *     same way the start menu and the quest form reach the screen.
 *   - the sessionStorage handshake — the answers survive the reload the same
 *     way the fresh-start flag does (see `save/freshStart.ts`), and are read at
 *     boot by whoever contributed the step.
 *
 * The answers are written under one key holding a stepId -> optionId map. This
 * file knows no plugin and no step: it moves whatever was contributed.
 */

import {
  isRenderablePreNewGameStep,
  type PreNewGameStepAnswers,
  type PreNewGameStepDefinition,
  type RuntimePluginContribution
} from "@sugarmagic/runtime-core";

export const PRE_NEW_GAME_ANSWERS_SESSION_STORAGE_KEY =
  "sugarmagic.pre-new-game-answers";

type PreNewGameStepContribution = Extract<
  RuntimePluginContribution,
  { kind: "newGame.preStep" }
>;

/** How a step gets on screen. Injected so tests answer without a browser. */
export type PreNewGameStepPresenter = (
  definition: PreNewGameStepDefinition
) => Promise<string>;

/**
 * Ask every contributed step in turn and return what the player chose.
 *
 * Order is the order `getContributions` returns, which is contribution priority
 * ascending. One registered step needs no ordering control beyond that.
 *
 * A step that supplies nothing, or supplies something unrenderable, is skipped:
 * New Game is already under way by the time this runs, and stranding the player
 * on a broken modal is worse than not asking.
 */
export async function runPreNewGameSteps(options: {
  contributions: readonly PreNewGameStepContribution[];
  present: PreNewGameStepPresenter;
}): Promise<PreNewGameStepAnswers> {
  const answers: PreNewGameStepAnswers = {};
  for (const contribution of options.contributions) {
    let definition: PreNewGameStepDefinition | null = null;
    try {
      definition = contribution.payload.getStep();
    } catch (error) {
      console.warn(
        `[web-runtime] pre-new-game step "${contribution.contributionId}" threw while building its question; skipping.`,
        error
      );
      continue;
    }
    if (!isRenderablePreNewGameStep(definition)) {
      if (definition) {
        console.warn(
          `[web-runtime] pre-new-game step "${contribution.contributionId}" supplied a question with no options or no valid default; skipping.`
        );
      }
      continue;
    }
    answers[definition.stepId] = await options.present(definition);
  }
  return answers;
}

/**
 * The slice of Storage the handshake uses. Passed in so the round trip can be
 * exercised without a browser; every caller in the game leaves it out.
 */
export type PreNewGameStepStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

function defaultStorage(): PreNewGameStepStorage | null {
  return typeof sessionStorage === "undefined" ? null : sessionStorage;
}

/** Hand the answers to the next boot. Writing nothing when there is nothing. */
export function writePreNewGameStepAnswers(
  answers: PreNewGameStepAnswers,
  storage: PreNewGameStepStorage | null = defaultStorage()
): void {
  if (!storage) return;
  if (Object.keys(answers).length === 0) return;
  storage.setItem(
    PRE_NEW_GAME_ANSWERS_SESSION_STORAGE_KEY,
    JSON.stringify(answers)
  );
}

/**
 * Read + remove the answers at module load, so the next boot starts clean.
 *
 * Returns an empty map when nothing was written, which is the ordinary case:
 * every boot that was not a New Game press, and every New Game press with no
 * steps registered.
 */
export function consumePreNewGameStepAnswers(
  storage: PreNewGameStepStorage | null = defaultStorage()
): PreNewGameStepAnswers {
  if (!storage) return {};
  const raw = storage.getItem(PRE_NEW_GAME_ANSWERS_SESSION_STORAGE_KEY);
  if (raw === null) return {};
  storage.removeItem(PRE_NEW_GAME_ANSWERS_SESSION_STORAGE_KEY);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const answers: PreNewGameStepAnswers = {};
    for (const [stepId, optionId] of Object.entries(parsed)) {
      if (typeof optionId === "string") answers[stepId] = optionId;
    }
    return answers;
  } catch {
    // Storage is shared with anything else running on this origin. A value
    // this cannot read means the choice is lost, which the caller handles by
    // falling back to its own default -- it does not stop the boot.
    console.warn(
      "[web-runtime] pre-new-game answers could not be read; continuing without them."
    );
    return {};
  }
}
