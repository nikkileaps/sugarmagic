/**
 * packages/plugins/src/catalog/sugaragent/runtime/quest/quest-context-middleware.test.ts
 *
 * Purpose: Verifies the quest-context CONTEXT-stage middleware (Plan
 * 077.2 / D3): resolves world lore once per quest-state, memoizes it,
 * re-resolves when the quest state changes, is a no-op with no active
 * quest or non-agent selection, and enforces the D2 prompt invariant
 * (objective text seeds retrieval only -- the raw displayName/description
 * are used as the search query and never appear in the annotation).
 *
 * Implements: Plan 077 §077.2 tests
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import type { ConversationExecutionContext } from "@sugarmagic/runtime-core";
import {
  createQuestContextMiddleware,
  QUEST_CONTEXT_ANNOTATION_KEY,
  QUEST_CONTEXT_STATE_KEY,
  type MemoizedQuestContext,
  type QuestContextAnnotation
} from "./quest-context-middleware";
import type { VectorStoreProvider } from "../clients";
import type { RetrievedEvidenceItem } from "../types";

function makeExecution(
  state: Record<string, unknown> = {},
  runtimeOverrides: Partial<ConversationExecutionContext["runtimeContext"]> = {}
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
    annotations: {},
    runtimeContext: {
      here: null,
      playerLocation: null,
      playerPosition: null,
      playerArea: null,
      npcLocation: null,
      npcPosition: null,
      npcArea: null,
      npcPlayerRelation: null,
      npcBehavior: null,
      trackedQuest: {
        questId: "quest.find-the-luggage",
        displayName: "Find the Luggage"
      },
      activeQuestStage: {
        questId: "quest.find-the-luggage",
        stageId: "stage.search",
        stageDisplayName: "Search the station"
      },
      activeQuestObjectives: {
        questId: "quest.find-the-luggage",
        displayName: "Find the Luggage",
        stageId: "stage.search",
        stageDisplayName: "Search the station",
        objectives: [
          {
            nodeId: "node.find-suitcase",
            displayName: "Find your lost suitcase",
            description: "Track down the missing suitcase from the luggage carousel"
          }
        ]
      },
      ...runtimeOverrides
    }
  };
}

function fakeLore(text: string): RetrievedEvidenceItem {
  return {
    fileId: "lore.station-info",
    filename: "station-info.md",
    score: 0.9,
    text,
    attributes: {}
  };
}

function fakeVectorStore(results: RetrievedEvidenceItem[]): {
  provider: VectorStoreProvider;
  searchLore: ReturnType<typeof vi.fn>;
} {
  const searchLore = vi.fn(async () => results);
  return {
    provider: { searchLore } as unknown as VectorStoreProvider,
    searchLore
  };
}

describe("createQuestContextMiddleware", () => {
  it("resolves world lore and publishes it as an annotation", async () => {
    const { provider } = fakeVectorStore([
      fakeLore("Travelers with lost luggage are directed to baggage claim.")
    ]);
    const middleware = createQuestContextMiddleware({ vectorStoreProvider: provider });
    const execution = makeExecution();

    await middleware.prepare?.(execution);

    const annotation = execution.annotations[QUEST_CONTEXT_ANNOTATION_KEY] as QuestContextAnnotation;
    expect(annotation.hasContext).toBe(true);
    expect(annotation.worldContext).toBe(
      "Travelers with lost luggage are directed to baggage claim."
    );
  });

  it("resolves exactly once per quest-state across multiple turns (memoized)", async () => {
    const { provider, searchLore } = fakeVectorStore([
      fakeLore("Travelers with lost luggage are directed to baggage claim.")
    ]);
    const middleware = createQuestContextMiddleware({ vectorStoreProvider: provider });
    const state: Record<string, unknown> = {};

    await middleware.prepare?.(makeExecution(state));
    await middleware.prepare?.(makeExecution(state));
    await middleware.prepare?.(makeExecution(state));

    expect(searchLore).toHaveBeenCalledTimes(1);
    const memo = state[QUEST_CONTEXT_STATE_KEY] as MemoizedQuestContext;
    expect(memo.questId).toBe("quest.find-the-luggage");
    expect(memo.stageId).toBe("stage.search");
  });

  it("re-resolves when the quest stage advances", async () => {
    const { provider, searchLore } = fakeVectorStore([
      fakeLore("Baggage claim is on level B.")
    ]);
    const middleware = createQuestContextMiddleware({ vectorStoreProvider: provider });
    const state: Record<string, unknown> = {};

    // Turn 1: stage.search
    await middleware.prepare?.(makeExecution(state));
    expect(searchLore).toHaveBeenCalledTimes(1);

    // Turn 2: stage advanced to stage.claim
    await middleware.prepare?.(
      makeExecution(state, {
        activeQuestStage: { questId: "quest.find-the-luggage", stageId: "stage.claim", stageDisplayName: "Go to baggage claim" }
      })
    );
    expect(searchLore).toHaveBeenCalledTimes(2);

    const memo = state[QUEST_CONTEXT_STATE_KEY] as MemoizedQuestContext;
    expect(memo.stageId).toBe("stage.claim");
  });

  it("annotates hasContext=false and worldContext=null when no lore is found", async () => {
    const { provider } = fakeVectorStore([]);
    const middleware = createQuestContextMiddleware({ vectorStoreProvider: provider });
    const execution = makeExecution();

    await middleware.prepare?.(execution);

    const annotation = execution.annotations[QUEST_CONTEXT_ANNOTATION_KEY] as QuestContextAnnotation;
    expect(annotation.hasContext).toBe(false);
    expect(annotation.worldContext).toBeNull();
  });

  it("is a no-op when there is no active quest", async () => {
    const { provider, searchLore } = fakeVectorStore([
      fakeLore("something")
    ]);
    const middleware = createQuestContextMiddleware({ vectorStoreProvider: provider });
    const execution = makeExecution({}, { trackedQuest: null, activeQuestObjectives: null });

    await middleware.prepare?.(execution);

    expect(searchLore).not.toHaveBeenCalled();
    expect(execution.annotations[QUEST_CONTEXT_ANNOTATION_KEY]).toBeUndefined();
  });

  it("is a no-op for non-agent (scripted-dialogue) selections", async () => {
    const { provider, searchLore } = fakeVectorStore([fakeLore("something")]);
    const middleware = createQuestContextMiddleware({ vectorStoreProvider: provider });
    const execution: ConversationExecutionContext = {
      selection: {
        conversationKind: "scripted-dialogue",
        npcDefinitionId: "npc.finnick"
      } as ConversationExecutionContext["selection"],
      input: null,
      state: {},
      annotations: {}
    };

    await middleware.prepare?.(execution);

    expect(searchLore).not.toHaveBeenCalled();
    expect(execution.annotations[QUEST_CONTEXT_ANNOTATION_KEY]).toBeUndefined();
  });

  it("degrades gracefully when vectorStoreProvider is absent", async () => {
    const middleware = createQuestContextMiddleware({ vectorStoreProvider: null });
    const execution = makeExecution();

    await middleware.prepare?.(execution);

    const annotation = execution.annotations[QUEST_CONTEXT_ANNOTATION_KEY] as QuestContextAnnotation;
    expect(annotation.hasContext).toBe(false);
    expect(annotation.worldContext).toBeNull();
  });

  it("truncates long world context to the char cap", async () => {
    const longText = "A".repeat(600);
    const { provider } = fakeVectorStore([fakeLore(longText)]);
    const middleware = createQuestContextMiddleware({
      vectorStoreProvider: provider,
      maxWorldContextChars: 100
    });
    const execution = makeExecution();

    await middleware.prepare?.(execution);

    const annotation = execution.annotations[QUEST_CONTEXT_ANNOTATION_KEY] as QuestContextAnnotation;
    expect(annotation.worldContext).not.toBeNull();
    expect(annotation.worldContext!.length).toBeLessThanOrEqual(104); // 100 + "..."
    expect(annotation.worldContext!.endsWith("...")).toBe(true);
  });

  it("D2 prompt invariant: the raw objective displayName does not appear in the annotation", async () => {
    const { provider } = fakeVectorStore([
      fakeLore("Travelers with lost luggage are directed to baggage claim.")
    ]);
    const middleware = createQuestContextMiddleware({ vectorStoreProvider: provider });
    const execution = makeExecution();

    await middleware.prepare?.(execution);

    const annotation = execution.annotations[QUEST_CONTEXT_ANNOTATION_KEY] as QuestContextAnnotation;
    // The objective displayName / description are private; only world-lore enters the annotation.
    expect(annotation.worldContext).not.toContain("Find your lost suitcase");
    expect(annotation.worldContext).not.toContain("Track down the missing suitcase");
    // Only the retrieved world-lore text is present.
    expect(annotation.worldContext).toContain("baggage claim");
  });

  it("uses the objective description as the retrieval query (D2 seed check)", async () => {
    const { provider, searchLore } = fakeVectorStore([fakeLore("world fact")]);
    const middleware = createQuestContextMiddleware({ vectorStoreProvider: provider });
    await middleware.prepare?.(makeExecution());

    // The query must be built from the objective text (seeds retrieval, never in prompt).
    const callArg = searchLore.mock.calls[0]?.[0] as { query: string } | undefined;
    expect(callArg?.query).toBeTruthy();
    expect(callArg?.query).toContain("Track down the missing suitcase");
  });
});
