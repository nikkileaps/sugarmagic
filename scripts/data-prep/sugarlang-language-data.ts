/**
 * scripts/data-prep/sugarlang-language-data.ts
 *
 * Purpose: The language-AGNOSTIC half of data-prep -- the entry shapes, the
 *   morphology pass ordering, and the file helpers.
 *
 * NOTHING HERE MAY NAME A LANGUAGE. Rules that do -- endings, accents, tenses,
 * function words, contractions -- live in ./languages/<lang>.ts and are reached
 * through ./languages/registry. This file used to hold both, and the Spanish
 * half was silently applied to Italian; see languages/language-rules.ts for
 * what that cost and for how to decide which half a new rule belongs to.
 *
 * Exports:
 *   - the atlas / morphology / frequency entry shapes
 *   - buildMorphologyData and the primitives languages build on
 *   - read/write helpers used by the data-prep scripts
 *
 * Relationships:
 *   - Writes plugin-owned language assets under packages/plugins/src/catalog/sugarlang/data/languages/.
 *   - Downloads and caches upstream source files used to regenerate the checked-in snapshots.
 *   - Does NOT import from ./languages; the dependency runs one way.
 *
 * Status: active
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type CEFRBand = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
type AtlasPriorSource =
  | "cefrlex"
  | "frequency-derived"
  | "claude-classified"
  | "human-override"
  | "kelly";

/** Six slots in person order 1s,2s,3s,1p,2p,3p; null where the form does not exist. */
type FormsRow = Array<string | null>;

export interface AtlasVerbForms {
  pres: FormsRow;
  pret: FormsRow;
  imp: FormsRow;
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

export interface AtlasLemmaEntry {
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

export interface MorphologyEntry {
  lemmaId: string;
  partsOfSpeech?: string[];
}

export interface MorphologyDataFile {
  lang: string;
  forms: Record<string, MorphologyEntry>;
}

export interface FrequencyLemmaEntry {
  lemmaId: string;
  lang: string;
  rank: number;
  corpusFrequency: number;
}

export interface FrequencyDataFile {
  lang: string;
  generatedAt: string;
  lemmas: Record<string, FrequencyLemmaEntry>;
}


export interface PlacementQuestionnaire {
  schemaVersion: 1;
  lang: string;
  targetLanguage: string;
  supportLanguage: string;
  formTitle: string;
  formIntro: string;
  questions: Array<Record<string, unknown>>;
  minAnswersForValid: number;
}


export const DATA_BUILD_DATE = "2026-04-09";

const CEFR_ORDER: CEFRBand[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..", "..");
const CACHE_DIR = join(REPO_ROOT, ".cache", "sugarlang-language-data");

export function normalizeLemma(value: string): string | null {
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

export function pickLowerBand(left: CEFRBand, right: CEFRBand): CEFRBand {
  return compareBands(left, right) <= 0 ? left : right;
}

export function isCefrBand(value: string | undefined): value is CEFRBand {
  return value !== undefined && CEFR_ORDER.includes(value as CEFRBand);
}

export async function downloadToCache(url: string, filename: string): Promise<string> {
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


/** Branches on the SHAPE of `forms`, not on the language, so every language
 *  with authored forms inverts through here. */
export function authoredSurfacesOf(entry: AtlasLemmaEntry): string[] {
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

export function addMorphologyEntry(
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


export function buildMorphologyData(
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
