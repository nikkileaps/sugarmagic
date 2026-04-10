/**
 * packages/plugins/src/catalog/sugarlang/tests/middlewares/sugar-lang-verify-middleware.test.ts
 *
 * Purpose: Verifies repair and fallback behavior in the Sugarlang verify middleware.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Depends on ../../runtime/middlewares/sugar-lang-verify-middleware.
 *   - Uses shared middleware test fixtures from ./test-helpers.
 *
 * Implements: Epic 10 Story 10.4
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import { createSugarLangVerifyMiddleware } from "../../runtime/middlewares/sugar-lang-verify-middleware";
import { SUGARLANG_CONSTRAINT_ANNOTATION } from "../../runtime/middlewares/shared";
import {
  createBaseConstraint,
  createServicesStub,
  createTestExecution,
  createTestLearnerProfile,
  createTestTurn
} from "./test-helpers";

describe("SugarLangVerifyMiddleware", () => {
  it("repairs an out-of-envelope turn and returns the repaired text", async () => {
    const classifierCheck = vi
      .fn()
      .mockReturnValueOnce({
        withinEnvelope: false,
        profile: {
          totalTokens: 1,
          knownTokens: 0,
          inBandTokens: 0,
          unknownTokens: 1,
          bandHistogram: {
            A1: 0,
            A2: 0,
            B1: 1,
            B2: 0,
            C1: 0,
            C2: 0
          },
          outOfEnvelopeLemmas: [{ lemmaId: "complicado", lang: "es" }],
          ceilingExceededLemmas: [{ lemmaId: "complicado", lang: "es" }],
          questEssentialLemmasMatched: [],
          coverageRatio: 0.5
        },
        worstViolation: {
          lemmaRef: { lemmaId: "complicado", lang: "es" },
          surfaceForm: "complicado",
          cefrBand: "B1",
          reason: "too hard"
        },
        rule: "test",
        violations: [
          {
            lemmaRef: { lemmaId: "complicado", lang: "es" },
            surfaceForm: "complicado",
            cefrBand: "B1",
            reason: "too hard"
          }
        ],
        exemptionsApplied: []
      })
      .mockReturnValueOnce({
        withinEnvelope: true,
        profile: {
          totalTokens: 1,
          knownTokens: 1,
          inBandTokens: 1,
          unknownTokens: 0,
          bandHistogram: {
            A1: 1,
            A2: 0,
            B1: 0,
            B2: 0,
            C1: 0,
            C2: 0
          },
          outOfEnvelopeLemmas: [],
          ceilingExceededLemmas: [],
          questEssentialLemmasMatched: [],
          coverageRatio: 1
        },
        worstViolation: null,
        rule: "test",
        violations: [],
        exemptionsApplied: []
      });
    const llmProvider = {
      generateStructuredTurn: vi.fn().mockResolvedValue("texto simple")
    };
    const services = createServicesStub({
      resolveForExecution: () => ({
        learnerStore: {
          getCurrentProfile: vi
            .fn()
            .mockResolvedValue(createTestLearnerProfile())
        },
        sceneLexiconStore: {
          ensure: vi.fn().mockResolvedValue({
            sceneId: "scene-1",
            contentHash: "hash",
            pipelineVersion: "v1",
            atlasVersion: "v1",
            profile: "runtime-preview",
            lemmas: {},
            properNouns: [],
            anchors: [],
            questEssentialLemmas: []
          })
        },
        classifier: {
          check: classifierCheck
        },
        llmProvider
      })
    });
    const middleware = createSugarLangVerifyMiddleware({
      services: services as never
    });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint({
      rawPrescription: {
        introduce: [],
        reinforce: [],
        avoid: [{ lemmaId: "complicado", lang: "es" }],
        budget: { newItemsAllowed: 0 },
        rationale: {
          candidateSetSize: 0,
          envelopeSurvivorCount: 0,
          priorityScores: [],
          reasons: []
        }
      }
    });

    const result = await middleware.finalize?.(
      execution,
      createTestTurn("texto complicado")
    );

    expect(llmProvider.generateStructuredTurn).toHaveBeenCalledTimes(1);
    expect(result?.text).toBe("texto simple");
  });
});
