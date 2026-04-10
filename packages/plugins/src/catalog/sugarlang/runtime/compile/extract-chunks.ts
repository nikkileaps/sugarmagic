/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/extract-chunks.ts
 *
 * Purpose: Runs the LLM-backed lexical chunk extractor over scene-authored text.
 *
 * Exports:
 *   - EXTRACTOR_PROMPT_VERSION
 *   - EXTRACT_CHUNKS_PROMPT_TEMPLATE
 *   - extractor prompt/build types and helpers
 *   - createAnthropicChunkExtractorClient
 *   - extractChunks
 *
 * Relationships:
 *   - Depends on scene traversal text blobs, lexical chunk contracts, and telemetry.
 *   - Is consumed by the chunk cache, authoring scheduler, and publish pipeline.
 *
 * Implements: Proposal 001 §Lexical Chunk Awareness
 *
 * Status: active
 */

import Ajv from "ajv";
import type { ErrorObject } from "ajv";
import { AnthropicClient } from "../../../sugaragent/runtime/clients";
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

const CHUNK_SCHEMA = {
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

const validateChunkPayload = ajv.compile(CHUNK_SCHEMA);

export const EXTRACTOR_PROMPT_VERSION = "1";
export const DEFAULT_CHUNK_EXTRACTOR_MODEL = "claude-sonnet-4-6";
export const EXTRACT_CHUNKS_PROMPT_TEMPLATE = [
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

export interface ChunkExtractorClientRequest {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
}

export interface ChunkExtractorClientResult {
  text: string;
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  requestId?: string | null;
}

export interface ChunkExtractorClient {
  generateStructuredChunks: (
    request: ChunkExtractorClientRequest
  ) => Promise<ChunkExtractorClientResult>;
}

export interface ExtractChunksInput {
  sceneText: TextBlob[];
  lang: string;
  atlas: LexicalAtlasProvider;
  llmClient: ChunkExtractorClient;
  promptVersion?: string;
  model?: string;
  maxTokens?: number;
  sceneId?: string;
  contentHash?: string;
  telemetry?: TelemetrySink;
  now?: () => number;
}

export interface ExtractChunksResult {
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

export function buildExtractChunksPrompt(
  sceneText: TextBlob[],
  lang: string,
  atlas: LexicalAtlasProvider,
  promptVersion = EXTRACTOR_PROMPT_VERSION
): { system: string; user: string } {
  const system = EXTRACT_CHUNKS_PROMPT_TEMPLATE.join("\n");
  const user = [
    `promptVersion: ${promptVersion}`,
    `targetLanguage: ${lang}`,
    `atlasVersion: ${atlas.getAtlasVersion(lang)}`,
    "Output schema:",
    JSON.stringify(CHUNK_SCHEMA),
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

export function createAnthropicChunkExtractorClient(
  client: AnthropicClient
): ChunkExtractorClient {
  return {
    async generateStructuredChunks(
      request: ChunkExtractorClientRequest
    ): Promise<ChunkExtractorClientResult> {
      const response = await client.generateMessage({
        model: request.model,
        system: request.systemPrompt,
        userMessage: request.userPrompt,
        maxTokens: request.maxTokens
      });

      return {
        text: response.text,
        requestId: response.requestId ?? null,
        model: request.model
      };
    }
  };
}

export async function extractChunks(
  input: ExtractChunksInput
): Promise<ExtractChunksResult> {
  const telemetry = input.telemetry ?? createNoOpTelemetrySink();
  const now = input.now ?? (() => Date.now());
  const promptVersion = input.promptVersion ?? EXTRACTOR_PROMPT_VERSION;
  const model = input.model ?? DEFAULT_CHUNK_EXTRACTOR_MODEL;
  const maxTokens = input.maxTokens ?? 900;
  const prompt = buildExtractChunksPrompt(
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
      extractorModel: model,
      extractorPromptVersion: promptVersion
    })
  );

  let response: ChunkExtractorClientResult;
  try {
    response = await input.llmClient.generateStructuredChunks({
      model,
      systemPrompt: prompt.system,
      userPrompt: prompt.user,
      maxTokens
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
        extractorModel: model,
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
    const payload = parseChunkPayload(response.text);
    const extractedAtMs = now();
    const chunks = payload.chunks
      .map((chunk) =>
        sanitizeChunk(
          chunk,
          input.lang,
          response.model,
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
          input: response.inputTokens ?? estimateTokens(prompt.system) + estimateTokens(prompt.user),
          output: response.outputTokens ?? estimateTokens(response.text)
        },
        extractorModel: response.model
      })
    );

    return {
      chunks: dedupedChunks,
      tokenCost: {
        input: response.inputTokens ?? estimateTokens(prompt.system) + estimateTokens(prompt.user),
        output: response.outputTokens ?? estimateTokens(response.text)
      },
      latencyMs: extractedAtMs - startedAt,
      model: response.model
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
        extractorModel: response.model,
        error: failure
      })
    );

    return {
      chunks: [],
      tokenCost: {
        input: response.inputTokens ?? estimateTokens(prompt.system) + estimateTokens(prompt.user),
        output: response.outputTokens ?? estimateTokens(response.text)
      },
      latencyMs: now() - startedAt,
      model: response.model,
      failure
    };
  }
}
