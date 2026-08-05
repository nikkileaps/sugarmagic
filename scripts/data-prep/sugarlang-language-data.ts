/**
 * scripts/data-prep/sugarlang-language-data.ts
 *
 * Purpose: Shared source-backed import helpers for the checked-in sugarlang language-data snapshots.
 *
 * Exports:
 *   - source-backed builders for Spanish and Italian data files
 *   - read/write helpers used by the Epic 4 data-prep scripts
 *
 * Relationships:
 *   - Writes plugin-owned language assets under packages/plugins/src/catalog/sugarlang/data/languages/.
 *   - Downloads and caches upstream source files used to regenerate the checked-in snapshots.
 *
 * Implements: Epic 4 data-prep workflow
 *
 * Status: active
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

type CEFRBand = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
type AtlasPriorSource =
  | "cefrlex"
  | "frequency-derived"
  | "claude-classified"
  | "human-override"
  | "kelly";

/** Six slots in person order 1s,2s,3s,1p,2p,3p; null where the form does not exist. */
type ParadigmRow = Array<string | null>;

interface AtlasVerbForms {
  pres: ParadigmRow;
  pret: ParadigmRow;
  imp: ParadigmRow;
  ger: string;
  part: string;
}

/** Nouns inflect for number only -- a feminine noun is a separate lemma. */
interface AtlasNounForms {
  sg: string;
  pl: string;
}

/** Adjectives inflect for gender and number; fs/fp null when invariable. */
interface AtlasAdjectiveForms {
  ms: string;
  fs: string | null;
  mp: string;
  fp: string | null;
}

type AtlasWordForms =
  | AtlasVerbForms
  | AtlasNounForms
  | AtlasAdjectiveForms;

interface AtlasLemmaEntry {
  lemmaId: string;
  lang: string;
  cefrPriorBand: CEFRBand;
  frequencyRank: number | null;
  partsOfSpeech: string[];
  gloss?: string;
  cefrPriorSource: AtlasPriorSource;
  /** Verbs only. Authored in the dictionary; this file derives FROM it. */
  forms?: AtlasWordForms;
}

export interface CefrLexDataFile {
  lang: string;
  atlasVersion: string;
  lemmas: Record<string, AtlasLemmaEntry>;
}

interface MorphologyEntry {
  lemmaId: string;
  partsOfSpeech?: string[];
}

export interface MorphologyDataFile {
  lang: string;
  forms: Record<string, MorphologyEntry>;
}

interface FrequencyLemmaEntry {
  lemmaId: string;
  lang: string;
  rank: number;
  corpusFrequency: number;
}

interface FrequencyDataFile {
  lang: string;
  generatedAt: string;
  lemmas: Record<string, FrequencyLemmaEntry>;
}

interface KellySubsetLemmaEntry {
  lemmaId: string;
  lang: string;
  cefrBand: CEFRBand;
}

interface KellySubsetDataFile {
  lang: string;
  sourceVersion: string;
  lemmas: Record<string, KellySubsetLemmaEntry>;
}

interface PlacementQuestionnaire {
  schemaVersion: 1;
  lang: string;
  targetLanguage: string;
  supportLanguage: string;
  formTitle: string;
  formIntro: string;
  questions: Array<Record<string, unknown>>;
  minAnswersForValid: number;
}

interface ParsedItalianLemma {
  lemmaId: string;
  partsOfSpeech: Set<string>;
  rank: number;
  cefrBand: CEFRBand | null;
}

const ITALIAN_KELLY_URL = "https://ssharoff.github.io/kelly/it_m3.xls";
const DATA_BUILD_DATE = "2026-04-09";

const CEFR_ORDER: CEFRBand[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const SPANISH_SOURCE_BANDS: CEFRBand[] = ["A1", "A2", "B1", "B2", "C1"];
const SPANISH_ATLAS_LIMIT = 11000;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..", "..");
const CACHE_DIR = join(REPO_ROOT, ".cache", "sugarlang-language-data");

function normalizeLemma(value: string): string | null {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length === 0 || normalized.includes(" ")) {
    return null;
  }

  return normalized;
}

