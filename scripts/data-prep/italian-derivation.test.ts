/**
 * scripts/data-prep/italian-derivation.test.ts
 *
 * Purpose: Pins the Italian forms the dictionary does not store but the
 *   morphology index derives -- the polite command, the conditional, the
 *   future, and pronouns attached to a verb.
 *
 * The counterpart of spanish-derivation.test.ts, and it exists for the same
 * reason: derivation is where non-words get written into the index. Italian's
 * own history is the argument -- the guessing pass it still falls back to
 * produced `probleme` for `problemi` and `banci` for `banchi`.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import type { MorphologyFile } from "./competency-inventory";
import { languageRules } from "./languages/registry";
import { readJsonFile, sugarlangDataPath } from "./sugarlang-language-data";

const index = readJsonFile<MorphologyFile>(
  sugarlangDataPath("languages", "it", "morphology.json")
).forms;

const lemmaOf = (surface: string) => index[surface]?.lemmaId ?? null;

/** Runs the third pass alone, so a case can be checked without the word
 *  having to be in the shipped dictionary yet. */
function derive(entry: Record<string, unknown>): string[] {
  const forms: Record<string, { lemmaId: string }> = {};
  languageRules("it").addDerivedForms?.(forms as never, entry as never);
  return Object.keys(forms);
}

describe("the two forms lesson 1 could not resolve", () => {
  it("resolves the polite command", () => {
    // `senta` is the Lei command and the present subjunctive at once. A1
    // politeness is largely polite commands, so this class is not optional.
    expect(lemmaOf("senta")).toBe("sentire");
  });

  it("resolves a verb with a pronoun stuck on the end", () => {
    expect(lemmaOf("figurati")).toBe("figurare");
  });
});

