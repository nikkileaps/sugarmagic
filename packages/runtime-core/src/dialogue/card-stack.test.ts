import { describe, expect, it } from "vitest";

import {
  DEFAULT_STACK_DEPTH,
  accumulateWheelSteps,
  stackWindow,
  stepFrontIndex
} from "./card-stack";

describe("accumulateWheelSteps", () => {
  const base = { accumulator: 0, stepPx: 20, maxSteps: 4 };

  it("carries small deltas until they add up to a card", () => {
    let acc = 0;
    const seen: number[] = [];
    // A trackpad flick: many small pixel deltas.
    for (let i = 0; i < 5; i++) {
      const out = accumulateWheelSteps({ ...base, deltaY: 6, deltaMode: 0, accumulator: acc });
      acc = out.accumulator;
      seen.push(out.steps);
    }
    // 30px in => one card; the rest carries.
    expect(seen.reduce((a, b) => a + b, 0)).toBe(1);
    expect(acc).toBeGreaterThanOrEqual(0);
    expect(acc).toBeLessThan(base.stepPx);
  });

  it("treats a line-mode wheel as comparable to a pixel-mode trackpad", () => {
    // deltaY of 3 LINES is a normal wheel notch; unnormalised it is 3px and
    // would take seven notches to move one card.
    const lines = accumulateWheelSteps({ ...base, deltaY: 3, deltaMode: 1 });
    expect(lines.steps).toBe(2);

    const pixels = accumulateWheelSteps({ ...base, deltaY: 3, deltaMode: 0 });
    expect(pixels.steps).toBe(0);
  });

  it("resets on a direction change instead of cancelling out", () => {
    const down = accumulateWheelSteps({ ...base, deltaY: 15, deltaMode: 0 });
    expect(down.steps).toBe(0);
    expect(down.accumulator).toBe(15);

    // Reversing must not subtract from the carried delta.
    const up = accumulateWheelSteps({
      ...base,
      deltaY: -15,
      deltaMode: 0,
      accumulator: down.accumulator
    });
    expect(up.accumulator).toBe(-15);
  });

  it("caps a hard flick instead of teleporting through the conversation", () => {
    const out = accumulateWheelSteps({ ...base, deltaY: 4000, deltaMode: 0 });
    expect(out.steps).toBe(4);
  });

  it("steps negative for a negative delta", () => {
    expect(accumulateWheelSteps({ ...base, deltaY: -40, deltaMode: 0 }).steps).toBe(-2);
  });
});

describe("stackWindow", () => {
  it("renders the front card plus three behind it, back to front", () => {
    const slots = stackWindow({ total: 10, frontIndex: 9, depth: DEFAULT_STACK_DEPTH });

    expect(slots).toEqual([
      { index: 6, depth: 3 },
      { index: 7, depth: 2 },
      { index: 8, depth: 1 },
      { index: 9, depth: 0 }
    ]);
  });

  it("orders slots back to front, so a later sibling paints over an earlier one", () => {
    const slots = stackWindow({ total: 10, frontIndex: 9, depth: 4 });
    const depths = slots.map((slot) => slot.depth);

    expect(depths).toEqual([...depths].sort((a, b) => b - a));
    expect(slots[slots.length - 1]!.depth).toBe(0);
  });

  it("never emits an index before the start of the conversation", () => {
    const slots = stackWindow({ total: 10, frontIndex: 1, depth: 4 });

    expect(slots).toEqual([
      { index: 0, depth: 1 },
      { index: 1, depth: 0 }
    ]);
    expect(slots.every((slot) => slot.index >= 0)).toBe(true);
  });

  it("shows a single card when the conversation has just begun", () => {
    expect(stackWindow({ total: 1, frontIndex: 0, depth: 4 })).toEqual([
      { index: 0, depth: 0 }
    ]);
  });

  it("windows the middle of a long conversation without materialising it", () => {
    const slots = stackWindow({ total: 200, frontIndex: 100, depth: 4 });

    expect(slots).toHaveLength(4);
    expect(slots.map((slot) => slot.index)).toEqual([97, 98, 99, 100]);
  });

  it("clamps a front index past the end back onto the last card", () => {
    const slots = stackWindow({ total: 3, frontIndex: 99, depth: 4 });

    expect(slots[slots.length - 1]).toEqual({ index: 2, depth: 0 });
  });

  it("renders nothing for an empty conversation", () => {
    expect(stackWindow({ total: 0, frontIndex: 0, depth: 4 })).toEqual([]);
  });
});

describe("stepFrontIndex", () => {
  it("walks back into history and forward toward the present", () => {
    expect(stepFrontIndex({ total: 10, frontIndex: 9, delta: -1 })).toBe(8);
    expect(stepFrontIndex({ total: 10, frontIndex: 8, delta: 1 })).toBe(9);
  });

  it("stops at the oldest card rather than wrapping round to the newest", () => {
    expect(stepFrontIndex({ total: 10, frontIndex: 0, delta: -1 })).toBe(0);
    expect(stepFrontIndex({ total: 10, frontIndex: 2, delta: -50 })).toBe(0);
  });

  it("stops at the present rather than running past it", () => {
    expect(stepFrontIndex({ total: 10, frontIndex: 9, delta: 1 })).toBe(9);
    expect(stepFrontIndex({ total: 10, frontIndex: 5, delta: 50 })).toBe(9);
  });

  it("absorbs a fast flick as a multi-card step", () => {
    expect(stepFrontIndex({ total: 20, frontIndex: 19, delta: -5 })).toBe(14);
  });
});
