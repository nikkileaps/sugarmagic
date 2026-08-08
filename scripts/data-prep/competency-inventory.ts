/**
 * scripts/data-prep/competency-inventory.ts
 *
 * Purpose: Builds a language's competency inventory from the authored
 *   curriculum and that language's authored exponents.
 *
 * Exports:
 *   - buildCompetencyInventory
 *   - type CurriculumBandFile, ExponentsFile, CompetencyInventoryFile
 *
 * Relationships:
 *   - Reads data/curriculum/<band>.json and data/languages/<lang>/exponents.json.
 *   - Resolves words through data/languages/<lang>/morphology.json.
 *   - Takes contractions and function words from ./languages/<lang>.
 *   - Writes data/languages/<lang>/competency-inventory.json.
 *
 * Status: active
 */

import Ajv2020 from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";

import type { LanguageRules } from "./languages/language-rules";
import { languageRules } from "./languages/registry";
import { readJsonFile, sugarlangDataPath } from "./sugarlang-language-data";

export type CurriculumBandFile = {
  schemaVersion: string;
  band: string;
  lessons: Array<{ lessonId: string; ordinal: number; displayName: string }>;
  competencies: Array<{
    competencyId: string;
    lessonId: string;
    displayName: string;
    cefrDescriptor: string;
    isItemZero?: boolean;
    placementGateBand?: string;
    interpretLexiconCategory?: string;
  }>;
};

export type ExponentsFile = {
  schemaVersion: string;
  lang: string;
  exponents: Record<string, AuthoredExponent[]>;
};

export type AuthoredExponent = {
  /** Ordered. The first phrase is canonical and gives the exponent its id. */
  wordings: Array<{
    phrase: string;
    /** What it means, per support language. Authored: `por favor` does not
     *  come out of its own words. */
    gloss: Record<string, string>;
    /** Only where the morphology index resolves a word the wrong way. */
    lemmas?: Record<string, string>;
  }>;
};

export type MorphologyFile = {
  lang: string;
  forms: Record<string, { lemmaId: string }>;
};

export type CompetencyInventoryFile = {
  schemaVersion: "2";
  lang: string;
  lessons: Array<{
    lessonId: string;
    band: string;
    ordinal: number;
    displayName: string;
  }>;
  competencies: Array<{
    competencyId: string;
    lessonId: string;
    displayName: string;
    cefrDescriptor: string;
    band: string;
    isItemZero?: boolean;
    placementGateBand?: string;
    interpretLexiconCategory?: string;
    exponents: Record<string, InventoryExponent[]>;
  }>;
};

type InventoryExponent = {
  exponentId: string;
  normalizedForm: string;
  surfaceForms: string[];
  cefrBand: string;
  constituentLemmas: string[];
  /**
   * Every spelling to what it means. Keyed by surface form so a hover can
   * answer from the text it matched -- `qué significa` reads "what does it
   * mean" even though it shares an exponent with `qué es`.
   */
  glossBySurface: Record<string, Record<string, string>>;
};

/**
 * STRUCTURE FIRST, MEANING SECOND.
 *
 * The build already reports meaning problems well -- an unresolvable word, a
 * competency that is not in the curriculum -- by collecting them all and
 * naming each one. It reported SHAPE problems terribly: a missing `gloss` or a
 * mistyped `wordings` reached the loop below and came out as a TypeError
 * pointing at a line of this file, saying nothing about which phrase was
 * wrong.
 *
 * That was survivable while one language was authored. It is not the thing to
 * hand someone writing a few thousand phrases by hand.
 *
 * So the schema owns shape and runs first, and the failure list below stays
 * the single place meaning problems are reported. Two checks, two jobs, no
 * overlap.
 */
let compiledExponentsSchema: ValidateFunction | null = null;

function describeSchemaError(error: ErrorObject): string {
  // `/exponents/greet/0/wordings/0` reads better as a path than as prose, and
  // it is what an author needs to find the entry.
  const where = error.instancePath === "" ? "(root)" : error.instancePath;
  const extra =
    error.keyword === "additionalProperties"
      ? ` ("${String((error.params as { additionalProperty?: string }).additionalProperty)}")`
      : "";
  return `${where} ${error.message ?? "is invalid"}${extra}`;
}

