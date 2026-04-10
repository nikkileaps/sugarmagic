/**
 * packages/plugins/src/catalog/sugarlang/runtime/classifier/envelope-classifier.ts
 *
 * Purpose: Composes tokenization, lemmatization-aware coverage, and rule evaluation into one deterministic facade.
 *
 * Exports:
 *   - EnvelopeClassifierOptions
 *   - EnvelopeClassifierCheckOptions
 *   - EnvelopeClassifier
 *
 * Relationships:
 *   - Depends on learner-profile, atlas, morphology, coverage, and envelope-rule types.
 *   - Will be consumed by the verify middleware once Epic 10 lands.
 *
 * Implements: Proposal 001 §2. Envelope Classifier
 *
 * Status: active
 */

import type {
  EnvelopeRule,
  EnvelopeViolation,
  EnvelopeVerdict,
  LearnerProfile,
  LexicalAtlasProvider,
  LexicalPrescription
} from "../types";
import { MorphologyLoader } from "./morphology-loader";
import { CefrLexAtlasProvider } from "../providers/impls/cefr-lex-atlas-provider";
import { computeCoverage } from "./coverage";
import { applyEnvelopeRule } from "./envelope-rule";
import { compareCefrBands } from "./cefr-band-utils";
import { tokenize } from "./tokenize";

export interface EnvelopeClassifierOptions {
  rule?: EnvelopeRule;
}

export interface EnvelopeClassifierCheckOptions {
  prescription?: LexicalPrescription | null;
  knownEntities?: Set<string>;
  questEssentialLemmas?: Set<string>;
  lang?: string;
}

const DEFAULT_RULE_LABEL =
  "coverage>=0.95 && nonExemptCeilingExceeded===0 && nonExemptOutOfEnvelope<=2";

function compareViolationSeverity(
  left: EnvelopeViolation,
  right: EnvelopeViolation
): number {
  if (left.cefrBand === "unknown" && right.cefrBand === "unknown") {
    return left.lemmaRef.lemmaId.localeCompare(right.lemmaRef.lemmaId);
  }
  if (left.cefrBand === "unknown") {
    return 1;
  }
  if (right.cefrBand === "unknown") {
    return -1;
  }

  const bandDifference = compareCefrBands(right.cefrBand, left.cefrBand);
  if (bandDifference !== 0) {
    return bandDifference;
  }

  return left.lemmaRef.lemmaId.localeCompare(right.lemmaRef.lemmaId);
}

function createViolationReason(
  learner: LearnerProfile,
  lemmaId: string,
  lang: string,
  band: EnvelopeViolation["cefrBand"]
): string {
  if (band === "unknown") {
    return `Lemma "${lemmaId}" is outside the learner envelope for ${lang}.`;
  }

  if (compareCefrBands(band, learner.estimatedCefrBand) > 1) {
    return `Lemma "${lemmaId}" exceeds the ${learner.estimatedCefrBand}+1 ceiling.`;
  }

  return `Lemma "${lemmaId}" is above learner band ${learner.estimatedCefrBand}.`;
}

export class EnvelopeClassifier {
  private readonly rule: EnvelopeRule;

  constructor(
    private readonly atlas: LexicalAtlasProvider = new CefrLexAtlasProvider(),
    private readonly morphology: MorphologyLoader = new MorphologyLoader(),
    options: EnvelopeClassifierOptions = {}
  ) {
    this.rule = options.rule ?? applyEnvelopeRule;
  }

  check(
    text: string,
    learner: LearnerProfile,
    options: EnvelopeClassifierCheckOptions = {}
  ): EnvelopeVerdict {
    const lang = options.lang ?? learner.targetLanguage;
    const tokens = tokenize(text, lang);
    const profile = computeCoverage(
      tokens,
      learner,
      this.atlas,
      options.knownEntities ?? new Set(),
      this.morphology,
      options.questEssentialLemmas ?? new Set()
    );
    const ruleResult = this.rule(profile, learner.estimatedCefrBand, {
      prescription: options.prescription,
      knownEntities: options.knownEntities,
      questEssentialLemmas: options.questEssentialLemmas
    });

    const violations = ruleResult.violations
      .map<EnvelopeViolation>((lemmaRef) => {
        const cefrBand = this.atlas.getBand(lemmaRef.lemmaId, lemmaRef.lang) ?? "unknown";

        return {
          lemmaRef,
          surfaceForm: lemmaRef.surfaceForm ?? lemmaRef.lemmaId,
          cefrBand,
          reason: createViolationReason(learner, lemmaRef.lemmaId, lang, cefrBand)
        };
      })
      .sort(compareViolationSeverity);

    return {
      withinEnvelope: ruleResult.withinEnvelope,
      profile,
      worstViolation: violations[0] ?? null,
      rule: DEFAULT_RULE_LABEL,
      violations,
      exemptionsApplied: ruleResult.exemptionsApplied
    };
  }
}
