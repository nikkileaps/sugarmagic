/**
 * Colours cross between the number a light stores and the string a colour
 * control speaks. A round trip must not lose a digit, and a half-typed value
 * arriving mid-drag must not turn a light black.
 */

import { describe, expect, it } from "vitest";
import { hexColorNumber, hexColorString } from "@sugarmagic/workspaces";

describe("authored colours as numbers and as strings", () => {
  it("survives a round trip", () => {
    for (const color of [0x000000, 0xffd9a0, 0x3366ff, 0xffffff]) {
      expect(hexColorNumber(hexColorString(color), 0)).toBe(color);
    }
  });

  it("pads short values so a dark colour is not mistaken for a short one", () => {
    expect(hexColorString(0x0000ff)).toBe("#0000ff");
    expect(hexColorString(0x000001)).toBe("#000001");
  });

  it("keeps the colour it had when a value is still being typed", () => {
    // A colour control emits on every keystroke, so "#ff" arrives as a matter
    // of course. Falling back to black would look like a deliberate edit.
    for (const partial of ["", "#", "#ff", "#gggggg", "not a colour"]) {
      expect(hexColorNumber(partial, 0xffd9a0)).toBe(0xffd9a0);
    }
  });

  it("reads a value with or without its hash, and either case", () => {
    expect(hexColorNumber("ffd9a0", 0)).toBe(0xffd9a0);
    expect(hexColorNumber("#FFD9A0", 0)).toBe(0xffd9a0);
  });
});
