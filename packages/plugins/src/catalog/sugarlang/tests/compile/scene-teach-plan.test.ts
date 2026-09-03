/**
 * packages/plugins/src/catalog/sugarlang/tests/compile/scene-teach-plan.test.ts
 *
 * Purpose: Pins the build-time Teacher call -- how many times it runs, what it
 *   is told, and what it does when the Teacher fails.
 *
 * Implements: Plan 090 story 090.11
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import { planSceneTeaching } from "../../runtime/compile/scene-teach-plan";
import type { PedagogicalDirective } from "../../runtime/contracts/pedagogy";
import type { SceneContextModel } from "../../runtime/contracts/scene-context";
import type { TeacherContext } from "../../runtime/contracts/providers";
import { createTestAtlasProvider } from "./test-helpers";

function directive(): PedagogicalDirective {
  return {
    targetVocab: {
      introduce: [{ kind: "vocabulary", lemmaId: "queso", lang: "es" }],
      reinforce: [],
      avoid: []
    },
    supportPosture: "anchored",
    targetLanguageRatio: 0.3,
    interactionStyle: "listening_first",
    glossingStrategy: "hover",
    sentenceComplexityCap: "single-clause",
    comprehensionCheck: null,
    directiveLifetime: { maxTurns: 6 },
    citedSignals: [],
    rationale: "test",
    confidenceBand: "medium",
    isFallbackDirective: false
  } as unknown as PedagogicalDirective;
}

function sceneContext(): SceneContextModel {
  return {
    regionId: "scene-dock",
    contentHash: "hash-1",
    concepts: [{ word: "cheese", pos: "noun", provenance: "npc:finnick:bio" }]
  } as unknown as SceneContextModel;
}

const ATLAS = createTestAtlasProvider("es", []);

describe("build-time teach plan", () => {
  it("calls the Teacher ONCE PER BAND, not once per line", () => {
    // The estimate that made this story look unaffordable was "one LLM call per
    // line per band". It is not: the build-time situation is scene-level --
    // no quest, no time of day, no NPC, no recent turns -- so every node in a
    // scene composes an identical Situation and would get an identical
    // directive. A 50-node scene across 6 bands is 6 calls, not 300.
    const invoke = vi.fn(async () => directive());

    return planSceneTeaching({
      regionId: "scene-dock",
      sceneContext: sceneContext(),
      bands: ["A1", "A2", "B1"],
      targetLanguage: "es",
      supportLanguage: "en",
      teacher: { invoke },
      atlas: ATLAS
    }).then((plan) => {
      expect(invoke).toHaveBeenCalledTimes(3);
      expect([...plan.byBand.keys()]).toEqual(["A1", "A2", "B1"]);
    });
  });

  it("hands the Teacher a synthetic EMPTY learner at the band being baked", async () => {
    // A variant is per BAND, not per person -- there is no learner in its cache
    // key -- so the bake must not be personalised. An empty profile is the
    // honest representation of "some learner at band B": everything reads
    // unseen, so everything is introduce-eligible and nothing is spuriously due.
    // Feeding a real player's cards in here would bake one person's review
    // schedule into content every player reads.
    const seen: TeacherContext[] = [];
    const invoke = vi.fn(async (ctx: TeacherContext) => {
      seen.push(ctx);
      return directive();
    });

    await planSceneTeaching({
      regionId: "scene-dock",
      sceneContext: sceneContext(),
      bands: ["B2"],
      targetLanguage: "es",
      supportLanguage: "en",
      teacher: { invoke },
      atlas: ATLAS
    });

    expect(seen[0]!.learner.estimatedCefrBand).toBe("B2");
    expect(seen[0]!.learner.lemmaCards).toEqual({});
  });

  it("carries no NPC, because the key excludes one and the concepts already have the bio", async () => {
    // situationKey deliberately excludes the NPC, so adding one would change the
    // PROMPT while leaving the KEY identical -- the exact shape that lets a
    // cache serve one NPC's directive for another. The bio is already in the
    // scene's concepts via provenance.
    const seen: TeacherContext[] = [];
    const invoke = vi.fn(async (ctx: TeacherContext) => {
      seen.push(ctx);
      return directive();
    });

    await planSceneTeaching({
      regionId: "scene-dock",
      sceneContext: sceneContext(),
      bands: ["A1"],
      targetLanguage: "es",
      supportLanguage: "en",
      teacher: { invoke },
      atlas: ATLAS
    });

    expect(seen[0]!.situation?.npc).toBeUndefined();
    expect(seen[0]!.situation?.recentTurns).toBeUndefined();
  });

  it("still asks when the scene was never built, rather than skipping", async () => {
    // composeSituation is total, so a null scene context is a valid situation
    // with everything unavailable. The Teacher gives a weak answer rather than
    // no answer, and the caller can tell which by checking the context.
    const invoke = vi.fn(async () => directive());

    const plan = await planSceneTeaching({
      regionId: "scene-dock",
      sceneContext: null,
      bands: ["A1"],
      targetLanguage: "es",
      supportLanguage: "en",
      teacher: { invoke },
      atlas: ATLAS
    });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(plan.byBand.has("A1")).toBe(true);
  });

  it("one band failing does not abandon the others", async () => {
    // A bake that loses one band must not lose the rest. The failed band is
    // ABSENT from the plan, which the caller reads as "bake this band with no
    // slate" -- the pre-090.11 behavior, not an invented slate.
    let calls = 0;
    const invoke = vi.fn(async () => {
      calls += 1;
      if (calls === 2) throw new Error("gateway 503");
      return directive();
    });

    const plan = await planSceneTeaching({
      regionId: "scene-dock",
      sceneContext: sceneContext(),
      bands: ["A1", "A2", "B1"],
      targetLanguage: "es",
      supportLanguage: "en",
      teacher: { invoke },
      atlas: ATLAS
    });

    expect([...plan.byBand.keys()]).toEqual(["A1", "B1"]);
    expect(plan.byBand.has("A2")).toBe(false);
  });

  it("exposes the directive's vocab as the slate the bake consumes", async () => {
    const invoke = vi.fn(async () => directive());

    const plan = await planSceneTeaching({
      regionId: "scene-dock",
      sceneContext: sceneContext(),
      bands: ["A1"],
      targetLanguage: "es",
      supportLanguage: "en",
      teacher: { invoke },
      atlas: ATLAS
    });

    expect(plan.byBand.get("A1")!.slate.introduce).toEqual([
      { kind: "vocabulary", lemmaId: "queso", lang: "es" }
    ]);
  });
});
