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

import type { NpcMemoryRecord, ScoredMemoryItem } from "./npc-memory-store";

/** Key under which the memoized memory lives in `execution.state`. */
export const MEMORY_STATE_KEY = "sugaragent.memory";
/** Key under which the per-turn memory annotation is published. */
export const MEMORY_ANNOTATION_KEY = "sugaragent.memory";

/** Default hard cap on the digest text (Plan 073.5 makes this config). */
export const DEFAULT_MEMORY_DIGEST_MAX_CHARS = 800;

/** Reserved share of the digest budget for the disclosures line, so
 *  disclosures (the cross-conversation repetition lever) can't be starved
 *  out by higher-scored facts. Plan 080 §D5 (round-2 epic-review fix). */
const DISCLOSURE_BUDGET_FRACTION = 0.3;

/** Per-conversation recency decay for item ranking (Generative Agents
 *  style): an item last touched `age` conversations ago scores
 *  `importance * RECENCY_DECAY_BASE^age`. Recency keys off `lastUpdated`
 *  (the conversationCounter at last add/refresh), NOT last-retrieved --
 *  the digest is frozen at load, so a read must not mutate the record
 *  (Plan 080 §D5, epic-review round-1 fix). */
const RECENCY_DECAY_BASE = 0.9;

/**
 * The disclosures directive (Plan 080 §D4/§080.5). POSITIVE framing on
 * purpose: prohibitions ("do not mention") make models over-suppress
 * (the NPC clams up and avoids the topic entirely) or over-focus on the
 * named thing. We want the opposite -- the NPC should still bring these up
 * naturally; it just shouldn't RE-INTRODUCE them as if new. So we grant
 * permission + describe the state, per Anthropic's "tell it what to do,
 * not what not to do" guidance. Rendered only when disclosures exist. */
const DISCLOSURE_DIRECTIVE =
  "You can refer to these naturally as things already shared between you; " +
  "you needn't introduce or explain them again as if for the first time.";

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

/** Clip a prose string to a char budget (returns "" when there's no room). */
function clip(text: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}

/** Salience score: importance decayed by how many conversations ago the
 *  item was last touched. Plan 080 §D5. */
function itemScore(item: ScoredMemoryItem, nowCounter: number): number {
  const age = Math.max(0, nowCounter - item.lastUpdated);
  return item.importance * Math.pow(RECENCY_DECAY_BASE, age);
}

/**
 * Rank items by salience (score desc; tie-break on text for a stable,
 * locale-independent order) and greedily pack their texts into `budget`
 * chars, joined by "; ". Highest-scored survive; lowest-scored drop when
 * the budget is tight. Plan 080 §D5.
 */
function rankAndPackItems(
  items: ScoredMemoryItem[],
  nowCounter: number,
  budget: number
): string {
  const ranked = [...items].sort((a, b) => {
    const delta = itemScore(b, nowCounter) - itemScore(a, nowCounter);
    if (delta !== 0) return delta;
    return a.text < b.text ? -1 : a.text > b.text ? 1 : 0;
  });
  const picked: string[] = [];
  let used = 0;
  for (const item of ranked) {
    const text = item.text.trim();
    if (!text) continue;
    const cost = (picked.length > 0 ? 2 : 0) + text.length; // "; " separator
    if (used + cost > budget) continue; // skip; a smaller lower item may still fit
    picked.push(text);
    used += cost;
  }
  return picked.join("; ");
}

/**
 * Build the compact memory digest injected into the cached system
 * prefix. Returns "" for a first meeting (no record, or metCount 0) so
 * no memory block is emitted. Deterministic: same record in, same
 * bytes out (required for byte-stability).
 *
 * Plan 080 §D5 -- salience-ranked, budget-packed. Sections are added in
 * PRIORITY order (highest-value first), and items within a section are
 * ranked by importance x recency so the best survive a tight budget. The
 * disclosures line is reserved a bounded sub-budget and placed early so it
 * is never starved (the repetition lever). `lastConversationSummary` is
 * prioritized ABOVE the detail facts, fixing the pre-080 bug where the
 * freshest continuity was always the first thing dropped.
 */
export function buildMemoryDigest(
  record: NpcMemoryRecord | null,
  maxChars: number = DEFAULT_MEMORY_DIGEST_MAX_CHARS
): string {
  if (!record || record.metCount <= 0) return "";

  const now = record.conversationCounter;
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
  let budget = maxChars - lines.join("\n").length;

  /** Add a fully-formed line if it fits the running budget (accounting for
   *  the joining newline). */
  const addLine = (line: string): void => {
    if (!line) return;
    const cost = 1 + line.length; // newline + line
    if (cost <= budget) {
      lines.push(line);
      budget -= cost;
    }
  };

  // 1. Disclosures — reserved, bounded, and added FIRST among the body so a
  //    low-importance disclosure still renders under pile pressure (D5).
  const disclosureBudget = Math.max(
    0,
    Math.min(Math.floor(maxChars * DISCLOSURE_BUDGET_FRACTION), budget)
  );
  const disclosuresJoined = rankAndPackItems(
    record.disclosures,
    now,
    Math.max(0, disclosureBudget - "You have already told this player about: ".length)
  );
  if (disclosuresJoined) {
    addLine(`You have already told this player about: ${disclosuresJoined}`);
    // The positive-framed directive (080.5) -- keep the NPC free to mention
    // these, just not to re-introduce them as new.
    addLine(DISCLOSURE_DIRECTIVE);
  }

  // 2. Relationship overview (prose, clipped to fit).
  if (record.relationshipSummary) {
    const prefix = "Relationship so far: ";
    const clipped = clip(record.relationshipSummary, budget - 1 - prefix.length);
    if (clipped) addLine(prefix + clipped);
  }

  // 3. Last conversation — freshest continuity, ABOVE the detail facts (fixes
  //    the freshest-first-drop bug).
  if (record.lastConversationSummary) {
    const prefix = "Your last conversation: ";
    const clipped = clip(record.lastConversationSummary, budget - 1 - prefix.length);
    if (clipped) addLine(prefix + clipped);
  }

  // 4. Ranked detail categories fill whatever budget remains, best items first.
  const categories: Array<[string, ScoredMemoryItem[]]> = [
    ["Things you have learned about them", record.salientFacts],
    ["Promises or undertakings", record.promises],
    ["Notable moments", record.emotionalBeats]
  ];
  for (const [label, items] of categories) {
    if (items.length === 0) continue;
    const prefix = `${label}: `;
    const joined = rankAndPackItems(items, now, Math.max(0, budget - 1 - prefix.length));
    if (joined) addLine(prefix + joined);
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