function compareBands(left: CEFRBand, right: CEFRBand): number {
  return CEFR_ORDER.indexOf(left) - CEFR_ORDER.indexOf(right);
}

function pickLowerBand(left: CEFRBand, right: CEFRBand): CEFRBand {
  return compareBands(left, right) <= 0 ? left : right;
}

function isCefrBand(value: string | undefined): value is CEFRBand {
  return value !== undefined && CEFR_ORDER.includes(value as CEFRBand);
}

async function downloadToCache(url: string, filename: string): Promise<string> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const path = join(CACHE_DIR, filename);
  if (existsSync(path)) {
    return path;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download "${url}": ${response.status} ${response.statusText}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  writeFileSync(path, Buffer.from(arrayBuffer));
  return path;
}

function mapSpanishPos(tag: string): string[] {
  if (tag.startsWith("V")) {
    return ["verb"];
  }
  if (tag.startsWith("NC")) {
    return ["noun"];
  }
  if (tag.startsWith("NP")) {
    return ["proper-noun"];
  }
  if (tag.startsWith("AQ") || tag.startsWith("AO") || tag.startsWith("A")) {
    return ["adjective"];
  }
  if (tag.startsWith("R")) {
    return ["adverb"];
  }
  if (tag.startsWith("I")) {
    return ["interjection"];
  }
  if (tag.startsWith("SP")) {
    return ["preposition"];
  }
  if (tag.startsWith("CC") || tag.startsWith("CS")) {
    return ["conjunction"];
  }
  if (tag.startsWith("D")) {
    return ["determiner"];
  }
  if (tag.startsWith("P")) {
    return ["pronoun"];
  }
  if (tag.startsWith("Z")) {
    return ["numeral"];
  }

  return ["other"];
}

function mapItalianPos(pos: string): string[] {
  switch (pos) {
    case "v":
      return ["verb"];
    case "n":
      return ["noun"];
    case "np":
      return ["proper-noun"];
    case "adj":
      return ["adjective"];
    case "adv":
      return ["adverb"];
    case "prep":
      return ["preposition"];
    case "conj":
      return ["conjunction"];
    case "det":
      return ["determiner"];
    case "pron":
      return ["pronoun"];
    case "num":
      return ["numeral"];
    case "int":
      return ["interjection"];
    case "for":
      return ["formula"];
    case "abb":
      return ["abbreviation"];
    default:
      return ["other"];
  }
}

async function loadItalianSourceEntries(): Promise<ParsedItalianLemma[]> {
  const path = await downloadToCache(ITALIAN_KELLY_URL, "it_m3.xls");
  const workbook = XLSX.readFile(path);
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(
    workbook.Sheets[workbook.SheetNames[0]!],
    { raw: false, defval: "" }
  );

  const grouped = new Map<string, ParsedItalianLemma>();
  let rank = 0;

  for (const row of rows) {
    const points = isCefrBand(row.Points) ? row.Points : null;
    const partsOfSpeech = mapItalianPos(row.Pos ?? "");
    const variants = (row.Lemma ?? "")
      .split(",")
      .map((variant) => normalizeLemma(variant))
      .filter((variant): variant is string => variant !== null);

    for (const variant of variants) {
      rank += 1;
      const existing = grouped.get(variant);
      if (existing) {
        existing.rank = Math.min(existing.rank, rank);
        if (points) {
          existing.cefrBand = existing.cefrBand
            ? pickLowerBand(existing.cefrBand, points)
            : points;
        }
        partsOfSpeech.forEach((partOfSpeech) =>
          existing.partsOfSpeech.add(partOfSpeech)
        );
        continue;
      }

      grouped.set(variant, {
        lemmaId: variant,
        partsOfSpeech: new Set(partsOfSpeech),
        rank,
        cefrBand: points
      });
    }
  }

  return [...grouped.values()].sort((left, right) => left.rank - right.rank);
}

