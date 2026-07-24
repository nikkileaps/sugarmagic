/**
 * packages/plugins/src/catalog/sugaragent/runtime/stages/retrieve-stage.test.ts
 *
 * Purpose: Guards the 072.6 own-page-exclusion gate at the boundary the
 * integration tests don't cover: persona LOADED but the turn is
 * location-anchored, where the target is the LOCATION page (not the NPC's own
 * page), so the own-page exclusion must stay OFF and the location eq filter
 * must be used.
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
  });
});
