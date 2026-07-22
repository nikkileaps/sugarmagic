/**
 * packages/plugins/src/catalog/sugaragent/runtime/memory/conversation-summarizer.ts
 *
 * Purpose: the end-of-conversation memory writer (Plan 073 §073.2).
 * Two phases at session dispose (Plan 073 §D3):
 *
 *   1. DETERMINISTIC merge, awaited synchronously — metCount++,
 *      conversationCounter++, truncated last exchange. This ALWAYS
 *      lands (an IndexedDB write, milliseconds), so an immediate
 *      re-talk sees "we met" even before any LLM returns.
 *   2. ASYNC LLM summary upgrade, fire-and-forget — a small model
 *      distills the transcript into a structured memory delta, merged
 *      with counter gating (a summary for conversation N never
 *      overwrites a record already advanced past N). Any failure
 *      leaves the record holding the deterministic delta only.
 *
 * The response parser molds sugarlang's teacher schema-parser idiom
 * (AJV validation + tolerant JSON extraction from model text). Budget:
 * one call per conversation, capped tokens, explicit SMALL model id
 * (not the NPC-dialogue default).
 *
 * Implements: Plan 073 §073.2 (D2, D3)
 *
 * Status: active
 */

import Ajv from "ajv";
import type { LLMProvider } from "../clients";
import type { SugarAgentLogger } from "../logger";
import type { SugarAgentSessionHistoryEntry } from "../types";
import type { NpcMemoryStore, SummaryMemoryDelta } from "./npc-memory-store";

/** One capped call per conversation. */
export const DEFAULT_SUMMARY_MAX_TOKENS = 400;

/** Defensive caps so a chatty summary can't bloat the durable record. */
const MAX_SUMMARY_CHARS = 600;
const MAX_FACT_CHARS = 200;
const MAX_LIST_ITEMS = 8;

const ajv = new Ajv({ allErrors: true, strict: false, removeAdditional: false });

const summarySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    relationshipSummary: { type: "string" },
    salientFacts: { type: "array", items: { type: "string" } },
    promises: { type: "array", items: { type: "string" } },
    emotionalBeats: { type: "array", items: { type: "string" } },
    lastConversationSummary: { type: "string" }
  }
} as const;

const validateSummary = ajv.compile(summarySchema);

export type SummaryParseError =
  | { code: "invalid_json"; message: string }
  | { code: "schema_validation_failed"; message: string };

export type SummaryParseResult =
  | { delta: SummaryMemoryDelta }
  | { error: SummaryParseError };

function stripMarkdownCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

function extractJsonObjectCandidate(text: string): string {
  const stripped = stripMarkdownCodeFences(text);
  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    return stripped;
  }
  return stripped.slice(firstBrace, lastBrace + 1).trim();
}

function coerceString(value: unknown, maxChars: number): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length <= maxChars ? trimmed : trimmed.slice(0, maxChars);
}

function coerceList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) =>
      entry.length <= MAX_FACT_CHARS ? entry : entry.slice(0, MAX_FACT_CHARS)
    )
    .slice(0, MAX_LIST_ITEMS);
}

/**
 * Parse + validate the model's summary text into a SummaryMemoryDelta.
 * Tolerant of code fences and surrounding prose; a malformed response
 * returns an error so the caller keeps the deterministic-only record.
 */
export function parseSummaryDelta(
  npcDefinitionId: string,
  text: string
): SummaryParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObjectCandidate(text));
  } catch (error) {
    return {
      error: {
        code: "invalid_json",
        message: error instanceof Error ? error.message : "invalid JSON"
      }
    };
  }
  if (!validateSummary(parsed)) {
    return {
      error: {
        code: "schema_validation_failed",
        message: "summary failed schema validation"
      }
    };
  }
  const record = parsed as Record<string, unknown>;
  return {
    delta: {
      npcDefinitionId,
      relationshipSummary: coerceString(
        record.relationshipSummary,
        MAX_SUMMARY_CHARS
      ),
      salientFacts: coerceList(record.salientFacts),
      promises: coerceList(record.promises),
      emotionalBeats: coerceList(record.emotionalBeats),
      lastConversationSummary: coerceString(
        record.lastConversationSummary,
        MAX_SUMMARY_CHARS
      )
    }
  };
}

const SUMMARY_SYSTEM_PROMPT = [
  "You maintain one NPC's private memory of a player across conversations.",
  "Read the transcript and distill what THIS NPC should remember about the PLAYER.",
  "Respond with ONLY a JSON object, no prose, with these fields:",
  '- "relationshipSummary": one short paragraph on the relationship so far.',
  '- "salientFacts": array of concrete facts the player revealed about themselves.',
  '- "promises": array of promises or undertakings either side made.',
  '- "emotionalBeats": array of notable emotional moments.',
  '- "lastConversationSummary": 1-2 sentences summarizing this conversation.',
  "Keep every field compact. Omit a field (or use an empty array/string) when nothing applies.",
  "Do NOT invent details not present in the transcript.",
  "Do NOT use dates, clock times, or 'today/yesterday' language — order is tracked elsewhere."
].join("\n");