function rankToBand(rank: number): CEFRBand {
  if (rank <= 1000) {
    return "A1";
  }
  if (rank <= 2000) {
    return "A2";
  }
  if (rank <= 4000) {
    return "B1";
  }
  if (rank <= 6000) {
    return "B2";
  }
  if (rank <= 8000) {
    return "C1";
  }

  return "C2";
}

function finalizeAtlasEntries(
  entries: Array<{
    lemmaId: string;
    lang: "es" | "it";
    cefrPriorBand: CEFRBand;
    frequencyRank: number;
    partsOfSpeech: string[];
    cefrPriorSource: AtlasPriorSource;
    gloss?: string;
  }>
): Record<string, AtlasLemmaEntry> {
  return Object.fromEntries(
    entries
      .sort((left, right) => left.frequencyRank - right.frequencyRank)
      .map((entry) => [entry.lemmaId, entry])
  );
}

export async function buildItalianFrequencyData(): Promise<FrequencyDataFile> {
  const entries = await loadItalianSourceEntries();
  const total = entries.length;

  return {
    lang: "it",
    generatedAt: DATA_BUILD_DATE,
    lemmas: Object.fromEntries(
      entries.map((entry, index) => [
        entry.lemmaId,
        {
          lemmaId: entry.lemmaId,
          lang: "it",
          rank: index + 1,
          corpusFrequency: total - index
        }
      ])
    )
  };
}

/**
 * Every distinct surface an entry claims, whatever its part of speech.
 *
 * Mirrors `allForms` in runtime/classifier/word-forms.ts. The two are separate
 * because this script does not import from the plugin package; if the stored
 * shape changes, change both.
 */
/**
 * Verbs whose present subjunctive is not built off the `yo` stem, given in
 * full. Every other verb in the language is regular here, including the ones
 * that look irregular: `oigo` -> `oiga`, `digo` -> `diga`, `tengo` -> `tenga`.
 */
const SPANISH_IRREGULAR_SUBJUNCTIVE: Record<string, string[]> = {
  ser: ["sea", "seas", "sea", "seamos", "seáis", "sean"],
  ir: ["vaya", "vayas", "vaya", "vayamos", "vayáis", "vayan"],
  estar: ["esté", "estés", "esté", "estemos", "estéis", "estén"],
  dar: ["dé", "des", "dé", "demos", "deis", "den"],
  saber: ["sepa", "sepas", "sepa", "sepamos", "sepáis", "sepan"],
  haber: ["haya", "hayas", "haya", "hayamos", "hayáis", "hayan"]
};

/**
 * The twelve verbs whose future and conditional are not built on the plain
 * infinitive. Every other verb in the language is, which is why these are a
 * list and not a rule.
 */
const SPANISH_IRREGULAR_FUTURE_STEM: Record<string, string> = {
  decir: "dir",
  hacer: "har",
  poder: "podr",
  poner: "pondr",
  querer: "querr",
  saber: "sabr",
  salir: "saldr",
  tener: "tendr",
  valer: "valdr",
  venir: "vendr",
  caber: "cabr",
  haber: "habr"
};

const SUBJUNCTIVE_AR = ["e", "es", "e", "emos", "éis", "en"];
const SUBJUNCTIVE_ER_IR = ["a", "as", "a", "amos", "áis", "an"];
const CONDITIONAL = ["ía", "ías", "ía", "íamos", "íais", "ían"];
const FUTURE = ["é", "ás", "á", "emos", "éis", "án"];
const IMPERFECT_SUBJUNCTIVE = ["ra", "ras", "ra", "ramos", "rais", "ran"];

/**
 * Tenses the dictionary does not store but the language needs.
 *
 * The stored paradigm is present, preterite and imperfect. That leaves out
 * three things a beginner meets constantly:
 *
 *   PRESENT SUBJUNCTIVE, which is also the `usted` imperative -- `disculpe`,
 *   `perdone`, `oiga`. A1 politeness is largely polite imperatives, and none of
 *   them resolved before this.
 *
 *   CONDITIONAL, which is how wanting is said politely -- `querría`, `podría`,
 *   `gustaría`.
 *
 *   FUTURE, one word rather than `ir a` + infinitive.
 *
 * All three are derived rather than authored because they ARE derivable:
 * subjunctive from the `yo` stem, future and conditional from the infinitive.
 * Asking an author to write `disculpe` beside `disculpo` would be asking them
 * to restate a rule the language already follows.
 */
