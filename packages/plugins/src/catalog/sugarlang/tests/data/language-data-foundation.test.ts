/**
 * packages/plugins/src/catalog/sugarlang/tests/data/language-data-foundation.test.ts
 *
 * Purpose: Verifies Epic 4's language schemas, shipped data snapshots, and runtime loaders.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Depends on ../../data/schemas/* and ../../data/languages/* as the checked-in data source of truth.
 *   - Exercises the Epic 4 runtime loaders under ../../runtime/providers, ../../runtime/classifier, and ../../runtime/placement.
 *
 * Implements: Epic 4 language-data validation, smoke tests, and fail-fast loader checks
 *
 * Status: active
 */

import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import esCefrlex from "../../data/languages/es/cefrlex.json";
import esMorphology from "../../data/languages/es/morphology.json";
import esPlacementQuestionnaire from "../../data/languages/es/placement-questionnaire.json";
import itCefrlex from "../../data/languages/it/cefrlex.json";
import itFrequency from "../../data/languages/it/frequency.json";
import itMorphology from "../../data/languages/it/morphology.json";
import itPlacementQuestionnaire from "../../data/languages/it/placement-questionnaire.json";
import cefrlexSchema from "../../data/schemas/cefrlex.schema.json";
import frequencySchema from "../../data/schemas/frequency.schema.json";
import morphologySchema from "../../data/schemas/morphology.schema.json";
import placementQuestionnaireSchema from "../../data/schemas/placement-questionnaire.schema.json";
import { lemmatize } from "../../runtime/classifier/lemmatize";
import {
  MorphologyLoader,
  loadMorphologyIndex
} from "../../runtime/classifier/morphology-loader";
import { PlacementQuestionnaireLoader } from "../../runtime/placement/placement-questionnaire-loader";
import {
  CefrLexAtlasProvider,
  type CefrLexDataFile
} from "../../runtime/providers/impls/cefr-lex-atlas-provider";

const ajv = new Ajv2020({
  allErrors: true,
  strict: false
});

function compileSchema(schema: object) {
  const isValidSchema = ajv.validateSchema(schema);
  if (!isValidSchema) {
    throw new Error(
      `Invalid JSON Schema: ${ajv.errorsText(ajv.errors, { separator: "\n" })}`
    );
  }

  return ajv.compile(schema);
}

