/**
 * packages/plugins/src/catalog/sugarlang/runtime/grading/graded-text-service.ts
 *
 * Purpose: Turn authored source-language text into target-language text pitched
 * at a CEFR band, and verify the result.
 *
 * Exports:
 *   - GRADED_TEXT_PROMPT_VERSION
 *   - VOICE_RETENTION_PASS_THRESHOLD
 *   - GradedTextService
 *   - GradedTextRequest / GradedTextGuidance / GradedTextResult
 *
 * Relationships:
 *   - Depends on the LLM client seam, the lexical atlas, and the classifier
 *     facade (envelope predicate, language ratio, voice retention).
 *   - Knows NOTHING about dialogue, items, quests, or any other content shape.
 *     Callers own identity, caching, and persistence.
 *
 * Implements: Epic 086 Story 086.3 (extracted from `generate-variant.ts` 2026-07-28)
 *
 * Status: active
 *
 * ---------------------------------------------------------------------------
 * WHAT "GRADED" MEANS
 *
 * In language pedagogy a GRADED text is one rewritten to sit at a specific
 * proficiency level -- the idea behind graded readers. Grading is not
 * translation: the same English sentence graded to A1 and to B2 yields two
 * genuinely different Spanish texts, differing in vocabulary range, clause
 * complexity, and how much English is left standing. The band is an input to
 * the writing, not a filter applied afterwards.
 *
 * ADAPTATION, not translation, is therefore the job: preserve what the text
 * has to communicate, re-express it within the reach of a learner at `band`.
 *
 * WHAT THIS DOES
 *
 * One call: prompt an LLM to adapt `sourceText` into `targetLang` at `band`,
 * then run the result through four verifiers, returning the text AND the
 * per-gate verdict so the caller can decide whether to trust it:
 *
 *   1. envelope   -- does the mix of known/unknown vocabulary sit inside the
 *                    band's allowance and ceiling?
 *   2. ratio      -- is the share of target language what the posture directed?
 *   3. voice      -- was the authored voice retained? (no-op without a voice
 *                    spec; see the note in `adapt`)
 *   4. fidelity   -- does the output still convey every must-convey fact?
 *                    LLM-judged, and skipped when the caller supplies none.
 *
 * WHAT THIS DOES NOT DO
 *
 *   - It does not know what the text IS. No node ids, no definition ids, no
 *     graph. Identity is the caller's, because identity is what differs
 *     between a dialogue line and an item description while the grading work
 *     is identical.
 *   - It does not cache, hash, or persist. `VariantCacheKey` and content
 *     hashing live with the callers that own the content.
 *   - It does not decide WHETHER to grade, or at which bands. That is
 *     scheduling.
 *   - It does not gloss, weave, or annotate. Those are runtime concerns.
 *
 * WHY IT EXISTS
 *
 * This logic used to live inside `generateVariant`, whose signature took
 * `dialogueDefinitionId` and `nodeId` -- two fields no line of its logic ever
 * read; they were stamped onto the output object and nothing else. Meanwhile
 * the things that genuinely vary by caller (posture, directed ratio, token
 * budget, and the register the prompt writes in) were hardcoded constants in
 * the function body. The contract was inside out: caller identity in the
 * signature, caller-varying knobs baked in.
 *
 * That made the module unusable for anything but dialogue, which surfaced the
 * moment item Examine text needed the same treatment. Extracting it is what
 * makes "the model RENDERS" a real, single implementation rather than a
 * dialogue-shaped one.
 *
 * PATTERNS USED
 *
 *   - Dependency injection via the constructor (llm client, atlas, inventory
 *     chunks, morphology). Every collaborator is swappable, so tests drive it
 *     with a mocked client and no network.
 *   - Prompt/parse split: `buildAdaptationPrompt` and `buildFidelityPrompt` are
 *     pure and exported-adjacent, so prompt changes are reviewable as data and
 *     can be snapshot-tested without a model call.
 *   - Schema validation at the boundary (Ajv) for the fidelity judge's JSON.
 *     Anything the model returns is untrusted until it validates.
 *   - Fail-soft, conservative: a generation failure returns `text: null` plus a
 *     failure message rather than throwing, and a fidelity check that errors
 *     FAILS the gate rather than passing it. A bad adaptation reaching a
 *     learner is worse than a missing one.
 *
 * USAGE
 *
 *   const adapter = new GradedTextService({ llmClient, atlas, inventoryChunks });
 *   const result = await adapter.adapt({
 *     sourceText: "The stationmaster is looking for his luggage.",
 *     targetLang: "es",
 *     band: "A2",
 *     guidance: { register: "item description" },
 *     mustConveyFacts: ["the luggage is missing"]
 *   });
 *   if (result.verdict?.overallPasses) use(result.text);
 *
 * NAMING NOTE
 *
 * Named for the job, not the lifecycle. It was nearly "Baker", but baking
 * describes WHEN it runs (ahead of time) rather than WHAT it does, and this
 * codebase already uses "bake" narrowly for scripted variant precomputation --
 * overloading it further would blur the one term that still means something.
 * "Adapter" is the language-teaching verb for level-appropriate rewriting; it
 * is deliberately not "Renderer", since every `*Renderer` in this repo is a GPU
 * object.
 */