function spanishDerivedTenses(entry: AtlasLemmaEntry): string[] {
  const f = entry.forms;
  if (!f || !("pres" in f)) return [];
  const out: string[] = [];

  const irregular = SPANISH_IRREGULAR_SUBJUNCTIVE[entry.lemmaId];
  if (irregular) {
    out.push(...irregular);
  } else {
    const yo = f.pres[0];
    if (typeof yo === "string" && yo.endsWith("o")) {
      const stem = yo.slice(0, -1);
      const endings = entry.lemmaId.endsWith("ar")
        ? SUBJUNCTIVE_AR
        : SUBJUNCTIVE_ER_IR;
      out.push(...endings.map((ending) => `${stem}${ending}`));
    }
  }

  // Imperfect subjunctive, off the third-person plural preterite:
  // `quisieron` -> `quisiera`. It is how wanting is said politely, so a
  // beginner meets `quisiera` long before the tense is taught.
  const theyDid = f.pret[5];
  if (typeof theyDid === "string" && theyDid.endsWith("ron")) {
    const stem = theyDid.slice(0, -3);
    out.push(...IMPERFECT_SUBJUNCTIVE.map((ending) => `${stem}${ending}`));
  }

  const futureStem =
    SPANISH_IRREGULAR_FUTURE_STEM[entry.lemmaId] ??
    (/(ar|er|ir)$/.test(entry.lemmaId) ? entry.lemmaId : null);
  if (futureStem) {
    out.push(...CONDITIONAL.map((ending) => `${futureStem}${ending}`));
    out.push(...FUTURE.map((ending) => `${futureStem}${ending}`));
  }

  return out;
}

function spanishSurfacesOf(entry: AtlasLemmaEntry): string[] {
  const f = entry.forms;
  if (!f) return [entry.lemmaId];
  const raw: Array<string | null | undefined> =
    "pres" in f
      ? [...f.pres, ...f.pret, ...f.imp, f.ger, f.part]
      : "sg" in f
        ? [f.sg, f.pl]
        : [f.ms, f.fs, f.mp, f.fp];
  return [
    ...new Set([entry.lemmaId, ...raw])
  ].filter((s): s is string => typeof s === "string" && s.length > 0);
}

function addMorphologyEntry(
  forms: Record<string, MorphologyEntry>,
  form: string,
  lemmaId: string,
  partsOfSpeech: string[]
): void {
  const normalized = normalizeLemma(form);
  if (!normalized || forms[normalized]) {
    return;
  }

  forms[normalized] = {
    lemmaId,
    partsOfSpeech
  };
}

/**
 * EVERY SURFACE THE DICTIONARY HOLDS, POINTED AT ITS LEMMA. No rules.
 *
 * This function used to GUESS -- `-ar` verbs got `-ando`/`-ado`, nouns got
 * `+s`/`+es`, and anything ending in `-o` got a `-a` "feminine". Guessing does
 * not know meaning, so it produced words that do not exist (`pedir` ->
 * "pediendo", real: `pidiendo`) and, worse, words that exist and mean something
 * else: `caso` -> `casa`, `puerto` -> `puerta`, `libro` -> `libra`. Those are
 * not inflections, they are different words, and the index claimed otherwise.
 *
 * The forms now live in the dictionary, where a person or a model can read them
 * next to the gloss and correct them. This file only inverts them.
 */
function addSpanishMorphologyForms(
  forms: Record<string, MorphologyEntry>,
  entry: AtlasLemmaEntry
): void {
  for (const surface of spanishSurfacesOf(entry)) {
    addMorphologyEntry(forms, surface, entry.lemmaId, entry.partsOfSpeech);
  }
}

