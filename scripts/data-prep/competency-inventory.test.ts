/**
 * scripts/data-prep/competency-inventory.test.ts
 *
 * Purpose: Pins the competency inventory as a GENERATED file -- the checked-in
 *   JSON must be exactly what the build produces from the authored sources.
 *
 * Relationships:
 *   - Exercises ./competency-inventory against the real curriculum, the real
 *     Spanish exponents, and the real morphology index.
 *
 * Status: active
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildCompetencyInventory,
  type CurriculumBandFile,
  type ExponentsFile,
  type MorphologyFile
} from "./competency-inventory";
import { readJsonFile, sugarlangDataPath } from "./sugarlang-language-data";

const BANDS = ["a1", "a2", "b1", "b2", "c1"];

function realInputs() {
  return {
    bands: BANDS.map((band) =>
      readJsonFile<CurriculumBandFile>(
        sugarlangDataPath("curriculum", `${band}.json`)
      )
    ),
    exponents: readJsonFile<ExponentsFile>(
      sugarlangDataPath("languages", "es", "exponents.json")
    ),
    morphology: readJsonFile<MorphologyFile>(
      sugarlangDataPath("languages", "es", "morphology.json")
    )
  };
}

describe("the shipped competency inventory is generated, not authored", () => {
  it("THE ONE THAT MATTERS: the checked-in file is byte-identical to a fresh build", () => {
    // A hand-edit to the generated file fails here rather than surviving until
    // the next regeneration silently discards it.
    const built = `${JSON.stringify(
      buildCompetencyInventory(realInputs()),
      null,
      2
    )}\n`;
    const shipped = readFileSync(
      sugarlangDataPath("languages", "es", "competency-inventory.json"),
      "utf8"
    );
    expect(built).toBe(shipped);
  });

  it("building twice from unchanged sources produces the same file", () => {
    const a = JSON.stringify(buildCompetencyInventory(realInputs()));
    const b = JSON.stringify(buildCompetencyInventory(realInputs()));
    expect(a).toBe(b);
  });
});

describe("a phrase that cannot be resolved fails the build", () => {
  it("names the competency, the phrase, and the word", () => {
    // nikki is the user of a build pass, so it fails loudly here rather than
    // degrading in front of a player.
    const inputs = realInputs();
    expect(() =>
      buildCompetencyInventory({
        ...inputs,
        exponents: {
          ...inputs.exponents,
          exponents: {
            greet: [{ wordings: ["hola qwertyuiop"] }]
          }
        }
      })
    ).toThrow(/greet \/ "hola qwertyuiop": "qwertyuiop" does not resolve/);
  });

  it("rejects an exponent named for a competency the curriculum does not have", () => {
    const inputs = realInputs();
    expect(() =>
      buildCompetencyInventory({
        ...inputs,
        exponents: {
          ...inputs.exponents,
          exponents: { "not-a-competency": [{ wordings: ["hola"] }] }
        }
      })
    ).toThrow(/not-a-competency: named in es exponents but absent/);
  });

  it("a lemma override rescues a homograph the index resolves the other way", () => {
    // `cuesta` is a real noun ("slope"), so the index gives the noun and not
    // costar's third person. Without the override the phrase would teach the
    // wrong word, silently.
    const inputs = realInputs();
    const withoutOverride = buildCompetencyInventory({
      ...inputs,
      exponents: {
        ...inputs.exponents,
        exponents: { "ask-price": [{ wordings: ["cuánto cuesta"] }] }
      }
    });
    expect(
      withoutOverride.competencies[0]!.exponents.es[0]!.constituentLemmas
    ).toContain("cuesta");

    const withOverride = buildCompetencyInventory({
      ...inputs,
      exponents: {
        ...inputs.exponents,
        exponents: {
          "ask-price": [
            { wordings: ["cuánto cuesta"], lemmas: { cuesta: "costar" } }
          ]
        }
      }
    });
    expect(
      withOverride.competencies[0]!.exponents.es[0]!.constituentLemmas
    ).toContain("costar");
  });
});
