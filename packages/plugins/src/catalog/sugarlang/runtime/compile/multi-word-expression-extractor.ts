/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/multi-word-expression-extractor.ts
 *
 * WHAT A MULTI-WORD EXPRESSION IS
 *   A multi-word expression (MWE) is a sequence of words a fluent speaker
 *   retrieves from memory AS ONE ITEM rather than assembling from grammar.
 *   It is a STORAGE unit, not a syntactic one -- which is why MWEs share no
 *   common grammatical shape:
 *     "buenos dias"        noun phrase        (pragmatic routine)
 *     "mucho gusto"        adverb + noun      (pragmatic routine)
 *     "tomar una decision" verb + object      (collocation)
 *     "estar en las nubes" clause             (idiom)
 *   The literature calls these formulaic sequences (Wray) or lexical chunks
 *   (Lewis); "multi-word expression" is the computational-linguistics name and
 *   the one used here because it says what it is without implying syntax.
 *
 * WHY THEY MATTER PEDAGOGICALLY
 *   Fluency comes from holding a stock of these, not from composing every
 *   utterance from rules. They also carry pragmatic appropriateness that
 *   word-by-word composition destroys ("mucho gusto" is not "much pleasure").
 *   Hence each MWE is graded by CEFR band AS A COMMUNICATIVE UNIT, not by its
 *   hardest constituent lemma: "buenos dias" is A1 to USE even for a learner
 *   who could not parse it, because it is learned whole and never decomposed.
 *
 * WHAT THIS MODULE DOES -- AND DELIBERATELY DOES NOT
 *   DOES:     spots MWEs that appear VERBATIM in authored scene text. The
 *             prompt forbids inventing anything not present. Surface-bound and
 *             extractive: "what multi-word units are literally sitting here?"
 *   DOES NOT: infer what the scene is ABOUT. A bio reading "cheesemonger"
 *             yields no MWE here, and never will -- inferring the concept
 *             `cheese` from it is a different job with a different output
 *             shape (single notion, not a phrase). Do not grow this module in
 *             that direction; it is a separate extractor.
 *
 * PATTERNS USED, AND WHY
 *   - Dependency injection via constructor (mirrors LexicalBudgeter): the
 *     atlas, LLM client, telemetry sink and clock are injected so the class is
 *     unit-testable against fakes with no network and no real clock.
 *   - Strategy-ish prompt/parse split: `buildMultiWordExpressionPrompt` is
 *     exported and pure, so prompt shape can be asserted without invoking a
 *     model, and the prompt can be versioned independently of the caller.
 *   - Schema-validated boundary (Ajv): model output is untrusted input. It is
 *     validated against MWE_SCHEMA before anything downstream sees it.
 *   - Fail-soft: any model or validation failure returns a result carrying a
 *     `failure` and an empty list rather than throwing, so a compile degrades
 *     to no-MWEs instead of breaking authoring. The PUBLISH path chooses to
 *     treat that failure as fatal; that decision lives at the call site.
 *
 * HOW TO USE
 *     const extractor = new MultiWordExpressionExtractor({
 *       atlas, llmClient, telemetry
 *     });
 *     const result = await extractor.extract({
 *       sceneText: collectSceneText(scene),
 *       lang: scene.targetLanguage,
 *       sceneId: scene.sceneId,
 *       contentHash
 *     });
 *   Callers own caching and scheduling -- this class is stateless per call.
 *   `SugarlangAuthoringCompileScheduler` owns debounce and cache-hit skip;
 *   `MultiWordExpressionCache` (still named chunk-cache) owns persistence.
 *
 * The output type is `LexicalChunk`: a chunk is any multi-word expression,
 * which is what this module finds. A phrase that performs a competency is an
 * exponent and lives in the competency inventory, not here.
 *
 * Exports:
 *   - MultiWordExpressionExtractor (class)
 *   - MWE_EXTRACTOR_PROMPT_VERSION
 *   - MWE_EXTRACTION_PROMPT_TEMPLATE
 *   - buildMultiWordExpressionPrompt
 *   - MultiWordExpressionExtractionInput / ...Result
 *
 * Implements: Proposal 001 §Lexical Chunk Awareness; Plan 085 (functions as chunks)
 *
 * Status: active
 */

