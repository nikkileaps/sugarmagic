/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/extract-intent.ts
 *
 * Purpose: Runs the LLM-backed line-intent extractor over a dialogue node's text.
 *
 * Exports:
 *   - INTENT_EXTRACTOR_PROMPT_VERSION
 *   - ExtractIntentInput
 *   - ExtractIntentResult
 *   - extractIntent
 *
 * Relationships:
 *   - Depends on line-intent contracts, LLM client, and telemetry.
 *   - Is consumed by the intent cache and authoring compile scheduler.
 *
 * Implements: Epic 086 Story 086.1 -- line-intent model
 *
 * Status: active
 */

import Ajv from "ajv";
import type { ErrorObject } from "ajv";
import type { SugarlangLLMClient } from "../llm/types";
import type { LineIntentArtifact } from "../contracts/line-intent";
import type { DialogueLineIntent } from "@sugarmagic/domain";
import {
  createNoOpTelemetrySink,
  createTelemetryEvent,
  emitTelemetry,
  type TelemetrySink
} from "../telemetry/telemetry";

// 087.5: mustConveyFacts now emits target-language lemmaIds (not only English
// fact strings) when targetLanguage is supplied. Bumped so artifacts extracted
// under the old contract miss the cache and re-extract -- a stale English-only
// artifact can never match a schedule lemma id, silently disabling the
// live-render trigger for that line.
export const INTENT_EXTRACTOR_PROMPT_VERSION = "087.5.0";
const DEFAULT_INTENT_EXTRACTOR_MODEL = "claude-sonnet-4-6";

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  removeAdditional: false
});

const INTENT_SCHEMA = {
  type: "object",
  required: ["mustConveyFacts", "beat", "voiceNote"],
  properties: {
    mustConveyFacts: { type: "array", items: { type: "string" } },
    beat: { type: "string" },
    voiceNote: { type: "string" }
  }
} as const;

const validateIntentPayload = ajv.compile(INTENT_SCHEMA);

export interface ExtractIntentInput {
  nodeId: string;
  dialogueDefinitionId: string;
  nodeText: string;
  authoredIntent?: DialogueLineIntent;
  /** Target language code (e.g. "es"). When provided, the extractor outputs
   *  vocabulary lemmaIds from that language for teachable matching. */
  targetLanguage?: string;
  llmClient: SugarlangLLMClient;
  contentHash: string;
  promptVersion?: string;
  model?: string;
  maxTokens?: number;
  telemetry?: TelemetrySink;
  now?: () => number;
}

export interface ExtractIntentResult {
  artifact: LineIntentArtifact;
  failure?: {
    code: string;
    message: string;
  };
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.trim().length / 4));
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

function toValidationMessage(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map(
      (error) =>
        `${error.instancePath || "/"} ${error.message ?? "validation error"}`
    )
    .join("; ");
}

function isHandAuthored(intent: DialogueLineIntent | undefined): boolean {
  if (!intent) return false;
  return (
    Array.isArray(intent.mustConveyFacts) &&
    intent.mustConveyFacts.length > 0 &&
    typeof intent.beat === "string" &&
    intent.beat.length > 0 &&
    typeof intent.voiceNote === "string" &&
    intent.voiceNote.length > 0
  );
}

function buildIntentPrompt(
  nodeText: string,
  promptVersion: string,
  targetLanguage?: string
): { system: string; user: string } {
  const vocabInstruction = targetLanguage
    ? [
        `  mustConveyFacts: identify vocabulary from the target language (${targetLanguage}) that this line introduces or reinforces.`,
        `    Output each as the base/dictionary form (lemmaId) of the word, e.g. "comer", "hablar", "pan".`,
        `    Also include any discrete English facts the line must communicate.`,
        `    Each entry is either a target-language lemmaId or a short English fact string.`,
        `    Can be empty.`
      ].join("\n")
    : "  mustConveyFacts: an array of discrete facts the line must communicate (can be empty)";

  const system = [
    "You are annotating dialogue intent metadata for a language-learning game.",
    "Return JSON only.",
    "Given a dialogue line, extract:",
    vocabInstruction,
    "  beat: a single short phrase describing the dramatic beat of the line",
    "  voiceNote: a single short phrase describing the voice character / delivery note for the line",
    "Keep each item concise. Do not invent facts not present in the text."
  ].join("\n");

  const user = [
    `promptVersion: ${promptVersion}`,
    "Output schema:",
    JSON.stringify(INTENT_SCHEMA),
    "",
    "Dialogue line:",
    nodeText
  ].join("\n");

  return { system, user };
}

function buildPartialArtifact(
  nodeId: string,
  dialogueDefinitionId: string,
  nodeText: string,
  authoredIntent: DialogueLineIntent | undefined,
  model: string,
  extractedAtMs: number
): LineIntentArtifact {
  return {
    nodeId,
    dialogueDefinitionId,
    anchorText: nodeText,
    mustConveyFacts: authoredIntent?.mustConveyFacts ?? [],
    beat: authoredIntent?.beat ?? null,
    voiceNote: authoredIntent?.voiceNote ?? null,
    derived: true,
    reviewFlag: true,
    extractedAtMs,
    extractedByModel: model
  };
}

