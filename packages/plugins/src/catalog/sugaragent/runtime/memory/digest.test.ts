/**
 * packages/plugins/src/catalog/sugaragent/runtime/memory/digest.test.ts
 *
 * Purpose: Verifies the memory digest builder + annotation (Plan
 * 073.3): first meeting yields an empty digest, a remembered record
 * renders a compact, met-count-led digest, the digest is deterministic
 * (byte-stable input->output), and the annotation reflects
 * first-meeting / hasMemory.
 *
 * Implements: Plan 073 §073.3 tests
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import type { NpcMemoryRecord, ScoredMemoryItem } from "./npc-memory-store";
import {
  buildMemoryAnnotation,
  buildMemoryDigest,
  type MemoizedNpcMemory
} from "./digest";

/** Build scored items from plain strings for fixtures. */
function items(...texts: string[]): ScoredMemoryItem[] {
  return texts.map((text) => ({ text, importance: 5, lastUpdated: 1 }));
}

/** A single scored item with explicit importance + recency. */
function scored(text: string, importance: number, lastUpdated: number): ScoredMemoryItem {
  return { text, importance, lastUpdated };
}

function record(overrides: Partial<NpcMemoryRecord> = {}): NpcMemoryRecord {
  return {
    key: "u::p::npc.finnick",
    userId: "u",
    playthroughId: "p",
    npcDefinitionId: "npc.finnick",
    schemaVersion: 2,
    metCount: 2,
    conversationCounter: 2,
    lastExchange: "Player: bye\nNPC: see you",
    relationshipSummary: "Warming to Mim, a cheese enthusiast.",
    salientFacts: items("Name is Mim", "Loves aged gouda"),
    promises: items("Save a wedge of gouda"),
    emotionalBeats: items("laughed together"),
    disclosures: [],
    lastConversationSummary: "Mim asked about the shop's oldest cheese.",
    summaryCounter: 2,
    ...overrides
  };
}

describe("buildMemoryDigest", () => {
  it("returns empty for a first meeting (null record or metCount 0)", () => {
    expect(buildMemoryDigest(null)).toBe("");
    expect(buildMemoryDigest(record({ metCount: 0 }))).toBe("");
  });

  it("renders a compact met-count-led digest for a remembered player", () => {
    const digest = buildMemoryDigest(record());
    expect(digest).toContain("What you remember about this player");
    expect(digest).toContain("spoken with them 2 times before");
    // Plan 073.4 — first-meeting semantics: a remembered player is greeted as
    // an acquaintance, not re-introduced.
    expect(digest).toContain("do not re-introduce yourself");
    expect(digest).toContain("Warming to Mim");
    expect(digest).toContain("Loves aged gouda");
    expect(digest).toContain("Save a wedge of gouda");
    expect(digest).toContain("Mim asked about the shop's oldest cheese.");
  });

  it("uses the singular phrasing for one prior meeting", () => {
    expect(buildMemoryDigest(record({ metCount: 1 }))).toContain(
      "spoken with them once before"
    );
  });

  it("omits absent fields (deterministic-only record: met but not yet summarized)", () => {
    const digest = buildMemoryDigest(
      record({
        metCount: 1,
        relationshipSummary: "",
        salientFacts: [],
        promises: [],
        emotionalBeats: [],
        lastConversationSummary: ""
      })
    );
    expect(digest).toContain("spoken with them once before");
    expect(digest).not.toContain("Relationship so far:");
    expect(digest).not.toContain("Things you have learned");
  });

  it("is deterministic (same record -> identical bytes)", () => {
    expect(buildMemoryDigest(record())).toBe(buildMemoryDigest(record()));
  });

  it("hard-caps the digest length", () => {
    const digest = buildMemoryDigest(
      record({ relationshipSummary: "x".repeat(5000) }),
      120
    );
    expect(digest.length).toBeLessThanOrEqual(120);
  });
});

