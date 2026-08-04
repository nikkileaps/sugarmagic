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
 *   - Writes data/languages/<lang>/competency-inventory.json.
 *
 * Status: active
 */

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
  exponents: Record<
    string,
    Array<{ wordings: string[]; lemmas?: Record<string, string> }>
  >;
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
};

/**
 * Words carrying no lexical content of their own: articles, clitic object and
 * reflexive pronouns, and possessive determiners. A competency counts as in
 * envelope when one of its constituent lemmas is being taught, so leaving `me`
 * or `el` in the list would put half the curriculum in envelope the moment
 * either is prescribed.
 *
 * Prepositions are NOT here. `hasta`, `en`, `por` and `de` are taught as
 * vocabulary at A1 and carry meaning the learner has to acquire.
 */
const NO_LEXICAL_CONTENT = new Set([
  "el",
  "la",
  "los",
  "un",
  "una",
  "me",
  "te",
  "se",
  "nos",
  "os",
  "lo",
  "le",
  "les",
  "mi",
  "tu",
  "su"
]);

export function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").normalize("NFC");
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

function tokenize(wording: string): string[] {
  return wording
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function buildCompetencyInventory(inputs: {
  bands: CurriculumBandFile[];
  exponents: ExponentsFile;
  morphology: MorphologyFile;
}): CompetencyInventoryFile {
  const { bands, exponents, morphology } = inputs;
  const lang = exponents.lang;

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

      // Players type without accents, so every accented wording also ships
      // deaccented. Derived rather than authored, so the two cannot drift.
      const surfaceForms: string[] = [];
      for (const wording of entry.wordings) {
        for (const form of [wording, stripDiacritics(wording)]) {
          if (!surfaceForms.includes(form)) surfaceForms.push(form);
        }
      }

      const constituentLemmas: string[] = [];
      for (const wording of entry.wordings) {
        for (const token of tokenize(wording)) {
          const lemma = entry.lemmas?.[token] ?? morphology.forms[token]?.lemmaId;
          if (!lemma) {
            failures.push(
              `${competencyId} / "${wording}": "${token}" does not resolve to a lemma`
            );
            continue;
          }
          if (NO_LEXICAL_CONTENT.has(lemma)) continue;
          if (!constituentLemmas.includes(lemma)) constituentLemmas.push(lemma);
        }
      }

      const exponentId = exponentIdFor(canonical);
      built.push({
        exponentId,
        normalizedForm: exponentId,
        surfaceForms,
        cefrBand: band.band,
        constituentLemmas
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
