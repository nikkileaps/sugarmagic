/**
 * packages/runtime-core/src/plugins/pre-new-game-steps.ts
 *
 * A PRE-NEW-GAME STEP is a question the player answers after pressing New Game
 * and before the game is wiped and reloaded. Plugins contribute steps; the host
 * runs them in order and carries the answers across the reload.
 *
 * A step supplies DATA, not DOM. Core owns the question shape and the answer
 * shape, and the host renders the definition with its own overlay, so a step
 * gets the game's look and input gating without a plugin drawing anything.
 *
 * Contributing no steps is a working configuration, not an empty one: New Game
 * then does exactly what it did before this seam existed.
 */

/** One answer a step offers. */
export interface PreNewGameStepOption {
  optionId: string;
  label: string;
}

/**
 * One question with a fixed list of answers and one of them preselected.
 *
 * There is always a default selection and there is no way to dismiss a step
 * without answering, so a step that is shown always produces an answer. Code
 * downstream of the reload can rely on having one.
 */
export interface PreNewGameStepDefinition {
  /** Identifies this step's answer in the handshake. Unique across plugins. */
  stepId: string;
  title: string;
  /** One line under the title. Leave out when the title says enough. */
  prompt?: string;
  options: PreNewGameStepOption[];
  /** Must name one of `options`. */
  defaultOptionId: string;
  confirmLabel: string;
}

export interface PreNewGameStepPayload {
  summary: string;
  /**
   * The question to ask, or null to ask nothing this time. Null means "no
   * question right now", not "error" -- the host skips the step and carries on.
   */
  getStep: () => PreNewGameStepDefinition | null;
}

/**
 * What the player chose, keyed by `stepId`. Values are `optionId`s.
 *
 * This is what rides the reload. Whoever contributed a step reads its own
 * `stepId` back at boot; nothing else in the map concerns it.
 */
export type PreNewGameStepAnswers = Record<string, string>;

/**
 * True when the definition is well formed enough to render and answer.
 *
 * A step arrives from a plugin, so a malformed one is a caller mistake rather
 * than a runtime condition -- but New Game is a destructive action already in
 * progress by the time this runs, so the host skips a bad step and continues
 * rather than stranding the player on a broken modal.
 */
export function isRenderablePreNewGameStep(
  definition: PreNewGameStepDefinition | null
): definition is PreNewGameStepDefinition {
  if (!definition) return false;
  if (!definition.stepId || !definition.confirmLabel) return false;
  if (definition.options.length === 0) return false;
  return definition.options.some(
    (option) => option.optionId === definition.defaultOptionId
  );
}
