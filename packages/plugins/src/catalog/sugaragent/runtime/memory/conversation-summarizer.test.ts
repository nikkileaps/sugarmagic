/**
 * packages/plugins/src/catalog/sugaragent/runtime/memory/conversation-summarizer.test.ts
 *
 * Purpose: Verifies the end-of-conversation summarizer (Plan 073
 * §073.2) against a mock gateway: the deterministic merge ALWAYS
 * lands (phase 1), a valid LLM summary merges (phase 2), a gateway
 * failure leaves the deterministic-only record intact, and a summary
 * whose counter is behind the record is dropped. Plus parser
 * tolerance (code fences / surrounding prose) and rejection.
 *
 * Implements: Plan 073 §073.2 tests
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import type { LLMGenerateRequest, LLMGenerateResult, LLMProvider } from "../clients";
import { createSugarAgentLogger } from "../logger";
import type { SugarAgentSessionHistoryEntry } from "../types";
import {
  InMemoryNpcMemoryBackend,
  NpcMemoryStore
} from "./npc-memory-store";
import {
  DEFAULT_SUMMARY_MAX_TOKENS,
  MAX_FACT_CHARS,
  MAX_LIST_ITEMS,
  MAX_SUMMARY_CHARS,
  parseSummaryDelta,
  summarizeConversationAtDispose,
  type ConversationSummaryDeps
} from "./conversation-summarizer";

const FINNICK = "npc.finnick";
const logger = createSugarAgentLogger(false);

function newStore(): NpcMemoryStore {
  return new NpcMemoryStore({
    userId: "user-1",
    playthroughId: "play-1",
    backend: new InMemoryNpcMemoryBackend()
  });
}

function transcript(): SugarAgentSessionHistoryEntry[] {
  return [
    { role: "assistant", text: "Welcome to the cheese shop!" },
    { role: "user", text: "Hi, I'm Mim. I love aged gouda." },
    { role: "assistant", text: "A gouda person! Come back soon." }
  ];
}

function mockProvider(
  handler: (request: LLMGenerateRequest) => LLMGenerateResult | Promise<LLMGenerateResult>
): LLMProvider {
  return { generateStructuredTurn: async (request) => handler(request) };
}

const VALID_SUMMARY = JSON.stringify({
  relationshipSummary: "Met Mim, a friendly newcomer who likes cheese.",
  salientFacts: [
    { text: "Name is Mim", importance: 8 },
    { text: "Loves aged gouda", importance: 6 }
  ],
  promises: [],
  emotionalBeats: [{ text: "warm first meeting", importance: 5 }],
  disclosures: [{ text: "told them my wife is Maggie", importance: 7 }],
  lastConversationSummary: "Mim introduced themselves and their taste in cheese."
});

describe("summarizeConversationAtDispose", () => {
  it("lands the deterministic merge before the summary resolves", async () => {
    const store = newStore();
    const deps: ConversationSummaryDeps = {
      store,
      logger,
      llmProvider: mockProvider(() => ({
        text: VALID_SUMMARY,
        usage: null,
        model: "claude-haiku-4-5"
      }))
    };

    const handle = await summarizeConversationAtDispose(deps, {
      npcDefinitionId: FINNICK,
      transcript: transcript()
    });

    // Phase 1 already landed: "we met" is visible immediately.
    const afterDeterministic = await store.load(FINNICK);
    expect(afterDeterministic?.metCount).toBe(1);
    expect(afterDeterministic?.conversationCounter).toBe(1);
    expect(handle.conversationCounter).toBe(1);
    // Summary not merged yet in the record (still pending) — but the
    // deterministic continuity floor is present.
    expect(afterDeterministic?.lastExchange).toContain("gouda person");
  });

  it("merges a valid LLM summary (phase 2)", async () => {
    const store = newStore();
    const handle = await summarizeConversationAtDispose(
      {
        store,
        logger,
        llmProvider: mockProvider(() => ({
          text: VALID_SUMMARY,
          usage: null,
          model: "claude-haiku-4-5"
        }))
      },
      { npcDefinitionId: FINNICK, transcript: transcript() }
    );

    const outcome = await handle.summaryComplete;
    expect(outcome.status).toBe("merged");

    const record = await store.load(FINNICK);
    expect(record?.relationshipSummary).toContain("Mim");
    // 080.2: scored items land with importance preserved; disclosures too.
    expect(record?.salientFacts.map((item) => item.text)).toContain("Loves aged gouda");
    expect(record?.salientFacts.find((item) => item.text === "Name is Mim")?.importance).toBe(8);
    expect(record?.disclosures.map((item) => item.text)).toContain(
      "told them my wife is Maggie"
    );
    expect(record?.lastConversationSummary).toContain("introduced");
  });

  it("leaves the deterministic-only record when the gateway fails", async () => {
    const store = newStore();
    const handle = await summarizeConversationAtDispose(
      {
        store,
        logger,
        llmProvider: mockProvider(() => {
          throw new Error("gateway 503");
        })
      },
      { npcDefinitionId: FINNICK, transcript: transcript() }
    );

    const outcome = await handle.summaryComplete;
    expect(outcome.status).toBe("failed");

    const record = await store.load(FINNICK);
    expect(record?.metCount).toBe(1);
    expect(record?.relationshipSummary).toBe("");
    expect(record?.salientFacts).toEqual([]);
  });

  it("reports parse-failed and keeps the deterministic record on malformed JSON", async () => {
    const store = newStore();
    const handle = await summarizeConversationAtDispose(
      {
        store,
        logger,
        llmProvider: mockProvider(() => ({
          text: "sorry, I could not summarize that",
          usage: null,
          model: "claude-haiku-4-5"
        }))
      },
      { npcDefinitionId: FINNICK, transcript: transcript() }
    );

    const outcome = await handle.summaryComplete;
    expect(outcome.status).toBe("parse-failed");
    expect((await store.load(FINNICK))?.metCount).toBe(1);
  });

  it("drops a summary whose counter is behind the record (late earlier summarizer)", async () => {
    const store = newStore();
    // Simulate a LATER conversation having already summarized: advance
    // the record's summaryCounter past what this dispose will produce.
    await store.mergeSummary(
      { npcDefinitionId: FINNICK, relationshipSummary: "from a later conversation" },
      5
    );

    const handle = await summarizeConversationAtDispose(
      {
        store,
        logger,
        llmProvider: mockProvider(() => ({
          text: VALID_SUMMARY,
          usage: null,
          model: "claude-haiku-4-5"
        }))
      },
      { npcDefinitionId: FINNICK, transcript: transcript() }
    );
    // This dispose's deterministic merge produced counter 1, which is
    // behind the record's summaryCounter (5).
    expect(handle.conversationCounter).toBe(1);
    const outcome = await handle.summaryComplete;
    expect(outcome.status).toBe("stale-dropped");

    // The newer summary survives.
    expect((await store.load(FINNICK))?.relationshipSummary).toBe(
      "from a later conversation"
    );
  });

  it("writes NOTHING when the player never spoke (no metCount bump)", async () => {
    const store = newStore();
    let called = 0;
    const handle = await summarizeConversationAtDispose(
      {
        store,
        logger,
        llmProvider: mockProvider(() => {
          called += 1;
          return { text: VALID_SUMMARY, usage: null, model: "m" };
        })
      },
      {
        npcDefinitionId: FINNICK,
        transcript: [{ role: "assistant", text: "Hello there!" }]
      }
    );

    const outcome = await handle.summaryComplete;
    expect(outcome.status).toBe("skipped-empty");
    expect(called).toBe(0);
    // A greeting-only open/close is NOT a meeting: no record, no metCount bump,
    // so the next visit is still a first meeting.
    expect(handle.conversationCounter).toBe(0);
    expect(await store.load(FINNICK)).toBeNull();
  });

  it("skips the LLM call when no provider is configured", async () => {
    const store = newStore();
    const handle = await summarizeConversationAtDispose(
      { store, logger, llmProvider: null },
      { npcDefinitionId: FINNICK, transcript: transcript() }
    );
    expect((await handle.summaryComplete).status).toBe("skipped-no-llm");
    expect((await store.load(FINNICK))?.metCount).toBe(1);
  });
});

describe("parseSummaryDelta", () => {
  it("parses valid JSON wrapped in code fences and prose", () => {
    const text = [
      "Here is the summary:",
      "```json",
      VALID_SUMMARY,
      "```"
    ].join("\n");
    const result = parseSummaryDelta(FINNICK, text);
    expect("delta" in result).toBe(true);
    if ("delta" in result) {
      expect(result.delta.salientFacts?.map((item) => item.text)).toEqual([
        "Name is Mim",
        "Loves aged gouda"
      ]);
      expect(result.delta.salientFacts?.[0]?.importance).toBe(8);
      expect(result.delta.disclosures?.map((item) => item.text)).toEqual([
        "told them my wife is Maggie"
      ]);
    }
  });

  it("clamps out-of-range or missing importance into 1-10 (080.2)", () => {
    const result = parseSummaryDelta(
      FINNICK,
      JSON.stringify({
        salientFacts: [
          { text: "too high", importance: 99 },
          { text: "too low", importance: -4 },
          { text: "not a number", importance: "high" },
          { text: "missing" }
        ]
      })
    );
    expect("delta" in result).toBe(true);
    if ("delta" in result) {
      const byText = Object.fromEntries(
        (result.delta.salientFacts ?? []).map((item) => [item.text, item.importance])
      );
      expect(byText["too high"]).toBe(10);
      expect(byText["too low"]).toBe(1);
      expect(byText["not a number"]).toBe(5); // DEFAULT_ITEM_IMPORTANCE
      expect(byText["missing"]).toBe(5);
    }
  });

  it("accepts bare strings for back-compat, defaulting importance (080.2)", () => {
    const result = parseSummaryDelta(
      FINNICK,
      JSON.stringify({ salientFacts: ["Name is Mim", "Loves gouda"] })
    );
    expect("delta" in result).toBe(true);
    if ("delta" in result) {
      expect(result.delta.salientFacts).toEqual([
        { text: "Name is Mim", importance: 5 },
        { text: "Loves gouda", importance: 5 }
      ]);
    }
  });

  it("errors on non-JSON", () => {
    const result = parseSummaryDelta(FINNICK, "no json here");
    expect("error" in result && result.error.code).toBe("invalid_json");
  });

  it("errors on schema violation (wrong field types)", () => {
    const result = parseSummaryDelta(
      FINNICK,
      JSON.stringify({ salientFacts: "should be an array" })
    );
    expect("error" in result && result.error.code).toBe("schema_validation_failed");
  });

  it("coerces and caps oversized fields", () => {
    const result = parseSummaryDelta(
      FINNICK,
      JSON.stringify({
        relationshipSummary: "x".repeat(5000),
        salientFacts: Array.from({ length: 30 }, (_, i) => `fact ${i}`)
      })
    );
    expect("delta" in result).toBe(true);
    if ("delta" in result) {
      expect(result.delta.relationshipSummary?.length).toBeLessThanOrEqual(600);
      expect(result.delta.salientFacts?.length).toBeLessThanOrEqual(8);
    }
  });
});

describe("summary token budget (080.2)", () => {
  it("a worst-case at-caps payload fits DEFAULT_SUMMARY_MAX_TOKENS", () => {
    // The defensive worst case the caps allow: all four scored lists at
    // MAX_LIST_ITEMS x MAX_FACT_CHARS, every item scored, plus both summaries
    // at MAX_SUMMARY_CHARS. If this fits the output ceiling, no within-caps
    // response can truncate mid-JSON and drop the whole summary.
    const item = { text: "x".repeat(MAX_FACT_CHARS), importance: 10 };
    const list = Array.from({ length: MAX_LIST_ITEMS }, () => item);
    const worstCase = JSON.stringify({
      relationshipSummary: "x".repeat(MAX_SUMMARY_CHARS),
      salientFacts: list,
      promises: list,
      emotionalBeats: list,
      disclosures: list,
      lastConversationSummary: "x".repeat(MAX_SUMMARY_CHARS)
    });
    // ~4 chars/token is the standard rough estimate; use a conservative
    // (denser) 3.2 so the assertion holds even for token-heavy JSON.
    const estimatedTokens = Math.ceil(worstCase.length / 3.2);
    expect(estimatedTokens).toBeLessThanOrEqual(DEFAULT_SUMMARY_MAX_TOKENS);
  });
});
