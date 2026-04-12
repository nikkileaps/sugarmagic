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
  CompiledSceneLexicon,
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
import { createChunkMatcher, type ChunkMatcher } from "./chunk-matcher";
import { tokenize } from "./tokenize";
import {
  createNoOpTelemetrySink,
  createTelemetryEvent,
  emitTelemetry,
  type TelemetrySink
} from "../telemetry/telemetry";

export interface EnvelopeClassifierOptions {
  rule?: EnvelopeRule;
  telemetry?: TelemetrySink;
}

export interface EnvelopeClassifierCheckOptions {
  prescription?: LexicalPrescription | null;
  knownEntities?: Set<string>;
  questEssentialLemmas?: Set<string>;
  lang?: string;
  sceneLexicon?: Pick<CompiledSceneLexicon, "sceneId" | "contentHash" | "chunks"> | null;
  conversationId?: string;
  turnId?: string;
  sessionId?: string;
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
  private readonly telemetry: TelemetrySink;
  private readonly chunkMatcherCache = new Map<string, ChunkMatcher>();

  constructor(
    private readonly atlas: LexicalAtlasProvider = new CefrLexAtlasProvider(),
    private readonly morphology: MorphologyLoader = new MorphologyLoader(),
    options: EnvelopeClassifierOptions = {}
  ) {
    this.rule = options.rule ?? applyEnvelopeRule;
    this.telemetry = options.telemetry ?? createNoOpTelemetrySink();
  }

  private resolveChunkMatcher(
    text: string,
    lang: string,
    sceneLexicon: Pick<CompiledSceneLexicon, "contentHash" | "chunks"> | null | undefined
  ): ChunkMatcher | null {
    if (!sceneLexicon?.chunks?.length) {
      return null;
    }

    const cacheKey = `${lang}:${sceneLexicon.contentHash}`;
    const cached = this.chunkMatcherCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const matcher = createChunkMatcher(sceneLexicon.chunks, lang, text);
    this.chunkMatcherCache.set(cacheKey, matcher);
    return matcher;
  }

  getCachedChunkMatcherCount(): number {
    return this.chunkMatcherCache.size;
  }

  check(
    text: string,
    learner: LearnerProfile,
    options: EnvelopeClassifierCheckOptions = {}
  ): EnvelopeVerdict {
    const lang = options.lang ?? learner.targetLanguage;
    const tokens = tokenize(text, lang);
    const chunkMatcher = this.resolveChunkMatcher(text, lang, options.sceneLexicon);
    const profile = computeCoverage(
      tokens,
      learner,
      this.atlas,
      options.knownEntities ?? new Set(),
      this.morphology,
      options.questEssentialLemmas ?? new Set(),
      chunkMatcher,
      options.sceneLexicon?.chunks
    );
    const ruleResult = this.rule(profile, learner.estimatedCefrBand, {
      prescription: options.prescription,
      knownEntities: options.knownEntities,
      questEssentialLemmas: options.questEssentialLemmas
    });

    const violations = ruleResult.violations
      .map<EnvelopeViolation>((lemmaRef) => {
        const matchedChunk = profile.matchedChunkTokens.find(
          (entry) => entry.normalizedForm === lemmaRef.lemmaId
        );
        const cefrBand =
          matchedChunk?.cefrBand ??
          this.atlas.getBand(lemmaRef.lemmaId, lemmaRef.lang) ??
          "unknown";

        return {
          lemmaRef,
          surfaceForm: lemmaRef.surfaceForm ?? lemmaRef.lemmaId,
          cefrBand,
          reason: createViolationReason(learner, lemmaRef.lemmaId, lang, cefrBand)
        };
      })
      .sort(compareViolationSeverity);

    const verdict = {
      withinEnvelope: ruleResult.withinEnvelope,
      profile,
      worstViolation: violations[0] ?? null,
      rule: DEFAULT_RULE_LABEL,
      violations,
      exemptionsApplied: ruleResult.exemptionsApplied
    };

    if (
      options.sceneLexicon?.sceneId &&
      profile.matchedChunkTokens.length > 0 &&
      options.conversationId &&
      options.turnId
    ) {
      void emitTelemetry(
        this.telemetry,
        createTelemetryEvent("chunk.hit-during-classification", {
          conversationId: options.conversationId,
          sessionId: options.sessionId,
          turnId: options.turnId,
          timestamp: Date.now(),
          sceneId: options.sceneLexicon.sceneId,
          matchedChunks: profile.matchedChunkTokens.map((match) => ({
            chunkId: match.chunkId,
            cefrBand: match.cefrBand,
            surfaceMatched: match.surfaceMatched
          }))
        })
      );
    }

    return verdict;
  }
}
