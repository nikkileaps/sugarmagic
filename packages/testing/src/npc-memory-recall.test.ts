/**
 * packages/testing/src/npc-memory-recall.test.ts
 *
 * Purpose: End-to-end proof of Plan 073.3 — a second conversation with
 * the same NPC references the first. Drives the real conversation host
 * with the sugaragent provider + memory middleware against a mock
 * gateway: conversation 1 writes memory (deterministic + a canned LLM
 * summary), conversation 2 loads it, the digest reaches the model in
 * the cached system half, and a "do you remember me?" recall is
 * answered (grounded, hasMemory) instead of abstaining. Also checks the
 * system prompt is byte-stable across conversation-2 turns.
 *
 * Implements: Plan 073 §073.3 tests (D4, D6)
 *
 * Status: active
 */

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPluginConfigurationRecord } from "@sugarmagic/domain";
import {
  clearNpcMemoryStoreCacheForTests,
  createRuntimePluginInstances,
  getDiscoveredPluginDefinition,
  resolveNpcMemoryStore,
  SUGARAGENT_PLUGIN_ID
} from "@sugarmagic/plugins";
import {
  createConversationHost,
  createPlaythroughIdentitySaveParticipant,
  createRuntimeBootModel,
  registerActiveIdentityProvider,
  resetActivePlaythroughIdForTests,
  type ConversationMiddleware,
  type ConversationProvider,
  type SaveSlice,
  type User,
  type UserIdentityProvider
} from "@sugarmagic/runtime-core";

const TEST_ENVIRONMENT = {
  SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL: "http://localhost:8787"
};
const NPC_ID = "npc:finnick";

interface CapturedGenerate {
  model: string | undefined;
  systemPrompt: string;
  userPrompt: string;
}

const SUMMARY_JSON = JSON.stringify({
  relationshipSummary: "Fond of Mim, a cheese enthusiast.",
  salientFacts: ["Name is Mim", "Loves aged gouda"],
  promises: [],
  emotionalBeats: ["warm first meeting"],
  lastConversationSummary: "Mim introduced themselves and mentioned loving aged gouda."
});

