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
import type {
  LorePageResolver,
  ResolvedLorePage,
  VectorStoreProvider
} from "../clients";
import type { RetrievedEvidenceItem } from "../types";

function makeExecution(
  state: Record<string, unknown> = {},
  runtimeOverrides: Partial<ConversationExecutionContext["runtimeContext"]> = {},
  selectionOverrides: Partial<ConversationExecutionContext["selection"]> = {}
): ConversationExecutionContext {
  return {
    selection: {
      conversationKind: "free-form",
      npcDefinitionId: "npc.finnick",
      npcDisplayName: "Finnick",
      interactionMode: "agent",
      ...selectionOverrides
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

function fakeLore(
  text: string,
  score = 0.9,
  attributes: Record<string, unknown> = {}
): RetrievedEvidenceItem {
  return {
    fileId: "lore.station-info",
    filename: "station-info.md",
    score,
    text,
    attributes
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

describe("createQuestContextMiddleware -- result selection", () => {
  it("takes the highest-scoring result rather than the first one returned", async () => {
    const { provider } = fakeVectorStore([
      fakeLore("Lower scoring page.", 0.65),
      fakeLore("Higher scoring page.", 0.88)
    ]);
    const middleware = createQuestContextMiddleware({ vectorStoreProvider: provider });
    const execution = makeExecution();

    await middleware.prepare?.(execution);

    const annotation = execution.annotations[
      QUEST_CONTEXT_ANNOTATION_KEY
    ] as QuestContextAnnotation;
    expect(annotation.worldContext).toBe("Higher scoring page.");
  });

  it("skips a result with empty text and uses the next one", async () => {
    const { provider } = fakeVectorStore([
      fakeLore("   ", 0.92),
      fakeLore("Real world fact.", 0.71)
    ]);
    const middleware = createQuestContextMiddleware({ vectorStoreProvider: provider });
    const execution = makeExecution();

    await middleware.prepare?.(execution);

    const annotation = execution.annotations[
      QUEST_CONTEXT_ANNOTATION_KEY
    ] as QuestContextAnnotation;
    expect(annotation.worldContext).toBe("Real world fact.");
  });

  it("asks for more than one candidate", async () => {
    const { provider, searchLore } = fakeVectorStore([fakeLore("world fact")]);
    const middleware = createQuestContextMiddleware({ vectorStoreProvider: provider });

    await middleware.prepare?.(makeExecution());

    const callArg = searchLore.mock.calls[0]?.[0] as
      | { maxResults: number }
      | undefined;
    expect(callArg?.maxResults).toBeGreaterThan(1);
  });

  it("memoizes the chosen score for threshold calibration", async () => {
    const { provider } = fakeVectorStore([fakeLore("Chosen page.", 0.71)]);
    const middleware = createQuestContextMiddleware({ vectorStoreProvider: provider });
    const state: Record<string, unknown> = {};

    await middleware.prepare?.(makeExecution(state));

    const memo = state[QUEST_CONTEXT_STATE_KEY] as MemoizedQuestContext;
    expect(memo.worldContextScore).toBe(0.71);
  });
});

// 077.5 cost guard: the quest-context middleware must not add any LLM calls.
// It may call vectorStoreProvider.searchLore (a vector-index lookup, not an LLM
// call) once per quest-state change; memoization prevents re-calling it on
// subsequent turns with the same questId+stageId.
describe("createQuestContextMiddleware -- 077.5 cost guard", () => {
  it("memo hit on same quest state makes zero network calls (vector-search + LLM both saved)", async () => {
    const { provider, searchLore } = fakeVectorStore([
      fakeLore("Travelers with lost luggage are directed to baggage claim.")
    ]);
    const middleware = createQuestContextMiddleware({ vectorStoreProvider: provider });
    const state: Record<string, unknown> = {};

    // Cold resolve: one vector-search call expected.
    await middleware.prepare?.(makeExecution(state));
    expect(searchLore).toHaveBeenCalledTimes(1);

    // Two more turns, same quest state: no new calls.
    await middleware.prepare?.(makeExecution(state));
    await middleware.prepare?.(makeExecution(state));
    expect(searchLore).toHaveBeenCalledTimes(1);
  });

  it("does not call any LLM during context resolution -- only vectorStoreProvider.searchLore", async () => {
    // Ensure the fake provider exposes ONLY searchLore. If the middleware ever
    // added an LLM call it would need an additional method here (which would
    // need to be a vi.fn() that can be asserted). An unrecognized call would
    // throw, keeping this guard tight.
    const searchLore = vi.fn(async () => [
      fakeLore("Baggage claim is on level B.")
    ]);
    const providerWithOnlySearchLore: VectorStoreProvider = {
      searchLore
    } as unknown as VectorStoreProvider;
    const middleware = createQuestContextMiddleware({
      vectorStoreProvider: providerWithOnlySearchLore
    });

    await middleware.prepare?.(makeExecution());

    // The one allowed call: vector-index lookup (not an LLM call).
    expect(searchLore).toHaveBeenCalledOnce();
  });
});

// #171 -- the prompt has to be able to say WHOSE page this is. Without a title
// the block reads as an unattributed statement about the present world, and an
// NPC handed a page written about someone else speaks as that character.
describe("createQuestContextMiddleware -- source attribution", () => {
  it("carries the source page title from the chunk attributes", async () => {
    const { provider } = fakeVectorStore([
      fakeLore("A no nonsense station manager.", 0.9, {
        page_id: "lore.entities.npcs.horace_pennyfeather",
        title: "Horace Pennyfeather"
      })
    ]);
    const middleware = createQuestContextMiddleware({ vectorStoreProvider: provider });
    const execution = makeExecution();
    await middleware.prepare?.(execution);

    const annotation = execution.annotations[
      QUEST_CONTEXT_ANNOTATION_KEY
    ] as QuestContextAnnotation;
    expect(annotation.worldContextTitle).toBe("Horace Pennyfeather");
  });

  it("leaves the title null when the chunk carries no title attribute", async () => {
    const { provider } = fakeVectorStore([fakeLore("Baggage claim is on level B.")]);
    const middleware = createQuestContextMiddleware({ vectorStoreProvider: provider });
    const execution = makeExecution();
    await middleware.prepare?.(execution);

    const annotation = execution.annotations[
      QUEST_CONTEXT_ANNOTATION_KEY
    ] as QuestContextAnnotation;
    expect(annotation.worldContextTitle).toBeNull();
  });

  it("reports another NPC's page as not the speaker's own", async () => {
    const { provider } = fakeVectorStore([
      fakeLore("A no nonsense station manager.", 0.9, {
        page_id: "lore.entities.npcs.horace_pennyfeather",
        title: "Horace Pennyfeather"
      })
    ]);
    const middleware = createQuestContextMiddleware({ vectorStoreProvider: provider });
    const execution = makeExecution({}, {}, {
      lorePageId: "lore.entities.npcs.penelope_mccrick"
    });
    await middleware.prepare?.(execution);

    const annotation = execution.annotations[
      QUEST_CONTEXT_ANNOTATION_KEY
    ] as QuestContextAnnotation;
    expect(annotation.worldContextIsOwnPage).toBe(false);
  });

  it("reports the speaker's own page as their own", async () => {
    const { provider } = fakeVectorStore([
      fakeLore("Penelope keeps a suite above the dock.", 0.9, {
        page_id: "lore.entities.npcs.penelope_mccrick",
        title: "Penelope McCrick"
      })
    ]);
    const middleware = createQuestContextMiddleware({ vectorStoreProvider: provider });
    const execution = makeExecution({}, {}, {
      lorePageId: "lore.entities.npcs.penelope_mccrick"
    });
    await middleware.prepare?.(execution);

    const annotation = execution.annotations[
      QUEST_CONTEXT_ANNOTATION_KEY
    ] as QuestContextAnnotation;
    expect(annotation.worldContextIsOwnPage).toBe(true);
  });
});

// #171 -- another character's identity page is not "the world right now". What
// this NPC knows about them is what their own page says under `## Relationships`.
describe("createQuestContextMiddleware -- other-character pages", () => {
  const PENELOPE = "lore.entities.npcs.penelope_mccrick";
  const HORACE = "lore.entities.npcs.horace_pennyfeather";

  function characterPage(
    pageId: string,
    title: string,
    relationships?: string
  ): ResolvedLorePage {
    return {
      pageId,
      title,
      relativePath: "entities/npcs/page.md",
      sectionCount: 2,
      body: "",
      sections: [
        { heading: "Persona", slug: "persona", content: "A character." },
        ...(relationships
          ? [{ heading: "Relationships", slug: "relationships", content: relationships }]
          : [])
      ]
    };
  }

  function placePage(pageId: string, title: string): ResolvedLorePage {
    return {
      pageId,
      title,
      relativePath: "places/dock.md",
      sectionCount: 1,
      body: "",
      sections: [{ heading: "Overview", slug: "overview", content: "A busy dock." }]
    };
  }

  function fakeResolver(pages: ResolvedLorePage[]): LorePageResolver {
    return { resolvePages: async () => pages };
  }

  function speaking(): ConversationExecutionContext {
    return makeExecution({}, {}, { lorePageId: PENELOPE });
  }

  it("drops another character's page when the speaker's page says nothing about them", async () => {
    const { provider } = fakeVectorStore([
      fakeLore("A no nonsense station manager.", 0.9, {
        page_id: HORACE,
        title: "Horace Pennyfeather"
      }),
      fakeLore("Lost luggage is held at the dock office.", 0.7, {
        page_id: "lore.places.dock",
        title: "The Dock"
      })
    ]);
    const middleware = createQuestContextMiddleware({
      vectorStoreProvider: provider,
      lorePageResolver: fakeResolver([
        characterPage(HORACE, "Horace Pennyfeather"),
        characterPage(PENELOPE, "Penelope McCrick"),
        placePage("lore.places.dock", "The Dock")
      ])
    });
    const execution = speaking();
    await middleware.prepare?.(execution);

    const annotation = execution.annotations[
      QUEST_CONTEXT_ANNOTATION_KEY
    ] as QuestContextAnnotation;
    expect(annotation.worldContext).toBe("Lost luggage is held at the dock office.");
    expect(annotation.worldContextTitle).toBe("The Dock");
  });

  it("injects the speaker's own words about a character they have a relationship with", async () => {
    const { provider } = fakeVectorStore([
      fakeLore("A no nonsense station manager.", 0.9, {
        page_id: HORACE,
        title: "Horace Pennyfeather"
      })
    ]);
    const middleware = createQuestContextMiddleware({
      vectorStoreProvider: provider,
      lorePageResolver: fakeResolver([
        characterPage(HORACE, "Horace Pennyfeather"),
        characterPage(
          PENELOPE,
          "Penelope McCrick",
          `- [Horace Pennyfeather](${HORACE}) -- She finds him tediously literal.`
        )
      ])
    });
    const execution = speaking();
    await middleware.prepare?.(execution);

    const annotation = execution.annotations[
      QUEST_CONTEXT_ANNOTATION_KEY
    ] as QuestContextAnnotation;
    expect(annotation.worldContext).toBe(
      "What you know of Horace Pennyfeather: She finds him tediously literal."
    );
    expect(annotation.worldContext).not.toContain("A no nonsense station manager");
    // The text came off the speaker's page, so the prompt must not disown it.
    expect(annotation.worldContextIsOwnPage).toBe(true);
    expect(annotation.worldContextTitle).toBe("Penelope McCrick");
  });

  it("emits no world context when every candidate is another character", async () => {
    const { provider } = fakeVectorStore([
      fakeLore("A no nonsense station manager.", 0.9, {
        page_id: HORACE,
        title: "Horace Pennyfeather"
      })
    ]);
    const middleware = createQuestContextMiddleware({
      vectorStoreProvider: provider,
      lorePageResolver: fakeResolver([
        characterPage(HORACE, "Horace Pennyfeather"),
        characterPage(PENELOPE, "Penelope McCrick")
      ])
    });
    const execution = speaking();
    await middleware.prepare?.(execution);

    const annotation = execution.annotations[
      QUEST_CONTEXT_ANNOTATION_KEY
    ] as QuestContextAnnotation;
    expect(annotation.hasContext).toBe(false);
    expect(annotation.worldContext).toBeNull();
  });

  it("keeps a place page, which is world context", async () => {
    const { provider } = fakeVectorStore([
      fakeLore("Lost luggage is held at the dock office.", 0.9, {
        page_id: "lore.places.dock",
        title: "The Dock"
      })
    ]);
    const middleware = createQuestContextMiddleware({
      vectorStoreProvider: provider,
      lorePageResolver: fakeResolver([
        placePage("lore.places.dock", "The Dock"),
        characterPage(PENELOPE, "Penelope McCrick")
      ])
    });
    const execution = speaking();
    await middleware.prepare?.(execution);

    const annotation = execution.annotations[
      QUEST_CONTEXT_ANNOTATION_KEY
    ] as QuestContextAnnotation;
    expect(annotation.worldContext).toBe("Lost luggage is held at the dock office.");
    expect(annotation.worldContextIsOwnPage).toBe(false);
  });

  it("keeps the speaker's own page rather than dropping it as another character", async () => {
    const { provider } = fakeVectorStore([
      fakeLore("Penelope keeps a suite above the dock.", 0.9, {
        page_id: PENELOPE,
        title: "Penelope McCrick"
      })
    ]);
    const middleware = createQuestContextMiddleware({
      vectorStoreProvider: provider,
      lorePageResolver: fakeResolver([characterPage(PENELOPE, "Penelope McCrick")])
    });
    const execution = speaking();
    await middleware.prepare?.(execution);

    const annotation = execution.annotations[
      QUEST_CONTEXT_ANNOTATION_KEY
    ] as QuestContextAnnotation;
    expect(annotation.worldContext).toBe("Penelope keeps a suite above the dock.");
    expect(annotation.worldContextIsOwnPage).toBe(true);
  });

  it("uses the best result unchanged when no page resolver is configured", async () => {
    const { provider } = fakeVectorStore([
      fakeLore("A no nonsense station manager.", 0.9, {
        page_id: HORACE,
        title: "Horace Pennyfeather"
      })
    ]);
    const middleware = createQuestContextMiddleware({ vectorStoreProvider: provider });
    const execution = speaking();
    await middleware.prepare?.(execution);

    const annotation = execution.annotations[
      QUEST_CONTEXT_ANNOTATION_KEY
    ] as QuestContextAnnotation;
    expect(annotation.worldContext).toBe("A no nonsense station manager.");
  });

  it("keeps playing when the page fetch fails", async () => {
    const { provider } = fakeVectorStore([
      fakeLore("Lost luggage is held at the dock office.", 0.9, {
        page_id: "lore.places.dock",
        title: "The Dock"
      })
    ]);
    const middleware = createQuestContextMiddleware({
      vectorStoreProvider: provider,
      lorePageResolver: {
        resolvePages: async () => {
          throw new Error("gateway down");
        }
      }
    });
    const execution = speaking();
    await middleware.prepare?.(execution);

    const annotation = execution.annotations[
      QUEST_CONTEXT_ANNOTATION_KEY
    ] as QuestContextAnnotation;
    expect(annotation.worldContext).toBe("Lost luggage is held at the dock office.");
  });
});