export async function extractIntent(
  input: ExtractIntentInput
): Promise<ExtractIntentResult> {
  const telemetry = input.telemetry ?? createNoOpTelemetrySink();
  const now = input.now ?? (() => Date.now());
  const promptVersion = input.promptVersion ?? INTENT_EXTRACTOR_PROMPT_VERSION;
  const model = input.model ?? DEFAULT_INTENT_EXTRACTOR_MODEL;

  // If all three intent fields are hand-authored, skip LLM entirely.
  if (isHandAuthored(input.authoredIntent)) {
    const authored = input.authoredIntent!;
    return {
      artifact: {
        nodeId: input.nodeId,
        dialogueDefinitionId: input.dialogueDefinitionId,
        anchorText: input.nodeText,
        mustConveyFacts: authored.mustConveyFacts!,
        beat: authored.beat!,
        voiceNote: authored.voiceNote!,
        derived: false,
        reviewFlag: false,
        extractedAtMs: now(),
        extractedByModel: "hand-authored"
      }
    };
  }

  const prompt = buildIntentPrompt(input.nodeText, promptVersion, input.targetLanguage);
  const startedAt = now();

  await emitTelemetry(
    telemetry,
    createTelemetryEvent("chunk.extraction-started", {
      timestamp: startedAt,
      sceneId: input.dialogueDefinitionId,
      contentHash: input.contentHash,
      lang: "en",
      extractorModel: model,
      extractorPromptVersion: promptVersion
    })
  );

  let response: { text: string; requestId: string | null };
  try {
    response = await input.llmClient.generate({
      model,
      systemPrompt: prompt.system,
      userPrompt: prompt.user,
      maxTokens: input.maxTokens ?? 300
    });
  } catch (error) {
    const failure = {
      code: "intent_extractor_request_failed",
      message:
        error instanceof Error ? error.message : "Intent extraction failed"
    };
    await emitTelemetry(
      telemetry,
      createTelemetryEvent("chunk.extraction-failed", {
        timestamp: now(),
        sceneId: input.dialogueDefinitionId,
        contentHash: input.contentHash,
        lang: "en",
        extractorModel: model,
        error: failure
      })
    );
    return {
      artifact: buildPartialArtifact(
        input.nodeId,
        input.dialogueDefinitionId,
        input.nodeText,
        input.authoredIntent,
        model,
        now()
      ),
      failure
    };
  }

  try {
    const candidate = extractJsonCandidate(response.text);
    if (!candidate) {
      throw new Error(
        "Intent extractor response did not contain a JSON object."
      );
    }

    const parsed = JSON.parse(candidate) as unknown;
    if (!validateIntentPayload(parsed)) {
      throw new Error(
        `Intent extractor response failed schema validation: ${toValidationMessage(
          validateIntentPayload.errors
        )}`
      );
    }

    const payload = parsed as {
      mustConveyFacts: string[];
      beat: string;
      voiceNote: string;
    };

    const extractedAtMs = now();
    const artifact: LineIntentArtifact = {
      nodeId: input.nodeId,
      dialogueDefinitionId: input.dialogueDefinitionId,
      anchorText: input.nodeText,
      mustConveyFacts: payload.mustConveyFacts,
      beat: payload.beat || null,
      voiceNote: payload.voiceNote || null,
      derived: true,
      reviewFlag: false,
      extractedAtMs,
      extractedByModel: model
    };

    await emitTelemetry(
      telemetry,
      createTelemetryEvent("chunk.extraction-completed", {
        timestamp: extractedAtMs,
        sceneId: input.dialogueDefinitionId,
        contentHash: input.contentHash,
        lang: "en",
        chunkCount: payload.mustConveyFacts.length,
        latencyMs: extractedAtMs - startedAt,
        tokenCost: {
          input: estimateTokens(prompt.system) + estimateTokens(prompt.user),
          output: estimateTokens(response.text)
        },
        extractorModel: model
      })
    );

    return { artifact };
  } catch (error) {
    const failure = {
      code: "intent_extractor_parse_failed",
      message:
        error instanceof Error
          ? error.message
          : "Intent extraction parse failed"
    };
    await emitTelemetry(
      telemetry,
      createTelemetryEvent("chunk.extraction-failed", {
        timestamp: now(),
        sceneId: input.dialogueDefinitionId,
        contentHash: input.contentHash,
        lang: "en",
        extractorModel: model,
        error: failure
      })
    );
    return {
      artifact: buildPartialArtifact(
        input.nodeId,
        input.dialogueDefinitionId,
        input.nodeText,
        input.authoredIntent,
        model,
        now()
      ),
      failure
    };
  }
}
