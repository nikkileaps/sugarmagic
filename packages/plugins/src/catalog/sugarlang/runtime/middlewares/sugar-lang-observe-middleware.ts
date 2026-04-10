/**
 * packages/plugins/src/catalog/sugarlang/runtime/middlewares/sugar-lang-observe-middleware.ts
 *
 * Purpose: Implements the analysis-stage middleware that extracts Sugarlang observations and routes them to the learner reducer.
 *
 * Exports:
 *   - createSugarLangObserveMiddleware
 *
 * Relationships:
 *   - Depends on the Sugarlang runtime service graph plus the ConversationMiddleware interface.
 *   - Is the single place where raw turn/input context becomes learner observations and probe lifecycle state.
 *
 * Implements: Proposal 001 §End-to-End Turn Flow / §Implicit Signal Collection
 *
 * Status: active
 */

import type { ConversationMiddleware } from "@sugarmagic/runtime-core";
import type { TelemetrySink } from "../telemetry/telemetry";
import { tokenize } from "../classifier/tokenize";
import { lemmatize } from "../classifier/lemmatize";
import type { LemmaRef, SugarlangConstraint } from "../types";
import type { SugarlangRuntimeServices } from "../runtime-services";
import {
  SUGARLANG_COMPLETED_OBJECTIVE_IDS_ANNOTATION,
  SUGARLANG_CONSTRAINT_ANNOTATION,
  SUGARLANG_PLACEMENT_FLOW_ANNOTATION,
  createNoOpSugarlangLogger,
  createObservationEvent,
  getChoiceLemmaRef,
  getHoverLemma,
  getSceneId,
  getStoredComprehensionCheck,
  getTurnsSinceLastProbe,
  normalizeTurn,
  setStoredComprehensionCheck,
  setTurnsSinceLastProbe,
  type SugarlangLoggerLike
} from "./shared";

const NO_OP_TELEMETRY: TelemetrySink = {
  emit() {
    return undefined;
  }
};

export interface SugarLangObserveMiddlewareDeps {
  services: SugarlangRuntimeServices;
  logger?: SugarlangLoggerLike;
  telemetry?: TelemetrySink;
}

function collectLemmasFromText(text: string, lang: string): Array<{ surface: string; lemmaId: string | null }> {
  return tokenize(text, lang)
    .filter((token) => token.kind === "word")
    .map((token) => ({
      surface: token.surface,
      lemmaId: lemmatize(token.surface, lang)
    }));
}

function buildTargetLemmaSet(constraint: SugarlangConstraint): Set<string> {
  return new Set(
    [...constraint.targetVocab.introduce, ...constraint.targetVocab.reinforce].map(
      (lemma) => lemma.lemmaId
    )
  );
}

