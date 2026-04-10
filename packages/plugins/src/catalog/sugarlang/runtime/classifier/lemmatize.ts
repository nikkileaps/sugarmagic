/**
 * packages/plugins/src/catalog/sugarlang/runtime/classifier/lemmatize.ts
 *
 * Purpose: Resolves a token or surface form to its canonical lemma via morphology data.
 *
 * Exports:
 *   - lemmatize
 *
 * Relationships:
 *   - Is consumed by coverage computation, the classifier facade, and auto-simplify.
 *   - Wraps the fail-fast morphology loader from Epic 4 without duplicating lookup rules.
 *
 * Implements: Proposal 001 §2. Envelope Classifier
 *
 * Status: active
 */

import type { LemmaRef } from "../types";
import {
  MorphologyLoader,
  lemmatizeWithMorphology,
  type MorphologyDataFile
} from "./morphology-loader";
import type { Token } from "./tokenize";

function isMorphologyDataFile(
  morphologyIndex:
    | MorphologyDataFile
    | MorphologyLoader
    | Record<string, string>
): morphologyIndex is MorphologyDataFile {
  return typeof morphologyIndex === "object" && morphologyIndex !== null && "forms" in morphologyIndex;
}

function isMorphologyLoader(
  morphologyIndex:
    | MorphologyDataFile
    | MorphologyLoader
    | Record<string, string>
): morphologyIndex is MorphologyLoader {
  return morphologyIndex instanceof MorphologyLoader;
}

function isToken(token: string | Token): token is Token {
  return typeof token === "object";
}

function normalizeSurfaceForm(surfaceForm: string, lang: string): string {
  return surfaceForm.trim().normalize("NFC").toLocaleLowerCase(lang);
}

function resolveLemmaId(
  surfaceForm: string,
  lang: string,
  morphologyIndex?:
    | MorphologyDataFile
    | MorphologyLoader
    | Record<string, string>
): string | null {
  const normalized = normalizeSurfaceForm(surfaceForm, lang);
  if (normalized.length === 0) {
    return null;
  }

  if (morphologyIndex && isMorphologyLoader(morphologyIndex)) {
    return morphologyIndex.lemmatize(normalized, lang);
  }
  if (morphologyIndex && isMorphologyDataFile(morphologyIndex)) {
    return morphologyIndex.forms[normalized]?.lemmaId ?? null;
  }
  if (morphologyIndex) {
    return morphologyIndex[normalized] ?? null;
  }

  return lemmatizeWithMorphology(normalized, lang);
}

export function lemmatize(
  token: Token,
  lang: string,
  morphologyIndex?:
    | MorphologyDataFile
    | MorphologyLoader
    | Record<string, string>
): LemmaRef | null;
export function lemmatize(
  token: string,
  lang: string,
  morphologyIndex?:
    | MorphologyDataFile
    | MorphologyLoader
    | Record<string, string>
): string | null;
export function lemmatize(
  token: string | Token,
  lang: string,
  morphologyIndex?:
    | MorphologyDataFile
    | MorphologyLoader
    | Record<string, string>
): LemmaRef | string | null {
  const surfaceForm = isToken(token) ? token.surface : token;
  const lemmaId = resolveLemmaId(surfaceForm, lang, morphologyIndex);
  if (!lemmaId) {
    return null;
  }

  if (!isToken(token)) {
    return lemmaId;
  }

  return {
    lemmaId,
    surfaceForm: token.surface.normalize("NFC"),
    lang
  };
}
