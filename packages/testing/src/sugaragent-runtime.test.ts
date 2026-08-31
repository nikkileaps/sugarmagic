import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPluginConfigurationRecord,
  type NPCRecoveryStrategy
} from "@sugarmagic/domain";
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

  // Plan 072.6 (D1) — DEGRADED path: this test's fetch mock does not answer
  // /lore/resolve, so persona load degrades (loaded=false) and retrieval keeps
  // the legacy own-page-preferred targeting (eq filter, then broaden).
  it("prefers the NPC lore page during retrieval before broadening (card not loaded)", async () => {
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

  // Plan 072.6 (D1) — CARD-LOADED path: when the persona card loads, the NPC's
  // own page is in the system prompt, so evidence retrieval runs a broad search
  // (no own-page eq filter) and drops own-page hits, surfacing OTHER lore.
  it("excludes the NPC's own page from evidence when the persona card is loaded", async () => {
    const OWN_PAGE = "lore.entities.npcs.finnick";
    const searchRequests: Array<Record<string, unknown> | null> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const body =
          typeof init?.body === "string" && init.body.trim().length > 0
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : null;

        if (url.endsWith("/api/sugaragent/lore/resolve")) {
          // Page resolves -> persona loads (loaded=true).
          return new Response(
            JSON.stringify({
              ok: true,
              pages: [
                {
                  pageId: OWN_PAGE,
                  title: "Finnick",
                  relativePath: "npc/finnick.md",
                  sectionCount: 1,
                  body: "## Persona\n\nCheese-obsessed.",
                  sections: [
                    { heading: "Persona", slug: "persona", content: "Cheese-obsessed." }
                  ]
                }
              ],
              missingPageIds: []
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url.endsWith("/api/sugaragent/retrieve/search")) {
          searchRequests.push(body);
          return new Response(
            JSON.stringify({
              results: [
                {
                  fileId: "own",
                  filename: "finnick.md",
                  score: 0.99,
                  attributes: { page_id: OWN_PAGE },
                  text: "Finnick's own page content."
                },
                {
                  fileId: "other",
                  filename: "town.md",
                  score: 0.8,
                  attributes: { page_id: "lore.locations.town" },
                  text: "The town square has a fountain."
                }
              ],
              requestId: "search-broad"
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url.endsWith("/api/sugaragent/generate")) {
          return new Response(
            JSON.stringify({ text: "Cheese!", requestId: "gen-1" }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        throw new Error("Unexpected fetch in test: " + url);
      })
    );

    const host = createConversationHost({
      providers: [resolveSugarAgentProvider()]
    });
    await host.startSession({
      conversationKind: "free-form",
      npcDefinitionId: "npc:finnick",
      npcDisplayName: "Finnick",
      interactionMode: "agent",
      lorePageId: OWN_PAGE
    });

    const reply = await host.submitInput({
      kind: "free_text",
      text: "Tell me about the town."
    });

    const retrieve = (
      reply?.diagnostics?.stages as
        | Record<string, { payload?: Record<string, unknown> }>
        | undefined
    )?.Retrieve?.payload;
    expect(retrieve?.personaLoaded).toBe(true);
    expect(retrieve?.ownPageExcluded).toBe(true);
    // The search that ran during this reply used NO own-page eq filter.
    const lastSearch = searchRequests.at(-1);
    expect(lastSearch?.filters).toBeUndefined();
    // Own page dropped from evidence; only the other-page result survives.
    expect(retrieve?.loreContextCount).toBe(1);
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

  it("NEVER recites raw evidence when the LLM call fails (deterministic fallback stays in character)", async () => {
    // Reproduces the gateway-contract-mismatch failure mode: the generate call
    // fails, and the deterministic fallback must NOT dump the retrieved chunk.
    const LORE_MARKER = "PODCASTSCRIPTLEAK: Title: Archivado Section: SCENE 3";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/sugaragent/retrieve/search")) {
        return new Response(
          JSON.stringify({
            results: [
              {
                fileId: "chunk-1",
                filename: "podcast.md",
                score: 0.9,
                attributes: { page_id: "lore.entities.npcs.finnick" },
                text: LORE_MARKER
              }
            ],
            requestId: "search-1"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.endsWith("/api/sugaragent/generate")) {
        // Non-retryable client error (e.g. an old gateway rejecting the new
        // request shape) → the else-branch deterministic fallback.
        return new Response(
          JSON.stringify({ ok: false, error: "InvalidRequest", message: "bad" }),
          { status: 400, headers: { "content-type": "application/json" } }
        );
      }
      throw new Error("Unexpected fetch in test: " + url);
    });
    vi.stubGlobal("fetch", fetchMock);

    const host = createConversationHost({
      providers: [resolveSugarAgentProvider()]
    });
    await host.startSession({
      conversationKind: "free-form",
      npcDefinitionId: "npc:finnick",
      npcDisplayName: "Finnick",
      interactionMode: "agent",
      lorePageId: "lore.entities.npcs.finnick"
    });
    const reply = await host.submitInput({
      kind: "free_text",
      text: "Tell me everything you know."
    });

    // The raw evidence and its vector-store markers must never surface.
    expect(reply?.text).not.toContain("PODCASTSCRIPTLEAK");
    expect(reply?.text).not.toContain("From what I know");
    expect(reply?.text).not.toContain("Title:");
    expect(reply?.text).not.toContain("Section:");
    expect(reply?.text).not.toContain("Page ID:");
    expect((reply?.text ?? "").length).toBeGreaterThan(0);
  });


  // A persona'd NPC answers player-initiated social turns IN CHARACTER (LLM),
  // not with a canned deterministic line; the opening turn stays canned.
  it("routes a persona'd NPC's player social turn through the LLM (not the canned reply)", async () => {
    let generateCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.endsWith("/api/sugaragent/lore/resolve")) {
          return new Response(
            JSON.stringify({
              ok: true,
              pages: [
                {
                  pageId: "lore.finnick",
                  title: "Finnick",
                  relativePath: "npc/finnick.md",
                  sectionCount: 1,
                  body: "## Persona\n\nCheese-obsessed and chatty.",
                  sections: [
                    { heading: "Persona", slug: "persona", content: "Cheese-obsessed and chatty." }
                  ]
                }
              ],
              missingPageIds: []
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url.endsWith("/api/sugaragent/retrieve/search")) {
          return new Response(JSON.stringify({ results: [], requestId: "s" }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }
        if (url.endsWith("/api/sugaragent/generate")) {
          generateCalls += 1;
          // A long, exuberant in-character reply (>440 chars, many sentences) —
          // exactly the kind the generic-only audit caps used to reject.
          return new Response(
            JSON.stringify({
              text:
                "Ah, welcome, welcome! Finnick's the name, and cheese is my game! " +
                "You've come to the finest little spot around, friend Mim! " +
                "Now tell me, what brings you here today? Are you a sharp-and-aged " +
                "sort of person, or more of a soft-and-creamy soul? Because let me " +
                "tell you, I have got a wheel of something special that would make " +
                "your whole week, no, your whole month, brighter! Just arrived, you " +
                "say? Then you simply must let me be your very first welcome!",
              requestId: "g"
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        throw new Error("Unexpected fetch in test: " + url);
      })
    );

    const host = createConversationHost({
      providers: [resolveSugarAgentProvider()]
    });
    const opening = await host.startSession({
      conversationKind: "free-form",
      npcDefinitionId: "npc:finnick",
      npcDisplayName: "Finnick",
      interactionMode: "agent",
      lorePageId: "lore.finnick"
    });
    // Opening turn (no player text) stays the canned greeting — no LLM.
    expect(opening?.text).toBe("Hello. What can I help you with today?");
    expect(generateCalls).toBe(0);

    const reply = await host.submitInput({
      kind: "free_text",
      text: "Hi! I'm Mim! I just arrived."
    });
    // The player's social turn goes through the LLM AND the long in-character
    // reply survives the audit (not repaired to the canned "I'm listening.").
    expect(generateCalls).toBe(1);
    expect(reply?.text).toContain("cheese is my game");
    expect(reply?.text).not.toBe("I'm listening.");
    expect((reply?.text ?? "").length).toBeGreaterThan(440);
  });

  // THE FIVE CONVERSATIONS (#241).
  //
  // One test per path in the epic's table, because the alternation defect that
  // survived three review rounds was invisible to per-claim checks and obvious
  // the moment anyone wrote a whole conversation down.
  //
  // Generation SUCCEEDS on every turn here, so nothing degrades and the only
  // thing repeating is the misunderstanding. Every other terminal-close fixture
  // in this file throws on /generate, which reaches the close through the
  // degraded rung instead.
  function stubRecoveryGateway(): {
    generatePrompts: string[];
  } {
    const generatePrompts: string[] = [];
    const sections = [
      { heading: "Persona", slug: "persona", content: "Cheese-obsessed and chatty." }
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.endsWith("/api/sugaragent/lore/resolve")) {
          return new Response(
            JSON.stringify({
              ok: true,
              pages: [
                {
                  pageId: "lore.finnick",
                  title: "Finnick",
                  relativePath: "npc/finnick.md",
                  sectionCount: sections.length,
                  body: "## Persona\n\nCheese-obsessed and chatty.",
                  sections
                }
              ],
              missingPageIds: []
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url.endsWith("/api/sugaragent/retrieve/search")) {
          return new Response(JSON.stringify({ results: [], requestId: "s" }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }
        if (url.endsWith("/api/sugaragent/generate")) {
          generatePrompts.push(String(init?.body ?? ""));
          return new Response(
            JSON.stringify({
              text: "Well now, that reminds me of a wheel I once aged.",
              requestId: "g"
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        throw new Error("Unexpected fetch in test: " + url);
      })
    );
    return { generatePrompts };
  }

  async function startFinnick(recoveryStrategies: NPCRecoveryStrategy[] = []) {
    const host = createConversationHost({
      providers: [resolveSugarAgentProvider()]
    });
    await host.startSession({
      conversationKind: "free-form",
      npcDefinitionId: "npc:finnick",
      npcDisplayName: "Finnick",
      interactionMode: "agent",
      lorePageId: "lore.finnick",
      recoveryStrategies
    });
    return host;
  }

  function planOf(turn: { diagnostics?: Record<string, unknown> } | null) {
    const stages = turn?.diagnostics?.["stages"] as
      | Record<string, { payload?: Record<string, unknown> }>
      | undefined;
    return stages?.["Plan"]?.payload ?? {};
  }

  it("conversation 1: one clarifying question, then the character carries it", async () => {
    const { generatePrompts } = stubRecoveryGateway();
    const host = await startFinnick([
      {
        strategy: "change-subject",
        note: "She tells you how things ought to be done."
      },
      { strategy: "playful-probe", note: "" }
    ]);

    const turns = [];
    for (let i = 0; i < 4; i += 1) {
      turns.push(await host.submitInput({ kind: "free_text", text: "qqq zzz" }));
    }

    expect(turns.map((t) => planOf(t)["responseIntent"])).toEqual([
      "clarify",
      "recover",
      "recover",
      "recover"
    ]);
    // The list is walked in written order and wraps, so an authored second
    // move is actually used instead of the first repeating.
    expect(turns.map((t) => planOf(t)["recoveryStrategy"])).toEqual([
      null,
      "change-subject",
      "playful-probe",
      "change-subject"
    ]);
    // One question for the whole run of confusion.
    expect(turns.at(-1)?.diagnostics).toMatchObject({
      consecutiveClarifyTurns: 1,
      consecutiveFallbackTurns: 0
    });
    // Still open.
    expect(
      turns.at(-1)?.proposedActions?.some((p) => p.kind === "request-close")
    ).toBe(false);
    expect(turns.at(-1)?.inputMode).toBe("free_text");

    // The move reaches the built prompt, not just PlanResult -- the assertion
    // `unknownNamedEntities` never had (#244).
    //
    // Assert the USER half by name. Checking the whole request body for
    // "change-subject" passes for the wrong reason: the recovery brief is in
    // the SYSTEM half and contains that string, so the check stays green even
    // with nothing carrying the strategy per turn.
    const lastRequest = JSON.parse(generatePrompts.at(-1) ?? "{}") as {
      userPrompt?: string;
      systemBlocks?: Array<{ text?: string }>;
    };
    expect(lastRequest.userPrompt).toContain(
      "Turn the conversation to something else you care about"
    );
    // And the writer's note rides in the system half, where it is stable for
    // the session.
    expect(
      (lastRequest.systemBlocks ?? []).map((b) => b.text ?? "").join("\n")
    ).toContain("how things ought to be done");
  });

  it("conversation 2: a brusque character leaves, and the panel closes", async () => {
    stubRecoveryGateway();
    const host = await startFinnick([
      { strategy: "curt-exit", note: "He has cheese to attend to." }
    ]);

    await host.submitInput({ kind: "free_text", text: "qqq zzz" });
    const exit = await host.submitInput({ kind: "free_text", text: "qqq zzz" });

    expect(planOf(exit)["responseIntent"]).toBe("recover");
    expect(planOf(exit)["recoveryStrategy"]).toBe("curt-exit");
    expect(
      exit?.proposedActions?.some((p) => p.kind === "request-close")
    ).toBe(true);
    expect(exit?.metadata?.["autoCloseAfterMs"]).toBe(2200);
    // Never the shared farewell line.
    expect(exit?.text).not.toContain("We'll speak again");
    expect(exit?.text).not.toContain("Let's chat later");
  });

  it("conversation 3: a character with no list talks about itself, and never leaves", async () => {
    stubRecoveryGateway();
    const host = await startFinnick();

    const turns = [];
    for (let i = 0; i < 3; i += 1) {
      turns.push(await host.submitInput({ kind: "free_text", text: "qqq zzz" }));
    }

    expect(turns.map((t) => planOf(t)["recoveryStrategy"])).toEqual([
      null,
      "self-disclosure",
      "self-disclosure"
    ]);
    expect(
      turns.at(-1)?.proposedActions?.some((p) => p.kind === "request-close")
    ).toBe(false);
  });

  it("conversation 4: a real exchange clears the slate, so later confusion earns a question again", async () => {
    stubRecoveryGateway();
    const host = await startFinnick([
      { strategy: "change-subject", note: "" }
    ]);

    await host.submitInput({ kind: "free_text", text: "qqq zzz" });
    await host.submitInput({ kind: "free_text", text: "qqq zzz" });

    // Something that lands: a greeting takes the social fast path and plans
    // `chat`, which is neither a clarify nor a recovery.
    const landed = await host.submitInput({ kind: "free_text", text: "hello!" });
    expect(planOf(landed)["responseIntent"]).not.toBe("clarify");
    expect(planOf(landed)["responseIntent"]).not.toBe("recover");
    expect(landed?.diagnostics).toMatchObject({ consecutiveClarifyTurns: 0 });

    // Confused again, and owed a question rather than being recovered at.
    const confusedAgain = await host.submitInput({
      kind: "free_text",
      text: "hjkl"
    });
    expect(planOf(confusedAgain)["responseIntent"]).toBe("clarify");
  });

  it("a recovery turn is never generic-only, so it cannot feed the outage counter", async () => {
    stubRecoveryGateway();
    const host = await startFinnick([
      { strategy: "change-subject", note: "" }
    ]);

    await host.submitInput({ kind: "free_text", text: "qqq zzz" });
    const recovery = await host.submitInput({ kind: "free_text", text: "qqq zzz" });

    expect(planOf(recovery)["responseSpecificity"]).toBe("grounded");
    expect(recovery?.diagnostics).toMatchObject({ consecutiveFallbackTurns: 0 });
  });

  it("resets the clarify count on a pre-placement turn, where the reply is not the planner's", async () => {
    stubRecoveryGateway();
    // Sugarlang's pre-placement opening line makes GenerateStage return a
    // complete envelope, so whatever Plan chose the NPC neither asked nor
    // recovered.
    const injectOnCue: ConversationMiddleware = {
      middlewareId: "test.pre-placement",
      displayName: "test pre-placement",
      priority: 0,
      stage: "context",
      prepare: (context) => {
        const input = context.input;
        if (input?.kind !== "free_text" || input.text !== "placement") {
          return context;
        }
        context.annotations["sugarlang.constraint"] = {
          generatorPromptOverlay: "",
          minimalGreetingMode: true,
          targetVocab: { introduce: [], reinforce: [], avoid: [] },
          supportPosture: "anchored",
          targetLanguageRatio: 0,
          interactionStyle: "listening_first",
          glossingStrategy: "none",
          sentenceComplexityCap: "single-clause",
          targetLanguage: "es",
          learnerCefr: "A1",
          rawPrescription: {
            introduce: [],
            reinforce: [],
            avoid: [],
            budget: { newItemsAllowed: 0 },
            rationale: {
              candidateSetSize: 0,
              envelopeSurvivorCount: 0,
              priorityScores: [],
              reasons: []
            }
          },
          prePlacementOpeningLine: {
            text: "Antes de empezar, una pregunta.",
            lang: "es",
            lineId: "opening:line-1"
          }
        };
        return context;
      }
    };

    const host = createConversationHost({
      providers: [resolveSugarAgentProvider()],
      middlewares: [injectOnCue]
    });
    await host.startSession({
      conversationKind: "free-form",
      npcDefinitionId: "npc:finnick",
      npcDisplayName: "Finnick",
      interactionMode: "agent",
      lorePageId: "lore.finnick"
    });

    await host.submitInput({ kind: "free_text", text: "qqq zzz" });
    const override = await host.submitInput({
      kind: "free_text",
      text: "placement"
    });
    expect(override?.text).toBe("Antes de empezar, una pregunta.");
    expect(override?.diagnostics).toMatchObject({
      consecutiveClarifyTurns: 0,
      consecutiveFallbackTurns: 0
    });
  });

  it("still ends a conversation after three degraded turns", async () => {
    // The counter this story leaves alone. An outage still closes at 3.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.endsWith("/api/sugaragent/lore/resolve")) {
          return new Response(
            JSON.stringify({ ok: true, pages: [], missingPageIds: [] }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        throw new Error("Unexpected fetch in test: " + url);
      })
    );

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

    // Not a greeting: a greeting takes the social fast path, which answers
    // deterministically without calling the model and so never degrades.
    const first = await host.submitInput({
      kind: "free_text",
      text: "I need my suitcase."
    });
    expect(first?.diagnostics).toMatchObject({ consecutiveFallbackTurns: 1 });
    await host.submitInput({ kind: "free_text", text: "I need my suitcase." });
    const third = await host.submitInput({
      kind: "free_text",
      text: "I need my suitcase."
    });

    expect(third?.text).toContain("Let's chat later");
    expect(
      third?.proposedActions?.some((proposal) => proposal.kind === "request-close")
    ).toBe(true);
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
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        void init;
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

  // #185 -- the handoff nothing else covers. The judge context is built in
  // GenerateStage (that is where buildGeneratePrompt runs) and read in
  // JudgeStage. The builder tests cover the builder; the JudgeStage tests feed
  // it a fixture. Delete the one line that carries the text between them and
  // both suites still pass, while in a real turn JudgeStage sees an empty
  // string, takes the `no-prompt` skip, and the judge silently stops running.
  //
  // This drives a real turn and reads what the judge route actually received.
  describe("the judge receives the writer's context (#185)", () => {
    function judgeHarness() {
      const judgeBodies: Record<string, unknown>[] = [];
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.endsWith("/api/sugaragent/lore/resolve")) {
          return new Response(
            JSON.stringify({
              ok: true,
              pages: [
                {
                  pageId: "lore.npc.maren",
                  title: "Maren",
                  relativePath: "npc/maren.md",
                  sectionCount: 3,
                  body: "## Persona\n\nWarm.\n\n## Voice\n\nCalls you 'love'.\n\n## Work\n\nRuns the bakery on the square.",
                  sections: [
                    { heading: "Persona", slug: "persona", content: "Warm." },
                    { heading: "Voice", slug: "voice", content: "Calls you 'love'." },
                    { heading: "Work", slug: "work", content: "Runs the bakery on the square." }
                  ]
                }
              ],
              missingPageIds: []
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url.endsWith("/api/sugaragent/retrieve/search")) {
          return new Response(JSON.stringify({ results: [], requestId: "s" }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }
        if (url.endsWith("/api/sugaragent/generate/judge")) {
          judgeBodies.push(JSON.parse((init as RequestInit).body as string));
          return new Response(
            JSON.stringify({ passed: true, violations: [], repairHint: null }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url.endsWith("/api/sugaragent/generate")) {
          return new Response(
            JSON.stringify({ text: "Morning, love!", requestId: "g" }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        throw new Error("Unexpected fetch in test: " + url);
      });
      vi.stubGlobal("fetch", fetchMock);
      return { judgeBodies };
    }

    it("refuses a place reality has never heard of, mid-sentence, in a real turn", async () => {
      // #184, verbatim from play 2026-08-16. Three other things are going on in
      // this message -- a compliment, a translation request, and the NPC's own
      // shop name -- and the invented shop arrives at the end.
      const { judgeBodies } = judgeHarness();
      void judgeBodies;
      const host = createConversationHost({
        providers: [resolveSugarAgentProvider()]
      });
      await host.startSession({
        conversationKind: "free-form",
        npcDefinitionId: "npc:maren",
        npcDisplayName: "Maren",
        interactionMode: "agent",
        lorePageId: "lore.npc.maren"
      });
      const reply = await host.submitInput({
        kind: "free_text",
        text:
          'Wow! That\'s muchas bueno! ( so great? como se dice "so great" en espanol? ) ' +
          "Say Cheese is a great name for a shop amigo. " +
          "Do you know anything about a place called Brindlebear's Book Emporium?"
      });

      const plan = (
        reply?.diagnostics as {
          stages?: { Plan?: { payload?: Record<string, unknown> } };
        }
      )?.stages?.Plan?.payload;
      // The goal wording is covered by the planning unit tests. What only a
      // real turn can prove is that the name survives the whole path --
      // Interpret -> PlanStage's corpus -> the decision -- and still refuses.
      expect(plan?.["responseIntent"]).toBe("abstain");
    });

    it("the player names themselves, and is remembered; they do not get to name the world", async () => {
      // #184 -- authority over your own identity, none over what exists.
      // Both names below are two capitalised words and neither is in the wiki.
      // Only one of them arrives via a self-introduction.
      const { judgeBodies } = judgeHarness();
      void judgeBodies;
      const host = createConversationHost({
        providers: [resolveSugarAgentProvider()]
      });
      await host.startSession({
        conversationKind: "free-form",
        npcDefinitionId: "npc:maren",
        npcDisplayName: "Maren",
        interactionMode: "agent",
        lorePageId: "lore.npc.maren"
      });

      await host.submitInput({ kind: "free_text", text: "My name is Mim Featherstone." });

      const planOf = (reply: unknown) =>
        (reply as { diagnostics?: { stages?: { Plan?: { payload?: Record<string, unknown> } } } })
          ?.diagnostics?.stages?.Plan?.payload;

      // Their own name, referred back to: reality now knows it.
      const aboutSelf = await host.submitInput({
        kind: "free_text",
        text: "Do you remember Mim Featherstone?"
      });
      expect(planOf(aboutSelf)?.["responseIntent"]).not.toBe("abstain");

      // A place they merely mentioned: still not real.
      const aboutWorld = await host.submitInput({
        kind: "free_text",
        text: "Do you know anything about Brindlebear's Book Emporium?"
      });
      expect(planOf(aboutWorld)?.["responseIntent"]).toBe("abstain");
    });

    it("sends core knowledge the judge could not otherwise see", async () => {
      const { judgeBodies } = judgeHarness();
      const host = createConversationHost({
        providers: [resolveSugarAgentProvider()]
      });
      await host.startSession({
        conversationKind: "free-form",
        npcDefinitionId: "npc:maren",
        npcDisplayName: "Maren",
        interactionMode: "agent",
        lorePageId: "lore.npc.maren"
      });
      // The opening turn is deterministic and never calls a model; a submitted
      // turn is what runs Generate and therefore Judge.
      await host.submitInput({ kind: "free_text", text: "Do you sell bread?" });

      expect(judgeBodies.length).toBeGreaterThan(0);
      const body = judgeBodies[0] as { context?: string };
      expect(typeof body.context).toBe("string");
      // Core knowledge: in the writer's prompt, absent from the old digest.
      expect(body.context).toContain("Runs the bakery on the square.");
      // And the brief stays behind.
      expect(body.context).not.toContain("Use only the provided evidence");
    });
  });
});
