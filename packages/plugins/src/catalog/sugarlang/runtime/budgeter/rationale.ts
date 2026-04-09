/**
 * packages/plugins/src/catalog/sugarlang/runtime/budgeter/rationale.ts
 *
 * Purpose: Reserves the lexical rationale builder used for debugging and telemetry.
 *
 * Exports:
 *   - buildLexicalRationale
 *
 * Relationships:
 *   - Depends on lexical-prescription contract types.
 *   - Will be consumed by the Budgeter and telemetry systems in Epic 8 and Epic 13.
 *
 * Implements: Proposal 001 §1. Lexical Budgeter / §Verification and Acceptance
 *
 * Status: skeleton (no implementation yet; see Epic 8)
 */

import type {
  LexicalPrescriptionInput,
  LexicalRationale
} from "../types";

export function buildLexicalRationale(
  _input: LexicalPrescriptionInput,
  _priorityScores: Record<string, number>
): LexicalRationale {
  throw new Error("TODO: Epic 8");
}