function makeGatewayMock(captured: CapturedGenerate[]) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/sugaragent/retrieve/search")) {
      return new Response(JSON.stringify({ results: [], requestId: "s" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (url.endsWith("/api/sugaragent/lore/resolve")) {
      return new Response(
        JSON.stringify({ ok: true, pages: [], missingPageIds: [] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (url.endsWith("/api/sugaragent/generate")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        model?: string;
        purpose?: string;
        systemBlocks?: Array<{ text: string }>;
        userPrompt?: string;
      };
      const systemPrompt = body.systemBlocks?.[0]?.text ?? "";
      captured.push({
        model: body.model,
        systemPrompt,
        userPrompt: body.userPrompt ?? ""
      });
      // The end-of-conversation summary is tagged server-side by purpose;
      // no model id crosses the wire (Plan 073.2).
      const isSummary = body.purpose === "summary";
      const text = isSummary ? SUMMARY_JSON : "A pleasure as always.";
      return new Response(
        JSON.stringify({ text, requestId: "g", model: body.model ?? "dialogue" }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    throw new Error("Unexpected fetch in test: " + url);
  });
}

function resolveSugarAgent(): {
  provider: ConversationProvider;
  middlewares: ConversationMiddleware[];
} {
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
      return { displayName: plugin.manifest.displayName, runtime: plugin.runtime };
    },
    TEST_ENVIRONMENT
  );
  const contributions = instances[0]?.contributions ?? [];
  const providerContribution = contributions.find(
    (entry) => entry.kind === "conversation.provider"
  );
  if (!providerContribution || providerContribution.kind !== "conversation.provider") {
    throw new Error("provider contribution missing");
  }
  const middlewares = contributions
    .filter((entry) => entry.kind === "conversation.middleware")
    .map((entry) =>
      entry.kind === "conversation.middleware" ? entry.payload.middleware : null
    )
    .filter((m): m is ConversationMiddleware => m != null);
  return { provider: providerContribution.payload.provider, middlewares };
}

function registerTestIdentity(userId: string): void {
  const user: User = {
    userId,
    displayName: null,
    email: null,
    isAnonymous: true,
    createdAt: "2026-07-21T00:00:00.000Z"
  };
  const provider = {
    currentUser: () => user,
    onChange: () => () => {},
    signIn: async () => user,
    signUp: async () => user,
    signOut: async () => {},
    linkAnonymousToCredentials: async () => user,
    getAccessToken: async () => null
  } satisfies UserIdentityProvider;
  registerActiveIdentityProvider(provider);
}

function mintPlaythrough(playthroughId: string): void {
  const participant = createPlaythroughIdentitySaveParticipant();
  const slice: SaveSlice<{ playthroughId: string }> = {
    schemaVersion: 1,
    data: { playthroughId }
  };
  participant.deserialize(slice);
}

beforeEach(() => {
  registerTestIdentity("user-recall");
  mintPlaythrough("play-recall");
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearNpcMemoryStoreCacheForTests();
  resetActivePlaythroughIdForTests();
  registerActiveIdentityProvider(null);
});

describe("NPC memory recall across conversations", () => {
  it("remembers the first conversation in the second (digest reaches the model, recall grounded)", async () => {
    const captured: CapturedGenerate[] = [];
    vi.stubGlobal("fetch", makeGatewayMock(captured));
    const { provider, middlewares } = resolveSugarAgent();

    // --- Conversation 1: the player introduces themselves. ---
    const host1 = createConversationHost({ providers: [provider], middlewares });
    await host1.startSession({
      conversationKind: "free-form",
      npcDefinitionId: NPC_ID,
      npcDisplayName: "Finnick",
      interactionMode: "agent",
      lorePageId: "root.npcs.finnick"
    });
    await host1.submitInput({ kind: "free_text", text: "Hi, I'm Mim. I love aged gouda." });
    await host1.endSession(); // dispose: deterministic merge (awaited) + async summary

    // The async LLM summary is fire-and-forget; wait for it to land.
    const store = resolveNpcMemoryStore();
    expect(store).not.toBeNull();
    await vi.waitFor(
      async () => {
        const record = await store!.load(NPC_ID);
        expect(record?.lastConversationSummary).toContain("gouda");
      },
      { timeout: 2000 }
    );

    // --- Conversation 2: a new session; the NPC should remember. ---
    const beforeCount = captured.length;
    const host2 = createConversationHost({ providers: [provider], middlewares });
    await host2.startSession({
      conversationKind: "free-form",
      npcDefinitionId: NPC_ID,
      npcDisplayName: "Finnick",
      interactionMode: "agent",
      lorePageId: "root.npcs.finnick"
    });
    const recall = await host2.submitInput({
      kind: "free_text",
      text: "Do you remember me?"
    });

    // The recall was answered from memory, not abstained.
    const planPayload = (
      recall?.diagnostics?.stages as
        | Record<string, { payload?: Record<string, unknown> }>
        | undefined
    )?.Plan?.payload;
    expect(planPayload?.hasMemory).toBe(true);
    expect(planPayload?.responseSpecificity).toBe("grounded");
    expect(planPayload?.responseIntent).toBe("answer");

    // The digest built from conversation 1 reached the model in the
    // cached system half of a conversation-2 generate call.
    const conv2Generates = captured.slice(beforeCount);
    expect(conv2Generates.length).toBeGreaterThan(0);
    const digestReached = conv2Generates.some(
      (g) =>
        g.systemPrompt.includes("What you remember about this player") &&
        g.systemPrompt.includes("Loves aged gouda")
    );
    expect(digestReached).toBe(true);

    // Byte-stability: every conversation-2 system prompt is identical
    // (the memoized digest doesn't shift between turns).
    const uniqueSystemPrompts = new Set(conv2Generates.map((g) => g.systemPrompt));
    expect(uniqueSystemPrompts.size).toBe(1);
  });
});
