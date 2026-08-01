import { describe, expect, it, vi } from "vitest";

import { splitTextIntoChunks } from "./chunk-text";

/**
 * A stand-in for real layout: every `perLine` characters is one line box.
 * Crude on purpose -- these tests are about the SPLITTING, and the real
 * measurement is DOM work that belongs to the panel.
 */
function fakeMeasure(perLine: number) {
  return (text: string) => Math.max(1, Math.ceil(text.length / perLine));
}

describe("splitTextIntoChunks", () => {
  it("returns short text untouched, without probing layout", () => {
    const measureLines = vi.fn(fakeMeasure(20));
    const text = "Short enough.";

    expect(splitTextIntoChunks(text, { maxLines: 3, measureLines })).toEqual([text]);
    // One probe to establish it fits, and no splitting work after that.
    expect(measureLines).toHaveBeenCalledTimes(1);
  });

  it("splits long text so every chunk is within the line budget", () => {
    const perLine = 20;
    const maxLines = 3;
    const text =
      "Oh okay okay okay yes but wait when you say queso do you mean the melty " +
      "dip kind the good stuff with peppers and heat or are you talking cheese " +
      "in general because queso just means cheese right";

    const chunks = splitTextIntoChunks(text, {
      maxLines,
      measureLines: fakeMeasure(perLine)
    });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(fakeMeasure(perLine)(chunk)).toBeLessThanOrEqual(maxLines);
    }
  });

  it("preserves every word, in order, across the chunks", () => {
    const text =
      "Head for the estacion and ask for Racky he knows everyone in this town " +
      "and he will point you at the docks before the tide turns again";

    const chunks = splitTextIntoChunks(text, {
      maxLines: 2,
      measureLines: fakeMeasure(18)
    });

    expect(chunks.join(" ").split(/\s+/)).toEqual(text.split(/\s+/));
  });

  it("never cuts through an unbreakable range", () => {
    // "queso fresco" is one highlighted term; a split inside it would tear the
    // gold marking and the celebrate burst in half.
    const text =
      "I would really love to talk about queso fresco because it is the best " +
      "cheese anyone has ever put on a plate in this whole entire town";
    const start = text.indexOf("queso fresco");
    const term = { start, end: start + "queso fresco".length };

    const chunks = splitTextIntoChunks(text, {
      maxLines: 1,
      measureLines: fakeMeasure(24),
      unbreakable: [term]
    });

    // Whichever chunk contains the term must contain ALL of it.
    const touching = chunks.filter(
      (chunk) => chunk.includes("queso") || chunk.includes("fresco")
    );
    expect(touching).toHaveLength(1);
    expect(touching[0]).toContain("queso fresco");
  });

  it("always makes progress when a single word exceeds the budget", () => {
    const text = `tiny ${"x".repeat(500)} tiny`;

    const chunks = splitTextIntoChunks(text, {
      maxLines: 1,
      measureLines: fakeMeasure(10)
    });

    // The oversized word gets its own chunk and overflows one card, rather than
    // the splitter failing to advance.
    expect(chunks.some((chunk) => chunk.includes("x".repeat(500)))).toBe(true);
    expect(chunks.join(" ").split(/\s+/)).toEqual(text.split(/\s+/));
  });

  it("rejects a nonsensical line budget rather than looping", () => {
    expect(() =>
      splitTextIntoChunks("anything at all", { maxLines: 0, measureLines: fakeMeasure(5) })
    ).toThrow(/maxLines/);
  });
});
