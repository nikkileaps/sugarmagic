import { describe, expect, it } from "vitest";

import { DEFAULT_STACK_DEPTH, stackWindow, stepFrontIndex } from "./card-stack";

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