describe("buildMemoryDigest salience ranking (080.4)", () => {
  it("keeps the highest-ranked facts and drops the lowest under budget pressure", () => {
    const digest = buildMemoryDigest(
      record({
        relationshipSummary: "",
        lastConversationSummary: "",
        promises: [],
        emotionalBeats: [],
        disclosures: [],
        salientFacts: [
          scored("PIVOTAL high-importance fact worth keeping", 10, 2),
          scored("TRIVIAL low-importance fact that should drop", 1, 2)
        ]
      }),
      // Enough room for the preamble + one of the two facts, not both.
      300
    );
    expect(digest).toContain("PIVOTAL high-importance fact worth keeping");
    expect(digest).not.toContain("TRIVIAL low-importance fact that should drop");
    expect(digest.length).toBeLessThanOrEqual(300);
  });

  it("renders a LOW-importance disclosure even under a pile of high-importance facts (reserved budget)", () => {
    const digest = buildMemoryDigest(
      record({
        relationshipSummary: "",
        lastConversationSummary: "",
        promises: [],
        emotionalBeats: [],
        // A wall of high-importance facts that would eat the whole budget
        // if disclosures were not reserved their own slice.
        salientFacts: Array.from({ length: 20 }, (_, i) =>
          scored(`very important fact number ${i} about the player`, 10, 2)
        ),
        disclosures: [scored("told them I love aged gouda", 1, 2)]
      }),
      400
    );
    // The low-importance disclosure survives the high-importance fact pile.
    expect(digest).toContain("told them I love aged gouda");
    expect(digest.length).toBeLessThanOrEqual(400);
  });

  it("prioritizes the freshest last-conversation summary above detail facts", () => {
    const digest = buildMemoryDigest(
      record({
        relationshipSummary: "",
        disclosures: [],
        promises: [],
        emotionalBeats: [],
        lastConversationSummary: "We spoke about the upcoming harvest festival.",
        salientFacts: [scored("minor detail that can be dropped", 2, 2)]
      }),
      // Room for preamble + the last-conversation line, but tight for facts.
      280
    );
    expect(digest).toContain("upcoming harvest festival");
    expect(digest.length).toBeLessThanOrEqual(280);
  });

  it("is byte-identical across renders with disclosures + varied recency", () => {
    const rec = record({
      disclosures: [scored("told them about Maggie", 7, 2)],
      salientFacts: [scored("older fact", 6, 1), scored("newer fact", 6, 2)]
    });
    expect(buildMemoryDigest(rec)).toBe(buildMemoryDigest(rec));
  });
});

describe("buildMemoryDigest disclosures directive (080.5)", () => {
  it("renders the positive-framed directive when disclosures exist", () => {
    const digest = buildMemoryDigest(
      record({ disclosures: [scored("told them my wife is Maggie", 7, 2)] })
    );
    expect(digest).toContain("told them my wife is Maggie");
    // Positive framing: permission to mention naturally, not a prohibition.
    expect(digest).toContain("You can refer to these naturally");
    expect(digest).toContain("already shared between you");
    expect(digest).toContain("as if for the first time");
  });

  it("omits the directive when there are no disclosures", () => {
    const digest = buildMemoryDigest(record({ disclosures: [] }));
    expect(digest).not.toContain("already shared between you");
    expect(digest).not.toContain("as if for the first time");
  });
});

describe("buildMemoryAnnotation", () => {
  it("flags a first meeting", () => {
    const memory: MemoizedNpcMemory = { record: null, digest: "", metCount: 0 };
    expect(buildMemoryAnnotation(memory)).toEqual({
      metCount: 0,
      firstMeeting: true,
      hasMemory: false
    });
  });

  it("flags a remembered player", () => {
    const rec = record();
    const memory: MemoizedNpcMemory = {
      record: rec,
      digest: buildMemoryDigest(rec),
      metCount: rec.metCount
    };
    expect(buildMemoryAnnotation(memory)).toEqual({
      metCount: 2,
      firstMeeting: false,
      hasMemory: true
    });
  });
});
