/**
 * packages/plugins/src/catalog/sugarlang/tests/teacher/situation-prompt.test.ts
 *
 * Purpose: The 090.3 pin -- a MISSING fact and an EMPTY fact must produce
 *   different prompt text.
 *
 * WHY THIS IS ASSERTED AGAINST THE PROMPT STRING
 *   The distinction only matters at the moment it reaches the model. A test on
 *   the Situation object proves the data kept the difference; only a test on the
 *   rendered prompt proves nobody flattened it on the way out. The epic has been
 *   burned by exactly this before -- pins that passed against a mock while the
 *   real prompt said something else.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises runtime/teacher/prompt-builder with a composed Situation.
 *
 * Implements: Plan 090 story 090.3
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { buildTeacherPrompt, formatSituation } from "../../runtime/teacher/prompt-builder";
import { composeSituation } from "../../runtime/situation";
import { createTeacherContext } from "./test-helpers";
import type { ConversationRuntimeContext } from "@sugarmagic/runtime-core";
import type { SceneContextModel } from "../../runtime/contracts/scene-context";

function runtimeContext(
  overrides: Partial<ConversationRuntimeContext> = {}
): ConversationRuntimeContext {
  return {
    here: null,
    playerLocation: null,
    playerPosition: null,
    npcLocation: null,
    npcPosition: null,
    trackedQuest: null,
    activeQuestStage: null,
    activeQuestObjectives: null,
    ...overrides
  } as ConversationRuntimeContext;
}

function situationSection(
  overrides: Partial<ConversationRuntimeContext> = {}
): string {
  return formatSituation(
    createTeacherContext({
      situation: composeSituation({
        sceneId: "scene-station",
        runtimeContext: runtimeContext(overrides)
      })
    })
  );
}

describe("the scene's concepts reach the model", () => {
  // FOUND IN PLAY, 2026-07-30. The situation block rendered prose and runtime
  // facts and silently dropped the concept list, so a scene carrying 15 concepts
  // including `cheese` reached the Teacher as a paragraph mentioning "a
  // cheesemaker" -- and the Teacher, forbidden from inventing lemmas, could not
  // name `queso`. Every unit test passed. This is the assertion that was
  // missing: not "the block renders" but "the affordances are IN it".
  function promptFor(...conceptLabels: string[]): string {
    const model: SceneContextModel = {
      sceneId: "scene-dock",
      contentHash: "hash",
      promptVersion: "090.1.0",
      supportLanguage: "en",
      prose: "A cheesemaker runs a shop here.",
      concepts: conceptLabels.map((label) => ({
        label,
        pos: "noun" as const,
        provenance: [{ sourceId: "npc:npc-finnick", kind: "npc" as const }]
      })),
      extractedAtMs: 1,
      extractedByModel: "gateway-resolved",
      reviewFlag: false
    };
    return buildTeacherPrompt(
      createTeacherContext({
        situation: composeSituation({ sceneId: "scene-dock", sceneContext: model })
      })
    ).user;
  }

  it("names the concept AND the lemma that supplies it", () => {
    // The pair is what makes it actionable. A concept alone is English; the
    // Teacher needs the target-language word to be allowed to name it.
    const prompt = promptFor("cheese");

    expect(prompt).toContain("cheese -> queso");
  });

  it("shows a concept the atlas cannot supply, rather than omitting it", () => {
    // An unteachable concept is information. Dropping it silently is how a
    // slate ends up mysteriously short with no explanation anywhere.
    expect(promptFor("moon-bartering")).toContain("moon-bartering -> (no single word)");
  });

  it("does NOT present function words as what to teach", () => {
    // The old SCENE SNAPSHOT sorted the scene lexicon by frequency and took six,
    // which at the top of any frequency list is `el, de, a, para, haber, por` --
    // printed under a heading saying "teachable lemmas", directly above the real
    // affordances.
    const prompt = promptFor("cheese");

    expect(prompt).not.toContain("teachable lemmas:");
  });
});

describe("formatSituation -- empty is not missing", () => {
  it("renders an unreadable fact as unknown and an empty one as none", () => {
    const missing = situationSection();
    const empty = situationSection({ knownFacts: [] });

    expect(missing).toContain("player has learned: (unknown)");
    expect(empty).toContain("player has learned: (none)");
    expect(missing).not.toEqual(empty);
  });

  it("keeps the distinction for recent world events too", () => {
    expect(situationSection()).toContain("recently in the world: (unknown)");
    expect(situationSection({ recentWorldEvents: [] })).toContain(
      "recently in the world: (none)"
    );
  });

  it("renders values when they are there", () => {
    const section = situationSection({
      knownFacts: ["The dock is closed.", "Orrin sells cheese."],
      timeOfDay: "morning"
    });

    expect(section).toContain("The dock is closed., Orrin sells cheese.");
    expect(section).toContain("time of day: morning");
  });

  it("says unknown for the whole section when there is no situation at all", () => {
    // Distinct from a situation whose fields are individually unavailable: the
    // caller had none to give, which is a different claim again. The fixture
    // hands the Teacher a situation by default (090.4 -- npc/recentTurns live
    // there now), so this test overrides it away explicitly.
    const section = formatSituation(
      createTeacherContext({ situation: undefined })
    );

    expect(section).toContain("(unknown)");
    expect(section).not.toContain("scene:");
  });
});

describe("buildTeacherPrompt -- the situation reaches the model", () => {
  it("puts the situation in the user prompt", () => {
    const prompt = buildTeacherPrompt(
      createTeacherContext({
        situation: composeSituation({
          sceneId: "scene-station",
          runtimeContext: runtimeContext({ timeOfDay: "evening", knownFacts: [] })
        })
      })
    );

    expect(prompt.user).toContain("SITUATION:");
    expect(prompt.user).toContain("time of day: evening");
    // The pin, end to end: this is the string the model actually receives.
    expect(prompt.user).toContain("player has learned: (none)");
  });

  it("a missing fact reaches the model as unknown, not as none", () => {
    const prompt = buildTeacherPrompt(
      createTeacherContext({
        situation: composeSituation({
          sceneId: "scene-station",
          runtimeContext: runtimeContext()
        })
      })
    );

    expect(prompt.user).toContain("player has learned: (unknown)");
    expect(prompt.user).not.toContain("player has learned: (none)");
  });
});
