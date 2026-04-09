/**
 * packages/plugins/src/catalog/sugarlang/runtime/classifier/tokenize.ts
 *
 * Purpose: Reserves the tokenizer used by the deterministic Envelope Classifier.
 *
 * Exports:
 *   - tokenize
 *
 * Relationships:
 *   - Will be consumed by coverage computation in the classifier pipeline.
 *   - Will eventually sit ahead of lemmatization and chunk-aware scanning.
 *
 * Implements: Proposal 001 §2. Envelope Classifier
 *
 * Status: skeleton (no implementation yet; see Epic 5)
 */

export function tokenize(_text: string, _lang: string): string[] {
  throw new Error("TODO: Epic 5");
}