/** Italian has no authored paradigms yet, so every verb takes the rule path. */
function addItalianMorphologyForms(
  forms: Record<string, MorphologyEntry>,
  entry: AtlasLemmaEntry
): void {
  const { lemmaId, partsOfSpeech } = entry;
  addMorphologyEntry(forms, lemmaId, lemmaId, partsOfSpeech);

  if (partsOfSpeech.includes("verb")) {
    if (lemmaId.endsWith("are")) {
      const stem = lemmaId.slice(0, -3);
      addMorphologyEntry(forms, `${stem}ando`, lemmaId, partsOfSpeech);
      addMorphologyEntry(forms, `${stem}ato`, lemmaId, partsOfSpeech);
    } else if (lemmaId.endsWith("ere")) {
      const stem = lemmaId.slice(0, -3);
      addMorphologyEntry(forms, `${stem}endo`, lemmaId, partsOfSpeech);
      addMorphologyEntry(forms, `${stem}uto`, lemmaId, partsOfSpeech);
    } else if (lemmaId.endsWith("ire")) {
      const stem = lemmaId.slice(0, -3);
      addMorphologyEntry(forms, `${stem}endo`, lemmaId, partsOfSpeech);
      addMorphologyEntry(forms, `${stem}ito`, lemmaId, partsOfSpeech);
    }
  }

  if (partsOfSpeech.includes("noun") || partsOfSpeech.includes("adjective")) {
    if (lemmaId.endsWith("o")) {
      addMorphologyEntry(
        forms,
        `${lemmaId.slice(0, -1)}i`,
        lemmaId,
        partsOfSpeech
      );
    } else if (lemmaId.endsWith("a")) {
      addMorphologyEntry(
        forms,
        `${lemmaId.slice(0, -1)}e`,
        lemmaId,
        partsOfSpeech
      );
    } else if (lemmaId.endsWith("e")) {
      addMorphologyEntry(
        forms,
        `${lemmaId.slice(0, -1)}i`,
        lemmaId,
        partsOfSpeech
      );
    }
  }
}

function buildMorphologyData(
  atlas: CefrLexDataFile,
  addLanguageSpecificForms: (
    forms: Record<string, MorphologyEntry>,
    entry: AtlasLemmaEntry
  ) => void,
  addDerivedForms?: (
    forms: Record<string, MorphologyEntry>,
    entry: AtlasLemmaEntry
  ) => void
): MorphologyDataFile {
  const forms: Record<string, MorphologyEntry> = {};

  // TWO PASSES, AND THE ORDER IS THE POINT. `addMorphologyEntry` is
  // first-come -- it refuses to overwrite -- so whoever claims a surface first
  // keeps it. Every HEADWORD is claimed before any derived form, because a word
  // that is a lemma in its own right outranks an inflected form of something
  // else.
  //
  // Without this, `hecho` (the noun, "fact") loses its own entry to the
  // participle of `hacer`, and `puesto`, `abierto`, `escrito`, `oido`,
  // `muerto` and `cubierto` go the same way. That was latent while the
  // generator guessed -- it produced `hacido`, which collides with nothing --
  // and only surfaced once the real participles came from the dictionary.
  for (const entry of Object.values(atlas.lemmas)) {
    addMorphologyEntry(forms, entry.lemmaId, entry.lemmaId, entry.partsOfSpeech);
  }

  for (const entry of Object.values(atlas.lemmas)) {
    addLanguageSpecificForms(forms, entry);
  }

  // THIRD PASS: tenses the dictionary does not store, so a form it DOES store
  // always outranks one we worked out.
  //
  // Without the split, `siente` went to the subjunctive of `sentar` ("that he
  // sit") instead of the present of `sentir` ("he feels"), and `crea` to the
  // subjunctive of `creer` instead of the present of `crear` -- because within
  // one pass whichever lemma is visited first wins, and a derived form was
  // competing on equal footing with a stored one. Measured: 112 surfaces
  // changed owner when these tenses were added, and this pass is what keeps
  // the changes to the ones that are improvements.
  if (addDerivedForms) {
    for (const entry of Object.values(atlas.lemmas)) {
      addDerivedForms(forms, entry);
    }
  }

  return {
    lang: atlas.lang,
    forms
  };
}

