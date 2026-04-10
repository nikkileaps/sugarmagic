/**
 * packages/plugins/src/catalog/sugarlang/tests/middlewares/sugar-lang-director-middleware.test.ts
 *
 * Purpose: Verifies the Sugarlang director middleware's constraint assembly and pre-placement bypass.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Depends on ../../runtime/middlewares/sugar-lang-director-middleware.
 *   - Uses shared middleware test fixtures from ./test-helpers.
 *
 * Implements: Epic 10 Story 10.2
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import { createSugarLangDirectorMiddleware } from "../../runtime/middlewares/sugar-lang-director-middleware";
import {
  SUGARLANG_CONSTRAINT_ANNOTATION,
  SUGARLANG_DIRECTIVE_ANNOTATION,
  SUGARLANG_PREPLACEMENT_LINE_ANNOTATION,
  SUGARLANG_PRESCRIPTION_ANNOTATION
} from "../../runtime/middlewares/shared";
import {
  createEmptyPrescription,
  createServicesStub,
  createTestExecution,
  createTestLearnerProfile
} from "./test-helpers";

describe("SugarLangDirectorMiddleware", () => {
  it("assembles a synthetic constraint for the pre-placement opening dialog without invoking the director", async () => {
    const invokeDirector = vi.fn();
    const services = createServicesStub({
      resolveForExecution: () => ({
        learnerStore: {
          getCurrentProfile: vi
            .fn()
            .mockResolvedValue(createTestLearnerProfile())
        },
        director: {
          invoke: invokeDirector
        }
      })
    });
    const middleware = createSugarLangDirectorMiddleware({
      services: services as never
    });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_PRESCRIPTION_ANNOTATION] = createEmptyPrescription();
    execution.annotations[SUGARLANG_PREPLACEMENT_LINE_ANNOTATION] = {
      text: "Let's start in English.",
      lang: "en",
      lineId: "opening:line-1"
    };

    await middleware.prepare?.(execution);

    expect(invokeDirector).not.toHaveBeenCalled();
    expect(execution.annotations[SUGARLANG_DIRECTIVE_ANNOTATION]).toMatchObject({
      citedSignals: ["pre-placement-opening-dialog"],
      isFallbackDirective: false
    });
    expect(execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION]).toMatchObject({
      targetLanguage: "es",
      prePlacementOpeningLine: {
        text: "Let's start in English.",
        lang: "en",
        lineId: "opening:line-1"
      }
    });
  });
});