import Ajv from "ajv";
import type { ErrorObject } from "ajv";
import type { SugarlangLLMClient, SugarlangLLMResult } from "../llm/types";
import { EXTRACTION_PURPOSE } from "../llm/types";
import type { LexicalAtlasProvider, LexicalChunk } from "../types";
import type { TextBlob } from "./scene-traversal";
import {
  createNoOpTelemetrySink,
  createTelemetryEvent,
  emitTelemetry,
  type TelemetrySink
} from "../telemetry/telemetry";

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  removeAdditional: false
});

const MWE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["chunks"],
  properties: {
    chunks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "normalizedForm",
          "surfaceForms",
          "cefrBand",
          "constituentLemmas",
          "rationale"
        ],
        properties: {
          normalizedForm: { type: "string", minLength: 1 },
          surfaceForms: {
            type: "array",
            items: { type: "string", minLength: 1 }
          },
          cefrBand: { enum: ["A1", "A2", "B1", "B2", "C1", "C2"] },
          constituentLemmas: {
            type: "array",
            items: { type: "string", minLength: 1 }
          },
          rationale: { type: "string", minLength: 1 }
        }
      }
    }
  }
} as const;

const validateChunkPayload = ajv.compile(MWE_SCHEMA);

export const MWE_EXTRACTOR_PROMPT_VERSION = "1";
export const MWE_EXTRACTION_PROMPT_TEMPLATE = [
  "You are annotating scene-authored language-learning metadata.",
  "Return JSON only.",
  "Identify multi-word idioms, fixed collocations, and formulaic chunks that appear verbatim in the provided scene text.",
  "Grade each chunk by CEFR band as a communicative unit, not by the hardest constituent lemma.",
  "Do not invent chunks that are not present in the text.",
  "Favor idiomatic or formulaic sequences over arbitrary adjacent words.",
  "Each chunk needs normalizedForm, surfaceForms observed in the text, cefrBand, constituentLemmas, and a short rationale."
] as const;

interface ExtractedChunkSchema {
  normalizedForm: string;
  surfaceForms: string[];
  cefrBand: LexicalChunk["cefrBand"];
  constituentLemmas: string[];
  rationale: string;
}

interface ExtractedChunkPayload {
  chunks: ExtractedChunkSchema[];
}

export interface MultiWordExpressionExtractionInput {
  sceneText: TextBlob[];
  lang: string;
  atlas: LexicalAtlasProvider;
  llmClient: SugarlangLLMClient;
  promptVersion?: string;
  model?: string;
  maxTokens?: number;
  sceneId?: string;
  contentHash?: string;
  telemetry?: TelemetrySink;
  now?: () => number;
}

export interface MultiWordExpressionExtractionResult {
  chunks: LexicalChunk[];
  tokenCost: {
    input: number;
    output: number;
  };
  latencyMs: number;
  model: string;
  failure?: {
    code: string;
    message: string;
  };
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.trim().length / 4));
}