/**
 * Object and reflexive pronouns that attach to the end of a verb.
 *
 * Only the single-clitic case, and only on the INFINITIVE. Spanish also
 * attaches these to affirmative imperatives and gerunds, but both shift the
 * written accent (`cuenta` + `me` is `cuéntame`), which needs syllabification
 * to get right. The infinitive never shifts, so this half is exact; the other
 * half is absent and every authoring pass so far has reported it.
 */
const SPANISH_ENCLITICS = [
  "me", "te", "se", "lo", "la", "le", "nos", "los", "las", "les"
];

/**
 * The eight affirmative `tú` imperatives that are not simply the third-person
 * singular present. The regular ones already resolve through that form.
 */
const SPANISH_IRREGULAR_TU_IMPERATIVE: Record<string, string> = {
  decir: "di",
  hacer: "haz",
  ir: "ve",
  poner: "pon",
  salir: "sal",
  ser: "sé",
  tener: "ten",
  venir: "ven"
};

/**
 * Forms the dictionary does not store but authored phrases keep reaching for.
 *
 * Every A2 authoring pass independently reported the same four shapes missing,
 * which is why they are derived rather than filed one at a time:
 *
 *   INFINITIVE + CLITIC -- `ayudarme`, `verte`, `explicarlo`. The single
 *   biggest blocker reported; polite requests and instructions are built on it.
 *
 *   PARTICIPLE AGREEMENT -- `pasada`, `ocupada`, `preocupada`. The masculine
 *   resolved and the feminine did not, so half of every such phrase failed.
 *
 *   -MENTE ADVERBS -- `finalmente`, `totalmente`. Formed off the feminine
 *   adjective, so they are derivable wherever the adjective has one.
 *
 *   IRREGULAR TU IMPERATIVES -- `ten`, `pon`. The regular ones already resolve
 *   as third-person present; these eight do not.
 */
function addSpanishExtraForms(
  forms: Record<string, MorphologyEntry>,
  entry: AtlasLemmaEntry
): void {
  const f = entry.forms;
  const { lemmaId, partsOfSpeech } = entry;

  if (partsOfSpeech.includes("verb") && /(ar|er|ir)$/.test(lemmaId)) {
    for (const clitic of SPANISH_ENCLITICS) {
      addMorphologyEntry(forms, `${lemmaId}${clitic}`, lemmaId, partsOfSpeech);
    }
    const irregular = SPANISH_IRREGULAR_TU_IMPERATIVE[lemmaId];
    if (irregular) {
      addMorphologyEntry(forms, irregular, lemmaId, partsOfSpeech);
    }
  }

  if (f && "pres" in f && typeof f.part === "string" && f.part.endsWith("o")) {
    const stem = f.part.slice(0, -1);
    for (const ending of ["a", "os", "as"]) {
      addMorphologyEntry(forms, `${stem}${ending}`, lemmaId, partsOfSpeech);
    }
  }

  // -mente attaches to the FEMININE adjective where one exists. Adjectives
  // ending in -l, -e or -z do not inflect for gender, so the dictionary stores
  // `fs: null` and the base form is what takes the suffix: `final` ->
  // `finalmente`, but `rápida` -> `rápidamente`.
  if (partsOfSpeech.includes("adjective") && f && "fs" in f) {
    const base = typeof f.fs === "string" ? f.fs : f.ms;
    if (typeof base === "string") {
      addMorphologyEntry(forms, `${base}mente`, lemmaId, partsOfSpeech);
    }
  }
}

function addSpanishDerivedForms(
  forms: Record<string, MorphologyEntry>,
  entry: AtlasLemmaEntry
): void {
  for (const surface of spanishDerivedTenses(entry)) {
    addMorphologyEntry(forms, surface, entry.lemmaId, entry.partsOfSpeech);
  }
  addSpanishExtraForms(forms, entry);
}

