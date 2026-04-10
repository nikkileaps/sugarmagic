/**
 * packages/plugins/src/catalog/sugarlang/runtime/classifier/lemmatize.ts
 *
 * Purpose: Reserves the surface-form to lemma lookup used by the deterministic classifier.
 *
 * Exports:
 *   - lemmatize
 *
 * Relationships:
 *   - Will be consumed by coverage computation after tokenization.
 *   - Will eventually read morphology indexes from plugin data assets.
 *
 * Implements: Proposal 001 §2. Envelope Classifier
 *
 * Status: active
 */

import {
  lemmatizeWithMorphology,
  type MorphologyDataFile
} from "./morphology-loader";

function isMorphologyDataFile(
  morphologyIndex: MorphologyDataFile | Record<string, string>
): morphologyIndex is MorphologyDataFile {
  return "forms" in morphologyIndex;
}

export function lemmatize(
  token: string,
  lang: string,
  morphologyIndex?: MorphologyDataFile | Record<string, string>
): string | null {
  if (morphologyIndex && isMorphologyDataFile(morphologyIndex)) {
    return morphologyIndex.forms[token.trim().toLowerCase()]?.lemmaId ?? null;
  }
  if (morphologyIndex) {
    return morphologyIndex[token.trim().toLowerCase()] ?? null;
  }

  return lemmatizeWithMorphology(token, lang);
}
