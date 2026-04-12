/**
 * packages/plugins/src/catalog/sugarlang/runtime/classifier/envelope-rule.ts
 *
 * Purpose: Applies the deterministic coverage and CEFR ceiling rule to a coverage profile.
 *
 * Exports:
 *   - ENVELOPE_KRASHEN_FLOOR
 *   - ENVELOPE_OUT_OF_ENVELOPE_ALLOWANCE
 *   - applyEnvelopeRule
 *
 * Relationships:
 *   - Depends on the envelope contract types.
 *   - Is consumed by EnvelopeClassifier once token coverage has been computed.
 *
 * Implements: Proposal 001 §2. Envelope Classifier / §Quest-Essential Lemma Exemption
 *
 * Status: active
 */

import type {
  CEFRBand,
  CoverageProfile,
  EnvelopeExemptionKind,
  EnvelopeRuleOptions,
  EnvelopeRuleResult,
  LemmaRef
} from "../types";

/**
 * The 95% comprehension floor follows Nation (2001) and the proposal's
 * deterministic realization of Krashen-style comprehensible input.
 */
export const ENVELOPE_KRASHEN_FLOOR = 0.95;

/**
 * Proposal 001 allows up to two non-exempt out-of-band lemmas before repair.
 */
export const ENVELOPE_OUT_OF_ENVELOPE_ALLOWANCE = 2;

function normalizeLookup(values: Iterable<string>): Set<string> {
  const normalized = new Set<string>();
  for (const value of values) {
    normalized.add(value.normalize("NFC").toLocaleLowerCase());
  }

  return normalized;
}

function resolveExemption(
  lemma: LemmaRef,
  profile: CoverageProfile,
  options: EnvelopeRuleOptions
): EnvelopeExemptionKind | null {
  const normalizedLemmaId = lemma.lemmaId.normalize("NFC").toLocaleLowerCase();
  const normalizedSurfaceForm = lemma.surfaceForm
    ?.normalize("NFC")
    .toLocaleLowerCase();
  const prescriptionIntroduce = normalizeLookup(
    options.prescription?.introduce.map((entry) => entry.lemmaId) ?? []
  );
  const knownEntities = normalizeLookup(options.knownEntities ?? []);
  const questEssentialLemmas = normalizeLookup(options.questEssentialLemmas ?? []);
  const matchedChunk = profile.matchedChunkTokens.find(
    (entry) =>
      entry.normalizedForm.normalize("NFC").toLocaleLowerCase() === normalizedLemmaId
  );

  if (
    prescriptionIntroduce.has(normalizedLemmaId) ||
    matchedChunk?.constituentLemmaIds.some((lemmaId) =>
      prescriptionIntroduce.has(lemmaId.normalize("NFC").toLocaleLowerCase())
    )
  ) {
    return "prescription-introduce";
  }
  if (
    knownEntities.has(normalizedLemmaId) ||
    (normalizedSurfaceForm && knownEntities.has(normalizedSurfaceForm))
  ) {
    return "named-entity";
  }
  if (questEssentialLemmas.has(normalizedLemmaId)) {
    return "quest-essential";
  }

  return null;
}

/**
 * Applies Proposal 001's deterministic envelope rule:
 * - coverage must remain at or above 95%
 * - non-exempt lemmas may not exceed learnerBand + 1
 * - at most two non-exempt out-of-band lemmas are tolerated
 *
 * The quest-essential exemption is the Linguistic Deadlock fix added in
 * Proposal 001 §Quest-Essential Lemma Exemption.
 */
export function applyEnvelopeRule(
  profile: CoverageProfile,
  learnerBand: CEFRBand,
  options: EnvelopeRuleOptions = {}
): EnvelopeRuleResult {
  const exemptedLemmaIds = new Set<string>();
  const exemptionsApplied: EnvelopeExemptionKind[] = [];
  const violations: LemmaRef[] = [];

  for (const lemma of profile.outOfEnvelopeLemmas) {
    const exemption = resolveExemption(lemma, profile, options);
    if (exemption) {
      exemptedLemmaIds.add(lemma.lemmaId);
      exemptionsApplied.push(exemption);
      continue;
    }

    violations.push(lemma);
  }

  const nonExemptCeilingExceeded = profile.ceilingExceededLemmas.filter(
    (lemma) =>
      !exemptedLemmaIds.has(lemma.lemmaId) &&
      resolveExemption(lemma, profile, options) === null
  );

  const withinEnvelope =
    profile.coverageRatio >= ENVELOPE_KRASHEN_FLOOR &&
    nonExemptCeilingExceeded.length === 0 &&
    violations.length <= ENVELOPE_OUT_OF_ENVELOPE_ALLOWANCE;

  return {
    withinEnvelope,
    violations,
    exemptionsApplied
  };
}