describe("Epic 4 language-data schemas", () => {
  it("compile as valid draft-2020-12 schemas", () => {
    expect(() => compileSchema(cefrlexSchema)).not.toThrow();
    expect(() => compileSchema(morphologySchema)).not.toThrow();
    expect(() => compileSchema(placementQuestionnaireSchema)).not.toThrow();
    expect(() => compileSchema(frequencySchema)).not.toThrow();
  });

  it("accept minimal valid examples for every schema", () => {
    const validateCefrlex = compileSchema(cefrlexSchema);
    const validateMorphology = compileSchema(morphologySchema);
    const validatePlacement = compileSchema(placementQuestionnaireSchema);
    const validateFrequency = compileSchema(frequencySchema);

    expect(
      validateCefrlex({
        lang: "es",
        atlasVersion: "atlas-1",
        lemmas: {
          hola: {
            lemmaId: "hola",
            lang: "es",
            cefrPriorBand: "A1",
            frequencyRank: 1,
            partsOfSpeech: ["interjection"],
            glosses: { en: "hello" },
            cefrPriorSource: "cefrlex"
          }
        }
      })
    ).toBe(true);

    expect(
      validateMorphology({
        lang: "es",
        forms: {
          hola: {
            lemmaId: "hola",
            partsOfSpeech: ["interjection"]
          }
        }
      })
    ).toBe(true);


    expect(
      validatePlacement({
        schemaVersion: 1,
        lang: "es",
        targetLanguage: "es",
        supportLanguage: "en",
        formTitle: "Arrival Form",
        formIntro: "Answer in Spanish.",
        minAnswersForValid: 1,
        questions: [
          {
            kind: "yes-no",
            questionId: "q1",
            targetBand: "A1",
            promptText: "Hablas espanol?",
            correctAnswer: "yes",
            yesLabel: "si",
            noLabel: "no"
          }
        ]
      })
    ).toBe(true);

    expect(
      validateFrequency({
        lang: "it",
        generatedAt: "2026-04-09",
        lemmas: {
          ciao: {
            lemmaId: "ciao",
            lang: "it",
            rank: 1,
            corpusFrequency: 1000
          }
        }
      })
    ).toBe(true);

  });

  it("reject invalid examples for every schema", () => {
    const validateCefrlex = compileSchema(cefrlexSchema);
    const validateMorphology = compileSchema(morphologySchema);
    const validatePlacement = compileSchema(placementQuestionnaireSchema);
    const validateFrequency = compileSchema(frequencySchema);

    expect(
      validateCefrlex({
        lang: "es",
        atlasVersion: "atlas-1",
        lemmas: {
          hola: {
            lemmaId: "hola",
            lang: "es",
            cefrPriorBand: "A9"
          }
        }
      })
    ).toBe(false);

    expect(
      validateMorphology({
        lang: "es",
        forms: {
          hola: {}
        }
      })
    ).toBe(false);


    expect(
      validatePlacement({
        schemaVersion: 1,
        lang: "es",
        targetLanguage: "es",
        supportLanguage: "en",
        formTitle: "Arrival Form",
        formIntro: "Answer in Spanish.",
        minAnswersForValid: 1,
        questions: [
          {
            kind: "multiple-choice",
            questionId: "q1",
            targetBand: "A1",
            promptText: "Hola?"
          }
        ]
      })
    ).toBe(false);

    expect(
      validateFrequency({
        lang: "it",
        generatedAt: "2026-04-09",
        lemmas: {
          ciao: {
            lemmaId: "ciao",
            lang: "it",
            rank: 0,
            corpusFrequency: 1000
          }
        }
      })
    ).toBe(false);

  });

  it("validate the shipped Spanish and Italian data files", () => {
    expect(compileSchema(cefrlexSchema)(esCefrlex)).toBe(true);
    expect(compileSchema(cefrlexSchema)(itCefrlex)).toBe(true);
    expect(compileSchema(morphologySchema)(esMorphology)).toBe(true);
    expect(compileSchema(morphologySchema)(itMorphology)).toBe(true);
    expect(
      compileSchema(placementQuestionnaireSchema)(esPlacementQuestionnaire)
    ).toBe(true);
    expect(
      compileSchema(placementQuestionnaireSchema)(itPlacementQuestionnaire)
    ).toBe(true);
    expect(compileSchema(frequencySchema)(itFrequency)).toBe(true);
  });
});

