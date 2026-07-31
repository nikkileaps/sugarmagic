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

import type { CEFRBand } from "../cefr";
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
/**
 * 090.4 ADDED `over-ratio`, AND ITS ABSENCE WAS A REAL BUG.
 *
 * The type had only `under-ratio`, so "far too much target language" was not an
 * expressible verdict -- anything at or above the floor was `conformant`,
 * including a reply that was 90% Spanish against a directed 0.3.
 *
 * That made sense when it was written: the failure everyone was chasing was
 * English-only output, so the verifier was built to catch too LITTLE. Observed
 * in play: an A1 learner got a full-Spanish, multi-clause explanation of
 * seasonal cheese, and nothing could even name what was wrong with it.
 *
 * The overshoot is not random. Two structural causes, both in the generator
 * prompt rather than here -- the conversation few-shots itself off its own
 * unannotated history, and a proportion ("30%") is enforced alongside a count
 * ("use these four words"), which only agree at one reply length. See
 * docs/backlog/009-target-language-ratio-drift.md. This ceiling stops the
 * runaway; it does not remove the ratchet.
 *
 * A one-sided check on a two-sided quantity is worth suspecting on sight.
 */
export type RatioConformance =
  | "conformant"
  | "under-ratio"
  | "over-ratio"
  | "skipped";

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
  /**
   * 090.10: lemma ids the TEACHER chose to introduce, exempt from the band
   * ceiling because teaching them is the point. Was
   * `prescription: LexicalPrescription` -- the budgeter's shortlist -- which
   * made the exemption track a lexical scan's picks rather than a decision.
   */
  taughtLemmaIds?: string[] | null;
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