function normalizeChunkId(value: string): string {
  return value
    .normalize("NFC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Mark}\p{Number}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

function buildSceneTextDump(sceneText: TextBlob[]): string {
  return [...sceneText]
    .sort((left, right) =>
      left.sourceId === right.sourceId
        ? left.sourceKind.localeCompare(right.sourceKind)
        : left.sourceId.localeCompare(right.sourceId)
    )
    .map(
      (blob) =>
        [
          `[${blob.sourceKind}] ${blob.sourceId}`,
          blob.text.normalize("NFC")
        ].join("\n")
    )
    .join("\n\n---\n\n");
}

export function buildMultiWordExpressionPrompt(
  sceneText: TextBlob[],
  lang: string,
  atlas: LexicalAtlasProvider,
  promptVersion = MWE_EXTRACTOR_PROMPT_VERSION
): { system: string; user: string } {
  const system = MWE_EXTRACTION_PROMPT_TEMPLATE.join("\n");
  const user = [
    `promptVersion: ${promptVersion}`,
    `targetLanguage: ${lang}`,
    `atlasVersion: ${atlas.getAtlasVersion(lang)}`,
    "Output schema:",
    JSON.stringify(MWE_SCHEMA),
    "",
    "Scene text:",
    buildSceneTextDump(sceneText)
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toValidationMessage(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "validation error"}`)
    .join("; ");
}

function parseChunkPayload(text: string): ExtractedChunkPayload {
  const candidate = extractJsonCandidate(text);
  if (!candidate) {
    throw new Error("Extractor response did not contain a JSON object.");
  }

  const parsed = JSON.parse(candidate) as unknown;
  if (!validateChunkPayload(parsed)) {
    throw new Error(
      `Extractor response failed schema validation: ${toValidationMessage(
        validateChunkPayload.errors
      )}`
    );
  }

  return parsed as ExtractedChunkPayload;
}

function sanitizeChunk(
  chunk: ExtractedChunkSchema,
  lang: string,
  model: string,
  extractedAtMs: number,
  promptVersion: string
): LexicalChunk | null {
  const normalizedForm = chunk.normalizedForm.normalize("NFC").trim().toLocaleLowerCase(lang);
  const chunkId = normalizeChunkId(normalizedForm);
  if (!normalizedForm || !chunkId) {
    return null;
  }

  const surfaceForms = Array.from(
    new Set(
      chunk.surfaceForms
        .map((surface) => surface.normalize("NFC").trim())
        .filter((surface) => surface.length > 0)
    )
  );
  const constituentLemmas = Array.from(
    new Set(
      chunk.constituentLemmas
        .map((lemma) => lemma.normalize("NFC").trim().toLocaleLowerCase(lang))
        .filter((lemma) => lemma.length > 0)
    )
  );

  if (surfaceForms.length === 0 || constituentLemmas.length === 0) {
    return null;
  }

  return {
    chunkId,
    normalizedForm,
    surfaceForms,
    cefrBand: chunk.cefrBand,
    constituentLemmas,
    extractedByModel: model,
    extractedAtMs,
    extractorPromptVersion: promptVersion,
    source: "llm-extracted"
  };
}

// NOTE: The old createAnthropicChunkExtractorClient was removed because
// sugarlang must not import from sugaragent. All LLM calls go through
// SugarlangLLMClient (the gateway). See runtime/llm/gateway-client.ts.

async function runExtraction(
  input: MultiWordExpressionExtractionInput
): Promise<MultiWordExpressionExtractionResult> {
  const telemetry = input.telemetry ?? createNoOpTelemetrySink();
  const now = input.now ?? (() => Date.now());
  const promptVersion = input.promptVersion ?? MWE_EXTRACTOR_PROMPT_VERSION;
  const model = input.model ?? "gateway-resolved";
  // Room to finish. The sibling scene-context pass truncated silently at its
  // old ceiling and the failure read as invalid JSON for days; `max_tokens` is
  // a ceiling rather than a reservation, so headroom is free.
  const maxTokens = input.maxTokens ?? 4000;
  const prompt = buildMultiWordExpressionPrompt(
    input.sceneText,
    input.lang,
    input.atlas,
    promptVersion
  );
  const startedAt = now();

  await emitTelemetry(
    telemetry,
    createTelemetryEvent("chunk.extraction-started", {
      timestamp: startedAt,
      sceneId: input.sceneId ?? "unknown-scene",
      contentHash: input.contentHash ?? "unknown-hash",
      lang: input.lang,
      extractorPurpose: EXTRACTION_PURPOSE,
      extractorPromptVersion: promptVersion
    })
  );

  let response: SugarlangLLMResult;
  try {
    response = await input.llmClient.generate({
      purpose: EXTRACTION_PURPOSE,
      systemPrompt: prompt.system,
      userPrompt: prompt.user,
      maxTokens,
      // Same reason as the scene-context pass: the schema in the prompt asks,
      // this constrains. Both passes failed in the same rebuild on JSON that
      // did not parse.
      outputSchema: MWE_SCHEMA
    });
  } catch (error) {
    const failure = {
      code: "extractor_request_failed",
      message: error instanceof Error ? error.message : "Chunk extraction failed"
    };
    await emitTelemetry(
      telemetry,
      createTelemetryEvent("chunk.extraction-failed", {
        timestamp: now(),
        sceneId: input.sceneId ?? "unknown-scene",
        contentHash: input.contentHash ?? "unknown-hash",
        lang: input.lang,
        extractorPurpose: EXTRACTION_PURPOSE,
        error: failure
      })
    );
    return {
      chunks: [],
      tokenCost: {
        input: estimateTokens(prompt.system) + estimateTokens(prompt.user),
        output: 0
      },
      latencyMs: now() - startedAt,
      model,
      failure
    };
  }

  try {
    // Truncation reads as bad syntax once it reaches the parser. Say which.
    if (response.stopReason === "max_tokens") {
      throw new Error(
        `Chunk extraction did not fit in ${maxTokens} output tokens. ` +
          `Raise maxTokens, or split the scene's authored content.`
      );
    }
    const payload = parseChunkPayload(response.text);
    const extractedAtMs = now();
    const chunks = payload.chunks
      .map((chunk) =>
        sanitizeChunk(
          chunk,
          input.lang,
          model,
          extractedAtMs,
          promptVersion
        )
      )
      .filter((chunk): chunk is LexicalChunk => chunk !== null)
      .sort((left, right) => left.chunkId.localeCompare(right.chunkId));
    const dedupedChunks = Array.from(
      new Map(chunks.map((chunk) => [chunk.chunkId, chunk])).values()
    );

    await emitTelemetry(
      telemetry,
      createTelemetryEvent("chunk.extraction-completed", {
        timestamp: extractedAtMs,
        sceneId: input.sceneId ?? "unknown-scene",
        contentHash: input.contentHash ?? "unknown-hash",
        lang: input.lang,
        chunkCount: dedupedChunks.length,
        latencyMs: extractedAtMs - startedAt,
        tokenCost: {
          input: estimateTokens(prompt.system) + estimateTokens(prompt.user),
          output: estimateTokens(response.text)
        },
        extractorPurpose: EXTRACTION_PURPOSE
      })
    );

    return {
      chunks: dedupedChunks,
      tokenCost: {
        input: estimateTokens(prompt.system) + estimateTokens(prompt.user),
        output: estimateTokens(response.text)
      },
      latencyMs: extractedAtMs - startedAt,
      model: model
    };
  } catch (error) {
    const failure = {
      code: "extractor_parse_failed",
      message: error instanceof Error ? error.message : "Chunk extraction parse failed"
    };
    await emitTelemetry(
      telemetry,
      createTelemetryEvent("chunk.extraction-failed", {
        timestamp: now(),
        sceneId: input.sceneId ?? "unknown-scene",
        contentHash: input.contentHash ?? "unknown-hash",
        lang: input.lang,
        extractorPurpose: EXTRACTION_PURPOSE,
        error: failure
      })
    );

    return {
      chunks: [],
      tokenCost: {
        input: estimateTokens(prompt.system) + estimateTokens(prompt.user),
        output: estimateTokens(response.text)
      },
      latencyMs: now() - startedAt,
      model: model,
      failure
    };
  }
}

