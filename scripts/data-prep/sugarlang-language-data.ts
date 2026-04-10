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

interface AtlasLemmaEntry {
  lemmaId: string;
  lang: string;
  cefrPriorBand: CEFRBand;
  frequencyRank: number;
  partsOfSpeech: string[];
  gloss?: string;
  cefrPriorSource: AtlasPriorSource;
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

interface SimplificationEntry {
  kind: "lemma-substitution" | "gloss-fallback";
  lemmaId?: string;
  gloss?: string;
  contextTags?: string[];
}

interface SimplificationsDataFile {
  lang: string;
  entries: Record<string, SimplificationEntry[]>;
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

interface ParsedSpanishLemma {
  lemmaId: string;
  band: CEFRBand;
  totalFrequency: number;
  partsOfSpeech: Set<string>;
}

interface ParsedItalianLemma {
  lemmaId: string;
  partsOfSpeech: Set<string>;
  rank: number;
  cefrBand: CEFRBand | null;
}

const ELELEX_DOWNLOAD_URL =
  "https://cental.uclouvain.be/cefrlex/static/resources/es/ELELex.tsv";
const ITALIAN_KELLY_URL = "https://ssharoff.github.io/kelly/it_m3.xls";
const DATA_BUILD_DATE = "2026-04-09";

const CEFR_ORDER: CEFRBand[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const SPANISH_SOURCE_BANDS: CEFRBand[] = ["A1", "A2", "B1", "B2", "C1"];
const SPANISH_ATLAS_LIMIT = 11000;
const ITALIAN_REVIEW_QUEUE_LIMIT = 50;

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

async function downloadTextToCache(
  url: string,
  filename: string
): Promise<string> {
  const path = await downloadToCache(url, filename);
  return readFileSync(path, "utf8");
}

function parseDelimitedRow(line: string): string[] {
  return line.split("\t").map((cell) => cell.replace(/^"|"$/g, ""));
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

function guessSpanishBand(levelFrequencies: number[]): CEFRBand {
  const index = levelFrequencies.findIndex((value) => value > 0);
  if (index === -1) {
    return "C1";
  }

  return SPANISH_SOURCE_BANDS[index] ?? "C1";
}

async function loadSpanishSourceEntries(): Promise<ParsedSpanishLemma[]> {
  const tsv = await downloadTextToCache(ELELEX_DOWNLOAD_URL, "ELELex.tsv");
  const lines = tsv.trim().split(/\r?\n/);
  const grouped = new Map<string, ParsedSpanishLemma>();

  for (const line of lines.slice(1)) {
    const [
      rawWord,
      rawTag,
      rawA1,
      rawA2,
      rawB1,
      rawB2,
      rawC1,
      rawTotalFrequency
    ] = parseDelimitedRow(line);
    const lemmaId = normalizeLemma(rawWord ?? "");
    if (!lemmaId) {
      continue;
    }

    const entryBand = guessSpanishBand([
      Number(rawA1),
      Number(rawA2),
      Number(rawB1),
      Number(rawB2),
      Number(rawC1)
    ]);
    const totalFrequency = Number(rawTotalFrequency);
    const partsOfSpeech = mapSpanishPos(rawTag ?? "");
    const existing = grouped.get(lemmaId);

    if (existing) {
      existing.band = pickLowerBand(existing.band, entryBand);
      existing.totalFrequency += Number.isFinite(totalFrequency)
        ? totalFrequency
        : 0;
      partsOfSpeech.forEach((partOfSpeech) =>
        existing.partsOfSpeech.add(partOfSpeech)
      );
      continue;
    }

    grouped.set(lemmaId, {
      lemmaId,
      band: entryBand,
      totalFrequency: Number.isFinite(totalFrequency) ? totalFrequency : 0,
      partsOfSpeech: new Set(partsOfSpeech)
    });
  }

  return [...grouped.values()]
    .sort((left, right) => right.totalFrequency - left.totalFrequency)
    .slice(0, SPANISH_ATLAS_LIMIT);
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

export async function buildSpanishCefrlexData(): Promise<CefrLexDataFile> {
  const entries = await loadSpanishSourceEntries();

  return {
    lang: "es",
    atlasVersion: "es-elelex-2026-04-09",
    lemmas: finalizeAtlasEntries(
      entries.map((entry, index) => ({
        lemmaId: entry.lemmaId,
        lang: "es",
        cefrPriorBand: entry.band,
        frequencyRank: index + 1,
        partsOfSpeech: [...entry.partsOfSpeech],
        cefrPriorSource: "cefrlex"
      }))
    )
  };
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

export async function buildItalianKellySubsetData(): Promise<KellySubsetDataFile> {
  const entries = await loadItalianSourceEntries();
  const filtered = entries.filter(
    (entry): entry is ParsedItalianLemma & { cefrBand: CEFRBand } =>
      entry.cefrBand !== null
  );

  return {
    lang: "it",
    sourceVersion: "it-kelly-2014",
    lemmas: Object.fromEntries(
      filtered.map((entry) => [
        entry.lemmaId,
        {
          lemmaId: entry.lemmaId,
          lang: "it",
          cefrBand: entry.cefrBand
        }
      ])
    )
  };
}

export async function buildItalianCefrlexData(): Promise<CefrLexDataFile> {
  const entries = await loadItalianSourceEntries();

  return {
    lang: "it",
    atlasVersion: "it-kelly-2026-04-09",
    lemmas: finalizeAtlasEntries(
      entries.map((entry, index) => ({
        lemmaId: entry.lemmaId,
        lang: "it",
        cefrPriorBand: entry.cefrBand ?? rankToBand(index + 1),
        frequencyRank: index + 1,
        partsOfSpeech: [...entry.partsOfSpeech],
        cefrPriorSource: entry.cefrBand ? "kelly" : "frequency-derived"
      }))
    )
  };
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

function addSpanishMorphologyForms(
  forms: Record<string, MorphologyEntry>,
  lemmaId: string,
  partsOfSpeech: string[]
): void {
  addMorphologyEntry(forms, lemmaId, lemmaId, partsOfSpeech);

  if (partsOfSpeech.includes("verb")) {
    if (lemmaId.endsWith("ar")) {
      const stem = lemmaId.slice(0, -2);
      addMorphologyEntry(forms, `${stem}ando`, lemmaId, partsOfSpeech);
      addMorphologyEntry(forms, `${stem}ado`, lemmaId, partsOfSpeech);
    } else if (lemmaId.endsWith("er") || lemmaId.endsWith("ir")) {
      const stem = lemmaId.slice(0, -2);
      addMorphologyEntry(forms, `${stem}iendo`, lemmaId, partsOfSpeech);
      addMorphologyEntry(forms, `${stem}ido`, lemmaId, partsOfSpeech);
    }
  }

  if (partsOfSpeech.includes("noun") || partsOfSpeech.includes("adjective")) {
    if (/[aeiouáéíóú]$/u.test(lemmaId)) {
      addMorphologyEntry(forms, `${lemmaId}s`, lemmaId, partsOfSpeech);
    } else {
      addMorphologyEntry(forms, `${lemmaId}es`, lemmaId, partsOfSpeech);
    }

    if (lemmaId.endsWith("o")) {
      const stem = lemmaId.slice(0, -1);
      addMorphologyEntry(forms, `${stem}a`, lemmaId, partsOfSpeech);
      addMorphologyEntry(forms, `${stem}os`, lemmaId, partsOfSpeech);
      addMorphologyEntry(forms, `${stem}as`, lemmaId, partsOfSpeech);
    }
  }
}

function addItalianMorphologyForms(
  forms: Record<string, MorphologyEntry>,
  lemmaId: string,
  partsOfSpeech: string[]
): void {
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
    lemmaId: string,
    partsOfSpeech: string[]
  ) => void
): MorphologyDataFile {
  const forms: Record<string, MorphologyEntry> = {};

  for (const entry of Object.values(atlas.lemmas)) {
    addLanguageSpecificForms(forms, entry.lemmaId, entry.partsOfSpeech);
  }

  return {
    lang: atlas.lang,
    forms
  };
}

export function buildSpanishMorphologyData(
  atlas: CefrLexDataFile
): MorphologyDataFile {
  return buildMorphologyData(atlas, addSpanishMorphologyForms);
}

export function buildItalianMorphologyData(
  atlas: CefrLexDataFile
): MorphologyDataFile {
  return buildMorphologyData(atlas, addItalianMorphologyForms);
}

function buildSimplificationsData(
  atlas: CefrLexDataFile
): SimplificationsDataFile {
  const lowerBandEntries = Object.values(atlas.lemmas)
    .filter(
      (entry) => entry.cefrPriorBand === "A1" || entry.cefrPriorBand === "A2"
    )
    .sort((left, right) => left.frequencyRank - right.frequencyRank);
  const lowerByPos = new Map<string, AtlasLemmaEntry[]>();

  for (const entry of lowerBandEntries) {
    for (const partOfSpeech of entry.partsOfSpeech) {
      const bucket = lowerByPos.get(partOfSpeech) ?? [];
      bucket.push(entry);
      lowerByPos.set(partOfSpeech, bucket);
    }
  }

  const entries: Record<string, SimplificationEntry[]> = {};

  for (const entry of Object.values(atlas.lemmas)) {
    if (entry.cefrPriorBand === "A1" || entry.cefrPriorBand === "A2") {
      continue;
    }

    const preferredPartOfSpeech = entry.partsOfSpeech[0];
    const candidates =
      (preferredPartOfSpeech
        ? lowerByPos.get(preferredPartOfSpeech)
        : undefined) ?? lowerBandEntries;
    const substitute = candidates.find(
      (candidate) => candidate.lemmaId !== entry.lemmaId
    );

    if (substitute) {
      entries[entry.lemmaId] = [
        {
          kind: "lemma-substitution",
          lemmaId: substitute.lemmaId,
          contextTags: [
            `source-band:${entry.cefrPriorBand.toLowerCase()}`,
            `source-lang:${atlas.lang}`
          ]
        }
      ];
      continue;
    }

    entries[entry.lemmaId] = [
      {
        kind: "gloss-fallback",
        gloss: entry.lemmaId,
        contextTags: [`source-band:${entry.cefrPriorBand.toLowerCase()}`]
      }
    ];
  }

  return {
    lang: atlas.lang,
    entries
  };
}

export function buildSpanishSimplificationsData(
  atlas: CefrLexDataFile
): SimplificationsDataFile {
  return buildSimplificationsData(atlas);
}

export function buildItalianSimplificationsData(
  atlas: CefrLexDataFile
): SimplificationsDataFile {
  return buildSimplificationsData(atlas);
}

export function buildItalianReviewQueueYaml(atlas: CefrLexDataFile): string {
  const lowConfidence = Object.values(atlas.lemmas)
    .filter((entry) => entry.cefrPriorSource === "frequency-derived")
    .slice(0, ITALIAN_REVIEW_QUEUE_LIMIT);

  const lines = [
    "# Frequency-derived Italian CEFR assignments for optional human review"
  ];
  for (const entry of lowConfidence) {
    lines.push(`- lemmaId: ${entry.lemmaId}`);
    lines.push(`  assignedBand: ${entry.cefrPriorBand}`);
    lines.push(`  frequencyRank: ${entry.frequencyRank}`);
    lines.push("  reviewReason: kelly-band-missing");
  }

  return lines.join("\n");
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

export function writeTextFile(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${value}\n`, "utf8");
}

export function sugarlangDataPath(...segments: string[]): string {
  return join(
    REPO_ROOT,
    "packages/plugins/src/catalog/sugarlang/data",
    ...segments
  );
}
