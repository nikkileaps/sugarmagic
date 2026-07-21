import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPluginConfigurationRecord } from "@sugarmagic/domain";
import {
  createRuntimePluginInstances,
  getDiscoveredPluginDefinition,
  SUGARAGENT_PLUGIN_ID
} from "@sugarmagic/plugins";
import {
  type ConversationMiddleware,
  createConversationHost,
  createRuntimeBootModel,
  type ConversationProvider
} from "@sugarmagic/runtime-core";

// Post-46.14: sugaragent requires a proxy base URL; all vendor calls are
// server-side. Point tests at a local mock gateway address and stub fetch.
const TEST_ENVIRONMENT = {
  SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL: "http://localhost:8787"
};

function makeDefaultGatewayMock() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/sugaragent/retrieve/search")) {
      return new Response(
        JSON.stringify({ results: [], requestId: "search-test" }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    // Plan 072.3 — startSession now loads persona via lore/resolve. Default to
    // "page not found" so the persona degrades (D3) without affecting tests
    // that don't assert on it.
    if (url.endsWith("/api/sugaragent/lore/resolve")) {
      return new Response(
        JSON.stringify({ ok: true, pages: [], missingPageIds: [] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    throw new Error("Unexpected fetch in test: " + url);
  });
}

function resolveSugarAgentProvider(
  environment: Record<string, string> = TEST_ENVIRONMENT
): ConversationProvider {
  const boot = createRuntimeBootModel({
    hostKind: "studio",
    compileProfile: "runtime-preview",
    contentSource: "authored-game-root"
  });
  const instances = createRuntimePluginInstances(
    boot,
    [createPluginConfigurationRecord(SUGARAGENT_PLUGIN_ID, true, {})],
    (pluginId) => {
      const plugin = getDiscoveredPluginDefinition(pluginId);
      if (!plugin) return null;
      return {
        displayName: plugin.manifest.displayName,
        runtime: plugin.runtime
      };
    },
    environment
  );
  const contribution = instances[0]?.contributions.find(
    (entry) => entry.kind === "conversation.provider"
  );
  if (!contribution || contribution.kind !== "conversation.provider") {
    throw new Error("SugarAgent provider contribution was not created");
  }
  return contribution.payload.provider;
}

describe("SugarAgent runtime provider", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", makeDefaultGatewayMock());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("uses a generic-only opening reply when no grounded evidence is available", async () => {
    const host = createConversationHost({
      providers: [resolveSugarAgentProvider()]
    });

    const initialTurn = await host.startSession({
      conversationKind: "free-form",
      npcDefinitionId: "npc:station-manager",
      npcDisplayName: "Station Manager",
      interactionMode: "agent",
      lorePageId: "root.characters.station_manager"
    });

    expect(initialTurn?.text).toBe("Hello. What can I help you with today?");
    expect(
      (
        (initialTurn?.diagnostics?.stages as Record<string, { payload?: Record<string, unknown> }> | undefined)
          ?.Plan?.payload?.responseSpecificity
      )
    ).toBe("generic-only");
    expect(
      (
        (initialTurn?.diagnostics?.stages as Record<string, { payload?: Record<string, unknown> }> | undefined)
          ?.Generate?.payload?.llmBackend
      )
    ).toBe("deterministic");
    expect(initialTurn?.diagnostics).toMatchObject({
      consecutiveFallbackTurns: 0
    });
  });

  it("treats a player self-introduction as social-fast chat instead of a factual fallback", async () => {
    const host = createConversationHost({
      providers: [resolveSugarAgentProvider()]
    });

    await host.startSession({
      conversationKind: "free-form",
      npcDefinitionId: "npc:station-manager",
      npcDisplayName: "Station Manager",
      interactionMode: "agent",
      lorePageId: "root.characters.station_manager"
    });

    const reply = await host.submitInput({
      kind: "free_text",
      text: "Hi! My name is Mim! Nice to meet you."
    });

    expect(reply?.text).toContain("Mim");
    expect(reply?.text).toContain("Nice to meet you");
    expect(reply?.text).not.toContain("tell me a little more about what you need");
    expect(
      (
        (reply?.diagnostics?.stages as Record<string, { payload?: Record<string, unknown> }> | undefined)
          ?.Interpret?.payload?.turnPath
      )
    ).toBe("social_fast");
    expect(
      (
        (reply?.diagnostics?.stages as Record<string, { payload?: Record<string, unknown> }> | undefined)
          ?.Plan?.payload?.responseIntent
      )
    ).toBe("chat");
    expect(reply?.diagnostics).toMatchObject({
      consecutiveFallbackTurns: 0
    });
  });

  it("ends a repeated generic-only dead-end conversation after three stalled turns", async () => {
    const host = createConversationHost({
      providers: [resolveSugarAgentProvider()]
    });

    const initialTurn = await host.startSession({
      conversationKind: "free-form",
      npcDefinitionId: "npc:station-manager",
      npcDisplayName: "Station Manager",
      interactionMode: "agent",
      lorePageId: "root.characters.station_manager"
    });

    expect(initialTurn?.text).toBe("Hello. What can I help you with today?");
    expect(initialTurn?.diagnostics).toMatchObject({
      consecutiveFallbackTurns: 0
    });

    const firstReply = await host.submitInput({
      kind: "free_text",
      text: "I need my suitcase."
    });
    expect(firstReply?.diagnostics).toMatchObject({
      consecutiveFallbackTurns: 1
    });

    await host.submitInput({
      kind: "free_text",
      text: "I need my suitcase."
    });
    const terminalTurn = await host.submitInput({
      kind: "free_text",
      text: "I need my suitcase."
    });

    expect(terminalTurn?.text).toContain("Let's chat later");
    expect(
      terminalTurn?.proposedActions?.some(
        (proposal) => proposal.kind === "request-close"
      )
    ).toBe(true);
    expect(terminalTurn?.metadata).toMatchObject({
      autoCloseAfterMs: 2200
    });
    expect(terminalTurn?.diagnostics).toMatchObject({
      consecutiveFallbackTurns: 3
    });
  });

  it("ends the conversation with a polite terminal reply after three degraded fallback turns", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("upstream unavailable");
      })
    );

    const host = createConversationHost({
      providers: [resolveSugarAgentProvider()]
    });

    const initialTurn = await host.startSession({
      conversationKind: "free-form",
      npcDefinitionId: "npc:station-manager",
      npcDisplayName: "Station Manager",
      interactionMode: "agent",
      lorePageId: "root.characters.station_manager"
    });
    expect(initialTurn?.diagnostics).toMatchObject({
      consecutiveFallbackTurns: 0
    });

    const firstReply = await host.submitInput({
      kind: "free_text",
      text: "can you tell me about the station?"
    });
    expect(firstReply?.diagnostics).toMatchObject({
      consecutiveFallbackTurns: 1
    });

    await host.submitInput({
      kind: "free_text",
      text: "what is going on here?"
    });
    const finalReply = await host.submitInput({
      kind: "free_text",
      text: "who should I talk to?"
    });

    expect(finalReply?.text).toContain("Let's chat later");
    expect(
      finalReply?.proposedActions?.some(
        (proposal) => proposal.kind === "request-close"
      )
    ).toBe(true);
    expect(finalReply?.metadata).toMatchObject({
      autoCloseAfterMs: 2200
    });
    expect(finalReply?.diagnostics).toMatchObject({
      consecutiveFallbackTurns: 3
    });

    const closedTurn = await host.submitInput({ kind: "advance" });
    expect(closedTurn).toBeNull();
    expect(host.isSessionActive()).toBe(false);
  });

  it("handles free-form NPC sessions with deterministic fallback when backends are not configured", async () => {
    const host = createConversationHost({
      providers: [resolveSugarAgentProvider()]
    });

    const initialTurn = await host.startSession({
      conversationKind: "free-form",
      npcDefinitionId: "npc:innkeeper",
      npcDisplayName: "Inez",
      interactionMode: "agent",
      lorePageId: "root.characters.inez"
    });

    expect(initialTurn?.providerId).toBe("sugaragent.provider");
    expect(initialTurn?.inputMode).toBe("free_text");
    expect(initialTurn?.diagnostics).toBeTruthy();

    const farewellTurn = await host.submitInput({
      kind: "free_text",
      text: "bye for now"
    });

    expect(farewellTurn?.inputMode).toBe("advance");
    expect(
      farewellTurn?.proposedActions?.some(
        (proposal) => proposal.kind === "request-close"
      )
    ).toBe(true);

    const closedTurn = await host.submitInput({ kind: "advance" });
    expect(closedTurn).toBeNull();
    expect(host.isSessionActive()).toBe(false);
  });

  it("surfaces scripted followup proposals for agent interactions", async () => {
    const host = createConversationHost({
      providers: [resolveSugarAgentProvider()]
    });

    await host.startSession({
      conversationKind: "free-form",
      npcDefinitionId: "npc:guard",
      npcDisplayName: "Captain Vale",
      interactionMode: "agent",
      lorePageId: "root.characters.captain_vale",
      scriptedFollowupDialogueDefinitionId: "dialogue:diamond-briefing",
      activeQuest: {
        questDefinitionId: "quest:missing-diamond",
        displayName: "The Missing Diamond",
        stageDisplayName: "Investigation",
        objectives: []
      }
    });

    const reply = await host.submitInput({
      kind: "free_text",
      text: "what am I supposed to do on this quest?"
    });

    expect(
      reply?.proposedActions?.some(
        (proposal) =>
          proposal.kind === "start-scripted-followup" &&
          proposal.dialogueDefinitionId === "dialogue:diamond-briefing"
      )
    ).toBe(true);
    expect(reply?.inputMode).toBe("advance");
  });

  it("abstains instead of inventing an answer when no grounded evidence is available", async () => {
    const host = createConversationHost({
      providers: [resolveSugarAgentProvider()]
    });

    await host.startSession({
      conversationKind: "free-form",
      npcDefinitionId: "npc:bookseller",
      npcDisplayName: "Mara",
      interactionMode: "agent",
      lorePageId: "root.characters.mara"
    });

    const reply = await host.submitInput({
      kind: "free_text",
      text: "who murdered the stationmaster?"
    });

    expect(reply?.text.toLowerCase()).toContain("don't know enough");
    expect(
      (
        (reply?.diagnostics?.stages as Record<string, { payload?: Record<string, unknown> }> | undefined)
          ?.Plan?.payload?.responseIntent
      )
    ).toBe("abstain");
  });

  it("prefers the NPC lore page during retrieval before broadening search", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> | null }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const body =
          typeof init?.body === "string" && init.body.trim().length > 0
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : null;
        requests.push({ url, body });

        if (url.endsWith("/api/sugaragent/retrieve/search")) {
          const isFiltered = body?.filters != null;
          return new Response(
            JSON.stringify({
              results: isFiltered
                ? []
                : [
                    {
                      fileId: "chunk-1",
                      filename: "npc.station-manager.md",
                      score: 0.92,
                      attributes: { page_id: "lore.entities.npcs.station-manager" },
                      text: "The station manager keeps the depot running."
                    }
                  ],
              requestId: isFiltered ? "search-filtered" : "search-broad"
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url.endsWith("/api/sugaragent/generate")) {
          return new Response(
            JSON.stringify({
              text: "The station manager keeps the depot running.",
              requestId: "gen-1"
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        throw new Error("Unexpected fetch in test: " + url);
      })
    );

    const host = createConversationHost({
      providers: [
        resolveSugarAgentProvider({
          ...TEST_ENVIRONMENT,
          SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL: "http://localhost:8787"
        })
      ]
    });

    await host.startSession({
      conversationKind: "free-form",
      npcDefinitionId: "npc:station-manager",
      npcDisplayName: "Station Manager",
      interactionMode: "agent",
      lorePageId: "lore.entities.npcs.station-manager"
    });

    const reply = await host.submitInput({
      kind: "free_text",
      text: "Who are you again?"
    });

    const searchRequests = requests.filter((request) =>
      request.url.endsWith("/api/sugaragent/retrieve/search")
    );
    expect(searchRequests).toHaveLength(2);
    expect(searchRequests[0]?.body?.filters).toEqual({
      type: "eq",
      key: "page_id",
      value: "lore.entities.npcs.station-manager"
    });
    expect(searchRequests[1]?.body?.filters).toBeUndefined();
    expect(
      (
        (reply?.diagnostics?.stages as Record<string, { payload?: Record<string, unknown> }> | undefined)
          ?.Retrieve?.payload?.broadenedBeyondLorePage
      )
    ).toBe(true);
  });

  it("uses blackboard-backed current location context for 'where are we' retrieval", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> | null }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const body =
          typeof init?.body === "string" && init.body.trim().length > 0
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : null;
        requests.push({ url, body });

        if (url.endsWith("/api/sugaragent/retrieve/search")) {
          return new Response(
            JSON.stringify({
              results: [
                {
                  fileId: "chunk-location-1",
                  filename: "locations.earendale.md",
                  score: 0.97,
                  attributes: { page_id: "lore.locations.towns.earendale" },
                  text: "Earendale is a market town near the rail station."
                }
              ],
              requestId: "search-here"
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url.endsWith("/api/sugaragent/generate")) {
          return new Response(
            JSON.stringify({
              text: "We're in Earendale.",
              requestId: "gen-here"
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        throw new Error("Unexpected fetch in test: " + url);
      })
    );

    const runtimeContextMiddleware: ConversationMiddleware = {
      middlewareId: "test.runtime-location-context",
      displayName: "Test Runtime Location Context",
      priority: -100,
      stage: "context",
      prepare(context) {
        const currentLocation = {
          regionId: "region:earendale",
          regionDisplayName: "Earendale",
          regionLorePageId: "lore.locations.towns.earendale",
          sceneId: null,
          sceneDisplayName: null,
          area: {
            areaId: "area:earendale-square",
            displayName: "Earendale Square",
            lorePageId: "lore.locations.towns.earendale.square",
            kind: "zone" as const
          },
          parentArea: null
        };

        return {
          ...context,
          runtimeContext: {
            here: currentLocation,
            playerLocation: {
              entityId: "player:hero",
              location: currentLocation
            },
            playerPosition: null,
            playerArea: null,
            npcLocation: {
              entityId: "npc:rick-roll",
              location: currentLocation
            },
            npcPosition: null,
            npcArea: null,
            npcPlayerRelation: null,
            npcBehavior: {
              movement: null,
              task: {
                npcDefinitionId: "npc:rick-roll",
                taskId: "task:unpack-cheese",
                displayName: "Unpack Cheese Delivery",
                description:
                  "Rick is sorting through fresh cheese wheels outside before carrying them into the shop."
              },
              activity: null,
              goal: null
            },
            trackedQuest: null,
            activeQuestStage: null,
            activeQuestObjectives: null
          }
        };
      }
    };

    const host = createConversationHost({
      providers: [
        resolveSugarAgentProvider({
          ...TEST_ENVIRONMENT,
          SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL: "http://localhost:8787"
        })
      ],
      middlewares: [runtimeContextMiddleware]
    });

    await host.startSession({
      conversationKind: "free-form",
      npcDefinitionId: "npc:rick-roll",
      npcDisplayName: "Rick Roll",
      interactionMode: "agent",
      lorePageId: "lore.entities.npcs.rick-roll"
    });

    const reply = await host.submitInput({
      kind: "free_text",
      text: "Where are we?"
    });

    const searchRequest = requests.find((request) =>
      request.url.endsWith("/api/sugaragent/retrieve/search")
    );
    expect(searchRequest?.body?.filters).toEqual({
      type: "eq",
      key: "page_id",
      value: "lore.locations.towns.earendale.square"
    });
    expect(String(searchRequest?.body?.query ?? "")).toContain("Current area: Earendale Square");
    expect(reply?.text).toBe("We're in Earendale.");
    expect(
      (
        (reply?.diagnostics?.stages as Record<string, { payload?: Record<string, unknown> }> | undefined)
          ?.Retrieve?.payload?.currentLocationDisplayName
      )
    ).toBe("Earendale Square");
    expect(
      (
        (reply?.diagnostics?.stages as Record<string, { payload?: Record<string, unknown> }> | undefined)
          ?.Retrieve?.payload?.currentTaskDisplayName
      )
    ).toBe("Unpack Cheese Delivery");
    expect(
      (
        (reply?.diagnostics?.stages as Record<string, { payload?: Record<string, unknown> }> | undefined)
          ?.Generate?.payload?.currentTaskDescription
      )
    ).toBe(
      "Rick is sorting through fresh cheese wheels outside before carrying them into the shop."
    );
  });

  it("retries transient gateway overloads (529), then exits politely and closes the conversation", async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/api/sugaragent/retrieve/search")) {
        return new Response(
          JSON.stringify({
            results: [
              {
                fileId: "chunk-1",
                filename: "npc.rick-roll.md",
                score: 0.94,
                attributes: { page_id: "lore.entities.npcs.rick-roll" },
                text: "Rick Roll owns a cheese shop."
              }
            ],
            requestId: "search-retry"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (url.endsWith("/api/sugaragent/generate")) {
        return new Response(
          JSON.stringify({ error: "overloaded_error", message: "Overloaded" }),
          { status: 529, headers: { "content-type": "application/json" } }
        );
      }

      throw new Error(`Unhandled test fetch URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const host = createConversationHost({
      providers: [resolveSugarAgentProvider()]
    });

    await host.startSession({
      conversationKind: "free-form",
      npcDefinitionId: "npc:rick-roll",
      npcDisplayName: "Rick Roll",
      interactionMode: "agent",
      lorePageId: "lore.entities.npcs.rick-roll"
    });

    const replyPromise = host.submitInput({
      kind: "free_text",
      text: "What's your name?"
    });
    await vi.runAllTimersAsync();
    const reply = await replyPromise;

    // Initial attempt + 2 retries (GENERATE_RETRY_BACKOFF_MS = [700, 1400]) = 3 total
    const generateCalls = fetchMock.mock.calls.filter(([request]) =>
      String(request).endsWith("/api/sugaragent/generate")
    );
    expect(generateCalls).toHaveLength(3);
    expect(reply?.text).toBe("Sorry, I need a moment to think. Let's chat later.");
    expect(reply?.text).not.toContain("Page ID:");
    expect(
      reply?.proposedActions?.some((proposal) => proposal.kind === "request-close")
    ).toBe(true);
    expect(reply?.metadata).toMatchObject({
      autoCloseAfterMs: 2200
    });
    expect(
      (
        (reply?.diagnostics?.stages as Record<string, { fallbackReason?: string | null }> | undefined)
          ?.Generate?.fallbackReason
      )
    ).toBe("llm-retry-exhausted");
  });

  // Plan 072.3 — session-start persona load.
  describe("persona load at session start", () => {
    type PersonaDiag = {
      pageId: string | null;
      loaded: boolean;
      fallbackReason: string | null;
      personaSectionCount: number;
      coreSectionCount: number;
    };

    function resolvePayloadFor(pageId: string) {
      return {
        ok: true,
        pages: [
          {
            pageId,
            title: "Maren",
            relativePath: "npc/maren.md",
            sectionCount: 3,
            body: "## Persona\n\nWarm.\n\n## Voice\n\nCalls you 'love'.\n\n## Work\n\nBakes.",
            sections: [
              { heading: "Persona", slug: "persona", content: "Warm." },
              { heading: "Voice", slug: "voice", content: "Calls you 'love'." },
              { heading: "Work", slug: "work", content: "Bakes." }
            ]
          }
        ],
        missingPageIds: []
      };
    }

    it("loads + designates the NPC's page once, hitting lore/resolve with the pageId", async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.endsWith("/api/sugaragent/lore/resolve")) {
          return new Response(JSON.stringify(resolvePayloadFor("lore.npc.maren")), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }
        if (url.endsWith("/api/sugaragent/retrieve/search")) {
          return new Response(
            JSON.stringify({ results: [], requestId: "search-test" }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        throw new Error("Unexpected fetch in test: " + url);
      });
      vi.stubGlobal("fetch", fetchMock);

      const host = createConversationHost({
        providers: [resolveSugarAgentProvider()]
      });
      const initialTurn = await host.startSession({
        conversationKind: "free-form",
        npcDefinitionId: "npc:maren",
        npcDisplayName: "Maren",
        interactionMode: "agent",
        lorePageId: "lore.npc.maren"
      });

      const resolveCalls = fetchMock.mock.calls.filter(([request]) =>
        (typeof request === "string" ? request : request.toString()).endsWith(
          "/api/sugaragent/lore/resolve"
        )
      );
      expect(resolveCalls).toHaveLength(1);
      const sentBody = JSON.parse(
        (resolveCalls[0]?.[1] as RequestInit).body as string
      );
      expect(sentBody).toEqual({ pageIds: ["lore.npc.maren"] });

      const persona = (
        initialTurn?.diagnostics as { persona?: PersonaDiag } | undefined
      )?.persona;
      expect(persona).toMatchObject({
        pageId: "lore.npc.maren",
        loaded: true,
        fallbackReason: null,
        personaSectionCount: 2, // Persona + Voice
        coreSectionCount: 1 // Work
      });
    });

    it("degrades (persona-unavailable) when the page is missing, without failing the turn", async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.endsWith("/api/sugaragent/lore/resolve")) {
          return new Response(
            JSON.stringify({
              ok: true,
              pages: [],
              missingPageIds: ["lore.npc.ghost"]
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url.endsWith("/api/sugaragent/retrieve/search")) {
          return new Response(
            JSON.stringify({ results: [], requestId: "search-test" }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        throw new Error("Unexpected fetch in test: " + url);
      });
      vi.stubGlobal("fetch", fetchMock);

      const host = createConversationHost({
        providers: [resolveSugarAgentProvider()]
      });
      const initialTurn = await host.startSession({
        conversationKind: "free-form",
        npcDefinitionId: "npc:ghost",
        npcDisplayName: "Ghost",
        interactionMode: "agent",
        lorePageId: "lore.npc.ghost"
      });

      // The turn still resolved (degrade, not fail).
      expect(initialTurn?.text).toBeTruthy();
      const persona = (
        initialTurn?.diagnostics as { persona?: PersonaDiag } | undefined
      )?.persona;
      expect(persona).toMatchObject({
        pageId: "lore.npc.ghost",
        loaded: false,
        fallbackReason: "persona-unavailable",
        personaSectionCount: 0,
        coreSectionCount: 0
      });
    });
  });
});
