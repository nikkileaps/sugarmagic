/**
 * packages/plugins/src/catalog/sugarlang/tests/middlewares/sugar-lang-observe-middleware.test.ts
 *
 * Purpose: Verifies probe-response handling and reducer routing in the Sugarlang observe middleware.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Depends on ../../runtime/middlewares/sugar-lang-observe-middleware.
 *   - Uses shared middleware test fixtures from ./test-helpers.
 *
 * Implements: Epic 10 Story 10.5
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import { createSugarLangObserveMiddleware } from "../../runtime/middlewares/sugar-lang-observe-middleware";
import {
  SUGARLANG_CONSTRAINT_ANNOTATION,
  SUGARLANG_LAST_TURN_COMPREHENSION_CHECK_STATE
} from "../../runtime/middlewares/shared";
import {
  createBaseConstraint,
  createServicesStub,
  createTestExecution,
  createTestLearnerProfile,
  createTestTurn
} from "./test-helpers";

describe("SugarLangObserveMiddleware", () => {
  it("commits provisional evidence when the player answers a stored probe with the target lemma", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const services = createServicesStub({
      resolveForExecution: () => ({
        learnerStore: {
          getCurrentProfile: vi
            .fn()
            .mockResolvedValue(createTestLearnerProfile())
        },
        learnerStateReducer: {
          apply
        }
      })
    });
    const middleware = createSugarLangObserveMiddleware({
      services: services as never
    });
    const execution = createTestExecution({
      input: {
        kind: "free_text",
        text: "carta"
      }
    });
    execution.state[SUGARLANG_LAST_TURN_COMPREHENSION_CHECK_STATE] = {
      targetLemmas: [{ lemmaId: "carta", lang: "es" }],
      probeStyle: "recognition",
      characterVoiceReminder: "Stay in character.",
      triggerReason: "soft-floor"
    };
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint();

    await middleware.finalize?.(execution, createTestTurn("Aqui tienes la carta."));

    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "commit-provisional-evidence",
        targetLemmas: [{ lemmaId: "carta", lang: "es" }]
      })
    );
    expect(
      execution.state[SUGARLANG_LAST_TURN_COMPREHENSION_CHECK_STATE]
    ).toBeUndefined();
  });
});
