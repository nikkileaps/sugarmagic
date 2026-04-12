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

import { PLAYER_VO_SPEAKER } from "@sugarmagic/domain";
import { describe, expect, it, vi } from "vitest";
import { createSugarLangObserveMiddleware } from "../../runtime/middlewares/sugar-lang-observe-middleware";
import {
  SUGARLANG_CONSTRAINT_ANNOTATION,
  SUGARLANG_LAST_TURN_COMPREHENSION_CHECK_STATE,
  SUGARLANG_PLACEMENT_FLOW_ANNOTATION
} from "../../runtime/middlewares/shared";
import {
  createBaseConstraint,
  createServicesStub,
  createTestExecution,
  createTestLearnerProfile,
  createTestTurn
} from "./test-helpers";

describe("SugarLangObserveMiddleware", () => {
  it("bypasses observation for player voice-over turns", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const middleware = createSugarLangObserveMiddleware({
      services: createServicesStub({
        getPlayerDefinitionId: () => "player-1",
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
      }) as never
    });
    const execution = createTestExecution({
      input: {
        kind: "free_text",
        text: "carta"
      }
    });
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint();
    const turn = {
      ...createTestTurn("I can't believe I'm here."),
      speakerId: PLAYER_VO_SPEAKER.speakerId,
      speakerLabel: PLAYER_VO_SPEAKER.displayName
    };

    const result = await middleware.finalize?.(execution, turn);

    expect(result).toEqual(turn);
    expect(apply).not.toHaveBeenCalled();
  });

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

  it("applies placement completion and emits quest proposals on questionnaire submission", async () => {
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
        kind: "placement_questionnaire",
        response: {
          questionnaireId: "es-placement-v1",
          submittedAtMs: 1234,
          answers: {}
        }
      }
    });
    execution.annotations[SUGARLANG_PLACEMENT_FLOW_ANNOTATION] = {
      phase: "closing-dialog",
      questionnaireVersion: "es-placement-v1",
      scoreResult: {
        cefrBand: "A2",
        confidence: 0.72,
        perBandScores: {
          A1: { correct: 2, total: 2 },
          A2: { correct: 2, total: 2 },
          B1: { correct: 0, total: 0 },
          B2: { correct: 0, total: 0 },
          C1: { correct: 0, total: 0 },
          C2: { correct: 0, total: 0 }
        },
        lemmasSeededFromFreeText: [{ lemmaId: "viajar", lang: "es" }],
        skippedCount: 1,
        totalCount: 6,
        scoredAtMs: 1234,
        questionnaireVersion: "es-placement-v1"
      }
    };

    const finalized = await middleware.finalize?.(
      execution,
      createTestTurn("Perfecto. Ya tengo tu formulario.")
    );

    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "placement-completion",
        cefrBand: "A2",
        lemmasSeededFromFreeText: [{ lemmaId: "viajar", lang: "es" }]
      })
    );
    expect(finalized?.proposedActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "set-conversation-flag",
          key: "sugarlang.placement.status",
          value: "completed"
        }),
        expect.objectContaining({
          kind: "notify-quest-event",
          eventName: "sugarlang.placement.completed"
        })
      ])
    );
  });
});
