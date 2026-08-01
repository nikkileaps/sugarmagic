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

/** A line of wheel delta, for devices that report lines instead of pixels. */
const WHEEL_LINE_PX = 16;
/** A page of wheel delta. Coarse on purpose -- one page is a decisive gesture. */
const WHEEL_PAGE_PX = 400;

export interface WheelStepInput {
  /** Raw `WheelEvent.deltaY`. */
  deltaY: number;
  /** Raw `WheelEvent.deltaMode`: 0 pixels, 1 lines, 2 pages. */
  deltaMode: number;
  /** Delta carried over from previous events in the gesture. */
  accumulator: number;
  /** Delta required to move the stack by one card. */
  stepPx: number;
  /** Cap on how many cards a single event may move. */
  maxSteps: number;
}

export interface WheelStepResult {
  /** Cards to move. Positive is the same direction as a positive deltaY. */
  steps: number;
  /** Delta to carry into the next event. */
  accumulator: number;
}

/**
 * Turns a stream of wheel events into discrete card steps.
 *
 * WHY deltaMode IS NORMALISED
 *   A trackpad reports PIXELS, but a mouse wheel on some browsers reports
 *   LINES -- deltaY of 3 where a trackpad sends 3px. Comparing both against a
 *   pixel threshold makes the wheel roughly sixteen times less sensitive than
 *   the trackpad, which reads as the stack being broken rather than stiff.
 *
 * WHY A DIRECTION CHANGE RESETS
 *   The accumulator is signed, so a scroll up followed by a scroll down would
 *   otherwise cancel out and the stack would sit still through both. Reversing
 *   is a new gesture and starts from zero.
 */
export function accumulateWheelSteps(input: WheelStepInput): WheelStepResult {
  const { deltaY, deltaMode, accumulator, stepPx, maxSteps } = input;
  const scale =
    deltaMode === 1 ? WHEEL_LINE_PX : deltaMode === 2 ? WHEEL_PAGE_PX : 1;
  const delta = deltaY * scale;

  const reversed = delta !== 0 && accumulator !== 0 && Math.sign(delta) !== Math.sign(accumulator);
  let carried = (reversed ? 0 : accumulator) + delta;

  const raw = Math.trunc(carried / stepPx);
  const steps = Math.max(-maxSteps, Math.min(maxSteps, raw));
  carried -= steps * stepPx;
  return { steps, accumulator: carried };
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
