/**
 * packages/runtime-core/src/dialogue/highlight.test.ts
 *
 * Purpose: Unit tests for readDialogueTeachLine and findTermMatches.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Tests ./highlight.ts
 *
 * Implements: Plan 085 story 085.5 (readDialogueTeachLine), pre-existing (findTermMatches)
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  findTermMatches,
  readDialogueTeachLine,
  writeDialogueTeachLine
} from "./highlight";

describe("teach line write/read contract", () => {
  it("round-trips: what the writer produces is what the reader finds", () => {
    // BINDS THE TWO HALVES. Before this, the key was a private const on the
    // reading side and a hand-typed literal on the writing side, in another
    // package -- so either could drift and both suites would still pass while
    // the teach line silently stopped rendering.
    const annotations: Record<string, unknown> = {};
    writeDialogueTeachLine(annotations, {
      label: "Greeting",
      text: '"Hola" is a greeting.'
    });

    expect(readDialogueTeachLine(annotations)).toEqual({
      label: "Greeting",
      text: '"Hola" is a greeting.'
    });
  });
});

describe("readDialogueTeachLine", () => {
  it("returns null when annotations is undefined", () => {
    expect(readDialogueTeachLine(undefined)).toBeNull();
  });

  it("returns null when the teach-line key is absent", () => {
    expect(readDialogueTeachLine({})).toBeNull();
  });

  it("returns null when the value is not an object", () => {
    expect(readDialogueTeachLine({ "dialogueTeachLine": "not an object" })).toBeNull();
  });

  it("returns null when label is missing", () => {
    expect(readDialogueTeachLine({ "dialogueTeachLine": { text: '"Hola" is a greeting.' } })).toBeNull();
  });

  it("returns null when text is missing", () => {
    expect(readDialogueTeachLine({ "dialogueTeachLine": { label: "Greeting" } })).toBeNull();
  });

  it("returns null when the value is null", () => {
    expect(readDialogueTeachLine({ "dialogueTeachLine": null })).toBeNull();
  });

  it("returns the annotation when both label and text are present", () => {
    const result = readDialogueTeachLine({
      "dialogueTeachLine": { label: "Greeting", text: '"Hola" is a greeting.' }
    });
    expect(result).toEqual({ label: "Greeting", text: '"Hola" is a greeting.' });
  });

  it("ignores unrelated annotation keys", () => {
    const result = readDialogueTeachLine({
      dialogueHighlight: { focusTerms: ["hola"] },
      "dialogueTeachLine": { label: "Farewell", text: '"Adios" is a farewell.' }
    });
    expect(result).toEqual({ label: "Farewell", text: '"Adios" is a farewell.' });
  });
});

describe("findTermMatches", () => {
  it("returns empty array when no terms match", () => {
    expect(findTermMatches("Hello world", ["xyz"], [], [])).toEqual([]);
  });

  it("matches a term case-insensitively", () => {
    const matches = findTermMatches("Buenos dias.", ["buenos"], [], []);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.start).toBe(0);
    expect(matches[0]!.term).toBe("Buenos");
  });

  it("marks celebrate=true for celebrate terms", () => {
    const matches = findTermMatches("Hola!", ["hola"], ["hola"], []);
    expect(matches[0]!.celebrate).toBe(true);
  });

  it("marks introduce=true for introduce terms", () => {
    const matches = findTermMatches("Gracias!", ["gracias"], [], ["gracias"]);
    expect(matches[0]!.introduce).toBe(true);
  });

  it("returns matches sorted by start position", () => {
    const matches = findTermMatches("Hola y adios.", ["adios", "hola"], [], []);
    expect(matches[0]!.start).toBeLessThan(matches[1]!.start);
  });

  it("does not match terms shorter than MIN_TERM_LENGTH (3)", () => {
    expect(findTermMatches("un dia", ["un"], [], [])).toHaveLength(0);
  });

  // 090.11 item 4: SPANS, NOT WORDS.
  //
  // A competency is an ACT and its exponent is a PHRASE. `buenos dias` has to
  // be ONE span with one hover -- two lit words read as two unrelated items and
  // offer two tooltips for one idea.
  //
  // The mechanism is already here (sort by length descending + the occupancy
  // map); what was missing upstream was any phrase ever reaching focusTerms,
  // because the observe middleware dropped every competency on the slate. These
  // pin the behaviour so a future change to the sort or the occupancy map
  // cannot silently split a phrase back into words.
  it("matches a multi-word exponent as ONE span", () => {
    const matches = findTermMatches("Buenos dias, viajero.", ["buenos dias"], [], []);

    expect(matches).toHaveLength(1);
    expect(matches[0]!.term.toLowerCase()).toBe("buenos dias");
  });

  it("gives the phrase its characters before a word inside it can claim them", () => {
    // Both the phrase and one of its own words are on the slate, which is the
    // realistic case: `dias` can be taught as vocabulary while `buenos dias` is
    // taught as a greeting. The phrase must win, and the inner word must not
    // produce a second overlapping span.
    const matches = findTermMatches("Buenos dias, viajero.", ["dias", "buenos dias"], [], []);

    expect(matches).toHaveLength(1);
    expect(matches[0]!.term.toLowerCase()).toBe("buenos dias");
  });

  it("still lights an inner word where it occurs OUTSIDE the phrase", () => {
    // Occupancy is per-character, not per-term, so the phrase claiming its own
    // characters must not suppress the same word elsewhere in the line.
    const matches = findTermMatches(
      "Buenos dias. Que tengas dias felices.",
      ["dias", "buenos dias"],
      [],
      []
    );

    expect(matches).toHaveLength(2);
    expect(matches[0]!.term.toLowerCase()).toBe("buenos dias");
    expect(matches[1]!.term.toLowerCase()).toBe("dias");
  });

  it("carries introduce and celebrate through a phrase unchanged", () => {
    // The gold/blue split and the celebrate animation are keyed off these two
    // booleans. Phrases ride the SAME fields as words -- nothing about them is
    // special-cased downstream, which is what keeps the styling untouched.
    const matches = findTermMatches(
      "Buenos dias!",
      ["buenos dias"],
      ["buenos dias"],
      ["buenos dias"]
    );

    expect(matches[0]!.introduce).toBe(true);
    expect(matches[0]!.celebrate).toBe(true);
  });
});
