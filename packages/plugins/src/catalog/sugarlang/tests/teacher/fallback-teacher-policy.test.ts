/**
 * packages/plugins/src/catalog/sugarlang/tests/teacher/fallback-teacher-policy.test.ts
 *
 * Purpose: Verifies the deterministic fallback Teacher'spolicy under common failure modes.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/teacher/policies/fallback-teacher-policy directly.
 *   - Confirms the fallback remains safe, deterministic, and clearly flagged.
 *
 * Implements: Epic 9 Story 9.4
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { FallbackTeacherPolicy } from "../../runtime/teacher/policies/fallback-teacher-policy";
import { createTeacherContext } from "./test-helpers";
import { createLemmaCard } from "../learner/test-helpers";
import { composeSituation } from "../../runtime/situation";
import type { SceneContextModel } from "../../runtime/contracts/scene-context";

/**
 * 090.4b: the fallback derives its slate from the SITUATION now, not the
 * prescription, so these tests have to supply one. That is the change in one
 * line: a fallback with no situation teaches nothing, which is the correct
 * answer and used to be impossible because the budgeter always had an opinion.
 *
 * `queso` is A1 in the shipped atlas and absent from the fixture learner's
 * cards, so its learning status is `unseen` -> introduce. `hola` is on a card
 * with low retrievability -> due -> reinforce.
 */
function situationTeaching(...conceptLabels: string[]) {
  const sceneContext: SceneContextModel = {
    sceneId: "scene-station",
    contentHash: "hash",
    promptVersion: "090.1.0",
    supportLanguage: "en",
    prose: "A station.",
    concepts: conceptLabels.map((label) => ({
      label,
      pos: "noun" as const,
      provenance: [{ sourceId: "npc:npc-orrin", kind: "npc" as const }]
    })),
    extractedAtMs: 1,
    extractedByModel: "gateway-resolved",
    reviewFlag: false
  };
  return composeSituation({ sceneId: "scene-station", sceneContext });
}

describe("FallbackTeacherPolicy", () => {
  const policy = new FallbackTeacherPolicy();

  it("always produces a valid fallback directive", async () => {
    const directive = await policy.invoke(
      createTeacherContext({ situation: situationTeaching("ticket", "cheese") })
    );

    // The mapping IS the behavior, so assert both halves:
    //   ticket -> billete, reviewCount 0        -> unseen -> introduce
    //   cheese -> queso,   retrievability 0.42  -> due    -> reinforce
    // Learning status (090.9) is doing the sorting; the prescription is not
    // consulted at all.
    expect(directive.targetVocab.introduce).toEqual([
      { kind: "vocabulary", lemmaId: "billete", lang: "es" }
    ]);
    expect(directive.targetVocab.reinforce).toEqual([
      { kind: "vocabulary", lemmaId: "queso", lang: "es" }
    ]);
    expect(directive.directiveLifetime.maxTurns).toBe(3);
    expect(directive.isFallbackDirective).toBe(true);
  });

  it("produces anchored posture with inline glossing at cold start", async () => {
    const context = createTeacherContext({
      situation: situationTeaching("ticket")
    });
    context.learner.assessment.status = "unassessed";
    context.learner.assessment.cefrConfidence = 0.2;
    const directive = await policy.invoke(context);

    expect(directive.supportPosture).toBe("anchored");
    expect(directive.glossingStrategy).toBe("inline");
  });

  it("produces target-dominant posture at high confidence", async () => {
    const context = createTeacherContext({
      learner: createTeacherContext({
        learner: createTeacherContext().learner
      }).learner
    });
    context.learner.assessment.cefrConfidence = 0.9;
    const directive = await policy.invoke(context);

    expect(directive.supportPosture).toBe("target-dominant");
    expect(directive.targetLanguageRatio).toBe(0.85);
  });

  it("flags every output as a fallback directive", async () => {
    const directive = await policy.invoke(createTeacherContext());
    expect(directive.isFallbackDirective).toBe(true);
  });

  it("honors the hard floor with the oldest pending lemmas", async () => {
    // 090.4: the floor state and the pending list are DERIVED, so this sets up
    // what produces them -- five cards carrying provisional evidence, and a
    // conversation 30 turns past its last probe (>= the hard floor's 25).
    const base = createTeacherContext();
    const directive = await policy.invoke({
      ...base,
      learner: {
        ...base.learner,
        currentSession: { ...base.learner.currentSession!, turns: 10 },
        lemmaCards: {
          uno: createLemmaCard("uno", "A1", {
            provisionalEvidence: 1,
            provisionalEvidenceFirstSeenTurn: 9
          }),
          dos: createLemmaCard("dos", "A1", {
            provisionalEvidence: 1,
            provisionalEvidenceFirstSeenTurn: 8
          }),
          tres: createLemmaCard("tres", "A1", {
            provisionalEvidence: 1,
            provisionalEvidenceFirstSeenTurn: 7
          }),
          cuatro: createLemmaCard("cuatro", "A1", {
            provisionalEvidence: 1,
            provisionalEvidenceFirstSeenTurn: 6
          }),
          cinco: createLemmaCard("cinco", "A1", {
            provisionalEvidence: 1,
            provisionalEvidenceFirstSeenTurn: 5
          })
        }
      },
      situation: { ...base.situation!, turnsSinceLastProbe: 30 }
    });

    expect(directive.comprehensionCheck.trigger).toBe(true);
    expect(directive.comprehensionCheck.targetLemmas).toEqual([
      { lemmaId: "cinco", lang: "es" },
      { lemmaId: "cuatro", lang: "es" },
      { lemmaId: "tres", lang: "es" }
    ]);
    expect(directive.comprehensionCheck.triggerReason).toBe("hard-floor-turns");
  });

  it("triggers a soft-floor probe for confident learners", async () => {
    // 090.4: the soft floor is `turnsSinceLastProbe >= 15 && pending >= 5`.
    // The injected fixture this replaced claimed softFloorReached with
    // turnsSinceLastProbe 10 and 3 pending -- a state the real rule cannot
    // produce, so the test was asserting against something unreachable.
    const context = createTeacherContext();
    context.learner.assessment.cefrConfidence = 0.8;
    const directive = await policy.invoke({
      ...context,
      learner: {
        ...context.learner,
        currentSession: { ...context.learner.currentSession!, turns: 10 },
        lemmaCards: Object.fromEntries(
          ["uno", "dos", "tres", "cuatro", "cinco"].map((lemmaId) => [
            lemmaId,
            createLemmaCard(lemmaId, "A1", {
              provisionalEvidence: 1,
              provisionalEvidenceFirstSeenTurn: 9
            })
          ])
        )
      },
      situation: { ...context.situation!, turnsSinceLastProbe: 20 }
    });

    expect(directive.comprehensionCheck.trigger).toBe(true);
    expect(directive.comprehensionCheck.triggerReason).toBe("soft-floor");
  });

  it("does not trigger a probe when no floor is active", async () => {
    const base = createTeacherContext();
    const directive = await policy.invoke({
      ...base,
      learner: { ...base.learner, lemmaCards: {} },
      situation: { ...base.situation!, turnsSinceLastProbe: 2 }
    });

    expect(directive.comprehensionCheck.trigger).toBe(false);
    expect(directive.comprehensionCheck.targetLemmas).toEqual([]);
  });
});
