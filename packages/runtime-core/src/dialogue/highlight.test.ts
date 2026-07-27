/**
 * packages/runtime-core/src/dialogue/highlight.test.ts
 *
 * Purpose: Unit tests for readTeachLine and findTermMatches.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Tests ./highlight.ts
 *
 * Implements: Plan 085 story 085.5 (readTeachLine), pre-existing (findTermMatches)
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { findTermMatches, readTeachLine } from "./highlight";

describe("readTeachLine", () => {
  it("returns null when annotations is undefined", () => {
    expect(readTeachLine(undefined)).toBeNull();
  });

  it("returns null when the teach-line key is absent", () => {
    expect(readTeachLine({})).toBeNull();
  });

  it("returns null when the value is not an object", () => {
    expect(readTeachLine({ "sugarlang.teachLine": "not an object" })).toBeNull();
  });

  it("returns null when label is missing", () => {
    expect(readTeachLine({ "sugarlang.teachLine": { text: '"Hola" is a greeting.' } })).toBeNull();
  });

  it("returns null when text is missing", () => {
    expect(readTeachLine({ "sugarlang.teachLine": { label: "Greeting" } })).toBeNull();
  });

  it("returns null when the value is null", () => {
    expect(readTeachLine({ "sugarlang.teachLine": null })).toBeNull();
  });

  it("returns the annotation when both label and text are present", () => {
    const result = readTeachLine({
      "sugarlang.teachLine": { label: "Greeting", text: '"Hola" is a greeting.' }
    });
    expect(result).toEqual({ label: "Greeting", text: '"Hola" is a greeting.' });
  });

  it("ignores unrelated annotation keys", () => {
    const result = readTeachLine({
      dialogueHighlight: { focusTerms: ["hola"] },
      "sugarlang.teachLine": { label: "Farewell", text: '"Adios" is a farewell.' }
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
});