export function buildSpanishMorphologyData(
  atlas: CefrLexDataFile
): MorphologyDataFile {
  return buildMorphologyData(
    atlas,
    addSpanishMorphologyForms,
    addSpanishDerivedForms
  );
}

export function buildItalianMorphologyData(
  atlas: CefrLexDataFile
): MorphologyDataFile {
  return buildMorphologyData(atlas, addItalianMorphologyForms);
}

function buildSpanishQuestionnaire(): PlacementQuestionnaire {
  return {
    schemaVersion: 1,
    lang: "es",
    targetLanguage: "es",
    supportLanguage: "en",
    formTitle: "Arrival Form",
    formIntro:
      "Answer what you can in Spanish. Leave blanks for anything you do not understand yet.",
    minAnswersForValid: 6,
    questions: [
      {
        kind: "multiple-choice",
        questionId: "es-q1",
        targetBand: "A1",
        promptText: "¿Cómo te llamas?",
        supportText: "Choose the answer that introduces your name.",
        options: [
          { optionId: "a", text: "Me llamo Ana.", isCorrect: true },
          { optionId: "b", text: "Tengo una maleta.", isCorrect: false },
          { optionId: "c", text: "Trabajo aquí.", isCorrect: false }
        ]
      },
      {
        kind: "fill-in-blank",
        questionId: "es-q2",
        targetBand: "A1",
        promptText: "Completa la frase.",
        sentenceTemplate: "Yo ___ de Canada.",
        acceptableAnswers: ["soy"],
        acceptableLemmas: ["ser"]
      },
      {
        kind: "yes-no",
        questionId: "es-q3",
        targetBand: "A1",
        promptText: "¿Hablas un poco de español?",
        correctAnswer: "yes",
        yesLabel: "si",
        noLabel: "no"
      },
      {
        kind: "free-text",
        questionId: "es-q4",
        targetBand: "A2",
        promptText: "Escribe una frase sobre tu trabajo.",
        expectedLemmas: ["trabajar"],
        acceptableForms: ["trabajo", "trabajar", "trabajando"],
        minExpectedLength: 10
      },
      {
        kind: "multiple-choice",
        questionId: "es-q5",
        targetBand: "A2",
        promptText: "¿Cuanto tiempo vas a quedarte?",
        options: [
          { optionId: "a", text: "Dos semanas.", isCorrect: true },
          { optionId: "b", text: "La estacion es grande.", isCorrect: false },
          { optionId: "c", text: "Me gusta el queso.", isCorrect: false }
        ]
      },
      {
        kind: "yes-no",
        questionId: "es-q6",
        targetBand: "A2",
        promptText: "¿Viajas solo hoy?",
        correctAnswer: "yes",
        yesLabel: "si",
        noLabel: "no"
      },
      {
        kind: "fill-in-blank",
        questionId: "es-q7",
        targetBand: "B1",
        promptText: "Completa la frase.",
        sentenceTemplate: "Necesito mi ___ para el tren.",
        acceptableAnswers: ["boleto", "billete"],
        acceptableLemmas: ["boleto", "billete"]
      },
      {
        kind: "free-text",
        questionId: "es-q8",
        targetBand: "B1",
        promptText: "Explica por que vienes a esta ciudad.",
        expectedLemmas: ["venir", "ciudad"],
        minExpectedLength: 18
      },
      {
        kind: "multiple-choice",
        questionId: "es-q9",
        targetBand: "B2",
        promptText: "¿Que documento presentas en la aduana?",
        options: [
          { optionId: "a", text: "Mi pasaporte.", isCorrect: true },
          { optionId: "b", text: "Mi queso favorito.", isCorrect: false },
          { optionId: "c", text: "Mi calendario.", isCorrect: false }
        ]
      },
      {
        kind: "free-text",
        questionId: "es-q10",
        targetBand: "B2",
        promptText:
          "Describe un problema de viaje que resolviste recientemente.",
        expectedLemmas: ["resolver", "viajar"],
        minExpectedLength: 24
      }
    ]
  };
}

