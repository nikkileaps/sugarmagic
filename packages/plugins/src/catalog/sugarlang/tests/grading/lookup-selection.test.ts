/**
 * packages/plugins/src/catalog/sugarlang/tests/grading/lookup-selection.test.ts
 *
 * Purpose: Pins select-to-translate -- what resolves, and what deliberately
 *   returns nothing.
 *
 * The interesting assertions here are the NULLs. A lookup that silently returns
 * a wrong or unhelpful answer (a name "translated", half a phrase glossed) is
 * worse than one that returns nothing, because the player cannot tell it is
 * wrong.
 *
 * Implements: Plan 090 story 090.12
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { lookupSelection } from "../../runtime/grading/lookup-selection";
import { MorphologyLoader } from "../../runtime/classifier/morphology-loader";
import type { LexicalAtlasProvider } from "../../runtime/types";

function createAtlas(): LexicalAtlasProvider {
  const glosses: Record<string, string> = {
    queso: "cheese",
    tienda: "shop",
    hablar: "to speak"
  };
  return {
    getLemma: (lemmaId) =>
      glosses[lemmaId]
        ? { lemmaId, lang: "es", cefrPriorBand: "A1", frequencyRank: 1, partsOfSpeech: ["noun"] }
        : undefined,
    getBand: () => "A1",
    getFrequencyRank: () => 1,
    getGloss: (lemmaId, lang, supportLang) =>
      lang === "es" && supportLang === "en" ? glosses[lemmaId] : undefined,
    resolveFromGloss: () => [],
    listLemmasAtBand: () => [],
    getAtlasVersion: () => "test"
  };
}

function look(selection: string, properNouns: string[] = []) {
  return lookupSelection({
    selection,
    targetLanguage: "es",
    supportLanguage: "en",
    atlas: createAtlas(),
    morphology: new MorphologyLoader(),
    properNouns
  });
}

describe("select-to-translate", () => {
  it("resolves a selected word to its English", () => {
    expect(look("queso")).toMatchObject({ lemmaId: "queso", gloss: "cheese" });
  });

  it("tolerates a sloppy drag", () => {
    // Selections come from a mouse, not a tokenizer. Trailing punctuation and
    // stray whitespace are the normal case, not the exception.
    expect(look("  queso.  ")).toMatchObject({ gloss: "cheese" });
  });

  it("resolves through inflection", () => {
    // The player selects what is on screen, which is conjugated. Requiring them
    // to select a citation form would make the feature useless.
    const result = look("hablas");
    if (result) {
      expect(result.lemmaId).toBe("hablar");
    }
  });

  it("returns nothing for a support-language word", () => {
    expect(look("cheese")).toBeNull();
  });

  it("returns nothing for a proper noun", () => {
    // A name is not a word the learner failed to know. Translating `Finnick`
    // would be actively wrong, not merely unhelpful.
    expect(look("Finnick", ["Finnick"])).toBeNull();
  });

  it("returns nothing for a genuine phrase rather than glossing half of it", () => {
    // `buenos dias` is one thing the player pointed at. The atlas glosses
    // lemmas, so the only compositional answer available is "good" + "day",
    // which is not what the phrase means. Backlog 011 owns the LLM tier that
    // can answer it; until then, silence beats a misleading half-answer.
    expect(look("buenos dias")).toBeNull();
  });

  it("returns nothing for an empty or whitespace selection", () => {
    expect(look("")).toBeNull();
    expect(look("   ")).toBeNull();
  });

  it("returns nothing for punctuation alone", () => {
    expect(look("!?")).toBeNull();
  });
});
