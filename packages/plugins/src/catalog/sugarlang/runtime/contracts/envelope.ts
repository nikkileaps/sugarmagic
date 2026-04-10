/**
 * packages/plugins/src/catalog/sugarlang/runtime/contracts/envelope.ts
 *
 * Purpose: Declares the coverage and envelope-verdict types owned by the deterministic classifier.
 *
 * Exports:
 *   - CoverageProfile
 *   - EnvelopeViolation
 *   - EnvelopeExemptionKind
 *   - EnvelopeRuleOptions
 *   - EnvelopeRuleResult
 *   - EnvelopeVerdict
 *   - EnvelopeRule
 *
 * Relationships:
 *   - Depends on lexical-prescription types for prescription-aware exemptions.
 *   - Is consumed by the classifier, verify middleware, and telemetry stubs.
 *
 * Implements: Proposal 001 §2. Envelope Classifier
 *
 * Status: active
 */

import type { CEFRBand } from "./learner-profile";
import type { LemmaRef, LexicalPrescription } from "./lexical-prescription";

/**
 * Per-turn coverage statistics computed over a generated line.
 *
 * Implements: Proposal 001 §2. Envelope Classifier
 */
export interface CoverageProfile {
  totalTokens: number;
  knownTokens: number;
  inBandTokens: number;
  unknownTokens: number;
  bandHistogram: Record<CEFRBand, number>;
  outOfEnvelopeLemmas: LemmaRef[];
  ceilingExceededLemmas: LemmaRef[];
  questEssentialLemmasMatched: string[];
  coverageRatio: number;
}

/**
 * Per-lemma detail about why a generated line violated the learner envelope.
 *
 * Implements: Proposal 001 §2. Envelope Classifier
 */
export interface EnvelopeViolation {
  lemmaRef: LemmaRef;
  surfaceForm: string;
  cefrBand: CEFRBand | "unknown";
  reason: string;
}

/**
 * Canonical exemption channels the envelope rule may apply to an offending lemma.
 *
 * Implements: Proposal 001 §Quest-Essential Lemma Exemption
 */
export type EnvelopeExemptionKind =
  | "prescription-introduce"
  | "named-entity"
  | "quest-essential";

/**
 * Options passed to the deterministic envelope rule.
 *
 * Implements: Proposal 001 §2. Envelope Classifier / §Quest-Essential Lemma Exemption
 */
export interface EnvelopeRuleOptions {
  prescription?: LexicalPrescription | null;
  knownEntities?: Set<string>;
  questEssentialLemmas?: Set<string>;
}

/**
 * Deterministic result returned by the envelope rule before facade formatting.
 *
 * Implements: Proposal 001 §2. Envelope Classifier
 */
export interface EnvelopeRuleResult {
  withinEnvelope: boolean;
  violations: LemmaRef[];
  exemptionsApplied: EnvelopeExemptionKind[];
}

/**
 * Final classifier verdict for a generated line.
 *
 * Implements: Proposal 001 §2. Envelope Classifier
 */
export interface EnvelopeVerdict {
  withinEnvelope: boolean;
  profile: CoverageProfile;
  worstViolation: EnvelopeViolation | null;
  rule: string;
  violations: EnvelopeViolation[];
  exemptionsApplied: EnvelopeExemptionKind[];
}

/**
 * Deterministic envelope rule contract.
 *
 * Implements: Proposal 001 §2. Envelope Classifier
 */
export type EnvelopeRule = (
  profile: CoverageProfile,
  learnerBand: CEFRBand,
  options: EnvelopeRuleOptions
) => EnvelopeRuleResult;
