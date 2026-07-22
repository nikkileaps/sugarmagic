/**
 * packages/plugins/src/catalog/sugaragent/runtime/memory/digest.ts
 *
 * Purpose: the shared shape + builder for the NPC memory that the
 * conversation pipeline reads. The memory middleware (073.3) loads the
 * record ONCE per conversation, builds a compact digest, and memoizes
 * both under `MEMORY_STATE_KEY` in `execution.state` (which persists
 * across turns). GenerateStage reads the digest for the cached system
 * prefix; Plan reads the metCount / hasMemory to answer recall intents.
 *
 * ## Byte-stability (Plan 073 §D4)
 *
 * The digest is computed ONCE from the loaded record and held in
 * execution state. A previous conversation's summarizer completing
 * mid-session must NOT change it — the record was frozen at load, so
 * the digest string is stable for the whole session and 072.4's
 * system-prompt byte-stability holds. Memory changes only BETWEEN
 * conversations (a fresh load), which invalidates the cache exactly
 * when it should. The full record NEVER enters the prompt; only this
 * hard-capped digest does.
 *
 * Implements: Plan 073 §073.3 (D4, D6)
 *
 * Status: active
 */

import type { NpcMemoryRecord } from "./npc-memory-store";

/** Key under which the memoized memory lives in `execution.state`. */
export const MEMORY_STATE_KEY = "sugaragent.memory";
/** Key under which the per-turn memory annotation is published. */
export const MEMORY_ANNOTATION_KEY = "sugaragent.memory";

/** Default hard cap on the digest text (Plan 073.5 makes this config). */
export const DEFAULT_MEMORY_DIGEST_MAX_CHARS = 800;

/** The memory loaded once per conversation and memoized in execution state. */
export interface MemoizedNpcMemory {
  /** The loaded record, or null when this NPC has no memory yet. */
  record: NpcMemoryRecord | null;
  /** The byte-stable digest for the system prompt; "" when nothing to inject. */
  digest: string;
  /** How many prior conversations — 0 means first meeting. */
  metCount: number;
}

/** The per-turn annotation other plugins (sugarlang, 073.4) consume. */
export interface NpcMemoryAnnotation {
  metCount: number;
  /** True on the very first meeting (metCount === 0). */
  firstMeeting: boolean;
  /** True when there is a remembered record with at least one prior meeting. */
  hasMemory: boolean;
}

function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}

function joinItems(items: string[]): string {
  return items.map((item) => item.trim()).filter(Boolean).join("; ");
}

/**
 * Build the compact memory digest injected into the cached system
 * prefix. Returns "" for a first meeting (no record, or metCount 0) so
 * no memory block is emitted. Deterministic: same record in, same
 * bytes out (required for byte-stability).
 */
export function buildMemoryDigest(
  record: NpcMemoryRecord | null,
  maxChars: number = DEFAULT_MEMORY_DIGEST_MAX_CHARS
): string {
  if (!record || record.metCount <= 0) return "";

  const lines: string[] = [
    "What you remember about this player (from earlier conversations):",
    record.metCount === 1
      ? "You have spoken with them once before."
      : `You have spoken with them ${record.metCount} times before.`,
    // Plan 073.4 — first-meeting semantics live here (SugarAgent, memory-
    // driven), NOT in a language plugin. metCount > 0 means you already know
    // this player, so greet them as an acquaintance rather than re-introducing.
    "You already know this player — greet them as an acquaintance; do not re-introduce yourself."
  ];
  if (record.relationshipSummary) {
    lines.push(`Relationship so far: ${record.relationshipSummary}`);
  }
  if (record.salientFacts.length > 0) {
    lines.push(`Things you have learned about them: ${joinItems(record.salientFacts)}`);
  }
  if (record.promises.length > 0) {
    lines.push(`Promises or undertakings: ${joinItems(record.promises)}`);
  }
  if (record.emotionalBeats.length > 0) {
    lines.push(`Notable moments: ${joinItems(record.emotionalBeats)}`);
  }
  if (record.lastConversationSummary) {
    lines.push(`Your last conversation: ${record.lastConversationSummary}`);
  }
  return truncate(lines.join("\n"), maxChars);
}

/** Build the per-turn annotation from a memoized record. */
export function buildMemoryAnnotation(memory: MemoizedNpcMemory): NpcMemoryAnnotation {
  return {
    metCount: memory.metCount,
    firstMeeting: memory.metCount <= 0,
    hasMemory: memory.record != null && memory.metCount > 0
  };
}
