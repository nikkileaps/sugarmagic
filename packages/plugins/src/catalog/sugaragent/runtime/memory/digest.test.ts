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
import type { NpcMemoryRecord } from "./npc-memory-store";
import {
  buildMemoryAnnotation,
  buildMemoryDigest,
  type MemoizedNpcMemory
} from "./digest";

function record(overrides: Partial<NpcMemoryRecord> = {}): NpcMemoryRecord {
  return {
    key: "u::p::npc.finnick",
    userId: "u",
    playthroughId: "p",
    npcDefinitionId: "npc.finnick",
    schemaVersion: 1,
    metCount: 2,
    conversationCounter: 2,
    lastExchange: "Player: bye\nNPC: see you",
    relationshipSummary: "Warming to Mim, a cheese enthusiast.",
    salientFacts: ["Name is Mim", "Loves aged gouda"],
    promises: ["Save a wedge of gouda"],
    emotionalBeats: ["laughed together"],
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
