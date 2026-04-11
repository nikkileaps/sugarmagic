/**
 * packages/plugins/src/catalog/sugarlang/runtime/classifier/auto-simplify.ts
 *
 * Purpose: Applies deterministic substitution or gloss fallback to failing lemmas and re-verifies the result.
 *
 * Exports:
 *   - AutoSimplifyResult
 *   - autoSimplify
 *
 * Relationships:
 *   - Depends on the classifier, simplifications data, and atlas data.
 *   - Will be consumed by the verify middleware once Epic 10 lands.
 *
 * Implements: Proposal 001 §2. Envelope Classifier / §Verification, Failure Modes, and Guardrails
 *
 * Status: active
 */

import type { LearnerProfile, LemmaRef } from "../types";
import { CefrLexAtlasProvider } from "../providers/impls/cefr-lex-atlas-provider";
import { compareCefrBands } from "./cefr-band-utils";
import { EnvelopeClassifier } from "./envelope-classifier";
import { lemmatize } from "./lemmatize";
import { MorphologyLoader } from "./morphology-loader";
import {
  SimplificationsLoader,
  type SimplificationEntry
} from "./simplifications-loader";
import { tokenize } from "./tokenize";

export interface AutoSimplifyResult {
  text: string;
  substitutionCount: number;
  fallbackGlosses: LemmaRef[];
}

const defaultAtlas = new CefrLexAtlasProvider();
const defaultMorphology = new MorphologyLoader();
const defaultClassifier = new EnvelopeClassifier(defaultAtlas, defaultMorphology);

function resolveReplacement(
  lemmaId: string,
  lang: string,
  learner: LearnerProfile,
  simplifications: SimplificationsLoader
): { replacementText: string; usedGlossFallback: boolean } {
  const entries = simplifications.load(lang).entries[lemmaId] ?? [];

  for (const entry of entries) {
    if (entry.kind !== "lemma-substitution" || !entry.lemmaId) {
      continue;
    }

    const replacementBand = defaultAtlas.getBand(entry.lemmaId, lang);
    if (
      replacementBand &&
      compareCefrBands(replacementBand, learner.estimatedCefrBand) <= 0
    ) {
      return {
        replacementText: entry.lemmaId,
        usedGlossFallback: false
      };
    }
  }

  const glossEntry = entries.find(
    (entry): entry is SimplificationEntry & { gloss: string } =>
      entry.kind === "gloss-fallback" && typeof entry.gloss === "string"
  );
  const atlasGloss = defaultAtlas.getGloss(lemmaId, lang, "en");

  return {
    replacementText: `*${(glossEntry?.gloss ?? atlasGloss ?? lemmaId).trim()}*`,
    usedGlossFallback: true
  };
}

export function autoSimplify(
  text: string,
  violations: LemmaRef[],
  learner: LearnerProfile,
  simplifications: SimplificationsLoader = new SimplificationsLoader()
): AutoSimplifyResult {
  const lang = learner.targetLanguage;
  const replacementByLemmaId = new Map<
    string,
    { replacementText: string; usedGlossFallback: boolean }
  >();
  const fallbackGlosses = new Map<string, LemmaRef>();

  for (const violation of violations) {
    if (!replacementByLemmaId.has(violation.lemmaId)) {
      replacementByLemmaId.set(
        violation.lemmaId,
        resolveReplacement(violation.lemmaId, lang, learner, simplifications)
      );
    }
  }

  const normalizedText = text.normalize("NFC");
  const tokens = tokenize(normalizedText, lang);
  const replacements: Array<{ start: number; end: number; text: string }> = [];

  for (const token of tokens) {
    if (token.kind !== "word") {
      continue;
    }

    const lemma = lemmatize(token, lang, defaultMorphology);
    if (!lemma) {
      continue;
    }

    const replacement = replacementByLemmaId.get(lemma.lemmaId);
    if (!replacement) {
      continue;
    }

    if (replacement.usedGlossFallback) {
      fallbackGlosses.set(lemma.lemmaId, {
        lemmaId: lemma.lemmaId,
        lang
      });
    }

    replacements.push({
      start: token.start,
      end: token.end,
      text: replacement.replacementText
    });
  }

  if (replacements.length === 0) {
    return {
      text: normalizedText,
      substitutionCount: 0,
      fallbackGlosses: []
    };
  }

  let cursor = 0;
  let simplifiedText = "";
  for (const replacement of replacements) {
    simplifiedText += normalizedText.slice(cursor, replacement.start);
    simplifiedText += replacement.text;
    cursor = replacement.end;
  }
  simplifiedText += normalizedText.slice(cursor);

  const verdict = defaultClassifier.check(simplifiedText, learner, { lang });
  if (!verdict.withinEnvelope) {
    throw new Error(
      `autoSimplify invariant violated for "${lang}": result remained out of envelope with ${verdict.violations.length} violations.`
    );
  }

  return {
    text: simplifiedText,
    substitutionCount: replacements.length,
    fallbackGlosses: Array.from(fallbackGlosses.values())
  };
}
