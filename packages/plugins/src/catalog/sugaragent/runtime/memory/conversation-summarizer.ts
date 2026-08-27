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
import {
  clampImportance,
  type NpcMemoryStore,
  type SummaryMemoryDelta,
  type SummaryScoredItem
} from "./npc-memory-store";

/**
 * One capped call per conversation. Raised from 400 (v1) at 080.2: the v2
 * schema adds per-item `importance` and a 4th list (`disclosures`), so a
 * within-caps payload is materially larger. 400 could truncate a rich
 * response mid-JSON, which fails AJV and drops the WHOLE summary (leaving
 * only the deterministic record). This ceiling comfortably fits the
 * defensive worst case (all four lists at MAX_LIST_ITEMS x MAX_FACT_CHARS
 * plus both summaries at MAX_SUMMARY_CHARS) -- see the worst-case token
 * test. It is a CEILING, not a target: a compact real summary emits far
 * less and costs the same as before, and the summary model is small/cheap.
 */
export const DEFAULT_SUMMARY_MAX_TOKENS = 3000;

/** Defensive caps so a chatty summary can't bloat the durable record.
 *  Exported so the worst-case token-budget test derives the same bound. */
export const MAX_SUMMARY_CHARS = 600;
export const MAX_FACT_CHARS = 200;
export const MAX_LIST_ITEMS = 8;

const ajv = new Ajv({ allErrors: true, strict: false, removeAdditional: false });

/** A summary-list item: a scored object, or a bare string (a model that
 *  ignores the object shape) which coerces to the default importance. */
const scoredItemSchema = {
  anyOf: [
    { type: "string" },
    {
      type: "object",
      additionalProperties: false,
      required: ["text"],
      properties: {
        text: { type: "string" },
        // Any type -- coerceScoredList/clampImportance sanitize it. Kept
        // lenient so a bad importance never rejects (drops) the whole summary.
        importance: {}
      }
    }
  ]
} as const;

const summarySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    relationshipSummary: { type: "string" },
    salientFacts: { type: "array", items: scoredItemSchema },
    promises: { type: "array", items: scoredItemSchema },
    emotionalBeats: { type: "array", items: scoredItemSchema },
    disclosures: { type: "array", items: scoredItemSchema },
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

/**
 * Coerce a summary-list value into scored items. Accepts either scored
 * objects `{ text, importance }` or bare strings (a model that ignored
 * the object shape -> default importance). Trims + caps text length,
 * drops empties, clamps importance, and caps the list length. Plan 080
 * §080.2.
 */
function coerceScoredList(value: unknown): SummaryScoredItem[] {
  if (!Array.isArray(value)) return [];
  const items: SummaryScoredItem[] = [];
  for (const entry of value) {
    let rawText: unknown;
    let rawImportance: unknown;
    if (typeof entry === "string") {
      rawText = entry;
    } else if (entry && typeof entry === "object") {
      rawText = (entry as { text?: unknown }).text;
      rawImportance = (entry as { importance?: unknown }).importance;
    }
    if (typeof rawText !== "string") continue;
    const trimmed = rawText.trim();
    if (trimmed.length === 0) continue;
    items.push({
      text: trimmed.length <= MAX_FACT_CHARS ? trimmed : trimmed.slice(0, MAX_FACT_CHARS),
      importance: clampImportance(rawImportance)
    });
    if (items.length >= MAX_LIST_ITEMS) break;
  }
  return items;
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
      salientFacts: coerceScoredList(record.salientFacts),
      promises: coerceScoredList(record.promises),
      emotionalBeats: coerceScoredList(record.emotionalBeats),
      disclosures: coerceScoredList(record.disclosures),
      lastConversationSummary: coerceString(
        record.lastConversationSummary,
        MAX_SUMMARY_CHARS
      )
    }
  };
}

const SUMMARY_SYSTEM_PROMPT = [
  "You maintain one NPC's private memory of a player across conversations.",
  "Read the transcript and distill what THIS NPC should remember.",
  "Respond with ONLY a JSON object, no prose, with these fields:",
  '- "relationshipSummary": one short paragraph on the relationship so far.',
  '- "salientFacts": things the PLAYER revealed about themselves.',
  '- "promises": promises or undertakings either side made.',
  '- "emotionalBeats": notable emotional moments.',
  '- "disclosures": things the NPC told the PLAYER about ITSELF this',
  "  conversation, so it does NOT repeat them next time -- e.g. \"told them",
  '  my wife is Maggie", "told them I love aged gouda".',
  '- "lastConversationSummary": 1-2 sentences summarizing this conversation.',
  "salientFacts, promises, emotionalBeats, and disclosures are arrays of",
  'objects: { "text": "<one short clause>", "importance": <integer 1-10> },',
  "where importance is how much this matters for future conversations",
  "(1 = trivial, 10 = pivotal).",
  "Keep every field compact; prefer FEW, high-signal items. Omit a field (or",
  "use an empty array/string) when nothing applies.",
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
      // Which model runs this is the gateway's call, not the caller's: it
      // maps purpose "summary" to SUGARMAGIC_SUGARAGENT_SUMMARY_MODEL.
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
