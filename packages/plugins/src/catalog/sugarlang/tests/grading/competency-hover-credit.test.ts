/**
 * packages/plugins/src/catalog/sugarlang/tests/grading/competency-hover-credit.test.ts
 *
 * Purpose: Pins that hovering a competency exponent credits that competency,
 *   wherever it sits in the line and whatever casing the line gave it.
 *
 * The competency branch of buildHighlightTerms had no tests at all, which is
 * how it shipped crediting the wrong card for the commonest case in the
 * language: a greeting at the start of a sentence.
 *
 * Relationships:
 *   - Exercises runtime/grading/highlight-terms.ts and the hover resolution in
 *     runtime/dialogue-entry-decorator.ts against the SHIPPED inventory.
 *
 * Status: active
 */

import { describe, expect, it, beforeEach } from "vitest";
import {
  buildHighlightTerms,
  focusTermsOf,
  termKey
} from "../../runtime/grading/highlight-terms";
import { CefrLexAtlasProvider } from "../../runtime/providers/impls/cefr-lex-atlas-provider";
import { createChunkMatcher } from "../../runtime/classifier/chunk-matcher";
import { getAllInventoryExponents } from "../../runtime/inventory/competency-inventory-loader";
import { tokenize } from "../../runtime/classifier/tokenize";
import {
  createSugarlangDialogueContribution,
  drainPendingHover
} from "../../runtime/dialogue-entry-decorator";
import type { ConversationTurnEnvelope } from "@sugarmagic/runtime-core";
import type { TeachableRef } from "../../runtime/contracts/teachable-ref";

const atlas = new CefrLexAtlasProvider();
const matcher = createChunkMatcher(getAllInventoryExponents("es"), "es");

function highlightFor(text: string) {
  return buildHighlightTerms({
    text,
    introduce: [
      { kind: "competency", competencyId: "greet", lang: "es" } as TeachableRef
    ],
    reinforce: [],
    atlas,
    targetLanguage: "es",
    supportLanguage: "en",
    chunkMatcher: matcher
  } as never);
}

/** What the player's hover actually resolves to, end to end. */
function creditForHoverIn(text: string, hovered: string): string | null {
  const contribution = createSugarlangDialogueContribution();
  const terms = highlightFor(text);
  contribution.decorate({
    speakerId: "npc-1",
    text,
    annotations: {
      dialogueHighlight: {
        focusTerms: focusTermsOf(terms),
        introduceTerms: terms.introduceTerms,
        celebrateTerms: [],
        glosses: terms.glosses,
        creditByTerm: terms.creditByTerm
      }
    }
  } as unknown as ConversationTurnEnvelope);
  // The UI lowercases before notifying; mirror that exactly.
  contribution.onTermHover({ term: hovered.toLowerCase(), lang: "es", dwellMs: 800 });
  return drainPendingHover()?.lemmaId ?? null;
}

describe("hovering a competency credits the competency", () => {
  beforeEach(() => {
    drainPendingHover();
  });

  it("THE CASE THIS EXISTS FOR: a single-word greeting starting a sentence", () => {
    // `Hola` capitalised was keyed as `Hola` and looked up as `hola`, missing.
    // The fallback is the raw term -- and `hola` IS an atlas lemma, so the
    // guard downstream accepted it and graded the WORD. It looked like it
    // worked. Greetings are almost always sentence-initial, so the broken case
    // was the normal one.
    expect(creditForHoverIn("Hola, senor.", "Hola")).toBe("exponent:hola");
  });

  it("a multi-word greeting starting a sentence", () => {
    // This one failed differently: `Buenos dias` is not an atlas lemma, so the
    // guard rejected it and the hover was dropped entirely. Nothing recorded.
    expect(creditForHoverIn("Buenos dias, viajero.", "Buenos dias")).toBe(
      "exponent:buenos_dias"
    );
  });

  it("still works mid-sentence, which is the case that always worked", () => {
    expect(creditForHoverIn("Pues hola.", "hola")).toBe("exponent:hola");
  });

  it("never credits a word that merely looks like the exponent", () => {
    // The specific harm: crediting the vocabulary card `hola` records that the
    // learner engaged with a NOUN, and the greeting they actually engaged with
    // stays at zero forever.
    const credit = creditForHoverIn("Hola, senor.", "Hola");
    expect(credit).not.toBe("hola");
    expect(credit?.startsWith("exponent:")).toBe(true);
  });
});

describe("the keys both sides use agree", () => {
  it("credit and gloss are keyed by the same normalization", () => {
    const highlight = highlightFor("Hola, senor.");
    const key = termKey("Hola");
    expect(highlight.creditByTerm[key]).toBe("exponent:hola");
    expect(highlight.glosses[key]).toBeDefined();
  });

  it("the displayed term keeps the line's casing", () => {
    // Only the KEYS normalize. The term is rendered to the player and the span
    // matcher is case-insensitive, so lowercasing it would change what is on
    // screen for no gain.
    expect(highlightFor("Hola, senor.").introduceTerms).toContain("Hola");
  });

  it("the gloss says what the phrase MEANS", () => {
    // Not the can-do descriptor. A hover answers the player's question --
    // "what did they just say" -- and "Can greet people in a simple way" is a
    // statement about the learner written for the Teacher.
    const highlight = highlightFor("Buenos dias, viajero.");
    expect(highlight.glosses[termKey("Buenos dias")]).toBe("good morning");
  });

  it("each wording of one exponent glosses to its own meaning", () => {
    // `qué es` and `qué significa` are one exponent and one card, but they do
    // not mean the same thing, so one gloss for the pair would be wrong for
    // whichever one the NPC did not say.
    const meta = (text: string) =>
      buildHighlightTerms({
        text,
        introduce: [
          { kind: "competency", competencyId: "meta-language", lang: "es" } as TeachableRef
        ],
        reinforce: [],
        atlas,
        targetLanguage: "es",
        supportLanguage: "en",
        chunkMatcher: matcher
      } as never);
    expect(meta("Que es?").glosses[termKey("Que es")]).toBe("what is it");
    expect(meta("Que significa?").glosses[termKey("Que significa")]).toBe(
      "what does it mean"
    );
  });
});

describe("a phrase is credited whether or not the player types the accents", () => {
  // Every accented wording ships deaccented too, derived rather than authored.
  // Asserting the data carries both spellings is not the same claim as
  // asserting a typed line MATCHES, which is what a player actually does.
  const both: Array<[string, string, string]> = [
    ["buenos dias", "buenos días", "buenos_dias"],
    ["adios", "adiós", "adios"],
    ["hasta manana", "hasta mañana", "hasta_manana"],
    ["donde esta", "dónde está", "donde_esta"],
    ["donde está", "dónde esta", "donde_esta"],
    ["cuanto cuesta", "cuánto cuesta", "cuanto_cuesta"],
    ["que tal", "qué tal", "que_tal"],
    ["si", "sí", "si"]
  ];

  for (const [plain, accented, exponentId] of both) {
    it(`"${plain}" and "${accented}" both credit ${exponentId}`, () => {
      for (const text of [plain, accented]) {
        const hits = matcher.match(tokenize(text, "es"), text);
        expect(
          hits.map((hit) => hit.item.exponentId),
          `"${text}" did not match`
        ).toContain(exponentId);
      }
    });
  }
});