/**
 * Constructor-injected dependencies. Everything here is a collaborator the
 * tests replace with a fake: no network, no real clock, no global telemetry.
 */
export interface MultiWordExpressionExtractorDeps {
  atlas: LexicalAtlasProvider;
  llmClient: SugarlangLLMClient;
  telemetry?: TelemetrySink;
  /** Injected clock; defaults to Date.now. Kept injectable so latency
   *  assertions are deterministic. */
  now?: () => number;
}

/** Per-call inputs: what to read, and the cache identity to report. */
export interface MultiWordExpressionExtractRequest {
  sceneText: TextBlob[];
  lang: string;
  promptVersion?: string;
  model?: string;
  maxTokens?: number;
  sceneId?: string;
  contentHash?: string;
}

/**
 * Spots multi-word expressions that appear VERBATIM in authored scene text.
 * See the module header for what an MWE is, why it is graded as a unit, and
 * what this deliberately does not do.
 *
 * Stateless per call -- caching and scheduling belong to the caller.
 */
export class MultiWordExpressionExtractor {
  constructor(private readonly deps: MultiWordExpressionExtractorDeps) {}

  async extract(
    request: MultiWordExpressionExtractRequest
  ): Promise<MultiWordExpressionExtractionResult> {
    return runExtraction({
      ...request,
      atlas: this.deps.atlas,
      llmClient: this.deps.llmClient,
      ...(this.deps.telemetry ? { telemetry: this.deps.telemetry } : {}),
      ...(this.deps.now ? { now: this.deps.now } : {})
    });
  }
}
