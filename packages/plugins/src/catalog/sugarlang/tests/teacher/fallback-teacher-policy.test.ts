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

describe("FallbackTeacherPolicy", () => {
  const policy = new FallbackTeacherPolicy();

  it("always produces a valid fallback directive", async () => {
    const directive = await policy.invoke(createTeacherContext());
    expect(directive.targetVocab.reinforce).toHaveLength(1);
    expect(directive.directiveLifetime.maxTurns).toBe(3);
    expect(directive.isFallbackDirective).toBe(true);
  });

  it("produces anchored posture with inline glossing at cold start", async () => {
    const context = createTeacherContext({
      activeQuestEssentialLemmas: []
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
    const directive = await policy.invoke(
      createTeacherContext({
        probeFloorState: {
          turnsSinceLastProbe: 30,
          totalPendingLemmas: 5,
          softFloorReached: true,
          hardFloorReached: true,
          hardFloorReason: "turns-since-probe"
        },
        pendingProvisionalLemmas: [
          { lemmaRef: { lemmaId: "uno", lang: "es" }, evidenceAmount: 1, turnsPending: 1 },
          { lemmaRef: { lemmaId: "dos", lang: "es" }, evidenceAmount: 1, turnsPending: 2 },
          { lemmaRef: { lemmaId: "tres", lang: "es" }, evidenceAmount: 1, turnsPending: 3 },
          { lemmaRef: { lemmaId: "cuatro", lang: "es" }, evidenceAmount: 1, turnsPending: 4 },
          { lemmaRef: { lemmaId: "cinco", lang: "es" }, evidenceAmount: 1, turnsPending: 5 }
        ]
      })
    );

    expect(directive.comprehensionCheck.trigger).toBe(true);
    expect(directive.comprehensionCheck.targetLemmas).toEqual([
      { lemmaId: "cinco", lang: "es" },
      { lemmaId: "cuatro", lang: "es" },
      { lemmaId: "tres", lang: "es" }
    ]);
    expect(directive.comprehensionCheck.triggerReason).toBe("hard-floor-turns");
  });

  it("triggers a soft-floor probe for confident learners", async () => {
    const context = createTeacherContext();
    context.learner.assessment.cefrConfidence = 0.8;
    const directive = await policy.invoke({
      ...context,
      probeFloorState: {
        turnsSinceLastProbe: 10,
        totalPendingLemmas: 3,
        softFloorReached: true,
        hardFloorReached: false
      }
    });

    expect(directive.comprehensionCheck.trigger).toBe(true);
    expect(directive.comprehensionCheck.triggerReason).toBe("soft-floor");
  });

  it("does not trigger a probe when no floor is active", async () => {
    const directive = await policy.invoke(
      createTeacherContext({
        probeFloorState: {
          turnsSinceLastProbe: 2,
          totalPendingLemmas: 0,
          softFloorReached: false,
          hardFloorReached: false
        },
        pendingProvisionalLemmas: []
      })
    );

    expect(directive.comprehensionCheck.trigger).toBe(false);
    expect(directive.comprehensionCheck.targetLemmas).toEqual([]);
  });
});
