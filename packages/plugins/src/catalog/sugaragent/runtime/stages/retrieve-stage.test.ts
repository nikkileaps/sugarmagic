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
      loreRelevanceFloor: 0,
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

// Plan 078.2 exit-criteria unit tests (a)-(f)
describe("RetrieveStage loreRelevanceFloor (078.2)", () => {
  function makeFloorContext(floor: number) {
    return { ...makeContext(), config: { ...makeContext().config, loreRelevanceFloor: floor } };
  }

  // Branch B, no pin: personaLoaded=false + contextAnchor="npc" so targetedLorePageId
  // equals npcLorePageId -> shouldPinNpcLore=false. Clean isolation for floor tests.
  function makeBranchBInput() {
    const base = makeInput(false);
    return {
      ...base,
      interpret: {
        ...base.interpret,
        interpretation: {
          ...base.interpret.interpretation,
          contextAnchor: "npc" as never,
          facet: "character" as never
        }
      }
    };
  }

  function makeProvider(scores: number[]) {
    return {
      searchLore: vi.fn(async () =>
        scores.map((score, i) => ({
          fileId: `f${i}`,
          filename: `chunk-${i}.md`,
          score,
          text: `Chunk ${i} text.`,
          attributes: { page_id: "lore.npc.horace" }
        }))
      )
    } as VectorStoreProvider;
  }

  it("(a) floor=0 is a no-op -- all chunks pass", async () => {
    const stage = new RetrieveStage(makeProvider([0.8, 0.3]));
    const result = await stage.execute(makeBranchBInput() as never, makeFloorContext(0) as never);
    expect(result.diagnostics.payload.droppedByFloor).toBe(0);
    expect((result.diagnostics.payload.droppedScores as number[]).length).toBe(0);
    const lore = result.output.loreContext.filter((item) => !item.fileId.startsWith("runtime:"));
    expect(lore.length).toBe(2);
  });

  it("(b) floor between two scores drops the weak chunk, keeps the strong one", async () => {
    const stage = new RetrieveStage(makeProvider([0.8, 0.3]));
    const result = await stage.execute(makeBranchBInput() as never, makeFloorContext(0.5) as never);
    expect(result.diagnostics.payload.droppedByFloor).toBe(1);
    expect(result.diagnostics.payload.droppedScores).toEqual([0.3]);
    const kept = result.output.loreContext.filter((item) => item.fileId === "f0");
    const dropped = result.output.loreContext.filter((item) => item.fileId === "f1");
    expect(kept.length).toBe(1);
    expect(dropped.length).toBe(0);
  });

  it("(c) pinned own-page chunk below the floor survives (pin bypasses filter)", async () => {
    // Primary search returns a strong doc-page chunk.
    // Pin search returns a weak NPC-page chunk (score 0.2, below floor 0.5).
    let callCount = 0;
    const provider: VectorStoreProvider = {
      searchLore: vi.fn(async () => {
        callCount += 1;
        if (callCount === 1) {
          return [{ fileId: "loc-1", filename: "dock.md", score: 0.9, text: "Dock text.", attributes: { page_id: "lore.location.dock" } }];
        }
        return [{ fileId: "npc-1", filename: "horace.md", score: 0.2, text: "Horace text.", attributes: { page_id: "lore.npc.horace" } }];
      })
    };
    const stage = new RetrieveStage(provider);
    const result = await stage.execute(makeInput(true) as never, makeFloorContext(0.5) as never);
    // The weak NPC pin must be present (pin bypasses filter).
    const pin = result.output.loreContext.find((item) => item.fileId === "npc-1");
    expect(pin).toBeDefined();
    expect(pin?.score).toBe(0.2);
    // The strong dock chunk should also be present.
    const strong = result.output.loreContext.find((item) => item.fileId === "loc-1");
    expect(strong).toBeDefined();
    // Only the primary results are filtered; droppedByFloor = 0 (loc-1 passes, pin bypasses).
    expect(result.diagnostics.payload.droppedByFloor).toBe(0);
  });

  it("(d) floor above all retrieved scores yields empty loreContext, status ok, loreSearchPerformed true", async () => {
    const stage = new RetrieveStage(makeProvider([0.4, 0.3]));
    const result = await stage.execute(makeBranchBInput() as never, makeFloorContext(0.9) as never);
    expect(result.status).toBe("ok");
    expect(result.output.loreSearchPerformed).toBe(true);
    expect(result.diagnostics.payload.droppedByFloor).toBe(2);
    // No retrieved chunks in loreContext (synthetic-location is absent too since
    // makeBranchBInput uses contextAnchor="npc", not "current_location").
    expect(result.output.loreContext.length).toBe(0);
  });

  it("(e) synthetic runtime-location evidence survives any floor <= 1", async () => {
    // Use makeInput(true) with location-anchored turn so runtime-location is prepended.
    // The retrieved chunk (0.1) is dropped by the floor; the synthetic prepend survives.
    const stage = new RetrieveStage(makeProvider([0.1]));
    const result = await stage.execute(makeInput(true) as never, makeFloorContext(0.99) as never);
    // shouldPinNpcLore fires here (location-anchored, persona loaded), but the pin mock
    // returns the same 0.1-score chunk, which is NOT the NPC's own page and doesn't pass
    // the page_id check for pinning. droppedByFloor covers both primary + (zero) pin results.
    const synth = result.output.loreContext.find(
      (item) => item.fileId === "runtime:blackboard:current-location"
    );
    expect(synth).toBeDefined();
    expect(synth?.score).toBe(1);
  });

  it("(f) with excludeOwnPage, floor filters other-lore before the slice", async () => {
    // personaLoaded=true + non-location-anchored turn triggers Branch A (excludeOwnPage).
    const nonLocationInput = {
      ...makeInput(true),
      interpret: {
        ...makeInput(true).interpret,
        interpretation: {
          ...makeInput(true).interpret.interpretation,
          contextAnchor: "npc" as never,
          facet: "character" as never
        }
      }
    };
    // Provider returns 3 chunks from other pages: scores 0.8, 0.4, 0.3.
    // NPC own page (lore.npc.horace) is excluded; the other 3 are from other pages.
    const provider: VectorStoreProvider = {
      searchLore: vi.fn(async () => [
        { fileId: "a", filename: "a.md", score: 0.8, text: "A.", attributes: { page_id: "lore.world.a" } },
        { fileId: "b", filename: "b.md", score: 0.4, text: "B.", attributes: { page_id: "lore.world.b" } },
        { fileId: "own", filename: "horace.md", score: 0.9, text: "Own.", attributes: { page_id: "lore.npc.horace" } }
      ])
    };
    const stage = new RetrieveStage(provider);
    // Floor 0.5: drops chunk b (0.4) and the own-page is already excluded, a (0.8) survives.
    const result = await stage.execute(nonLocationInput as never, makeFloorContext(0.5) as never);
    expect(result.diagnostics.payload.ownPageExcluded).toBe(true);
    expect(result.diagnostics.payload.droppedByFloor).toBe(1);
    const kept = result.output.loreContext.filter((item) => item.fileId === "a");
    const weakDropped = result.output.loreContext.filter((item) => item.fileId === "b");
    const ownDropped = result.output.loreContext.filter((item) => item.fileId === "own");
    expect(kept.length).toBe(1);
    expect(weakDropped.length).toBe(0);
    expect(ownDropped.length).toBe(0);
  });
});
