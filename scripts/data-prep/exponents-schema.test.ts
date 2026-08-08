/**
 * scripts/data-prep/exponents-schema.test.ts
 *
 * Purpose: Pins that a malformed exponents file is REPORTED rather than
 *   crashing the build, and that the two shipped files are well-formed.
 *
 * Before this, a missing gloss reached the build loop and came out as
 * `TypeError: Cannot convert undefined or null to object` pointing at
 * competency-inventory.ts -- which says nothing about which phrase is wrong.
 * That is not a thing to hand someone hand-writing a few thousand phrases.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  buildCompetencyInventory,
  type CurriculumBandFile,
  type ExponentsFile,
  type MorphologyFile
} from "./competency-inventory";
import { readJsonFile, sugarlangDataPath } from "./sugarlang-language-data";

const BANDS = ["a1", "a2", "b1", "b2", "c1"];

const bands = () =>
  BANDS.map((band) =>
    readJsonFile<CurriculumBandFile>(sugarlangDataPath("curriculum", `${band}.json`))
  );

const morphology = (lang: string) =>
  readJsonFile<MorphologyFile>(sugarlangDataPath("languages", lang, "morphology.json"));

/** A structurally valid one-phrase file, so each case below breaks exactly one thing. */
function exponentsWith(entry: unknown): ExponentsFile {
  return {
    schemaVersion: "1",
    lang: "es",
    exponents: { greet: [entry] }
  } as unknown as ExponentsFile;
}

function buildEs(exponents: ExponentsFile) {
  return buildCompetencyInventory({
    bands: bands(),
    exponents,
    morphology: morphology("es")
  });
}

describe("the shipped exponents files are well-formed", () => {
  for (const lang of ["es", "it"]) {
    it(`${lang} passes the schema`, () => {
      expect(() =>
        buildCompetencyInventory({
          bands: bands(),
          exponents: readJsonFile<ExponentsFile>(
            sugarlangDataPath("languages", lang, "exponents.json")
          ),
          morphology: morphology(lang)
        })
      ).not.toThrow();
    });
  }
});

describe("no phrase performs two competencies", () => {
  // The exponent id comes from the phrase, so the same phrase under two
  // competencies is ONE card with two claimed owners, and only one is
  // reported. Nothing in the build objects, and the Spanish suite checks this
  // for Spanish only -- Italian reached fifteen lessons with two of them
  // (`prego`, `è buono`) before anyone looked.
  //
  // `EXPONENT-AUTHORING.md` says to author the phrase under the competency it
  // most directly performs and raise the overlap. Italian did that: `prego`
  // stayed with thanks and showing someone in became `si accomodi`.
  for (const lang of ["es", "it"]) {
    it(`${lang}`, () => {
      const built = buildCompetencyInventory({
        bands: bands(),
        exponents: readJsonFile<ExponentsFile>(
          sugarlangDataPath("languages", lang, "exponents.json")
        ),
        morphology: morphology(lang)
      });

      const owner = new Map<string, string>();
      const clashes: string[] = [];
      for (const competency of built.competencies) {
        for (const exponent of competency.exponents[lang] ?? []) {
          const first = owner.get(exponent.exponentId);
          if (first) {
            clashes.push(`${exponent.exponentId}: ${first} + ${competency.competencyId}`);
          } else {
            owner.set(exponent.exponentId, competency.competencyId);
          }
        }
      }
      expect(clashes).toEqual([]);
    });
  }
});

describe("a malformed entry is named, not crashed on", () => {
  it("a wording with no gloss", () => {
    // Used to be: TypeError from Object.keys(undefined).
    expect(() => buildEs(exponentsWith({ wordings: [{ phrase: "hola" }] }))).toThrow(
      /wordings\/0.*gloss/s
    );
  });

  it("an entry with no wordings at all", () => {
    expect(() => buildEs(exponentsWith({}))).toThrow(/wordings/);
  });

  it("wordings given as a string instead of a list", () => {
    expect(() => buildEs(exponentsWith({ wordings: "hola" }))).toThrow(/must be array/);
  });

  it("a typo in a field name, rather than a missing one", () => {
    // The failure mode a schema catches that a hand-written check never does:
    // the value is present, spelled wrong, and silently ignored forever.
    expect(() =>
      buildEs(exponentsWith({ wordings: [{ phrase: "hola", gloss: { en: "hi" }, lemma: {} }] }))
    ).toThrow(/additional properties|lemma/);
  });

  it("names the path to the bad entry, so it can be found", () => {
    let message = "";
    try {
      buildEs(exponentsWith({ wordings: [{ phrase: "hola" }] }));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("Cannot read the es exponents");
    expect(message).toContain("/exponents/greet/0/wordings/0");
  });

  it("reports EVERY problem at once, not the first", () => {
    let message = "";
    try {
      buildEs(
        exponentsWith({
          wordings: [{ phrase: "hola" }, { phrase: "buenos días" }]
        })
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("/exponents/greet/0/wordings/0");
    expect(message).toContain("/exponents/greet/0/wordings/1");
  });
});

describe("the schema checks shape and leaves meaning to the build", () => {
  it("a phrase whose words do not resolve is still the build's failure to report", () => {
    // Structure is fine here, so the schema must stay out of the way and let
    // the existing failure list say the useful thing.
    expect(() =>
      buildEs(exponentsWith({ wordings: [{ phrase: "hola qwertyuiop", gloss: { en: "x" } }] }))
    ).toThrow(/does not resolve to a lemma/);
  });

  it("rejects trailing punctuation but allows a semicolon joining clauses", () => {
    // B2 phrases genuinely use semicolons mid-phrase; the authoring rule is
    // about the END of a phrase.
    expect(() =>
      buildEs(exponentsWith({ wordings: [{ phrase: "hola.", gloss: { en: "x" } }] }))
    ).toThrow(/phrase must match pattern/);
    expect(() =>
      buildEs(exponentsWith({ wordings: [{ phrase: "hola; adiós", gloss: { en: "x" } }] }))
    ).not.toThrow(/must match pattern/);
  });
});