describe("derived Italian forms are real words", () => {
  it("builds the subjunctive off the io stem", () => {
    for (const [surface, lemma] of [
      ["senta", "sentire"],
      ["chieda", "chiedere"],
      ["scusino", "scusare"],
      ["presentino", "presentare"]
    ] as const) {
      expect(lemmaOf(surface), surface).toBe(lemma);
    }
  });

  it("takes the irregular subjunctives from the list, not the stem", () => {
    expect(lemmaOf("vada")).toBe("andare");
  });

  it("THE ONE THAT WOULD BE WRONG: -isc- verbs drop the infix in the plural", () => {
    // `capisco` gives `capisca`, but the plural is NOT built on that stem --
    // `capisciamo` is not a word. The real forms are `capiamo` and `capiate`.
    // capire has no stored forms yet, so this runs the pass directly.
    const out = derive({
      lemmaId: "capire",
      partsOfSpeech: ["verb"],
      forms: {
        pres: ["capisco", "capisci", "capisce", "capiamo", "capite", "capiscono"],
        pret: [null, null, null, null, null, null],
        imp: [null, null, null, null, null, null],
        ger: "capendo",
        part: "capito"
      }
    });
    expect(out).toContain("capisca");
    expect(out).toContain("capiamo");
    expect(out).toContain("capiate");
    expect(out).not.toContain("capisciamo");
    expect(out).not.toContain("capisciate");
  });

  it("THE OTHER ONE THAT WOULD BE WRONG: -giare and -ciare absorb the subjunctive i", () => {
    // `mangiare`'s io stem is already `mangi`, so adding the ending gives
    // `mangii` and `mangiino`. Neither is a word; the real forms are `mangi`
    // and `mangino`. Every -giare and -ciare verb is in this class.
    expect(lemmaOf("mangi")).toBe("mangiare");
    expect(lemmaOf("mangino")).toBe("mangiare");
    expect(index["mangii"]).toBeUndefined();
    expect(index["mangiino"]).toBeUndefined();

    expect(lemmaOf("lasci")).toBe("lasciare");
    expect(lemmaOf("lascino")).toBe("lasciare");
    expect(index["lascii"]).toBeUndefined();

    // The ordinary case must keep its ending.
    expect(lemmaOf("parli")).toBe("parlare");
    expect(lemmaOf("parlino")).toBe("parlare");
  });

  it("A THIRD ONE THAT WOULD BE WRONG: -care and -gare keep the consonant hard", () => {
    // Italian writes an `h` to keep a `c` or `g` hard before an `i`:
    // `cercare` gives `cerchi`, not `cerci`. The subjunctive is also the
    // polite command, so this is ordinary shop language, and without the
    // respelling every -care and -gare verb produced a non-word AND lost its
    // real form.
    expect(lemmaOf("cerchi")).toBe("cercare");
    expect(lemmaOf("cerchino")).toBe("cercare");
    expect(lemmaOf("cerchiate")).toBe("cercare");
    expect(index["cerci"]).toBeUndefined();
    expect(index["cercino"]).toBeUndefined();
    expect(index["cerciate"]).toBeUndefined();
  });

  it("the SAME respelling in the future and conditional, which was missed for a band", () => {
    // The subjunctive fix only looked at an `i` ending. The future and
    // conditional endings start with `e`, need the same `h`, and did not get
    // it -- so `cercerò` sat in the index as a non-word through all of A1 and
    // A2 while `cercherò` was missing. Found by probing, not by a failure.
    expect(lemmaOf("cercherò")).toBe("cercare");
    expect(lemmaOf("pagherò")).toBe("pagare");
    expect(lemmaOf("spiegherei")).toBe("spiegare");
    expect(index["cercerò"]).toBeUndefined();
    expect(index["pagerò"]).toBeUndefined();

    // A stem that does not end in c or g must NOT grow one.
    expect(lemmaOf("parlerò")).toBe("parlare");
    expect(index["parlherò"]).toBeUndefined();
  });

  it("builds the conditional and future, regular and irregular", () => {
    for (const [surface, lemma] of [
      ["sentirei", "sentire"],
      ["chiamerei", "chiamare"],
      ["sentirò", "sentire"],
      ["verrei", "venire"],
      ["verrò", "venire"],
      ["starei", "stare"]
    ] as const) {
      expect(lemmaOf(surface), surface).toBe(lemma);
    }
  });

  it("attaches pronouns to the infinitive, which drops its final -e", () => {
    // `dire` + `mi` is `dirmi`, never `diremi`.
    expect(lemmaOf("dirmi")).toBe("dire");
    expect(lemmaOf("farlo")).toBe("fare");
    expect(index["diremi"]).toBeUndefined();
    expect(index["farelo"]).toBeUndefined();
  });

  it("no authored verb form carries a doubled i", () => {
    // The -iare family keeps ONE i (`risparmi`, `risparmiamo`), and writing
    // the regular -are endings onto its stem produces `risparmii` and
    // `risparmiiamo`. Nothing complains: they are simply non-words sitting in
    // the index, and the real forms go missing. Caught once by hand; this is
    // so the next one is caught by the suite.
    const atlas = readJsonFile<{
      lemmas: Record<string, { forms?: Record<string, unknown> }>;
    }>(sugarlangDataPath("languages", "it", "cefrlex.json")).lemmas;

    const doubled: string[] = [];
    for (const [lemmaId, entry] of Object.entries(atlas)) {
      const forms = entry.forms;
      if (!forms || !("pres" in forms)) continue;
      const surfaces = [
        ...(forms.pres as Array<string | null>),
        ...(forms.pret as Array<string | null>),
        ...(forms.imp as Array<string | null>),
        forms.ger as string,
        forms.part as string
      ];
      for (const surface of surfaces) {
        // A final `ii` is legitimate: `capii`, `dormii` are real preterites.
        if (typeof surface === "string" && surface.includes("ii") && !surface.endsWith("ii")) {
          doubled.push(`${lemmaId}: ${surface}`);
        }
      }
    }
    expect(doubled).toEqual([]);
  });

  it("invents no TENSE for a word whose forms are not authored yet", () => {
    // Most of the Italian dictionary has no stored forms. Attaching a pronoun
    // needs only the infinitive, so that still happens -- but a tense cannot be
    // built without knowing the present, and guessing one is how `probleme`
    // and `banci` got written. The line is drawn here deliberately.
    const out = derive({ lemmaId: "temere", partsOfSpeech: ["verb"] });
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain("temermi");
    // The truncated infinitive itself is also a word (`temer dire`), and needs
    // only the infinitive to build.
    expect(out).toContain("temer");
    // No subjunctive, conditional or future: every form is the infinitive
    // stem, alone or plus one pronoun, and nothing else.
    const clitics = ["mi", "ti", "si", "ci", "vi", "lo", "la", "li", "le", "ne"];
    for (const surface of out) {
      expect(
        surface === "temer" || clitics.some((clitic) => surface === `temer${clitic}`),
        surface
      ).toBe(true);
    }
  });

  it("a stored form still outranks a derived one", () => {
    // `sia` is a conjunction in its own right and keeps its own entry, even
    // though it is also the subjunctive of `essere`. Ordering, not accident.
    expect(lemmaOf("sia")).toBe("sia");
  });
});