export function createSugarLangObserveMiddleware(
  deps: SugarLangObserveMiddlewareDeps
): ConversationMiddleware {
  const logger = deps.logger ?? createNoOpSugarlangLogger();
  const telemetry = deps.telemetry ?? NO_OP_TELEMETRY;

  return {
    middlewareId: "sugarlang.observe",
    displayName: "Sugarlang Observe Middleware",
    priority: 90,
    stage: "analysis",
    async finalize(execution, turn) {
      const normalizedTurn = normalizeTurn(turn);
      const constraint = execution.annotations[
        SUGARLANG_CONSTRAINT_ANNOTATION
      ] as SugarlangConstraint | undefined;
      if (!normalizedTurn || !constraint) {
        return turn;
      }

      const services = deps.services.resolveForExecution(execution);
      if (!services) {
        return normalizedTurn;
      }

      const placementFlow = execution.annotations[
        SUGARLANG_PLACEMENT_FLOW_ANNOTATION
      ] as { phase?: string } | undefined;
      if (placementFlow?.phase === "opening-dialog") {
        await telemetry.emit("observer.pre-placement-bypass", {
          conversationId:
            execution.selection.npcDefinitionId ??
            execution.selection.dialogueDefinitionId ??
            "conversation"
        });
        return normalizedTurn;
      }

      const learner = await services.learnerStore.getCurrentProfile();
      const storedCheck = getStoredComprehensionCheck(execution);
      if (storedCheck && execution.input?.kind === "free_text") {
        const responseLemmas = new Set(
          collectLemmasFromText(execution.input.text, learner.targetLanguage)
            .map((entry) => entry.lemmaId)
            .filter((lemmaId): lemmaId is string => typeof lemmaId === "string")
        );
        const passed = storedCheck.targetLemmas.filter((lemma) =>
          responseLemmas.has(lemma.lemmaId)
        );
        const failed = storedCheck.targetLemmas.filter(
          (lemma) => !responseLemmas.has(lemma.lemmaId)
        );
        if (passed.length > 0) {
          await services.learnerStateReducer.apply({
            type: "commit-provisional-evidence",
            targetLemmas: passed,
            committedAtMs: Date.now(),
            probeTelemetry: {
              triggerReason: storedCheck.triggerReason
            }
          });
        }
        if (failed.length > 0) {
          await services.learnerStateReducer.apply({
            type: "discard-provisional-evidence",
            targetLemmas: failed,
            discardedAtMs: Date.now(),
            probeTelemetry: {
              triggerReason: storedCheck.triggerReason
            }
          });
        }
        await telemetry.emit(
          passed.length === storedCheck.targetLemmas.length
            ? "comprehension.probe-passed"
            : failed.length === storedCheck.targetLemmas.length
              ? "comprehension.probe-failed"
              : "comprehension.probe-mixed-result",
          {
            passed: passed.map((lemma) => lemma.lemmaId),
            failed: failed.map((lemma) => lemma.lemmaId)
          }
        );
        setStoredComprehensionCheck(execution, null);
      }

      const targetLemmaSet = buildTargetLemmaSet(constraint);
      const observedAtMs = Date.now();
      const sceneId = getSceneId(execution);
      if (!sceneId) {
        return normalizedTurn;
      }

      if (execution.input?.kind === "free_text") {
        const lemmaCandidates = collectLemmasFromText(
          execution.input.text,
          learner.targetLanguage
        );
        for (const candidate of lemmaCandidates) {
          if (candidate.lemmaId) {
            const lemmaRef: LemmaRef = {
              lemmaId: candidate.lemmaId,
              lang: learner.targetLanguage
            };
            await services.learnerStateReducer.apply({
              type: "observation",
              observationEvent: createObservationEvent({
                execution,
                lemma: lemmaRef,
                observation: targetLemmaSet.has(candidate.lemmaId)
                  ? {
                      kind: "produced-typed",
                      inputText: candidate.surface,
                      observedAtMs
                    }
                  : {
                      kind: "produced-unprompted",
                      observedAtMs
                    }
              })
            });
          } else if (constraint.targetVocab.introduce[0] || constraint.targetVocab.reinforce[0]) {
            const expectedLemma =
              constraint.targetVocab.introduce[0] ?? constraint.targetVocab.reinforce[0];
            await services.learnerStateReducer.apply({
              type: "observation",
              observationEvent: createObservationEvent({
                execution,
                lemma: expectedLemma,
                observation: {
                  kind: "produced-incorrect",
                  attemptedForm: candidate.surface,
                  expectedForm: expectedLemma.lemmaId,
                  observedAtMs
                }
              })
            });
          }
        }
      }

      const choiceLemma = getChoiceLemmaRef(execution.input, normalizedTurn.choices, execution);
      if (choiceLemma) {
        await services.learnerStateReducer.apply({
          type: "observation",
          observationEvent: createObservationEvent({
            execution,
            lemma: choiceLemma,
            observation: {
              kind: "produced-chosen",
              choiceSetId: execution.input?.kind === "choice" ? execution.input.choiceId : "choice",
              observedAtMs
            }
          })
        });
      }

      const hoverLemma = getHoverLemma(execution);
      if (hoverLemma) {
        await services.learnerStateReducer.apply({
          type: "observation",
          observationEvent: createObservationEvent({
            execution,
            lemma: hoverLemma.lemma,
            observation: {
              kind: "hovered",
              dwellMs: hoverLemma.dwellMs,
              observedAtMs
            }
          })
        });
      }

      const turnLemmas = collectLemmasFromText(normalizedTurn.text, learner.targetLanguage);
      for (const introduce of constraint.targetVocab.introduce) {
        if (turnLemmas.some((entry) => entry.lemmaId === introduce.lemmaId)) {
          await services.learnerStateReducer.apply({
            type: "observation",
            observationEvent: createObservationEvent({
              execution,
              lemma: introduce,
              observation: {
                kind: "encountered",
                observedAtMs
              }
            })
          });
        }
      }

      const completedObjectiveNodeIds = execution.annotations[
        SUGARLANG_COMPLETED_OBJECTIVE_IDS_ANNOTATION
      ] as string[] | undefined;
      if (Array.isArray(completedObjectiveNodeIds)) {
        for (const active of execution.runtimeContext?.activeQuestObjectives?.objectives ?? []) {
          if (!completedObjectiveNodeIds.includes(active.nodeId)) {
            continue;
          }
          for (const entry of collectLemmasFromText(active.description, learner.targetLanguage)) {
            if (!entry.lemmaId) {
              continue;
            }
            await services.learnerStateReducer.apply({
              type: "observation",
              observationEvent: createObservationEvent({
                execution,
                lemma: {
                  lemmaId: entry.lemmaId,
                  lang: learner.targetLanguage
                },
                observation: {
                  kind: "quest-success",
                  objectiveNodeId: active.nodeId,
                  observedAtMs
                }
              })
            });
          }
        }
      }

      if (constraint.comprehensionCheckInFlight) {
        setStoredComprehensionCheck(execution, {
          targetLemmas: constraint.comprehensionCheckInFlight.targetLemmas,
          probeStyle: constraint.comprehensionCheckInFlight.probeStyle,
          characterVoiceReminder:
            constraint.comprehensionCheckInFlight.characterVoiceReminder,
          triggerReason: constraint.comprehensionCheckInFlight.triggerReason
        });
        setTurnsSinceLastProbe(execution, 0);
      } else {
        setTurnsSinceLastProbe(execution, getTurnsSinceLastProbe(execution) + 1);
      }

      return normalizedTurn;
    }
  };
}
