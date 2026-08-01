/**
 * packages/plugins/src/catalog/sugarlang/tests/grading/ambient-spans.test.ts
 *
 * Purpose: Pins that target language the slate never asked for is FOUND.
 *
 * WHY THIS FILE EXISTS
 *   `dialogueHighlight` has only ever been built from `constraint.targetVocab`,
 *   so a line could be half Spanish and the system knew about two words of it.
 *   The player could see a word plainly and had no way to ask what it meant.
 *   These assertions are what "we know where all the Spanish is" means.
 *
 * Implements: Plan 090 story 090.12
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { findAmbientSpans } from "../../runtime/grading/ambient-spans";
import { MorphologyLoader } from "../../runtime/classifier/morphology-loader";
import type { LexicalAtlasProvider } from "../../runtime/types";

/**
 * Minimal atlas: only these lemmas are "Spanish". Everything else must fall out
 * of the detector, which is the property under test.
 */
function createAtlas(): LexicalAtlasProvider {
  const known = new Set(["queso", "tienda", "hablar", "hola", "gato"]);
  return {
    getLemma: (lemmaId, lang) =>
      lang === "es" && known.has(lemmaId)
        ? { lemmaId, lang, cefrPriorBand: "A1", frequencyRank: 1, partsOfSpeech: ["noun"] }
        : undefined,
    getBand: () => "A1",
    getFrequencyRank: () => 1,
    getGloss: () => undefined,
    resolveFromGloss: () => [],
    listLemmasAtBand: () => [],
    getAtlasVersion: () => "test"
  };
}

function find(text: string, slateTerms: string[] = [], properNouns: string[] = []) {
  return findAmbientSpans({
    text,
    targetLanguage: "es",
    atlas: createAtlas(),
    morphology: new MorphologyLoader(),
    slateTerms,
    properNouns
  });
}

describe("ambient spans", () => {
  it("finds target language the slate never asked for", () => {
    // The whole point. `tienda` is Spanish, nobody chose to teach it, and
    // before this it was indistinguishable from the English around it.
    const spans = find("I sell queso at my tienda.", ["queso"]);

    expect(spans.map((s) => s.lemmaId)).toEqual(["tienda"]);
  });

  it("excludes what the slate already accounts for", () => {
    // focus and recall are not ambient -- ambient is the RESIDUE. If the slate
    // word showed up here it would be marked twice and styled twice.
    expect(find("Do you like queso?", ["queso"])).toEqual([]);
  });

  it("matches the slate through inflection", () => {
    // The highlight carries citation forms; the text carries whatever the
    // generator wrote. A slate of `hablar` must still explain `hablas`, or every
    // conjugated teaching word reappears as ambient.
    expect(find("Tu hablas bien.", ["hablar"])).toEqual([]);
  });

  it("leaves support-language words alone", () => {
    // The atlas membership test is what makes a token target-language. Without
    // it, any word the morphology folded would count and the whole line would be
    // ambient.
    expect(find("I sell cheese at my shop.")).toEqual([]);
  });

  it("never offers a translation for a proper noun", () => {
    // A name is not a word the player failed to learn. `Finnick` must not be
    // selectable for lookup even if something in the chain would resolve it.
    expect(find("Finnick sells queso.", [], ["Finnick"]).map((s) => s.surface))
      .not.toContain("Finnick");
  });

  it("carries offsets that address the original text", () => {
    // Selection resolution is done by character range. Offsets that do not index
    // the rendered string cannot be mapped back from a DOM selection.
    const text = "I sell queso at my tienda.";
    const [span] = find(text, ["queso"]);

    expect(span).toBeDefined();
    expect(text.slice(span!.start, span!.end)).toBe("tienda");
  });

  it("returns empty rather than throwing on empty text", () => {
    // This feeds a presentation affordance. A line with no ambient spans and a
    // line where detection could not run must both leave the turn intact.
    expect(find("")).toEqual([]);
  });
});