import Ajv from "ajv";
import type { CEFRBand, LearnerId } from "../contracts/learner-profile";
import type { VariantVerdict } from "../contracts/baked-variant";
import type { SupportPosture } from "../contracts/pedagogy";
import type { SugarlangLLMClient } from "../llm/types";
import type { LexicalAtlasProvider } from "../types";
import type { InventoryChunk } from "../contracts/function-inventory";
import { applyMixedTextEnvelopePredicate } from "../classifier/envelope-rule";
import { computeLanguageRatioVerdict } from "../classifier/language-ratio";
import { computeVoiceRetentionScore } from "../classifier/envelope-classifier";
import { computeCoverage } from "../classifier/coverage";
import { tokenize } from "../classifier/tokenize";
import { createChunkMatcher } from "../classifier/chunk-matcher";
import { MorphologyLoader } from "../classifier/morphology-loader";

/**
 * Bumped to 086.3.1 when the prompt stopped saying "dialogue line" and started
 * taking the register from the caller. This string is a leg of the variant
 * cache key, so every previously baked variant re-grades on the next run --
 * intended, and cheap at current content volume.
 */
export const GRADED_TEXT_PROMPT_VERSION = "086.3.1";

/** Minimum voice-retention score for the voice gate to pass. */
export const VOICE_RETENTION_PASS_THRESHOLD = 0.5;

/** Verifier defaults, carried over from the 086 dialogue calibration. */
const DEFAULT_POSTURE: SupportPosture = "target-dominant";
const DEFAULT_DIRECTED_RATIO = 0.8;
const DEFAULT_MAX_TOKENS = 300;

/** Process-wide default so morphology data is validated and parsed once. */
const SHARED_MORPHOLOGY = new MorphologyLoader();

const ajv = new Ajv({ allErrors: true, strict: false });

const FIDELITY_SCHEMA = {
  type: "object",
  required: ["passes", "reasoning"],
  properties: {
    passes: { type: "boolean" },
    reasoning: { type: "string" }
  }
} as const;

const validateFidelityPayload = ajv.compile(FIDELITY_SCHEMA);

const BAND_DESCRIPTIONS: Record<CEFRBand, string> = {
  A1: "beginner (A1)",
  A2: "elementary (A2)",
  B1: "intermediate (B1)",
  B2: "upper-intermediate (B2)",
  C1: "advanced (C1)",
  C2: "proficient (C2)"
};

/**
 * Caller-supplied writing guidance. `register` is the one field that meaningfully
 * changes the model's output shape: a dialogue line and a paragraph of item prose
 * want different sentence rhythm, and the adapter cannot infer which it has.
 */
export interface GradedTextGuidance {
  /** What this text IS, e.g. "dialogue line", "item description". */
  register: string;
  /** Extra prompt lines -- dramatic beat, voice note, tone. */
  notes?: string[];
}

export interface GradedTextRequest {
  /** Authored source-language text. English today. */
  sourceText: string;
  targetLang: string;
  band: CEFRBand;
  /**
   * Facts the adaptation must preserve. An empty/absent list SKIPS the fidelity
   * gate (there is nothing to check), which is why it auto-passes rather than
   * auto-fails.
   */
  mustConveyFacts?: string[];
  guidance?: GradedTextGuidance;
  /** Verifier knobs. Omit for the dialogue-calibrated defaults. */
  posture?: SupportPosture;
  directedRatio?: number;
  maxTokens?: number;
}

