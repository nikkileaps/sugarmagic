/**
 * packages/plugins/src/catalog/sugarlang/runtime/contracts/envelope.ts
 *
 * Purpose: Declares the coverage and envelope-verdict types owned by the deterministic classifier.
 *
 * Exports:
 *   - CoverageProfile
 *   - EnvelopeViolation
 *   - EnvelopeRuleOptions
 *   - EnvelopeVerdict
 *   - EnvelopeRule
 *
 * Relationships:
 *   - Depends on lexical-prescription types for prescription-aware exemptions.
 *   - Is consumed by the classifier, verify middleware, and telemetry stubs.
 *
 * Implements: Proposal 001 §2. Envelope Classifier
 *
 * Status: skeleton (no implementation yet; see Epic 3)
 */

import type { LexicalPrescription } from "./lexical-prescription";

export interface CoverageProfile {
  totalTokens: number;
  knownTokens: number;
  inBandTokens: number;
  unknownTokens: number;
  bandHistogram: Record<string, number>;
  outOfEnvelopeLemmas: string[];
  coverageRatio: number;
}

export interface EnvelopeViolation {
  lemmaId: string;
  surfaceForm: string;
  reason: string;
}

export interface EnvelopeRuleOptions {
  prescription?: LexicalPrescription | null;
  knownEntities?: Set<string>;
  questEssentialLemmas?: Set<string>;
}

export interface EnvelopeVerdict {
  withinEnvelope: boolean;
  profile: CoverageProfile;
  worstViolation: EnvelopeViolation | null;
  rule: string;
  violations: EnvelopeViolation[];
  exemptionsApplied: Array<"prescription-introduce" | "named-entity" | "quest-essential">;
}

export type EnvelopeRule = (
  profile: CoverageProfile,
  options: EnvelopeRuleOptions
) => boolean;
