/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/generate-variant.ts
 *
 * Purpose: LLM-backed bake-time variant generator with four-gate verification.
 *
 * Exports:
 *   - VARIANT_PROMPT_VERSION
 *   - GenerateVariantInput
 *   - GenerateVariantResult
 *   - generateVariant
 *
 * Relationships:
 *   - Depends on baked-variant contracts, LLM client, classifier facade.
 *   - Is consumed by compile-scheduler variantPipeline.
 *
 * Implements: Epic 086 Story 086.3 -- bake-time variant generation + triple verification
 *
 * Status: active
 */

import Ajv from "ajv";
import type { CEFRBand } from "../contracts/learner-profile";
import type { LineIntentArtifact } from "../contracts/line-intent";
import type { BakedLineVariant, VariantVerdict } from "../contracts/baked-variant";
import type { SugarlangLLMClient } from "../llm/types";
import type { LexicalAtlasProvider } from "../types";
import type { InventoryChunk } from "../contracts/function-inventory";
import { applyMixedTextEnvelopePredicate } from "../classifier/envelope-rule";
import { computeLanguageRatioVerdict } from "../classifier/language-ratio";
import { computeVoiceRetentionScore } from "../classifier/envelope-classifier";
import { computeCoverage } from "../classifier/coverage";
import { createChunkMatcher } from "../classifier/chunk-matcher";
import { tokenize } from "../classifier/tokenize";
import { MorphologyLoader } from "../classifier/morphology-loader";

export const VARIANT_PROMPT_VERSION = "086.3.0";

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

export interface GenerateVariantInput {
  authoredText: string;
  targetLang: string;
  band: CEFRBand;
  intent: LineIntentArtifact | null;
  contentHash: string;
  dialogueDefinitionId: string;
  nodeId: string;
}

export interface GenerateVariantResult {
  variant: BakedLineVariant | null;
  failure?: { message: string };
}

const BAND_DESCRIPTIONS: Record<CEFRBand, string> = {
  A1: "beginner (A1)",
  A2: "elementary (A2)",
  B1: "intermediate (B1)",
  B2: "upper-intermediate (B2)",
  C1: "advanced (C1)",
  C2: "proficient (C2)"
};

function buildVariantPrompt(
  authoredText: string,
  targetLang: string,
  band: CEFRBand,
  intent: LineIntentArtifact | null
): { system: string; user: string } {
  const bandDesc = BAND_DESCRIPTIONS[band];
  const intentContext =
    intent && (intent.mustConveyFacts.length > 0 || intent.beat || intent.voiceNote)
      ? [
          intent.mustConveyFacts.length > 0
            ? `Must-convey facts: ${intent.mustConveyFacts.join("; ")}`
            : null,
          intent.beat ? `Dramatic beat: ${intent.beat}` : null,
          intent.voiceNote ? `Voice note: ${intent.voiceNote}` : null
        ]
          .filter(Boolean)
          .join("\n")
      : null;

  const system = [
    `You are a dialogue writer for a language-learning game.`,
    `Render the given English dialogue line in ${targetLang} for a ${bandDesc} learner.`,
    `The output must be predominantly or entirely in ${targetLang}, grammatically natural for the learner level.`,
    `Do not add glosses, translations, or explanations inline.`,
    `Return only the translated/adapted line, nothing else.`
  ].join(" ");

  const user = [
    `Target language: ${targetLang}`,
    `Learner level: ${band} (${bandDesc})`,
    ...(intentContext ? [`\nIntent context:\n${intentContext}`] : []),
    `\nOriginal English line:\n${authoredText}`
  ].join("\n");

  return { system, user };
}

