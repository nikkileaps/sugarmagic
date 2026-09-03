/**
 * packages/plugins/src/catalog/sugarlang/tests/compile/scene-context-extractor.test.ts
 *
 * Purpose: Pins the scene-context extraction pass -- concept inference, the
 *   provenance guard, curriculum-blindness, and every fail-soft path.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/compile/scene-context-extractor against a fake
 *     SugarlangLLMClient. No network, no real clock.
 *
 * Implements: Plan 090 story 090.1
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import type { SugarlangLLMClient, SugarlangLLMRequest } from "../../runtime/llm/types";
import type { ContextSource } from "../../runtime/contracts/scene-context";
import {
  SCENE_CONTEXT_PROMPT_VERSION,
  SceneContextExtractor,
  buildSceneContextPrompt,
  composeSceneContextProse
} from "../../runtime/compile/scene-context-extractor";

const SOURCES: ContextSource[] = [
  {
    sourceId: "npc:finnick",
    kind: "npc",
    displayName: "Finnick",
    labels: { placementLabel: "Cheesemonger" },
    prose: "A anxious trader, obsessed with cheese and a delayed shipment."
  },
  {
    sourceId: "region:dock",
    kind: "region",
    displayName: "The Dock",
    prose: "A wooden pier where cargo boats tie up."
  }
];

function fakeClient(text: string): {
  client: SugarlangLLMClient;
  calls: SugarlangLLMRequest[];
} {
  const calls: SugarlangLLMRequest[] = [];
  return {
    calls,
    client: {
      generate: vi.fn(async (request: SugarlangLLMRequest) => {
        calls.push(request);
        return { text, requestId: "req-1" };
      })
    } as unknown as SugarlangLLMClient
  };
}

function makeExtractor(text: string) {
  const { client, calls } = fakeClient(text);
  let tick = 1000;
  const extractor = new SceneContextExtractor({
    llmClient: client,
    now: () => (tick += 10)
  });
  return { extractor, calls };
}

const REQUEST = {
  sources: SOURCES,
  supportLanguage: "en",
  regionId: "scene-dock",
  contentHash: "hash-1"
};

describe("SceneContextExtractor", () => {
  it("sends the schema so the reply cannot be JSON that fails to parse", async () => {
    const { extractor, calls } = makeExtractor(
      JSON.stringify({ prose: "A dock.", concepts: [] })
    );
    await extractor.extract(REQUEST);

    // Constrained, not merely requested. Without this a single missing comma
    // lost a whole scene's concepts, and it did for several edits.
    expect(calls[0]?.outputSchema).toBeDefined();
    expect((calls[0]?.outputSchema as { type?: string }).type).toBe("object");
  });

  it("calls a truncated reply truncated, not invalid JSON", async () => {
    // These are indistinguishable once the text reaches a parser: both arrive
    // as something that will not parse. Reporting truncation as bad syntax is
    // what sent a real diagnosis days in the wrong direction -- every failing
    // reply had simply run out of room.
    const calls: SugarlangLLMRequest[] = [];
    const extractor = new SceneContextExtractor({
      llmClient: {
        generate: vi.fn(async (request: SugarlangLLMRequest) => {
          calls.push(request);
          return {
            text: '{"prose":"A dock.","concepts":[{"label":"cargo"',
            requestId: "req-1",
            stopReason: "max_tokens"
          };
        })
      } as unknown as SugarlangLLMClient
    });

    const result = await extractor.extract(REQUEST);

    expect(result.failure?.code).toBe("extractor_response_truncated");
    expect(result.failure?.message).toContain("did not fit");
    // Still fail-soft: authored prose survives, concepts do not.
    expect(result.model.concepts).toEqual([]);
  });

  it("extracts concepts inferred from prose, not copied from it", async () => {
    // The motivating case: "cheese" never appears as a standalone word in
    // Finnick's bio, and the word-scanning path therefore cannot nominate it.
    const { extractor } = makeExtractor(
      JSON.stringify({
        prose: "Finnick trades cheese at a busy dock.",
        concepts: [
          { label: "Cheese", pos: "noun", sourceIds: ["npc:finnick"] },
          { label: "cargo", pos: "noun", sourceIds: ["region:dock"] }
        ]
      })
    );

    const result = await extractor.extract(REQUEST);

    expect(result.failure).toBeUndefined();
    expect(result.model.concepts).toEqual([
      // normalized to lowercase, sorted by label
      { label: "cheese", pos: "noun", provenance: [{ sourceId: "npc:finnick", kind: "npc" }] },
      { label: "cargo", pos: "noun", provenance: [{ sourceId: "region:dock", kind: "region" }] }
    ].sort((left, right) => (left.label < right.label ? -1 : 1)));
    expect(result.model.reviewFlag).toBe(false);
  });

  it("accepts a multi-word label with no part of speech", async () => {
    // `self introduction` has no single word and no sensible POS. Spanish says
    // "me llamo" -- there is no lemma correspondence to find, so the concept
    // must survive without one.
    const { extractor } = makeExtractor(
      JSON.stringify({
        prose: "First meeting.",
        concepts: [{ label: "self introduction", sourceIds: ["npc:finnick"] }]
      })
    );

    const result = await extractor.extract(REQUEST);

    expect(result.failure).toBeUndefined();
    expect(result.model.concepts).toHaveLength(1);
    expect(result.model.concepts[0]).toEqual({
      label: "self introduction",
      provenance: [{ sourceId: "npc:finnick", kind: "npc" }]
    });
    expect(result.model.concepts[0]).not.toHaveProperty("pos");
  });

  it("sends purpose:\"extraction\" and never a client-chosen model", async () => {
    const { extractor, calls } = makeExtractor(
      JSON.stringify({ prose: "p", concepts: [] })
    );

    await extractor.extract(REQUEST);

    expect(calls[0]?.purpose).toBe("extraction");
    expect(calls[0]?.model).toBeUndefined();
  });

  it("drops a concept whose every cited source was never sent", async () => {
    // A model citing an unknown sourceId is inventing provenance. An
    // unattributable concept must not reach a teaching decision.
    const { extractor } = makeExtractor(
      JSON.stringify({
        prose: "p",
        concepts: [
          { label: "cheese", pos: "noun", sourceIds: ["npc:finnick"] },
          { label: "dragons", pos: "noun", sourceIds: ["npc:nobody"] }
        ]
      })
    );

    const result = await extractor.extract(REQUEST);

    expect(result.model.concepts.map((concept) => concept.label)).toEqual([
      "cheese"
    ]);
    // The drop is a prompt/model problem, so it is surfaced rather than silent.
    expect(result.model.reviewFlag).toBe(true);
  });

  it("keeps the valid citations of a partially-hallucinated concept", async () => {
    const { extractor } = makeExtractor(
      JSON.stringify({
        prose: "p",
        concepts: [
          { label: "cheese", pos: "noun", sourceIds: ["npc:nobody", "npc:finnick"] }
        ]
      })
    );

    const result = await extractor.extract(REQUEST);

    expect(result.model.concepts[0]?.provenance).toEqual([
      { sourceId: "npc:finnick", kind: "npc" }
    ]);
  });

  it("merges a repeated label into one concept with both provenances", async () => {
    const { extractor } = makeExtractor(
      JSON.stringify({
        prose: "p",
        concepts: [
          { label: "cargo", pos: "noun", sourceIds: ["region:dock"] },
          { label: "Cargo", pos: "noun", sourceIds: ["npc:finnick"], mustComprehend: true }
        ]
      })
    );

    const result = await extractor.extract(REQUEST);

    expect(result.model.concepts).toHaveLength(1);
    expect(result.model.concepts[0]?.provenance).toEqual([
      { sourceId: "npc:finnick", kind: "npc" },
      { sourceId: "region:dock", kind: "region" }
    ]);
    // mustComprehend is sticky across a merge -- required by one source is required.
    expect(result.model.concepts[0]?.mustComprehend).toBe(true);
  });

  describe("fail-soft", () => {
    it.each([
      ["unparseable text", "I'm afraid I can't do that."],
      ["invalid json", "{ not json"],
      ["schema violation", JSON.stringify({ prose: "p" })],
      ["bad part of speech", JSON.stringify({
        prose: "p",
        concepts: [{ label: "x", pos: "article", sourceIds: ["npc:finnick"] }]
      })]
    ])("degrades to authored prose with no concepts on %s", async (_label, text) => {
      const { extractor } = makeExtractor(text);

      const result = await extractor.extract(REQUEST);

      expect(result.failure).toBeDefined();
      expect(result.model.concepts).toEqual([]);
      // Still usable: authored names survive without any model involvement.
      expect(result.model.prose).toBe("Present here: Finnick, The Dock.");
      expect(result.model.reviewFlag).toBe(true);
    });

    it("degrades rather than throwing when the gateway is down", async () => {
      let tick = 0;
      const extractor = new SceneContextExtractor({
        llmClient: {
          generate: vi.fn(async () => {
            throw new Error("502 Bad Gateway");
          })
        } as unknown as SugarlangLLMClient,
        now: () => (tick += 5)
      });

      const result = await extractor.extract(REQUEST);

      expect(result.failure?.code).toBe("extractor_request_failed");
      expect(result.failure?.message).toContain("502");
      expect(result.model.concepts).toEqual([]);
      expect(result.model.prose).toBe("Present here: Finnick, The Dock.");
    });
  });

  it("rejects `article`, which no atlas emits, at the schema boundary", async () => {
    // Guards the specific trap the plan names: adopting the budgeter's
    // FUNCTIONAL_POS would admit values that can never resolve.
    const { extractor } = makeExtractor(
      JSON.stringify({
        prose: "p",
        concepts: [{ label: "the", pos: "article", sourceIds: ["npc:finnick"] }]
      })
    );

    const result = await extractor.extract(REQUEST);

    expect(result.failure?.code).toBe("extractor_schema_violation");
  });
});

describe("buildSceneContextPrompt", () => {
  it("is deterministic regardless of source order", () => {
    const forward = buildSceneContextPrompt(SOURCES, "en");
    const reversed = buildSceneContextPrompt([...SOURCES].reverse(), "en");

    expect(forward.user).toBe(reversed.user);
  });

  it("passes authored labels through instead of leaving them to inference", () => {
    // `placementLabel` is where an author types "Cheesemonger". There is no role
    // field on NPCDefinition, so this is the only authored signal for it.
    const { user } = buildSceneContextPrompt(SOURCES, "en");

    expect(user).toContain("placementLabel: Cheesemonger");
    expect(user).toContain("name: Finnick");
  });

  it("carries the prompt version so a prompt change invalidates deliberately", () => {
    const { user } = buildSceneContextPrompt(SOURCES, "en");

    expect(user).toContain(`promptVersion: ${SCENE_CONTEXT_PROMPT_VERSION}`);
  });

  it("mentions neither the atlas nor the competency inventory", () => {
    // Curriculum-blindness is load-bearing: an extractor that knows the ten
    // competencies can only ever surface those ten, so a gap in the curriculum
    // becomes invisible. It is also what keeps the cache valid across
    // curriculum edits and target languages.
    const { system, user } = buildSceneContextPrompt(SOURCES, "en");
    const combined = `${system}\n${user}`.toLowerCase();

    expect(combined).not.toContain("atlas");
    expect(combined).not.toContain("competency");
    expect(combined).not.toContain("lemma");
  });
});

describe("composeSceneContextProse", () => {
  it("needs no model -- the no-LLM half of the capability split", () => {
    expect(composeSceneContextProse(SOURCES)).toBe(
      "Present here: Finnick, The Dock."
    );
  });

  it("returns empty when nothing is named", () => {
    expect(composeSceneContextProse([])).toBe("");
    expect(
      composeSceneContextProse([{ sourceId: "s", kind: "lore", prose: "text" }])
    ).toBe("");
  });
});
