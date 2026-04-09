/**
 * packages/plugins/src/catalog/sugarlang/runtime/classifier/auto-simplify.ts
 *
 * Purpose: Reserves the deterministic auto-simplify fallback used after failed repair.
 *
 * Exports:
 *   - autoSimplify
 *
 * Relationships:
 *   - Depends on the envelope violation type.
 *   - Will be consumed by the verify middleware once Epic 5 lands.
 *
 * Implements: Proposal 001 §2. Envelope Classifier / §Verification, Failure Modes, and Guardrails
 *
 * Status: skeleton (no implementation yet; see Epic 5)
 */

import type { EnvelopeViolation } from "../types";

export function autoSimplify(
  _text: string,
  _violations: EnvelopeViolation[],
  _lang: string
): string {
  throw new Error("TODO: Epic 5");
}
