/**
 * packages/plugins/src/catalog/sugaragent/runtime/memory/memory-middleware.test.ts
 *
 * Purpose: Verifies the NPC memory context-stage middleware (Plan
 * 073.3 / D6): loads the record ONCE and memoizes it in
 * execution.state, republishes the annotation each turn, is a no-op
 * for non-agent selections, and keeps the digest byte-stable when the
 * underlying store changes mid-session (a previous conversation's
 * summarizer landing must NOT mutate the memoized digest).
 *
 * Implements: Plan 073 §073.3 tests
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import type { ConversationExecutionContext } from "@sugarmagic/runtime-core";
import { MEMORY_ANNOTATION_KEY, MEMORY_STATE_KEY, type MemoizedNpcMemory } from "./digest";
import { createNpcMemoryMiddleware } from "./memory-middleware";
import type { NpcMemoryRecord, NpcMemoryStore } from "./npc-memory-store";

function record(overrides: Partial<NpcMemoryRecord> = {}): NpcMemoryRecord {
  return {
    key: "u::p::npc.finnick",
    userId: "u",
    playthroughId: "p",
    npcDefinitionId: "npc.finnick",
    schemaVersion: 1,
    metCount: 1,
    conversationCounter: 1,
    lastExchange: "",
    relationshipSummary: "",
    salientFacts: [],
    promises: [],
    emotionalBeats: [],
    lastConversationSummary: "",
    summaryCounter: 0,
    ...overrides
  };
}

function agentExecution(
  state: Record<string, unknown> = {}
): ConversationExecutionContext {
  return {
    selection: {
      conversationKind: "free-form",
      npcDefinitionId: "npc.finnick",
      npcDisplayName: "Finnick",
      interactionMode: "agent"
    } as ConversationExecutionContext["selection"],
    input: null,
    state,
    annotations: {}
  };
}

function fakeStore(loadResult: NpcMemoryRecord | null): {
  store: NpcMemoryStore;
  load: ReturnType<typeof vi.fn>;
} {
  const load = vi.fn(async () => loadResult);
  return { store: { load } as unknown as NpcMemoryStore, load };
}

describe("createNpcMemoryMiddleware", () => {
  it("loads the record once and memoizes it across turns", async () => {
    const { store, load } = fakeStore(record({ metCount: 3 }));
    const middleware = createNpcMemoryMiddleware({ resolveStore: () => store });
    const state: Record<string, unknown> = {};

    // Turn 1 (startSession): loads + memoizes.
    await middleware.prepare?.(agentExecution(state));
    // Turn 2 (advance): state carries forward; no reload.
    await middleware.prepare?.(agentExecution(state));

    expect(load).toHaveBeenCalledTimes(1);
    expect((state[MEMORY_STATE_KEY] as MemoizedNpcMemory).metCount).toBe(3);
  });

  it("publishes the metCount / first-meeting / hasMemory annotation", async () => {
    const { store } = fakeStore(record({ metCount: 2 }));
    const execution = agentExecution();
    await createNpcMemoryMiddleware({ resolveStore: () => store }).prepare?.(
      execution
    );
    expect(execution.annotations[MEMORY_ANNOTATION_KEY]).toEqual({
      metCount: 2,
      firstMeeting: false,
      hasMemory: true
    });
  });

  it("annotates a first meeting when there is no record", async () => {
    const { store } = fakeStore(null);
    const execution = agentExecution();
    await createNpcMemoryMiddleware({ resolveStore: () => store }).prepare?.(
      execution
    );
    expect(execution.annotations[MEMORY_ANNOTATION_KEY]).toEqual({
      metCount: 0,
      firstMeeting: true,
      hasMemory: false
    });
  });

  it("is a no-op for a non-agent selection", async () => {
    const { store, load } = fakeStore(record());
    const execution: ConversationExecutionContext = {
      selection: {
        conversationKind: "scripted-dialogue",
        npcDefinitionId: "npc.finnick"
      } as ConversationExecutionContext["selection"],
      input: null,
      state: {},
      annotations: {}
    };
    await createNpcMemoryMiddleware({ resolveStore: () => store }).prepare?.(
      execution
    );
    expect(load).not.toHaveBeenCalled();
    expect(execution.state[MEMORY_STATE_KEY]).toBeUndefined();
    expect(execution.annotations[MEMORY_ANNOTATION_KEY]).toBeUndefined();
  });

  it("keeps the digest byte-stable when the store changes mid-session", async () => {
    // The fake store would return an ENRICHED record on a second load
    // (as if a prior conversation's summarizer just landed), but the
    // middleware memoized the first load, so the digest must not change.
    const first = record({ metCount: 1 });
    const enriched = record({
      metCount: 1,
      relationshipSummary: "now knows a lot about them"
    });
    let call = 0;
    const load = vi.fn(async () => (call++ === 0 ? first : enriched));
    const store = { load } as unknown as NpcMemoryStore;
    const middleware = createNpcMemoryMiddleware({ resolveStore: () => store });
    const state: Record<string, unknown> = {};

    await middleware.prepare?.(agentExecution(state));
    const digestTurn1 = (state[MEMORY_STATE_KEY] as MemoizedNpcMemory).digest;
    await middleware.prepare?.(agentExecution(state));
    const digestTurn2 = (state[MEMORY_STATE_KEY] as MemoizedNpcMemory).digest;

    expect(digestTurn2).toBe(digestTurn1);
    expect(digestTurn2).not.toContain("now knows a lot about them");
    expect(load).toHaveBeenCalledTimes(1);
  });
});