export interface GradedTextResult {
  /** null when generation failed; see `failure`. */
  text: string | null;
  /** null when generation failed before any gate could run. */
  verdict: VariantVerdict | null;
  generatedByModel: string;
  promptVersion: string;
  failure?: { message: string };
}

export interface GradedTextServiceDeps {
  llmClient: SugarlangLLMClient;
  atlas: LexicalAtlasProvider;
  inventoryChunks: InventoryChunk[];
  morphology?: MorphologyLoader;
}

/** Pure prompt construction -- no model call, so it is snapshot-testable. */
export function buildAdaptationPrompt(
  request: GradedTextRequest
): { system: string; user: string } {
  const bandDesc = BAND_DESCRIPTIONS[request.band];
  const register = request.guidance?.register ?? "line";
  const facts = request.mustConveyFacts ?? [];
  const notes = request.guidance?.notes ?? [];

  const context = [
    facts.length > 0 ? `Must-convey facts: ${facts.join("; ")}` : null,
    ...notes
  ].filter((part): part is string => Boolean(part));

  const system = [
    `You are a writer for a language-learning game.`,
    `Adapt the given English ${register} into ${request.targetLang} for a ${bandDesc} learner.`,
    `Adapt rather than translate: keep what the text must communicate, but re-express it within reach of a ${bandDesc} learner.`,
    `The output must be predominantly or entirely in ${request.targetLang}, grammatically natural for the learner level.`,
    `Preserve the length and shape of the original -- a one-line ${register} stays one line, a paragraph stays a paragraph.`,
    `Do not add glosses, translations, or explanations inline.`,
    `Return only the adapted text, nothing else.`
  ].join(" ");

  const user = [
    `Target language: ${request.targetLang}`,
    `Learner level: ${request.band} (${bandDesc})`,
    ...(context.length > 0 ? [`\nContext:\n${context.join("\n")}`] : []),
    `\nOriginal English ${register}:\n${request.sourceText}`
  ].join("\n");

  return { system, user };
}

/** Pure prompt construction for the fidelity judge. */
export function buildFidelityPrompt(
  generatedText: string,
  mustConveyFacts: string[],
  register: string
): { system: string; user: string } {
  const system = [
    `You are checking whether an adapted ${register} conveys all required facts.`,
    "Return JSON only matching the schema: { passes: boolean, reasoning: string }",
    "Set passes to true only if all must-convey facts are present in the adapted text.",
    "Keep reasoning concise (one sentence per missing fact at most)."
  ].join(" ");

  const user = [
    `Must-convey facts:\n${mustConveyFacts.map((fact, index) => `${index + 1}. ${fact}`).join("\n")}`,
    `\nAdapted text:\n${generatedText}`,
    `\nReturn JSON: { "passes": true|false, "reasoning": "..." }`
  ].join("\n");

  return { system, user };
}

function extractJsonCandidate(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }
  return trimmed.slice(firstBrace, lastBrace + 1).trim();
}

export class GradedTextService {
  private readonly llmClient: SugarlangLLMClient;
  private readonly atlas: LexicalAtlasProvider;
  private readonly inventoryChunks: InventoryChunk[];
  private readonly morphology: MorphologyLoader;

  constructor(deps: GradedTextServiceDeps) {
    this.llmClient = deps.llmClient;
    this.atlas = deps.atlas;
    this.inventoryChunks = deps.inventoryChunks;
    // Shared by default. MorphologyLoader caches per INSTANCE, so a fresh one
    // per service re-runs assertValidMorphologyData over ~29k form entries --
    // once per variant generated, and generateVariantsForNode fans out over
    // four bands at once. It used to be module-level in generate-variant.ts;
    // keep that.
    this.morphology = deps.morphology ?? SHARED_MORPHOLOGY;
  }

  async adapt(request: GradedTextRequest): Promise<GradedTextResult> {
    const promptVersion = GRADED_TEXT_PROMPT_VERSION;
    const generatedByModel = "graded-text-adapt";

    const prompt = buildAdaptationPrompt(request);

    let generatedText: string;
    try {
      const response = await this.llmClient.generate({
        systemPrompt: prompt.system,
        userPrompt: prompt.user,
        maxTokens: request.maxTokens ?? DEFAULT_MAX_TOKENS
      });
      generatedText = response.text.trim();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Graded text adaptation failed";
      return {
        text: null,
        verdict: null,
        generatedByModel,
        promptVersion,
        failure: { message }
      };
    }

    if (!generatedText) {
      return {
        text: null,
        verdict: null,
        generatedByModel,
        promptVersion,
        failure: { message: "Graded text adapter returned empty text" }
      };
    }

    const verdict = await this.verify(request, generatedText);
    return { text: generatedText, verdict, generatedByModel, promptVersion };
  }