function buildTranscriptText(
  transcript: readonly SugarAgentSessionHistoryEntry[]
): string {
  return transcript
    .map((entry) => `${entry.role === "user" ? "Player" : "NPC"}: ${entry.text}`)
    .join("\n");
}

/** Build the last-exchange continuity text from the transcript tail. */
export function buildLastExchange(
  transcript: readonly SugarAgentSessionHistoryEntry[]
): string {
  return buildTranscriptText(transcript.slice(-2));
}

export type SummaryOutcomeStatus =
  | "merged"
  | "stale-dropped"
  | "parse-failed"
  | "failed"
  | "skipped-no-llm"
  | "skipped-empty";

export interface SummaryOutcome {
  status: SummaryOutcomeStatus;
  model?: string | null;
}

export interface ConversationSummaryDeps {
  store: NpcMemoryStore;
  llmProvider: LLMProvider | null;
  logger: SugarAgentLogger;
  /** Override the summary token cap (else DEFAULT_SUMMARY_MAX_TOKENS). */
  maxTokens?: number;
}

export interface ConversationSummaryInput {
  npcDefinitionId: string;
  npcDisplayName?: string | null;
  transcript: readonly SugarAgentSessionHistoryEntry[];
}

async function runAsyncSummary(
  deps: ConversationSummaryDeps,
  input: ConversationSummaryInput,
  conversationCounter: number
): Promise<SummaryOutcome> {
  const { npcDefinitionId, transcript } = input;
  if (!deps.llmProvider) {
    deps.logger.logPluginEvent("memory-summary-skipped", {
      npcDefinitionId,
      reason: "no-llm"
    });
    return { status: "skipped-no-llm" };
  }
  try {
    const result = await deps.llmProvider.generateStructuredTurn({
      // Model id stays server-side (Plan 073.2). The gateway maps
      // purpose:"summary" to SUGARMAGIC_SUGARAGENT_SUMMARY_MODEL.
      model: "",
      purpose: "summary",
      systemPrompt: SUMMARY_SYSTEM_PROMPT,
      userPrompt: buildTranscriptText(transcript),
      maxTokens: deps.maxTokens ?? DEFAULT_SUMMARY_MAX_TOKENS
    });
    const parsed = parseSummaryDelta(npcDefinitionId, result.text);
    if ("error" in parsed) {
      deps.logger.logPluginEvent("memory-summary-parse-failed", {
        npcDefinitionId,
        code: parsed.error.code,
        message: parsed.error.message
      });
      return { status: "parse-failed", model: result.model };
    }
    const applied = await deps.store.mergeSummary(
      parsed.delta,
      conversationCounter
    );
    deps.logger.logPluginEvent("memory-summary-merged", {
      npcDefinitionId,
      applied,
      conversationCounter,
      model: result.model
    });
    return { status: applied ? "merged" : "stale-dropped", model: result.model };
  } catch (error) {
    deps.logger.logPluginEvent("memory-summary-failed", {
      npcDefinitionId,
      error: error instanceof Error ? error.message : String(error)
    });
    return { status: "failed" };
  }
}

export interface ConversationSummaryHandle {
  /** The conversation counter the deterministic merge produced; the
   *  async summary is gated against it. */
  conversationCounter: number;
  /** Resolves when the async LLM summary settles (merged / dropped /
   *  failed / skipped). Callers may fire-and-forget it. */
  summaryComplete: Promise<SummaryOutcome>;
}

/**
 * Two-phase end-of-conversation write. Awaits the deterministic merge
 * (phase 1), then kicks the async LLM summary (phase 2) and returns
 * its promise for the caller to fire-and-forget or await (tests).
 */
export async function summarizeConversationAtDispose(
  deps: ConversationSummaryDeps,
  input: ConversationSummaryInput
): Promise<ConversationSummaryHandle> {
  // Mini-review fix — a session the player never spoke in is not a
  // "conversation" (metCount counts distinct conversations). Skip the ENTIRE
  // write, not just the LLM summary: otherwise opening a dialogue, reading the
  // NPC's greeting, and closing without typing would bump metCount and make the
  // NPC treat the player as a returning acquaintance next visit.
  const hasPlayerTurn = input.transcript.some((entry) => entry.role === "user");
  if (!hasPlayerTurn) {
    deps.logger.logPluginEvent("memory-skipped", {
      npcDefinitionId: input.npcDefinitionId,
      reason: "no-player-turn"
    });
    return {
      conversationCounter: 0,
      summaryComplete: Promise.resolve({ status: "skipped-empty" })
    };
  }
  const { conversationCounter } = await deps.store.mergeDeterministic({
    npcDefinitionId: input.npcDefinitionId,
    lastExchange: buildLastExchange(input.transcript)
  });
  deps.logger.logPluginEvent("memory-deterministic-merged", {
    npcDefinitionId: input.npcDefinitionId,
    conversationCounter
  });
  const summaryComplete = runAsyncSummary(deps, input, conversationCounter);
  return { conversationCounter, summaryComplete };
}
