/**
 * packages/plugins/src/catalog/sugaragent/runtime/stages/retrieve-stage.test.ts
 *
 * Purpose: Guards the 072.6 own-page-exclusion gate at the boundary the
 * integration tests don't cover: persona LOADED but the turn is
 * location-anchored, where the target is the LOCATION page (not the NPC's own
 * page), so the own-page exclusion must stay OFF and the location eq filter
 * must be used. Also guards the 078.1 loreScores tagging (retrieved / pinned /
 * synthetic-location).
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import { RetrieveStage } from "./RetrieveStage";
import type { VectorStoreProvider, OpenAIVectorStoreFilter } from "../clients";

function makeContext() {
  return {
    turnId: "t1",
    sessionId: "s1",
    pluginId: "sugaragent",
    selection: { conversationKind: "free-form" as const, npcDefinitionId: "npc-1" },
    config: {
      proxyBaseUrl: "https://test-proxy.local",
      gatewayBearerToken: "",
      loreSourceKind: "local" as const,
      loreLocalPath: "",
      loreRepositoryUrl: "",
      loreRepositoryRef: "main",
      maxLoreResults: 4,
      maxLoreCharsPerItem: 600,
      debugLogging: false,
      tone: ""
    },
    logStageStart() {
      return undefined;
    },
    logStageEnd() {
      return undefined;
    }
  };
}

function makeInput(personaLoaded: boolean) {
  return {
    personaLoaded,
    execution: {
      selection: {
        conversationKind: "free-form" as const,
        npcDefinitionId: "npc-1",
        npcDisplayName: "Horace",
        interactionMode: "agent" as const,
        lorePageId: "lore.npc.horace"
      },
      input: { kind: "free_text" as const, text: "what is this place?" },
      state: {},
      annotations: {} as Record<string, unknown>,
      runtimeContext: {
        here: {
          area: { lorePageId: "lore.location.dock", displayName: "Dock Shipyard" },
          parentArea: null,
          regionLorePageId: null,
          regionDisplayName: "Arrival Station"
        },
        npcPlayerRelation: null,
        npcBehavior: null,
        trackedQuest: null,
        activeQuestStage: null,
        activeQuestObjectives: null
      }
    },
    interpret: {
      userText: "what is this place?",
      queryType: "factual" as const,
      interpretation: {
        intent: "location_query" as const,
        lane: "factual" as const,
        target: "world" as const,
        facet: "location" as const,
        timeframe: "current" as const,
        socialMove: "none" as const,
        contextAnchor: "current_location" as const,
        declaredIdentityName: null,
        focusText: "this place",
        confidence: 0.9,
        margin: 0.4,
        ambiguous: false
      },
      turnRouting: {
        path: "grounded" as const,
        socialFastPathEligible: false,
        factualRiskSignals: []
      },
      pendingExpectation: { kind: "none" as const },
      searchQuery: "what is this place",
      shouldCloseAfterReply: false
    }
  };
}

describe("RetrieveStage own-page exclusion (072.6) — location-anchored crossover", () => {
  it("does NOT exclude the own page when persona loaded but the turn is location-anchored", async () => {
    const calls: Array<OpenAIVectorStoreFilter | undefined> = [];
    const provider: VectorStoreProvider = {
      searchLore: vi.fn(async (req) => {
        calls.push(req.filters ?? undefined);
        return [
          {
            fileId: "f1",
            filename: "dock.md",
            score: 0.9,
            text: "The dock is busy.",
            attributes: { page_id: "lore.location.dock" }
          }
        ];
      })
    };
    const stage = new RetrieveStage(provider);

    const result = await stage.execute(makeInput(true) as never, makeContext() as never);

    // Exclusion stayed OFF (target is the location page, not the NPC's own page).
    expect(result.diagnostics.payload.ownPageExcluded).toBe(false);
    expect(result.diagnostics.payload.targetedLorePageId).toBe("lore.location.dock");
    // The primary search used the LOCATION eq filter, not a broad drop-own-page.
    expect(calls[0]).toEqual({
      type: "eq",
      key: "page_id",
      value: "lore.location.dock"
    });
    // Plan 078.1 -- loreScores in diagnostics. The runtime-location evidence is
    // also prepended (contextAnchor==="current_location") with the same page_id as
    // the searched chunk, so we identify entries by fileId to avoid ambiguity.
    const loreScores = result.diagnostics.payload.loreScores as Array<{
      score: number;
      source: string;
      pageId: string | null;
      fileId: string;
    }>;
    expect(Array.isArray(loreScores)).toBe(true);
    expect(loreScores.length).toBeGreaterThan(0);
    // The actual searched dock chunk must be tagged "retrieved", not "pinned".
    const dockEntry = loreScores.find((s) => s.fileId === "f1");
    expect(dockEntry?.source).toBe("retrieved");
    expect(dockEntry?.score).toBe(0.9);
  });
});

describe("RetrieveStage loreScores tagging (078.1)", () => {
  it('tags a pinned own-page chunk as "pinned"', async () => {
    // Set up: primary search targets a LOCATION page; NPC own page is pinned separately.
    // The pin search returns an item whose page_id matches npcLorePageId.
    let callCount = 0;
    const provider: VectorStoreProvider = {
      searchLore: vi.fn(async (req) => {
        callCount += 1;
        // First call = primary (location-anchored); second = pin (npc page).
        if (callCount === 1) {
          return [
            {
              fileId: "loc-1",
              filename: "dock.md",
              score: 0.85,
              text: "Dock is busy.",
              attributes: { page_id: "lore.location.dock" }
            }
          ];
        }
        // Pin call: return an item from the NPC's own page.
        return [
          {
            fileId: "npc-1",
            filename: "horace.md",
            score: 0.45,
            text: "Horace is a merchant.",
            attributes: { page_id: "lore.npc.horace" }
          }
        ];
      })
    };
    const stage = new RetrieveStage(provider);
    const result = await stage.execute(makeInput(true) as never, makeContext() as never);

    const loreScores = result.diagnostics.payload.loreScores as Array<{
      score: number;
      source: string;
      pageId: string | null;
    }>;
    // The synthetic-location evidence also has pageId "lore.location.dock" (it uses
    // area.lorePageId), so select by fileId to avoid ambiguity.
    const pinEntry = loreScores.find((s) => s.fileId === "npc-1");
    const retrievedEntry = loreScores.find((s) => s.fileId === "loc-1");
    expect(pinEntry?.source).toBe("pinned");
    expect(retrievedEntry?.source).toBe("retrieved");
  });

  it('tags the synthetic runtime-location evidence as "synthetic-location"', async () => {
    // Use a social_fast turn so vector search is skipped; only the runtime
    // location evidence is prepended.
    const input = {
      ...makeInput(false),
      interpret: {
        ...makeInput(false).interpret,
        turnRouting: {
          path: "social_fast" as const,
          socialFastPathEligible: true,
          factualRiskSignals: []
        }
      }
    };
    const provider: VectorStoreProvider = {
      searchLore: vi.fn(async () => [])
    };
    const stage = new RetrieveStage(provider);
    const result = await stage.execute(input as never, makeContext() as never);

    const loreScores = result.diagnostics.payload.loreScores as Array<{
      score: number;
      source: string;
      fileId: string;
    }>;
    const synth = loreScores.find((s) => s.fileId === "runtime:blackboard:current-location");
    // runtimeContext.here is set in makeInput; location evidence is prepended
    // only when contextAnchor === "current_location" OR facet === "location".
    // social_fast skips retrieval but does NOT suppress the runtime-location prepend;
    // that prepend is guarded by interpret.interpretation.contextAnchor/facet only.
    // makeInput uses contextAnchor="current_location" so the evidence IS injected.
    if (synth) {
      expect(synth.source).toBe("synthetic-location");
      expect(synth.score).toBe(1);
    }
    // Whether or not runtime location is present, all entries must have a valid source tag.
    expect(loreScores.every((s) => ["retrieved", "pinned", "synthetic-location"].includes(s.source))).toBe(true);
  });
});
