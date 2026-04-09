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
 * Status: skeleton (no implementation yet; see Epic 5)
 */

export function lemmatize(
  _token: string,
  _lang: string,
  _morphologyIndex: Record<string, string>
): string | null {
  throw new Error("TODO: Epic 5");
}
