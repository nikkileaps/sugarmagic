/**
 * packages/plugins/src/catalog/sugarlang/tests/director/fallback-director-policy.test.ts
 *
 * Purpose: Verifies the deterministic fallback Director policy under common failure modes.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/director/fallback-director-policy directly.
 *   - Confirms the fallback remains safe, deterministic, and clearly flagged.
 *
 * Implements: Epic 9 Story 9.4
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { FallbackDirectorPolicy } from "../../runtime/director/fallback-director-policy";
import { createDirectorContext } from "./test-helpers";

describe("FallbackDirectorPolicy", () => {
  const policy = new FallbackDirectorPolicy();

  it("always produces a valid fallback directive", async () => {
    const directive = await policy.invoke(createDirectorContext());
    expect(directive.targetVocab.reinforce).toHaveLength(1);
    expect(directive.directiveLifetime.maxTurns).toBe(3);
    expect(directive.isFallbackDirective).toBe(true);
  });

  it("produces anchored posture with inline glossing at cold start", async () => {
    const context = createDirectorContext({
      activeQuestEssentialLemmas: []
    });
    context.learner.assessment.status = "unassessed";
    context.learner.assessment.cefrConfidence = 0.2;
    const directive = await policy.invoke(context);

    expect(directive.supportPosture).toBe("anchored");
    expect(directive.glossingStrategy).toBe("inline");
  });

  it("produces target-dominant posture at high confidence", async () => {
    const context = createDirectorContext({
      learner: createDirectorContext({
        learner: createDirectorContext().learner
      }).learner
    });
    context.learner.assessment.cefrConfidence = 0.9;
    const directive = await policy.invoke(context);

    expect(directive.supportPosture).toBe("target-dominant");
    expect(directive.targetLanguageRatio).toBe(0.85);
  });

  it("flags every output as a fallback directive", async () => {
    const directive = await policy.invoke(createDirectorContext());
    expect(directive.isFallbackDirective).toBe(true);
  });

  it("honors the hard floor with the oldest pending lemmas", async () => {
    const directive = await policy.invoke(
      createDirectorContext({
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
    const context = createDirectorContext();
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
      createDirectorContext({
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