function buildItalianQuestionnaire(): PlacementQuestionnaire {
  return {
    schemaVersion: 1,
    lang: "it",
    targetLanguage: "it",
    supportLanguage: "en",
    formTitle: "Modulo di Arrivo",
    formIntro:
      "Rispondi in italiano quando puoi. Lascia vuoto quello che ancora non capisci.",
    minAnswersForValid: 6,
    questions: [
      {
        kind: "multiple-choice",
        questionId: "it-q1",
        targetBand: "A1",
        promptText: "Come ti chiami?",
        options: [
          { optionId: "a", text: "Mi chiamo Luca.", isCorrect: true },
          { optionId: "b", text: "Ho una valigia.", isCorrect: false },
          { optionId: "c", text: "Lavoro qui.", isCorrect: false }
        ]
      },
      {
        kind: "fill-in-blank",
        questionId: "it-q2",
        targetBand: "A1",
        promptText: "Completa la frase.",
        sentenceTemplate: "Io ___ del Canada.",
        acceptableAnswers: ["sono"],
        acceptableLemmas: ["essere"]
      },
      {
        kind: "yes-no",
        questionId: "it-q3",
        targetBand: "A1",
        promptText: "Parli un po di italiano?",
        correctAnswer: "yes",
        yesLabel: "si",
        noLabel: "no"
      },
      {
        kind: "free-text",
        questionId: "it-q4",
        targetBand: "A2",
        promptText: "Scrivi una frase sul tuo lavoro.",
        expectedLemmas: ["lavorare"],
        acceptableForms: ["lavoro", "lavorare", "lavorando"],
        minExpectedLength: 10
      },
      {
        kind: "multiple-choice",
        questionId: "it-q5",
        targetBand: "A2",
        promptText: "Quanto tempo resti in citta?",
        options: [
          { optionId: "a", text: "Due settimane.", isCorrect: true },
          { optionId: "b", text: "La stazione e grande.", isCorrect: false },
          { optionId: "c", text: "Mi piace il formaggio.", isCorrect: false }
        ]
      },
      {
        kind: "yes-no",
        questionId: "it-q6",
        targetBand: "A2",
        promptText: "Viaggi da solo oggi?",
        correctAnswer: "yes",
        yesLabel: "si",
        noLabel: "no"
      },
      {
        kind: "fill-in-blank",
        questionId: "it-q7",
        targetBand: "B1",
        promptText: "Completa la frase.",
        sentenceTemplate: "Ho bisogno del mio ___ per il treno.",
        acceptableAnswers: ["biglietto"],
        acceptableLemmas: ["biglietto"]
      },
      {
        kind: "free-text",
        questionId: "it-q8",
        targetBand: "B1",
        promptText: "Spiega perche vieni in questa citta.",
        expectedLemmas: ["venire", "citta"],
        minExpectedLength: 18
      },
      {
        kind: "multiple-choice",
        questionId: "it-q9",
        targetBand: "B2",
        promptText: "Quale documento presenti alla dogana?",
        options: [
          { optionId: "a", text: "Il mio passaporto.", isCorrect: true },
          {
            optionId: "b",
            text: "Il mio formaggio preferito.",
            isCorrect: false
          },
          { optionId: "c", text: "Il mio calendario.", isCorrect: false }
        ]
      },
      {
        kind: "free-text",
        questionId: "it-q10",
        targetBand: "B2",
        promptText:
          "Descrivi un problema di viaggio che hai risolto di recente.",
        expectedLemmas: ["risolvere", "viaggiare"],
        minExpectedLength: 24
      }
    ]
  };
}

export function buildSpanishPlacementQuestionnaire(): PlacementQuestionnaire {
  return buildSpanishQuestionnaire();
}

export function buildItalianPlacementQuestionnaire(): PlacementQuestionnaire {
  return buildItalianQuestionnaire();
}

export function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function sugarlangDataPath(...segments: string[]): string {
  return join(
    REPO_ROOT,
    "packages/plugins/src/catalog/sugarlang/data",
    ...segments
  );
}