  /** The four gates. Split out so a caller can re-verify authored text. */
  private async verify(
    request: GradedTextRequest,
    generatedText: string
  ): Promise<VariantVerdict> {
    // Gate 1: mixed-text envelope. Needs a learner to measure against, and at
    // adaptation time there is no real one -- synthesize the band we asked for.
    const syntheticLearner = {
      learnerId: "__graded-text__" as LearnerId,
      targetLanguage: request.targetLang,
      supportLanguage: "en",
      assessment: {
        status: "unassessed" as const,
        evaluatedCefrBand: null,
        cefrConfidence: 0,
        evaluatedAtMs: null
      },
      estimatedCefrBand: request.band,
      cefrPosterior: {
        A1: { alpha: 1, beta: 1 },
        A2: { alpha: 1, beta: 1 },
        B1: { alpha: 1, beta: 1 },
        B2: { alpha: 1, beta: 1 },
        C1: { alpha: 1, beta: 1 },
        C2: { alpha: 1, beta: 1 }
      },
      lemmaCards: {},
      currentSession: null,
      sessionHistory: []
    };

    // Inventory chunks, NOT sceneLexicon.chunks: scene.chunks only holds
    // authored text, so dynamic phrases would never match.
    const chunkMatcher = createChunkMatcher(this.inventoryChunks, request.targetLang);
    const tokens = tokenize(generatedText, request.targetLang);
    const profile = computeCoverage(
      tokens,
      syntheticLearner,
      this.atlas,
      new Set(),
      this.morphology,
      new Set(),
      chunkMatcher,
      undefined,
      generatedText
    );

    // No prescription here: must-convey facts are source-language narrative
    // strings, not target lemma ids. The structural allowance + ceiling checks
    // are the meaningful part.
    const envelopePasses = applyMixedTextEnvelopePredicate(profile, request.band, {
      prescription: null
    }).passes;

    // Gate 2: language ratio.
    const ratioVerdict = computeLanguageRatioVerdict(
      profile,
      request.directedRatio ?? DEFAULT_DIRECTED_RATIO,
      request.posture ?? DEFAULT_POSTURE
    );
    const ratioPasses =
      ratioVerdict.conformance === "conformant" ||
      ratioVerdict.conformance === "skipped";

    // Gate 3: voice retention. Inert without a voice spec, which no caller has
    // at adaptation time -- it scores 1.0 and always passes. Kept in the verdict
    // so the shape stays honest about which gates ran; see the deferred note in
    // the 086 plan before treating this as real coverage.
    const voiceRetentionScore = computeVoiceRetentionScore(generatedText, null);

    // Gate 4: fidelity. Conservative -- any failure to judge fails the gate.
    const facts = request.mustConveyFacts ?? [];
    let fidelityPasses: boolean;
    try {
      fidelityPasses = await this.runFidelityCheck(
        generatedText,
        facts,
        request.guidance?.register ?? "line"
      );
    } catch {
      fidelityPasses = false;
    }

    return {
      envelopePasses,
      ratioPasses,
      voiceRetentionScore,
      fidelityPasses,
      overallPasses:
        envelopePasses &&
        ratioPasses &&
        voiceRetentionScore >= VOICE_RETENTION_PASS_THRESHOLD &&
        fidelityPasses
    };
  }

  private async runFidelityCheck(
    generatedText: string,
    mustConveyFacts: string[],
    register: string
  ): Promise<boolean> {
    if (mustConveyFacts.length === 0) {
      return true;
    }

    const prompt = buildFidelityPrompt(generatedText, mustConveyFacts, register);
    let response: { text: string };
    try {
      response = await this.llmClient.generate({
        systemPrompt: prompt.system,
        userPrompt: prompt.user,
        maxTokens: 200
      });
    } catch {
      return false;
    }

    try {
      const candidate = extractJsonCandidate(response.text);
      if (!candidate) return false;
      const parsed = JSON.parse(candidate) as unknown;
      if (!validateFidelityPayload(parsed)) return false;
      return (parsed as { passes: boolean }).passes;
    } catch {
      return false;
    }
  }
}
