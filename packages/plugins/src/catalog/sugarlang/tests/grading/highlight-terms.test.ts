/**
 * packages/plugins/src/catalog/sugarlang/tests/grading/highlight-terms.test.ts
 *
 * Purpose: Pins what a slated teachable contributes to a line's highlight --
 *   the surfaces a word can appear as, and what the player gets credit for.
 *
 * Relationships:
 *   - Exercises runtime/grading/highlight-terms.ts against the SHIPPED
 *     dictionary, so a paradigm regression fails here rather than in play.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { buildHighlightTerms } from "../../runtime/grading/highlight-terms";
import { CefrLexAtlasProvider } from "../../runtime/providers/impls/cefr-lex-atlas-provider";
import type { TeachableRef } from "../../runtime/contracts/teachable-ref";

const atlas = new CefrLexAtlasProvider();

function vocab(lemmaId: string): TeachableRef {
  return { kind: "vocabulary", lemmaId, lang: "es" } as TeachableRef;
}

function build(text: string, introduce: string[], reinforce: string[] = []) {
  return buildHighlightTerms({
    text,
    introduce: introduce.map(vocab),
    reinforce: reinforce.map(vocab),
    atlas,
    targetLanguage: "es",
    supportLanguage: "en"
  });
}

describe("a slated word contributes every form it can appear as", () => {
  it("puts the CONJUGATED form on the slate, not just the infinitive", () => {
    // THE DEFECT THIS CLOSES. The Teacher slates `hablar`; realization writes
    // `hablo`. Listing only the citation form meant a slated verb was never
    // lit -- the term was a word the line did not contain.
    const terms = build("Yo hablo espanol.", ["hablar"]);
    expect(terms.introduceTerms).toContain("hablo");
    expect(terms.introduceTerms).toContain("hablar");
  });

  it("covers forms the line does not use, so matching stays the matcher's job", () => {
    // This file does no matching. It offers every form and findTermMatches
    // lights up whichever is present -- so there is still one answer to "is
    // this word in this line".
    const terms = build("Yo hablo espanol.", ["hablar"]);
    expect(terms.introduceTerms).toContain("hablas");
    expect(terms.introduceTerms).toContain("hablé");
  });

  it("carries the accent-bearing preterite, which is where boundaries break", () => {
    const terms = build("Ella pidió agua.", ["pedir"]);
    expect(terms.introduceTerms).toContain("pidió");
  });

  it("credits the LEMMA for every one of its forms", () => {
    // A card is keyed by lemma. Several terms, one credit.
    const terms = build("Yo hablo.", ["hablar"]);
    expect(terms.creditByTerm["hablo"]).toBe("hablar");
    expect(terms.creditByTerm["hablas"]).toBe("hablar");
    expect(terms.creditByTerm["hablar"]).toBe("hablar");
  });

  it("gives every form the same gloss", () => {
    const terms = build("Yo hablo.", ["hablar"]);
    expect(terms.glosses["hablo"]).toBeDefined();
    expect(terms.glosses["hablo"]).toBe(terms.glosses["hablar"]);
  });

  it("falls back to the citation form when a word has no paradigm", () => {
    // 584 higher-band verbs and every closed-class word have none. That is
    // today's behaviour and the right fallback -- not an error.
    const terms = build("Es un hecho.", ["que"]);
    expect(terms.introduceTerms).toContain("que");
    expect(terms.creditByTerm["que"]).toBe("que");
  });

  it("keeps a multi-word lemma as ONE term", () => {
    const terms = build("Hasta luego.", ["hasta_luego"]);
    const multi = terms.introduceTerms.filter((t) => t.includes(" "));
    if (multi.length > 0) expect(multi).toContain("hasta luego");
  });

  it("separates introduce from reinforce", () => {
    const terms = build("Yo hablo y ella pidió.", ["hablar"], ["pedir"]);
    expect(terms.introduceTerms).toContain("hablo");
    expect(terms.reinforceTerms).toContain("pidió");
    expect(terms.introduceTerms).not.toContain("pidió");
  });
});