function buildFidelityPrompt(
  generatedText: string,
  mustConveyFacts: string[]
): { system: string; user: string } {
  const system = [
    "You are checking whether a generated dialogue line conveys all required facts.",
    "Return JSON only matching the schema: { passes: boolean, reasoning: string }",
    "Set passes to true only if all must-convey facts are present in the generated line.",
    "Keep reasoning concise (one sentence per missing fact at most)."
  ].join(" ");

  const user = [
    `Must-convey facts:\n${mustConveyFacts.map((f, i) => `${i + 1}. ${f}`).join("\n")}`,
    `\nGenerated line:\n${generatedText}`,
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

const morphologyLoader = new MorphologyLoader();

async function runFidelityCheck(
  generatedText: string,
  mustConveyFacts: string[],
  llmClient: SugarlangLLMClient
): Promise<boolean> {
  if (mustConveyFacts.length === 0) {
    return true;
  }

  const prompt = buildFidelityPrompt(generatedText, mustConveyFacts);
  let response: { text: string };
  try {
    response = await llmClient.generate({
      systemPrompt: prompt.system,
      userPrompt: prompt.user,
      maxTokens: 200
    });
  } catch {
    // LLM failure -- conservative: fail the gate
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

export async function generateVariant(
  input: GenerateVariantInput,
  deps: {
    llmClient: SugarlangLLMClient;
    atlas: LexicalAtlasProvider;
    inventoryChunks: InventoryChunk[];
  }
): Promise<GenerateVariantResult> {
  const now = Date.now();

  // --- Generation ---
  const prompt = buildVariantPrompt(
    input.authoredText,
    input.targetLang,
    input.band,
    input.intent
  );

  let generatedText: string;
  let generatedByModel: string;
  try {
    const response = await deps.llmClient.generate({
      systemPrompt: prompt.system,
      userPrompt: prompt.user,
      maxTokens: 300
    });
    generatedText = response.text.trim();
    // Model is server-selected via purpose; record what we know
    generatedByModel = "scripted-variant-bake";
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Variant generation failed";
    return { variant: null, failure: { message } };
  }

  if (!generatedText) {
    return {
      variant: null,
      failure: { message: "Variant generator returned empty text" }
    };
  }

  // --- Gate 1: Mixed-text envelope predicate ---
  // Build a synthesized learner profile for this band
  const syntheticLearner = {
    learnerId: "__bake__" as import("../contracts/learner-profile").LearnerId,
    targetLanguage: input.targetLang,
    supportLanguage: "en",
    assessment: {
      status: "unassessed" as const,
      evaluatedCefrBand: null,
      cefrConfidence: 0,
      evaluatedAtMs: null
    },
    estimatedCefrBand: input.band,
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

  // Use inventory chunks (not sceneLexicon.chunks -- plan pin)
  const chunkMatcher = createChunkMatcher(deps.inventoryChunks, input.targetLang);
  const tokens = tokenize(generatedText, input.targetLang);
  const profile = computeCoverage(
    tokens,
    syntheticLearner,
    deps.atlas,
    new Set(),
    morphologyLoader,
    new Set(),
    chunkMatcher,
    undefined,
    generatedText
  );

  // No prescription available at bake time -- the intent's mustConveyFacts are English
  // narrative strings, not target-language lemma IDs. Pass null for prescription;
  // the structural gates (allowance + ceiling) are the meaningful check here.
  const envelopeResult = applyMixedTextEnvelopePredicate(profile, input.band, {
    prescription: null
  });
  const envelopePasses = envelopeResult.passes;

  // --- Gate 2: Language ratio ---
  // For B1+: target-dominant posture, directed ratio 0.8
  const posture: import("../contracts/pedagogy").SupportPosture = "target-dominant";
  const directedRatio = 0.8;
  const ratioVerdict = computeLanguageRatioVerdict(profile, directedRatio, posture);
  const ratioPasses =
    ratioVerdict.conformance === "conformant" || ratioVerdict.conformance === "skipped";

  // --- Gate 3: Voice retention ---
  // voiceSpec = null at bake time (no scene lexicon loaded); returns 1.0
  const voiceRetentionScore = computeVoiceRetentionScore(generatedText, null);

  // --- Gate 4: Fidelity check (LLM-assisted) ---
  let fidelityPasses: boolean;
  try {
    fidelityPasses = await runFidelityCheck(
      generatedText,
      input.intent?.mustConveyFacts ?? [],
      deps.llmClient
    );
  } catch {
    fidelityPasses = false;
  }

  const overallPasses =
    envelopePasses && ratioPasses && voiceRetentionScore >= 1.0 && fidelityPasses;

  const verdict: VariantVerdict = {
    envelopePasses,
    ratioPasses,
    voiceRetentionScore,
    fidelityPasses,
    overallPasses
  };

  const reviewFlag = !overallPasses;

  const variant: BakedLineVariant = {
    nodeId: input.nodeId,
    dialogueDefinitionId: input.dialogueDefinitionId,
    lang: input.targetLang,
    band: input.band,
    text: generatedText,
    verdict,
    reviewFlag,
    generatedAtMs: now,
    generatedByModel,
    contentHash: input.contentHash,
    promptVersion: VARIANT_PROMPT_VERSION
  };

  return { variant };
}
