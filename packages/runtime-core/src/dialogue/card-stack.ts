/**
 * packages/runtime-core/src/dialogue/card-stack.ts
 *
 * Purpose: The conversation as a STACK OF CARDS receding in Z. One card is at
 *   the front and is the active one; the rest sit behind it, progressively
 *   smaller, dimmer and mostly hidden. Enter pushes the stack back by one.
 *   Scrolling walks the same transition in either direction.
 *
 * ONE MECHANISM, NOT FOUR
 *   The reading beat, chunk advance, history and the input card were four
 *   separate behaviours stapled together. They are all the same thing: a card
 *   arrives at the front, and whatever was there moves back one place. Enter and
 *   scroll are just two inputs driving that one transition.
 *
 * THE STACK IS A WINDOW
 *   The card LIST is the whole conversation. The stack renders at most
 *   `depth` cards of it, ending at `frontIndex`. Scrolling back moves the
 *   window, it does not materialise the entire history.
 *
 * WHY THE INDEX MATH IS SEPARATE
 *   Everything below the DOM boundary is pure and tested. Off-by-ones in the
 *   window are the bugs that make a stack show the wrong card or silently drop
 *   the oldest one, and they are invisible in a screenshot.
 *
 * Exports:
 *   - stackWindow
 *   - stepFrontIndex
 *   - DEFAULT_STACK_DEPTH
 *
 * Status: active
 */

/** Front card plus three behind it. */
export const DEFAULT_STACK_DEPTH = 4;

export interface StackWindowInput {
  /** How many cards exist in the conversation. */
  total: number;
  /** Index of the card currently at the front. */
  frontIndex: number;
  /** How many cards the stack renders, front included. */
  depth: number;
}

export interface StackSlot {
  /** Index into the card list. */
  index: number;
  /** 0 is the front card; larger is further back. */
  depth: number;
}

/**
 * The cards to render, ordered BACK TO FRONT.
 *
 * Back-to-front is not cosmetic: the slots are appended in this order so that
 * a later sibling paints over an earlier one, which is what puts the front card
 * on top without assigning a z-index per card. It is also what lets each card
 * hide the clipped edge of the one behind it.
 */
export function stackWindow(input: StackWindowInput): StackSlot[] {
  const { total, frontIndex, depth } = input;
  if (total <= 0 || depth <= 0) return [];
  const front = Math.max(0, Math.min(frontIndex, total - 1));
  const slots: StackSlot[] = [];
  // Deepest first. `d` counts backwards from the front, and the loop stops at
  // the start of the list rather than emitting negative indices.
  for (let d = Math.min(depth - 1, front); d >= 0; d--) {
    slots.push({ index: front - d, depth: d });
  }
  return slots;
}

export interface StepFrontInput {
  total: number;
  frontIndex: number;
  /** Negative walks back into history, positive returns toward the present. */
  delta: number;
}

/**
 * Moves the front pointer, clamped to the conversation.
 *
 * Clamping rather than wrapping is deliberate: a stack that wraps from the
 * oldest card round to the newest reads as a bug, and it loses the player's
 * sense of where they are in the conversation.
 */
export function stepFrontIndex(input: StepFrontInput): number {
  const { total, frontIndex, delta } = input;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(frontIndex + delta, total - 1));
}