function assertExponentsShape(exponents: ExponentsFile): void {
  if (!compiledExponentsSchema) {
    compiledExponentsSchema = new Ajv2020({ strict: true, allErrors: true }).compile(
      readJsonFile<object>(sugarlangDataPath("schemas", "exponents.schema.json"))
    );
  }
  // Called for its boolean, not as a type guard -- Ajv's guard narrows the
  // argument to `unknown` and the error branch to `never`, which loses the
  // `lang` this message needs.
  const valid: boolean = compiledExponentsSchema(exponents);
  if (valid) return;

  const errors = compiledExponentsSchema.errors ?? [];
  throw new Error(
    `Cannot read the ${exponents.lang ?? "(unknown)"} exponents:\n  ${errors
      .map(describeSchemaError)
      .join("\n  ")}`
  );
}

export function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").normalize("NFC");
}

/**
 * Every way a player might accent a wording: each accented word independently
 * kept or dropped. `"dónde está"` gives four, `"hola"` gives one.
 *
 * The count is 2^(accented words). Real phrases carry one or two, so this stays
 * small; a wording with more than a handful is a sign it should be several.
 */
function accentCombinations(wording: string): string[] {
  const words = wording.split(" ");
  let forms = [""];
  for (const word of words) {
    const plain = stripDiacritics(word);
    const options = plain === word ? [word] : [word, plain];
    forms = forms.flatMap((prefix) =>
      options.map((option) => (prefix === "" ? option : `${prefix} ${option}`))
    );
  }
  return forms;
}

/** `"cuánto cuesta"` -> `"cuanto_cuesta"`. Ids are deaccented, so correcting a
 *  phrase's spelling never moves the id -- and never orphans a learner card. */
function exponentIdFor(wording: string): string {
  return stripDiacritics(wording)
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, "")
    .trim()
    .replace(/\s+/g, "_");
}

/**
 * The words of a wording, with written contractions expanded into the words
 * they stand for.
 *
 * Stripping the apostrophe and splitting -- which is what this did -- turns
 * Italian `dov'e` into `dov` and `e`. `dov` is not a word and no dictionary
 * will ever hold it, so a core A1 phrase could not be authored at all. The
 * language says what the stub stands for, because the dropped vowel is fixed
 * per word and guessing it is how non-words get made.
 *
 * Spanish supplies no rule and is unaffected: it writes no contractions with
 * an apostrophe. French will need one for `j'ai` and `l'eau`.
 */