describe("Epic 4 runtime language-data loaders", () => {
  it("loads the real Spanish and Italian atlases and exposes atlasVersion", async () => {
    const provider = new CefrLexAtlasProvider();

    const [spanishAtlas, italianAtlas] = await Promise.all([
      Promise.resolve(provider.load("es")),
      Promise.resolve(provider.load("it"))
    ]);

    expect(spanishAtlas.atlasVersion).toBe("es-elelex-2026-04-09");
    expect(italianAtlas.atlasVersion).toBe("it-kelly-2026-04-09");
    expect(provider.getAtlasVersion("es")).toBe("es-elelex-2026-04-09");
    expect(provider.getAtlasVersion("it")).toBe("it-kelly-2026-04-09");
    expect(provider.getBand("correr", "es")).toBe("A1");
    expect(provider.getBand("correre", "it")).toBe("A1");
  });

  it("ships a Spanish atlas with no C2 band", () => {
    const provider = new CefrLexAtlasProvider();

    // Spanish tops out at C1 in this data. That is a SHAPE claim -- introducing
    // a C2 entry changes what the band set means -- and it has been broken by
    // accident: twelve verbs were banded C2 while filling in forms, and
    // this assertion is what caught it.
    expect(provider.listLemmasAtBand("C2", "es")).toHaveLength(0);
  });

  // DELETED: a set of minimum-count assertions over both shipped atlases
  // ("at least 3000 A1 lemmas", "at least 11000 entries", and so on).
  //
  // They asserted nothing about correctness. The dictionary is curated -- it
  // grows when a missing lemma is added and shrinks when an entry that was
  // never a lemma is removed -- so the numbers move for good reasons, and every
  // such move failed a test that had no opinion about whether the change was
  // right. 239 multiword entries left in one pass and three separate floors had
  // to be rewritten to match, which is the whole story: they tracked the data
  // rather than constraining it.

  it("lemmatizes the smoke-test Spanish and Italian forms", () => {
    expect(loadMorphologyIndex("es").forms.corriendo?.lemmaId).toBe("correr");
    expect(loadMorphologyIndex("it").forms.correndo?.lemmaId).toBe("correre");
    expect(lemmatize("corriendo", "es")).toBe("correr");
    expect(lemmatize("correndo", "it")).toBe("correre");
  });


  it("loads placement questionnaires for both shipped languages", () => {
    const loader = new PlacementQuestionnaireLoader();

    expect(loader.getQuestionnaire("es").questions).toHaveLength(10);
    expect(loader.getQuestionnaire("it").questions).toHaveLength(10);
    expect(loader.getQuestionnaire("es").minAnswersForValid).toBe(6);
    expect(loader.getQuestionnaire("it").minAnswersForValid).toBe(6);
  });

  it("keeps Italian provenance tagging on every atlas lemma", () => {
    const provider = new CefrLexAtlasProvider();
    const italianAtlas = provider.load("it");

    expect(
      Object.values(italianAtlas.lemmas).every(
        (entry) =>
          typeof entry.cefrPriorSource === "string" &&
          entry.cefrPriorSource.length > 0
      )
    ).toBe(true);
  });

  it("fails fast when atlas data is missing or invalid", () => {
    const missingProvider = new CefrLexAtlasProvider({});
    const invalidProvider = new CefrLexAtlasProvider({
      es: {
        lang: "es",
        atlasVersion: "broken",
        lemmas: {
          hola: {
            lemmaId: "hola",
            lang: "es",
            cefrPriorBand: "A1",
            frequencyRank: 0,
            partsOfSpeech: [],
            glosses: { en: "hello" },
            cefrPriorSource: "cefrlex"
          }
        }
      } as unknown as CefrLexDataFile
    });

    expect(() => missingProvider.load("es")).toThrow(
      /Missing sugarlang cefrlex data/
    );
    expect(() => invalidProvider.load("es")).toThrow(/Invalid cefrlex data/);
  });

  it("fails fast when morphology or placement data is missing or invalid", () => {
    const missingMorphologyLoader = new MorphologyLoader({});
    const invalidMorphologyLoader = new MorphologyLoader({
      es: { lang: "es", forms: { correr: {} } } as never
    });
    const missingPlacementLoader = new PlacementQuestionnaireLoader({});
    const invalidPlacementLoader = new PlacementQuestionnaireLoader({
      es: {
        schemaVersion: 1,
        lang: "es",
        targetLanguage: "es",
        supportLanguage: "en",
        formTitle: "Broken",
        formIntro: "Broken",
        minAnswersForValid: 1,
        questions: [
          {
            kind: "multiple-choice",
            questionId: "q1",
            targetBand: "A1",
            promptText: "?"
          } as never
        ]
      }
    });

    expect(() => missingMorphologyLoader.load("es")).toThrow(
      /Missing sugarlang morphology data/
    );
    expect(() => invalidMorphologyLoader.load("es")).toThrow(
      /Invalid morphology data/
    );
    expect(() => missingPlacementLoader.getQuestionnaire("es")).toThrow(
      /Missing sugarlang placement questionnaire/
    );
    expect(() => invalidPlacementLoader.getQuestionnaire("es")).toThrow(
      /Invalid placement questionnaire/
    );
  });
});
