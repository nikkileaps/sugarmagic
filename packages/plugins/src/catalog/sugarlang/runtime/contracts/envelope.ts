/**
 * packages/plugins/src/catalog/sugarlang/runtime/contracts/envelope.ts
 *
 * Purpose: Declares the coverage and envelope-verdict types owned by the deterministic classifier.
 *
 * Exports:
 *   - CoverageProfile
 *   - RatioConformance
 *   - LanguageRatioVerdict
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
import type { ChunkSpec } from "../classifier/chunk-matcher";
import type { SupportPosture } from "./pedagogy";

/**
 * Virtual token emitted by the chunk-scan pre-pass before lemma coverage runs.
 *
 * Implements: Proposal 001 §Lexical Chunk Awareness
 */
export interface VirtualChunkToken {
  chunkId: string;
  normalizedForm: string;
  surfaceMatched: string;
  start: number;
  end: number;
  cefrBand: CEFRBand;
  constituentLemmaIds: string[];
}

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
  matchedChunks: ChunkSpec[];
  matchedChunkTokens: VirtualChunkToken[];
  coverageRatio: number;
  /** Word tokens included in the language-ratio denominator (excludes numbers and known entities). */
  ratioCheckTokens: number;
  /** Word tokens that resolved through target-language lemmatization + atlas (numerator for ratio). */
  resolvedTargetLanguageTokens: number;
}

/**
 * Whether measured target-language ratio meets the directed target.
 * "skipped" means the denominator was below the minimum-denominator guard.
 */
export type RatioConformance = "conformant" | "under-ratio" | "skipped";

/**
 * Per-turn verdict on whether the output meets the directed language ratio.
 * Computed deterministically alongside the envelope verdict; zero model calls.
 */
export interface LanguageRatioVerdict {
  measuredRatio: number;
  directedRatio: number;
  posture: SupportPosture;
  conformance: RatioConformance;
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
  | "quest-essential"
  | "voice-interjection";

/**
 * Options passed to the deterministic envelope rule.
 *
 * Implements: Proposal 001 §2. Envelope Classifier / §Quest-Essential Lemma Exemption
 */
export interface EnvelopeRuleOptions {
  prescription?: LexicalPrescription | null;
  knownEntities?: Set<string>;
  questEssentialLemmas?: Set<string>;
  /** NPC-authored interjection tokens whitelisted from envelope enforcement. See Plan 083 story 083.3. */
  voiceInterjections?: Set<string>;
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
  /** Language-ratio verdict; always present. "skipped" when denominator is below the minimum guard. */
  languageRatioVerdict: LanguageRatioVerdict;
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