function tokenize(wording: string, rules: LanguageRules): string[] {
  const rawTokens = wording
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\p{Mark}'’\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

  const out: string[] = [];
  for (const raw of rawTokens) {
    const expanded = rules.expandWrittenForm?.(raw);
    if (expanded) {
      out.push(...expanded);
      continue;
    }
    // Not a contraction this language knows: drop any remaining marks so a
    // stray quote never becomes part of a token.
    const bare = raw.replace(/['’]/gu, "");
    if (bare) out.push(bare);
  }
  return out;
}

export function buildCompetencyInventory(inputs: {
  bands: CurriculumBandFile[];
  exponents: ExponentsFile;
  morphology: MorphologyFile;
}): CompetencyInventoryFile {
  const { bands, exponents, morphology } = inputs;
  assertExponentsShape(exponents);
  const lang = exponents.lang;
  const rules = languageRules(lang);

  const competencyById = new Map<
    string,
    { band: CurriculumBandFile; competency: CurriculumBandFile["competencies"][number] }
  >();
  const lessonById = new Map<
    string,
    { band: string; lesson: CurriculumBandFile["lessons"][number] }
  >();
  for (const band of bands) {
    for (const lesson of band.lessons) {
      lessonById.set(lesson.lessonId, { band: band.band, lesson });
    }
    for (const competency of band.competencies) {
      competencyById.set(competency.competencyId, { band, competency });
    }
  }

  const failures: string[] = [];
  const competencies: CompetencyInventoryFile["competencies"] = [];
  const usedLessonIds = new Set<string>();

  for (const [competencyId, authored] of Object.entries(exponents.exponents)) {
    const found = competencyById.get(competencyId);
    if (!found) {
      failures.push(
        `${competencyId}: named in ${lang} exponents but absent from the curriculum`
      );
      continue;
    }
    const { band, competency } = found;
    usedLessonIds.add(competency.lessonId);

    const built: InventoryExponent[] = [];
    for (const entry of authored) {
      const [canonical] = entry.wordings;
      if (!canonical) {
        failures.push(`${competencyId}: an exponent has no wordings`);
        continue;
      }

      const surfaceForms: string[] = [];
      const glossBySurface: Record<string, Record<string, string>> = {};
      const constituentLemmas: string[] = [];

      for (const wording of entry.wordings) {
        if (Object.keys(wording.gloss).length === 0) {
          failures.push(`${competencyId} / "${wording.phrase}": no gloss`);
        }

        // Players accent inconsistently -- a word here, not the next one -- so
        // a wording ships every combination of its accented words kept or
        // dropped, not just the two extremes. The shipped `donde esta` carried
        // exactly such a mixed spelling by hand, and emitting only
        // both-or-neither would have quietly stopped matching it.
        for (const form of accentCombinations(wording.phrase)) {
          if (!surfaceForms.includes(form)) surfaceForms.push(form);
          // Every spelling answers with its own wording's meaning.
          glossBySurface[form] ??= wording.gloss;
        }

        for (const token of tokenize(wording.phrase, rules)) {
          const lemma =
            wording.lemmas?.[token] ?? morphology.forms[token]?.lemmaId;
          if (!lemma) {
            failures.push(
              `${competencyId} / "${wording.phrase}": "${token}" does not resolve to a lemma`
            );
            continue;
          }
          // The language's own list. It used to be one Spanish list used for
          // every language, which counted Italian `il`, `ti`, `ci` and `si` as
          // words an exponent teaches while stripping `su` and `tu`, which
          // Italian needs.
          if (rules.functionWords.has(lemma)) continue;
          if (!constituentLemmas.includes(lemma)) constituentLemmas.push(lemma);
        }
      }

      const exponentId = exponentIdFor(canonical.phrase);
      built.push({
        exponentId,
        normalizedForm: exponentId,
        surfaceForms,
        cefrBand: band.band,
        constituentLemmas,
        glossBySurface
      });
    }

    competencies.push({
      competencyId,
      lessonId: competency.lessonId,
      displayName: competency.displayName,
      cefrDescriptor: competency.cefrDescriptor,
      band: band.band,
      ...(competency.isItemZero ? { isItemZero: competency.isItemZero } : {}),
      ...(competency.placementGateBand
        ? { placementGateBand: competency.placementGateBand }
        : {}),
      ...(competency.interpretLexiconCategory
        ? { interpretLexiconCategory: competency.interpretLexiconCategory }
        : {}),
      exponents: { [lang]: built }
    });
  }

  if (failures.length > 0) {
    throw new Error(
      `Cannot build the ${lang} competency inventory:\n  ${failures.join("\n  ")}`
    );
  }

  // Only lessons that something in this language can actually teach. An empty
  // lesson in the inventory would be a heading the Teacher can never fill.
  const lessons = [...usedLessonIds]
    .map((lessonId) => {
      const entry = lessonById.get(lessonId)!;
      return {
        lessonId,
        band: entry.band,
        ordinal: entry.lesson.ordinal,
        displayName: entry.lesson.displayName
      };
    })
    .sort((a, b) =>
      a.band === b.band ? a.ordinal - b.ordinal : a.band.localeCompare(b.band)
    );

  competencies.sort((a, b) => {
    if (a.band !== b.band) return a.band.localeCompare(b.band);
    const ordinalA = lessonById.get(a.lessonId)!.lesson.ordinal;
    const ordinalB = lessonById.get(b.lessonId)!.lesson.ordinal;
    if (ordinalA !== ordinalB) return ordinalA - ordinalB;
    return a.competencyId.localeCompare(b.competencyId);
  });

  return { schemaVersion: "2", lang, lessons, competencies };
}
