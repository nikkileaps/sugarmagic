/**
 * packages/plugins/src/catalog/sugarlang/runtime/classifier/envelope-classifier.ts
 *
 * Purpose: Composes tokenization, lemmatization-aware coverage, and rule evaluation into one deterministic facade.
 *
 * Exports:
 *   - EnvelopeClassifierOptions
 *   - EnvelopeClassifierCheckOptions
 *   - EnvelopeClassifier
 *   - computeVoiceRetentionScore (re-exported from verify-middleware; bake code imports from here, not the middleware)
 *
 * Relationships:
 *   - Depends on learner-profile, atlas, morphology, coverage, and envelope-rule types.
 *   - Will be consumed by the verify middleware once Epic 10 lands.
 *
 * Implements: Proposal 001 §2. Envelope Classifier
 *             Plan 086 story 086.3 -- computeVoiceRetentionScore re-export
 *
 * Status: active
 */

import type {
  SceneVocabularyModel,
  EnvelopeRule,
  EnvelopeViolation,
  EnvelopeVerdict,
  LanguageRatioVerdict,
  LearnerProfile,
  LexicalAtlasProvider,
  SupportPosture
} from "../types";
import { MorphologyLoader } from "./morphology-loader";
import { CefrLexAtlasProvider } from "../providers/impls/cefr-lex-atlas-provider";
import { computeCoverage } from "./coverage";
import { applyEnvelopeRule } from "./envelope-rule";
import { compareCefrBands } from "../cefr";
import { createChunkMatcher, type ChunkMatcher } from "./chunk-matcher";
import { tokenize } from "./tokenize";
import {
  createNoOpTelemetrySink,
  createTelemetryEvent,
  emitTelemetry,
  type TelemetrySink
} from "../telemetry/telemetry";
import { computeLanguageRatioVerdict } from "./language-ratio";

/**
 * Returns [0,1]: fraction of the voice spec's markers (interjections, gesture tags)
 * present in the candidate text. Returns 1 when spec is null (neutral -- no preference).
 *
 * Copied here (not re-exported) to avoid a circular dependency:
 *   auto-simplify -> envelope-classifier -> verify-middleware -> auto-simplify
 * Bake-time code imports from this classifier facade instead of the middleware.
 *
 * Implements: Plan 086 story 086.3
 */
export function computeVoiceRetentionScore(
  text: string,
  voiceSpec: import("../types").VoiceChannelSpec | null | undefined
): number {
  if (!voiceSpec) return 1;
  let checks = 0;
  let retained = 0;
  if (voiceSpec.interjections.length > 0) {
    checks++;
    const lowerText = text.normalize("NFC").toLocaleLowerCase();
    if (voiceSpec.interjections.some((inj) => lowerText.includes(inj))) {
      retained++;
    }
  }
  if (voiceSpec.hasGestureTags) {
    checks++;
    if (/\*[^*\n]+\*/u.test(text)) retained++;
  }
  return checks === 0 ? 1 : retained / checks;
}

export interface EnvelopeClassifierOptions {
  rule?: EnvelopeRule;
  telemetry?: TelemetrySink;
}

export interface EnvelopeClassifierCheckOptions {
  /**
   * 090.10: lemma ids the TEACHER chose to introduce this situation, exempt
   * from the band ceiling because teaching them is the point. Was
   * `prescription: LexicalPrescription` -- the budgeter's shortlist -- so the
   * exemption tracked what a lexical scan had picked rather than what the
   * Teacher decided.
   */
  taughtLemmaIds?: string[] | null;
  knownEntities?: Set<string>;
  questEssentialLemmas?: Set<string>;
  /** NPC-authored interjection tokens whitelisted from envelope enforcement. See Plan 083 story 083.3. */
  voiceInterjections?: Set<string>;
  lang?: string;
  sceneLexicon?: Pick<SceneVocabularyModel, "sceneId" | "contentHash" | "chunks"> | null;
  conversationId?: string;
  turnId?: string;
  sessionId?: string;
  /** When provided, the verdict includes a language-ratio dimension. Pass from the constraint. */
  directedRatio?: number;
  supportPosture?: SupportPosture;
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

const MAX_CHUNK_MATCHER_CACHE = 32;

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
    lang: string,
    sceneLexicon: Pick<SceneVocabularyModel, "contentHash" | "chunks"> | null | undefined
  ): ChunkMatcher | null {
    if (!sceneLexicon?.chunks?.length) {
      return null;
    }

    const cacheKey = `${lang}:${sceneLexicon.contentHash}`;
    const cached = this.chunkMatcherCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Evict oldest entry when the cache is full to bound memory use.
    if (this.chunkMatcherCache.size >= MAX_CHUNK_MATCHER_CACHE) {
      const firstKey = this.chunkMatcherCache.keys().next().value;
      if (firstKey !== undefined) {
        this.chunkMatcherCache.delete(firstKey);
      }
    }

    const matcher = createChunkMatcher(sceneLexicon.chunks, lang);
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
    const chunkMatcher = this.resolveChunkMatcher(lang, options.sceneLexicon);
    const profile = computeCoverage(
      tokens,
      learner,
      this.atlas,
      options.knownEntities ?? new Set(),
      this.morphology,
      options.questEssentialLemmas ?? new Set(),
      chunkMatcher,
      options.sceneLexicon?.chunks,
      text
    );
    const ruleResult = this.rule(profile, learner.estimatedCefrBand, {
      taughtLemmaIds: options.taughtLemmaIds,
      knownEntities: options.knownEntities,
      questEssentialLemmas: options.questEssentialLemmas,
      voiceInterjections: options.voiceInterjections
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

    const languageRatioVerdict: LanguageRatioVerdict =
      options.directedRatio !== undefined && options.supportPosture !== undefined
        ? computeLanguageRatioVerdict(profile, options.directedRatio, options.supportPosture)
        : {
            measuredRatio: profile.ratioCheckTokens === 0 ? 1 : profile.resolvedTargetLanguageTokens / profile.ratioCheckTokens,
            directedRatio: 0,
            posture: "anchored",
            conformance: "skipped"
          };

    const verdict = {
      withinEnvelope: ruleResult.withinEnvelope,
      profile,
      worstViolation: violations[0] ?? null,
      rule: DEFAULT_RULE_LABEL,
      violations,
      exemptionsApplied: ruleResult.exemptionsApplied,
      languageRatioVerdict
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
