/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/line-intent-extractor.ts
 *
 * WHAT THIS ANSWERS
 *   "What is this ONE line trying to do?" -- the propositions it must
 *   communicate, its dramatic beat, and its delivery note.
 *
 * WHAT A mustConveyFact IS, AND IS NOT
 *   It is a PROPOSITION: "the luggage is missing", "the ferry leaves at dawn".
 *   It exists so a TRANSLATION of this line can be checked -- whatever language
 *   the line is rendered in, it must still convey these. It constrains
 *   RENDERING.
 *
 *   It is NOT vocabulary. From 087.5 until 2026-07-29 this field was a union of
 *   two incompatible types chosen by a flag: with `targetLanguage` set the
 *   prompt asked for target-language lemmaIds, without it, English propositions.
 *   Production always passed the flag, so the field held LEMMA IDS -- which made
 *   this module a per-node TEACHABLE NOMINATOR wearing the name "intent". That
 *   is why the scripted middleware read its "facts" as teachables, and why the
 *   fidelity judge was wired to `intent: null`: asking "does this Spanish line
 *   convey `queso`" is a category error phrased as a prompt.
 *
 *   Naming what to teach is `SceneContextExtractor`'s `concepts`, which nominate
 *   in English and let resolution map them to lemmas. Do not merge the two
 *   again, and do not reintroduce `targetLanguage` here -- a proposition is
 *   about meaning, not about any particular language's words. There is a test
 *   asserting exactly that, because this is the second time the boundary moved.
 *
 * WHY IT IS ITS OWN MODULE
 *   It briefly lived on `SceneContextExtractor` (2026-07-29) and was moved back,
 *   because the two have different DEPENDENCY SCOPE and that is what decides the
 *   artifact boundary:
 *
 *     scene concepts   depend on ALL sources        -> one artifact per scene
 *     line intent      depends on ONE dialogue node -> one artifact per node
 *
 *   Editing a single line must invalidate a single intent, not a scene's worth
 *   of them. A class named for a scene, producing a per-line artifact, also lies
 *   about its scope. Consumers benefit too: the variant generator needs a node's
 *   text and intent, never the scene's concepts.
 *
 * PATTERNS USED
 *   Same shape as the other extractors so all three read alike: constructor DI,
 *   an exported pure prompt builder (assert prompt shape with no model), an Ajv
 *   boundary because model output is untrusted input, and fail-soft -- a failure
 *   keeps whatever the author DID write and flags it for review rather than
 *   throwing.
 *
 * Exports:
 *   - LineIntentExtractor (class)
 *   - LINE_INTENT_PROMPT_VERSION
 *   - LINE_INTENT_PROMPT_TEMPLATE
 *   - LINE_INTENT_SCHEMA
 *   - buildLineIntentPrompt
 *   - LineIntentExtractRequest / LineIntentExtractionResult
 *
 * Implements: Plan 090 story 090.1
 *
 * Status: active
 */

import Ajv from "ajv";
import type { DialogueLineIntent } from "@sugarmagic/domain";
import type { SugarlangLLMClient } from "../llm/types";
import { EXTRACTION_PURPOSE } from "../llm/types";
import type { LineIntentArtifact } from "../contracts/line-intent";
import {
  createNoOpTelemetrySink,
  createTelemetryEvent,
  emitTelemetry,
  type TelemetrySink
} from "../telemetry/telemetry";

const ajv = new Ajv({ allErrors: true, strict: false, removeAdditional: false });

/**
 * Bumped to 090.1.0 when this pass stopped emitting target-language lemmaIds,
 * so mixed-contract artifacts miss the cache and re-extract. See the module
 * header for what the old contract was and why it was wrong.
 */
export const LINE_INTENT_PROMPT_VERSION = "090.1.0";

export const LINE_INTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["mustConveyFacts", "beat", "voiceNote"],
  properties: {
    mustConveyFacts: { type: "array", items: { type: "string", minLength: 1 } },
    beat: { type: "string" },
    voiceNote: { type: "string" }
  }
} as const;

const validateLineIntentPayload = ajv.compile(LINE_INTENT_SCHEMA);

export const LINE_INTENT_PROMPT_TEMPLATE = [
  "You are annotating dialogue intent for a language-learning game.",
  "Return JSON only.",
  "",
  "Given ONE dialogue line, say what that line is trying to do:",
  "",
  "  mustConveyFacts: discrete PROPOSITIONS the line must communicate, in English",
  '    (e.g. "the luggage is missing", "the ferry leaves at dawn"). These exist so a',
  "    translation of this line can be checked: whatever language it is rendered in,",
  "    it must still convey these. Can be empty.",
  "  beat: one short phrase for the dramatic beat of the line.",
  "  voiceNote: one short phrase for the delivery / voice character.",
  "",
  "Do NOT output vocabulary, dictionary forms, or words to teach. Deciding what a",
  "learner should study is a different job and not this one.",
  "Do not invent anything the line does not say."
];

export function buildLineIntentPrompt(
  nodeText: string,
  promptVersion = LINE_INTENT_PROMPT_VERSION
): { system: string; user: string } {
  return {
    system: LINE_INTENT_PROMPT_TEMPLATE.join("\n"),
    user: [
      `promptVersion: ${promptVersion}`,
      "Output schema:",
      JSON.stringify(LINE_INTENT_SCHEMA),
      "",
      "Dialogue line:",
      nodeText
    ].join("\n")
  };
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.trim().length / 4));
}

function extractJsonCandidate(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return null;
}

/** All three fields hand-authored means there is nothing to infer. */
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

