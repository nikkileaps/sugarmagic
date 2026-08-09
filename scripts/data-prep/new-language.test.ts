/**
 * scripts/data-prep/new-language.test.ts
 *
 * Purpose: Checks that a language the code has never seen can be built from
 *   its own rules alone -- so "could this take French when the time comes" has
 *   an answer that does not require writing any French.
 *
 * WHY A MADE-UP LANGUAGE
 *   A real third language would answer two questions at once and confuse them:
 *   whether the SYSTEM can take a language, and whether we got that language's
 *   grammar right. Only the first is in question. So this uses a synthetic
 *   language whose rules are deliberately unlike both shipped ones --
 *   contractions on a different marker, a different function-word set, its own
 *   derived forms -- and asserts the pipeline carries them through.
 *
 *   If this test needs a change to anything outside `languages/` to keep
 *   passing, a rule that belongs to one language is still living in shared
 *   code, and that is the finding.
 *
 * WHAT IT DOES NOT COVER
 *   The runtime half. Registering a language for PLAY still means adding it to
 *   a map in each of six loaders: the atlas provider, english-collisions, the
 *   morphology loader, the competency-inventory loader, always-target-words
 *   and the placement-questionnaire loader. Those are registration sites, not
 *   language rules -- this checks the build pipeline.
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
import type { LanguageRules } from "./languages/language-rules";
import { readJsonFile, sugarlangDataPath } from "./sugarlang-language-data";

/**
 * A language that is nothing like Spanish or Italian on purpose: it contracts
 * with a hyphen rather than an apostrophe, and calls a different set of words
 * functional.
 */
const madeUpRules: LanguageRules = {
  lang: "zz",
  functionWords: new Set(["zeh"]),
  expandWrittenForm(token) {
    const [stub, rest] = token.split("-");
    if (!stub || !rest) return null;
    return stub === "q" ? ["quo", rest] : null;
  },
  addMorphologyForms(forms, entry) {
    forms[entry.lemmaId] = { lemmaId: entry.lemmaId };
  },
  addDerivedForms(forms, entry) {
    forms[`${entry.lemmaId}-past`] = { lemmaId: entry.lemmaId };
  },
  buildPlacementQuestionnaire() {
    throw new Error("not needed for this check");
  }
};

const bands = () =>
  ["a1"].map((band) =>
    readJsonFile<CurriculumBandFile>(sugarlangDataPath("curriculum", `${band}.json`))
  );

/** Enough of an index for the phrases below, written by hand rather than built. */
const morphology: MorphologyFile = {
  lang: "zz",
  forms: {
    zeh: { lemmaId: "zeh" },
    quo: { lemmaId: "quo" },
    vim: { lemmaId: "vim" },
    tal: { lemmaId: "tal" }
  }
};

const exponents = (phrase: string): ExponentsFile =>
  ({
    schemaVersion: "1",
    lang: "zz",
    exponents: { greet: [{ wordings: [{ phrase, gloss: { en: "hello" } }] }] }
  }) as ExponentsFile;

describe("a language the registry has never heard of can still be built", () => {
  it("builds from its own rules, with no entry anywhere else", () => {
    const built = buildCompetencyInventory({
      bands: bands(),
      exponents: exponents("tal vim"),
      morphology,
      rules: madeUpRules
    });

    expect(built.lang).toBe("zz");
    expect(built.competencies).toHaveLength(1);
    expect(built.competencies[0]!.exponents.zz[0]!.constituentLemmas).toEqual([
      "tal",
      "vim"
    ]);
  });

  it("its contraction rule is used, not Italian's", () => {
    // `q-vim` is a contraction in this language and gibberish in both shipped
    // ones. If the pipeline had Italian's rule baked in, this would not
    // resolve.
    const built = buildCompetencyInventory({
      bands: bands(),
      exponents: exponents("q-vim"),
      morphology,
      rules: madeUpRules
    });

    expect(built.competencies[0]!.exponents.zz[0]!.constituentLemmas).toEqual([
      "quo",
      "vim"
    ]);
  });

  it("its function words are used, not Spanish's", () => {
    // `zeh` is functional HERE and unknown elsewhere; `la` is functional in
    // Spanish and must not be treated as such just because Spanish says so.
    const built = buildCompetencyInventory({
      bands: bands(),
      exponents: exponents("zeh vim"),
      morphology,
      rules: madeUpRules
    });

    expect(built.competencies[0]!.exponents.zz[0]!.constituentLemmas).toEqual(["vim"]);
  });

  it("a language with no contraction rule at all is fine", () => {
    // Spanish supplies none. Absent must mean "nothing to expand", never a
    // crash, or every simple language would need a stub.
    const noRules: LanguageRules = { ...madeUpRules, expandWrittenForm: undefined };
    const built = buildCompetencyInventory({
      bands: bands(),
      exponents: exponents("tal vim"),
      morphology,
      rules: noRules
    });
    expect(built.competencies[0]!.exponents.zz[0]!.surfaceForms).toContain("tal vim");
  });
});
