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
 *             Plan 086 story 086.2 (mixed-text predicate for anchored/supported postures)
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
  const taughtLemmaIds = normalizeLookup(options.taughtLemmaIds ?? []);
  const knownEntities = normalizeLookup(options.knownEntities ?? []);
  const questEssentialLemmas = normalizeLookup(options.questEssentialLemmas ?? []);
  const voiceInterjections = normalizeLookup(options.voiceInterjections ?? []);
  const matchedChunk = profile.matchedChunkTokens.find(
    (entry) =>
      entry.normalizedForm.normalize("NFC").toLocaleLowerCase() === normalizedLemmaId
  );

  if (
    taughtLemmaIds.has(normalizedLemmaId) ||
    matchedChunk?.constituentLemmaIds.some((lemmaId) =>
      taughtLemmaIds.has(lemmaId.normalize("NFC").toLocaleLowerCase())
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
  if (
    voiceInterjections.has(normalizedLemmaId) ||
    (normalizedSurfaceForm && voiceInterjections.has(normalizedSurfaceForm))
  ) {
    return "voice-interjection";
  }

  return null;
}

/**
 * Applies the deterministic envelope rule (Proposal 001, amended by
 * sugarmagic-latency-7gp 2026-08-06):
 * - non-exempt lemmas may not exceed learnerBand + 1
 * - at most two non-exempt out-of-band lemmas are tolerated
 *
 * THE 95% COVERAGE FLOOR NO LONGER GATES. Its arithmetic cannot work on a
 * deliberately mixed line -- every posture except target-only directs an
 * English remainder that lands in unknownTokens -- so in live play it fired on
 * every turn and paid for a 5-12s repair each time, essentially always
 * wrongly. `coverageRatio` is still computed and recorded as an instrument
 * (the floorFailed timeline fact); nothing enforces it. Nothing in this
 * codebase asks "can the learner comprehend this line" as a GATE any more --
 * that judgment moves to the Judge (latency epic, judge story).
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
    nonExemptCeilingExceeded.length === 0 &&
    violations.length <= ENVELOPE_OUT_OF_ENVELOPE_ALLOWANCE;

  return {
    withinEnvelope,
    violations,
    exemptionsApplied
  };
}