/** Fail-soft artifact: keep whatever the author DID write, flag for review. */
function buildPartialIntent(
  request: LineIntentExtractRequest,
  extractedAtMs: number
): LineIntentArtifact {
  return {
    nodeId: request.nodeId,
    dialogueDefinitionId: request.dialogueDefinitionId,
    anchorText: request.nodeText,
    mustConveyFacts: request.authoredIntent?.mustConveyFacts ?? [],
    beat: request.authoredIntent?.beat ?? null,
    voiceNote: request.authoredIntent?.voiceNote ?? null,
    derived: true,
    reviewFlag: true,
    extractedAtMs,
    extractedByModel: "gateway-resolved"
  };
}

export interface LineIntentExtractRequest {
  nodeId: string;
  dialogueDefinitionId: string;
  nodeText: string;
  authoredIntent?: DialogueLineIntent;
  contentHash: string;
  promptVersion?: string;
  maxTokens?: number;
}

export interface LineIntentExtractionResult {
  artifact: LineIntentArtifact;
  failure?: { code: string; message: string };
}

export interface LineIntentExtractorDeps {
  llmClient: SugarlangLLMClient;
  telemetry?: TelemetrySink;
  /** Injected clock; defaults to Date.now. Kept injectable for deterministic tests. */
  now?: () => number;
}

/**
 * Infers what one authored line is trying to do. See the module header for what
 * a mustConveyFact is, and for why this is not the place to name vocabulary.
 *
 * Stateless per call -- caching and scheduling belong to the caller, and the
 * cache key is per NODE.
 */
export class LineIntentExtractor {
  constructor(private readonly deps: LineIntentExtractorDeps) {}

  async extract(
    request: LineIntentExtractRequest
  ): Promise<LineIntentExtractionResult> {
    const telemetry = this.deps.telemetry ?? createNoOpTelemetrySink();
    const now = this.deps.now ?? (() => Date.now());
    const promptVersion = request.promptVersion ?? LINE_INTENT_PROMPT_VERSION;

    // Nothing to infer when the author wrote all three fields themselves.
    if (isHandAuthored(request.authoredIntent)) {
      const authored = request.authoredIntent as DialogueLineIntent;
      return {
        artifact: {
          nodeId: request.nodeId,
          dialogueDefinitionId: request.dialogueDefinitionId,
          anchorText: request.nodeText,
          mustConveyFacts: authored.mustConveyFacts as string[],
          beat: authored.beat as string,
          voiceNote: authored.voiceNote as string,
          derived: false,
          reviewFlag: false,
          extractedAtMs: now(),
          extractedByModel: "hand-authored"
        }
      };
    }

    const prompt = buildLineIntentPrompt(request.nodeText, promptVersion);
    const startedAt = now();

    await emitTelemetry(
      telemetry,
      createTelemetryEvent("line-intent.extraction-started", {
        timestamp: startedAt,
        nodeId: request.nodeId,
        dialogueDefinitionId: request.dialogueDefinitionId,
        contentHash: request.contentHash,
        extractorPurpose: EXTRACTION_PURPOSE,
        extractorPromptVersion: promptVersion
      })
    );

    const fail = async (
      code: string,
      message: string
    ): Promise<LineIntentExtractionResult> => {
      const failure = { code, message };
      await emitTelemetry(
        telemetry,
        createTelemetryEvent("line-intent.extraction-failed", {
          timestamp: now(),
          nodeId: request.nodeId,
          dialogueDefinitionId: request.dialogueDefinitionId,
          contentHash: request.contentHash,
          error: failure
        })
      );
      return { artifact: buildPartialIntent(request, now()), failure };
    };

    let response: { text: string; requestId: string | null };
    try {
      response = await this.deps.llmClient.generate({
        purpose: EXTRACTION_PURPOSE,
        systemPrompt: prompt.system,
        userPrompt: prompt.user,
        maxTokens: request.maxTokens ?? 300
      });
    } catch (error) {
      return fail(
        "intent_extractor_request_failed",
        error instanceof Error ? error.message : "Intent extraction failed"
      );
    }

    const candidate = extractJsonCandidate(response.text);
    if (!candidate) {
      return fail(
        "intent_extractor_unparseable_response",
        "Response contained no JSON object"
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch (error) {
      return fail(
        "intent_extractor_invalid_json",
        error instanceof Error ? error.message : "Invalid JSON"
      );
    }

    if (!validateLineIntentPayload(parsed)) {
      return fail(
        "intent_extractor_schema_violation",
        ajv.errorsText(validateLineIntentPayload.errors)
      );
    }

    const payload = parsed as {
      mustConveyFacts: string[];
      beat: string;
      voiceNote: string;
    };
    const extractedAtMs = now();

    await emitTelemetry(
      telemetry,
      createTelemetryEvent("line-intent.extraction-completed", {
        timestamp: extractedAtMs,
        nodeId: request.nodeId,
        dialogueDefinitionId: request.dialogueDefinitionId,
        contentHash: request.contentHash,
        factCount: payload.mustConveyFacts.length,
        latencyMs: extractedAtMs - startedAt,
        tokenCost: {
          input: estimateTokens(prompt.system) + estimateTokens(prompt.user),
          output: estimateTokens(response.text)
        }
      })
    );

    return {
      artifact: {
        nodeId: request.nodeId,
        dialogueDefinitionId: request.dialogueDefinitionId,
        anchorText: request.nodeText,
        mustConveyFacts: payload.mustConveyFacts,
        beat: payload.beat || null,
        voiceNote: payload.voiceNote || null,
        derived: true,
        reviewFlag: false,
        extractedAtMs,
        extractedByModel: "gateway-resolved"
      }
    };
  }
}
