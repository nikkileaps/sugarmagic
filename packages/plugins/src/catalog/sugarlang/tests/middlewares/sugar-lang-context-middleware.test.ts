/**
 * packages/plugins/src/catalog/sugarlang/tests/middlewares/sugar-lang-context-middleware.test.ts
 *
 * Purpose: Verifies the Sugarlang context middleware's placement and annotation flow.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Depends on ../../runtime/middlewares/sugar-lang-context-middleware.
 *   - Uses shared middleware test fixtures from ./test-helpers.
 *
 * Implements: Epic 10 Story 10.1
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import { createSugarLangContextMiddleware } from "../../runtime/middlewares/sugar-lang-context-middleware";
import {
  SUGARLANG_PLACEMENT_FLOW_ANNOTATION,
  SUGARLANG_PREPLACEMENT_LINE_ANNOTATION,
  SUGARLANG_PRESCRIPTION_ANNOTATION
} from "../../runtime/middlewares/shared";
import {
  createServicesStub,
  createTestExecution,
  createTestLearnerProfile
} from "./test-helpers";

describe("SugarLangContextMiddleware", () => {
  it("writes the pre-placement opening dialog annotations without running the budgeter", async () => {
    const learner = createTestLearnerProfile({
      assessment: {
        status: "unassessed",
        evaluatedCefrBand: null,
        cefrConfidence: 0.2,
        evaluatedAtMs: null
      }
    });
    const sceneEnsure = vi.fn();
    const services = createServicesStub({
      resolveForExecution: () => ({
        learnerStore: {
          getCurrentProfile: vi.fn().mockResolvedValue(learner)
        },
        learnerStateReducer: {
          apply: vi.fn()
        },
        sceneLexiconStore: {
          ensure: sceneEnsure
        }
      }),
      findNpcDefinition: () => ({
        definitionId: "npc-1",
        displayName: "Marisol",
        description: "Welcome to the placement check.\nTake a breath first."
      })
    });
    const middleware = createSugarLangContextMiddleware({
      services: services as never
    });
    const execution = createTestExecution({
      selection: {
        conversationKind: "free-form",
        npcDefinitionId: "npc-1",
        npcDisplayName: "Marisol",
        interactionMode: "agent",
        targetLanguage: "es",
        supportLanguage: "en",
        metadata: {
          sugarlangRole: "placement"
        }
      }
    });

    await middleware.prepare?.(execution);

    expect(execution.annotations[SUGARLANG_PLACEMENT_FLOW_ANNOTATION]).toEqual({
      phase: "opening-dialog"
    });
    expect(execution.annotations[SUGARLANG_PRESCRIPTION_ANNOTATION]).toMatchObject({
      introduce: [],
      reinforce: [],
      avoid: []
    });
    expect(execution.annotations[SUGARLANG_PREPLACEMENT_LINE_ANNOTATION]).toEqual({
      text: "Welcome to the placement check.",
      lang: "en",
      lineId: "opening:marisol"
    });
    expect(sceneEnsure).not.toHaveBeenCalled();
  });
});
