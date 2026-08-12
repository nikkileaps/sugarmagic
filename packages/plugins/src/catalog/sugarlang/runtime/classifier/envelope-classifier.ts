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
import { requireSugarlangTargetLanguage } from "../target-language-save-participant";

/**
 * Returns [0,1]: fraction of the voice spec's markers (interjections, gesture tags)
 * present in the candidate text. Returns 1 when spec is null (neutral -- no preference).
 *
 * Copied here (not re-exported) to avoid a circular dependency:
 *   envelope-classifier -> verify-middleware
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
  /**
   * Inventory exponent surfaces (competency phrases like "me gusta"), matched
   * as spans alongside the scene chunks. The scene lexicon holds only AUTHORED
   * text; a competency exponent in a dynamic NPC line is invisible without
   * these -- the chunk-matcher-uses-inventory lesson, applied here.
   */
  inventoryExponents?: readonly InventoryExponentLike[];
  /** English-collision surfaces (english-collisions.ts). See computeCoverage. */
  englishCollisions?: Set<string>;
  /** Single-word surfaces known target-language now: slated words' forms forms. */
  recognizedTargetSurfaces?: Set<string>;
}

/** The shape the chunk matcher needs; both LexicalChunk and Exponent satisfy it. */
export interface InventoryExponentLike {
  normalizedForm: string;
  surfaceForms: string[];
  cefrBand: import("../cefr").CEFRBand;
  constituentLemmas: string[];
}

const DEFAULT_RULE_LABEL =
  "nonExemptCeilingExceeded===0 && nonExemptOutOfEnvelope<=2 (coverage floor is metric-only)";

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
    sceneLexicon: Pick<SceneVocabularyModel, "contentHash" | "chunks"> | null | undefined,
    inventoryExponents?: readonly InventoryExponentLike[]
  ): ChunkMatcher | null {
    const sceneChunks = sceneLexicon?.chunks ?? [];
    const exponents = inventoryExponents ?? [];
    if (sceneChunks.length === 0 && exponents.length === 0) {
      return null;
    }

    // The inventory is static per language; the scene varies by contentHash.
    // Both legs are in the key so a scene without exponents and a scene with
    // them never share a matcher.
    const cacheKey = `${lang}:${sceneLexicon?.contentHash ?? "-"}:inv${exponents.length}`;
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

    const matcher = createChunkMatcher([...sceneChunks, ...exponents], lang);
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
    const lang = options.lang ?? requireSugarlangTargetLanguage();
    const tokens = tokenize(text, lang);
    const chunkMatcher = this.resolveChunkMatcher(
      lang,
      options.sceneLexicon,
      options.inventoryExponents
    );
    const profile = computeCoverage(
      tokens,
      learner,
      this.atlas,
      options.knownEntities ?? new Set(),
      this.morphology,
      options.questEssentialLemmas ?? new Set(),
      chunkMatcher,
      options.sceneLexicon?.chunks,
      text,
      options.englishCollisions,
      options.recognizedTargetSurfaces,
      // THE SAME LANGUAGE THE TOKENS WERE READ IN. Leaving this to the default
      // let a caller's `options.lang` steer tokenizing and chunk matching while
      // lemmatization and the band lookup used the game's language instead --
      // one turn read in two languages, which is the wrong half of the atlas.
      // A verify turn legitimately carries its own language
      // (sugar-lang-verify-middleware passes `constraint.targetLanguage`), so
      // the two can differ.
      lang
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
            normalizedForm: match.normalizedForm,
            cefrBand: match.cefrBand,
            surfaceMatched: match.surfaceMatched
          }))
        })
      );
    }

    return verdict;
  }
}
