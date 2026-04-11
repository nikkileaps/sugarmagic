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
import {
  createNoOpTelemetrySink,
  createTelemetryEvent,
  emitTelemetry,
  type TelemetrySink
} from "../telemetry/telemetry";
import { tokenize } from "../classifier/tokenize";
import { lemmatize } from "../classifier/lemmatize";
import type { LemmaRef, SugarlangConstraint } from "../types";
import type { SugarlangRuntimeServices } from "../runtime-services";
import { buildPlacementCompletionEvent } from "../placement/placement-flow-orchestrator";
import { emitPlacementCompleted } from "../quest-integration/placement-completion";
import {
  SUGARLANG_COMPLETED_OBJECTIVE_IDS_ANNOTATION,
  SUGARLANG_COMPREHENSION_PROBE_ID_ANNOTATION,
  SUGARLANG_CONSTRAINT_ANNOTATION,
  SUGARLANG_PLACEMENT_FLOW_ANNOTATION,
  createNoOpSugarlangLogger,
  createObservationEvent,
  getChoiceLemmaRef,
  getHoverLemma,
  getSceneId,
  getStoredComprehensionCheck,
  getSugarlangConversationId,
  getSugarlangTelemetryTurnId,
  getSugarAgentSessionId,
  getSugarAgentTurnCount,
  getTurnsSinceLastProbe,
  isPlayerSpokenTurn,
  normalizeTurn,
  setStoredComprehensionCheck,
  setTurnsSinceLastProbe,
  shouldRunSugarlangForExecution,
  type PlacementFlowAnnotation,
  type SugarlangLoggerLike
} from "./shared";

export interface SugarLangObserveMiddlewareDeps {
  services: SugarlangRuntimeServices;
  logger?: SugarlangLoggerLike;
  telemetry?: TelemetrySink;
}

function collectLemmasFromText(
  text: string,
  lang: string
): Array<{ surface: string; lemmaId: string | null }> {
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

function extractProbeQuestion(text: string): string | null {
  const sentences = text
    .split(/(?<=[?.!])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const question = [...sentences].reverse().find((sentence) => sentence.endsWith("?"));
  return question ?? null;
}

function isLikelySupportLanguageFallback(
  responseText: string,
  targetLemmaCount: number
): boolean {
  return targetLemmaCount === 0 && /[A-Za-z]/.test(responseText);
}

export function createSugarLangObserveMiddleware(
  deps: SugarLangObserveMiddlewareDeps
): ConversationMiddleware {
  const logger = deps.logger ?? createNoOpSugarlangLogger();
  const telemetry = deps.telemetry ?? createNoOpTelemetrySink();

  return {
    middlewareId: "sugarlang.observe",
    displayName: "Sugarlang Observe Middleware",
    priority: 90,
    stage: "analysis",
    async finalize(execution, turn) {
      const normalizedTurn = normalizeTurn(turn);
      if (!shouldRunSugarlangForExecution(execution)) {
        return normalizedTurn ?? turn;
      }

      if (
        normalizedTurn &&
        isPlayerSpokenTurn(normalizedTurn, deps.services.getPlayerDefinitionId())
      ) {
        return normalizedTurn;
      }

      const services = deps.services.resolveForExecution(execution);
      if (!services) {
        return turn;
      }

      const conversationId = getSugarlangConversationId(execution);
      const sessionId = getSugarAgentSessionId(execution);
      const traceTurnId = getSugarlangTelemetryTurnId(execution, "finalize");
      const sceneId = getSceneId(execution);
      const now = Date.now();

      const placementFlow = execution.annotations[
        SUGARLANG_PLACEMENT_FLOW_ANNOTATION
      ] as PlacementFlowAnnotation | undefined;
      if (placementFlow?.phase === "opening-dialog") {
        await emitTelemetry(
          telemetry,
          createTelemetryEvent("observer.pre-placement-bypass", {
            conversationId,
            sessionId,
            turnId: traceTurnId,
            timestamp: now,
            sceneId
          }),
          logger
        );
        return normalizedTurn;
      }

      if (placementFlow?.phase === "questionnaire") {
        await emitTelemetry(
          telemetry,
          createTelemetryEvent("observer.placement-questionnaire-bypass", {
            conversationId,
            sessionId,
            turnId: traceTurnId,
            timestamp: now,
            sceneId
          }),
          logger
        );
        return normalizedTurn;
      }

      if (execution.input?.kind === "placement_questionnaire") {
        if (
          normalizedTurn &&
          placementFlow?.phase === "closing-dialog" &&
          placementFlow.scoreResult
        ) {
          const learner = await services.learnerStore.getCurrentProfile();
          await services.learnerStateReducer.apply(
            buildPlacementCompletionEvent(placementFlow.scoreResult, learner)
          );
          normalizedTurn.proposedActions = [
            ...(normalizedTurn.proposedActions ?? []),
            ...emitPlacementCompleted(placementFlow.scoreResult)
          ];

          const confidenceFloor = deps.services.getConfig().placement.confidenceFloor;
          await emitTelemetry(
            telemetry,
            createTelemetryEvent("placement.completed", {
              conversationId,
              sessionId,
              turnId: traceTurnId,
              timestamp: Date.now(),
              finalBand: placementFlow.scoreResult.cefrBand,
              confidence: placementFlow.scoreResult.confidence,
              turnCount: getSugarAgentTurnCount(execution),
              questionnaireVersion: placementFlow.scoreResult.questionnaireVersion,
              result: placementFlow.scoreResult
            }),
            logger
          );
          if (placementFlow.scoreResult.confidence < confidenceFloor) {
            logger.warn("Placement completed below configured confidence floor.", {
              confidence: placementFlow.scoreResult.confidence,
              confidenceFloor
            });
          }
        }

        return normalizedTurn;
      }

      const constraint = execution.annotations[
        SUGARLANG_CONSTRAINT_ANNOTATION
      ] as SugarlangConstraint | undefined;
      if (!normalizedTurn || !constraint) {
        return turn;
      }

      const learner = await services.learnerStore.getCurrentProfile();
      const storedCheck = getStoredComprehensionCheck(execution);
      if (storedCheck && execution.input?.kind === "free_text") {
        const responseLemmas = new Set(
          collectLemmasFromText(execution.input.text, learner.targetLanguage)
            .map((entry) => entry.lemmaId)
            .filter((lemmaId): lemmaId is string => typeof lemmaId === "string")
        );
        const responseTimestamp = Date.now();
        await emitTelemetry(
          telemetry,
          createTelemetryEvent("comprehension.probe-response-received", {
            conversationId,
            sessionId,
            turnId: traceTurnId,
            timestamp: responseTimestamp,
            probeId: storedCheck.probeId,
            sceneId: storedCheck.sceneId ?? sceneId ?? "unknown-scene",
            npcId: storedCheck.npcId,
            npcDisplayName: storedCheck.npcDisplayName,
            targetLemmas: storedCheck.targetLemmas,
            playerResponseText: execution.input.text,
            responseLatencyMs: Math.max(0, responseTimestamp - storedCheck.promptedAtMs),
            responseInputKind: "free_text"
          }),
          logger
        );

        const passed = storedCheck.targetLemmas.filter((lemma) =>
          responseLemmas.has(lemma.lemmaId)
        );
        const failed = storedCheck.targetLemmas.filter(
          (lemma) => !responseLemmas.has(lemma.lemmaId)
        );
        const classifierReasoning =
          passed.length > 0
            ? `Response lemmatized to ${[...responseLemmas].join(", ")} and matched target lemmas.`
            : "No target lemmas were found in the lemmatized response.";

        if (isLikelySupportLanguageFallback(execution.input.text, responseLemmas.size)) {
          await emitTelemetry(
            telemetry,
            createTelemetryEvent("comprehension.probe-language-fallback", {
              conversationId,
              sessionId,
              turnId: traceTurnId,
              timestamp: responseTimestamp,
              probeId: storedCheck.probeId,
              sceneId: storedCheck.sceneId ?? sceneId ?? "unknown-scene",
              npcId: storedCheck.npcId,
              npcDisplayName: storedCheck.npcDisplayName,
              targetLemmas: storedCheck.targetLemmas,
              playerResponseText: execution.input.text,
              detectedLang: learner.supportLanguage
            }),
            logger
          );
        }

        if (passed.length > 0) {
          await services.learnerStateReducer.apply({
            type: "commit-provisional-evidence",
            targetLemmas: passed,
            committedAtMs: responseTimestamp,
            probeTelemetry: {
              probeId: storedCheck.probeId,
              triggerReason: storedCheck.triggerReason
            }
          });
        }
        if (failed.length > 0) {
          await services.learnerStateReducer.apply({
            type: "discard-provisional-evidence",
            targetLemmas: failed,
            discardedAtMs: responseTimestamp,
            probeTelemetry: {
              probeId: storedCheck.probeId,
              triggerReason: storedCheck.triggerReason
            }
          });
        }

        if (passed.length === storedCheck.targetLemmas.length) {
          await emitTelemetry(
            telemetry,
            createTelemetryEvent("comprehension.probe-passed", {
              conversationId,
              sessionId,
              turnId: traceTurnId,
              timestamp: responseTimestamp,
              probeId: storedCheck.probeId,
              sceneId: storedCheck.sceneId ?? sceneId ?? "unknown-scene",
              npcId: storedCheck.npcId,
              npcDisplayName: storedCheck.npcDisplayName,
              targetLemmas: storedCheck.targetLemmas,
              playerResponseText: execution.input.text,
              lemmasPassed: passed.map((lemma) => lemma.lemmaId),
              classifierReasoning
            }),
            logger
          );
        } else if (failed.length === storedCheck.targetLemmas.length) {
          await emitTelemetry(
            telemetry,
            createTelemetryEvent("comprehension.probe-failed", {
              conversationId,
              sessionId,
              turnId: traceTurnId,
              timestamp: responseTimestamp,
              probeId: storedCheck.probeId,
              sceneId: storedCheck.sceneId ?? sceneId ?? "unknown-scene",
              npcId: storedCheck.npcId,
              npcDisplayName: storedCheck.npcDisplayName,
              targetLemmas: storedCheck.targetLemmas,
              playerResponseText: execution.input.text,
              lemmasFailed: failed.map((lemma) => lemma.lemmaId),
              classifierReasoning
            }),
            logger
          );
        } else {
          await emitTelemetry(
            telemetry,
            createTelemetryEvent("comprehension.probe-mixed-result", {
              conversationId,
              sessionId,
              turnId: traceTurnId,
              timestamp: responseTimestamp,
              probeId: storedCheck.probeId,
              sceneId: storedCheck.sceneId ?? sceneId ?? "unknown-scene",
              npcId: storedCheck.npcId,
              npcDisplayName: storedCheck.npcDisplayName,
              targetLemmas: storedCheck.targetLemmas,
              playerResponseText: execution.input.text,
              lemmasPassed: passed.map((lemma) => lemma.lemmaId),
              lemmasFailed: failed.map((lemma) => lemma.lemmaId),
              classifierReasoning
            }),
            logger
          );
        }

        setStoredComprehensionCheck(execution, null);
      }

      const targetLemmaSet = buildTargetLemmaSet(constraint);
      const observedAtMs = Date.now();
      if (!sceneId) {
        return normalizedTurn;
      }
      const appliedObservations = [] as ReturnType<typeof createObservationEvent>[];

      if (execution.input?.kind === "free_text") {
        const lemmaCandidates = collectLemmasFromText(
          execution.input.text,
          learner.targetLanguage
        );
        // Deduplicate: only one observation per lemma per turn.
        const observedLemmaIds = new Set<string>();

        for (const candidate of lemmaCandidates) {
          if (!candidate.lemmaId || observedLemmaIds.has(candidate.lemmaId)) {
            continue;
          }

          // Only observe target lemmas (introduce/reinforce) or lemmas the
          // learner already has a card for. This avoids creating phantom
          // observations from English words that coincidentally match the
          // target-language morphology index.
          const isTargetLemma = targetLemmaSet.has(candidate.lemmaId);
          const hasExistingCard = candidate.lemmaId in learner.lemmaCards;

          if (!isTargetLemma && !hasExistingCard) {
            continue;
          }

          observedLemmaIds.add(candidate.lemmaId);
          const lemmaRef: LemmaRef = {
            lemmaId: candidate.lemmaId,
            lang: learner.targetLanguage
          };
          const observationEvent = createObservationEvent({
            execution,
            lemma: lemmaRef,
            observation: isTargetLemma
              ? {
                  kind: "produced-typed",
                  inputText: candidate.surface,
                  observedAtMs
                }
              : {
                  kind: "produced-unprompted",
                  observedAtMs
                }
          });
          appliedObservations.push(observationEvent);
          await services.learnerStateReducer.apply({
            type: "observation",
            observationEvent
          });
        }
      }

      const choiceLemma = getChoiceLemmaRef(
        execution.input,
        normalizedTurn.choices,
        execution
      );
      if (choiceLemma) {
        const observationEvent = createObservationEvent({
          execution,
          lemma: choiceLemma,
          observation: {
            kind: "produced-chosen",
            choiceSetId:
              execution.input?.kind === "choice" ? execution.input.choiceId : "choice",
            observedAtMs
          }
        });
        appliedObservations.push(observationEvent);
        await services.learnerStateReducer.apply({
          type: "observation",
          observationEvent
        });
      }

      const hoverLemma = getHoverLemma(execution);
      if (hoverLemma) {
        // Distinguish introduce hover (positive first exposure) from reinforce
        // hover (needed help remembering). See observations.ts for the
        // pedagogical rationale behind the different FSRS grades.
        const isIntroduceHover = constraint.targetVocab.introduce.some(
          (l) => l.lemmaId === hoverLemma.lemma.lemmaId
        );
        const observationEvent = createObservationEvent({
          execution,
          lemma: hoverLemma.lemma,
          observation: {
            kind: isIntroduceHover ? "hovered-introduce" : "hovered",
            dwellMs: hoverLemma.dwellMs,
            observedAtMs
          }
        });
        appliedObservations.push(observationEvent);
        await services.learnerStateReducer.apply({
          type: "observation",
          observationEvent
        });
      }

      const turnLemmas = collectLemmasFromText(normalizedTurn.text, learner.targetLanguage);
      for (const introduce of constraint.targetVocab.introduce) {
        if (!turnLemmas.some((entry) => entry.lemmaId === introduce.lemmaId)) {
          continue;
        }
        const observationEvent = createObservationEvent({
          execution,
          lemma: introduce,
          observation: {
            kind: "encountered",
            observedAtMs
          }
        });
        appliedObservations.push(observationEvent);
        await services.learnerStateReducer.apply({
          type: "observation",
          observationEvent
        });
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
            const observationEvent = createObservationEvent({
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
            });
            appliedObservations.push(observationEvent);
            await services.learnerStateReducer.apply({
              type: "observation",
              observationEvent
            });
          }
        }
      }

      if (appliedObservations.length > 0) {
        const updatedProfile = await services.learnerStore.getCurrentProfile();
        const observationSummary = appliedObservations.map((obs) => ({
          lemma: obs.lemma.lemmaId,
          kind: obs.observation.kind,
          card: updatedProfile.lemmaCards[obs.lemma.lemmaId]
            ? {
                stability: updatedProfile.lemmaCards[obs.lemma.lemmaId].stability.toFixed(2),
                difficulty: updatedProfile.lemmaCards[obs.lemma.lemmaId].difficulty.toFixed(2),
                reviewCount: updatedProfile.lemmaCards[obs.lemma.lemmaId].reviewCount,
                productiveStrength: updatedProfile.lemmaCards[obs.lemma.lemmaId].productiveStrength.toFixed(2)
              }
            : null
        }));

        logger.debug("Observer applied observations this turn.", {
          turn: traceTurnId,
          observations: observationSummary,
          learnerBand: updatedProfile.estimatedCefrBand,
          totalCards: Object.keys(updatedProfile.lemmaCards).length
        });

        await emitTelemetry(
          telemetry,
          createTelemetryEvent("observe.observations-applied", {
            conversationId,
            sessionId,
            turnId: traceTurnId,
            timestamp: Date.now(),
            sceneId,
            observations: appliedObservations,
            learnerDelta: {
              updatedLemmaIds: [
                ...new Set(
                  appliedObservations.map((event) => event.lemma.lemmaId)
                )
              ]
            }
          }),
          logger
        );
      }

      if (constraint.comprehensionCheckInFlight) {
        const probeId =
          (execution.annotations[
            SUGARLANG_COMPREHENSION_PROBE_ID_ANNOTATION
          ] as string | undefined) ?? `${traceTurnId}:probe`;
        const promptedAtMs = Date.now();
        await emitTelemetry(
          telemetry,
          createTelemetryEvent("comprehension.probe-fired", {
            conversationId,
            sessionId,
            turnId: traceTurnId,
            timestamp: promptedAtMs,
            probeId,
            sceneId,
            npcId: execution.selection.npcDefinitionId ?? null,
            npcDisplayName: execution.selection.npcDisplayName ?? null,
            targetLemmas: constraint.comprehensionCheckInFlight.targetLemmas,
            generatedText: normalizedTurn.text,
            probeQuestionExtract: extractProbeQuestion(normalizedTurn.text)
          }),
          logger
        );
        setStoredComprehensionCheck(execution, {
          probeId,
          targetLemmas: constraint.comprehensionCheckInFlight.targetLemmas,
          probeStyle: constraint.comprehensionCheckInFlight.probeStyle,
          characterVoiceReminder:
            constraint.comprehensionCheckInFlight.characterVoiceReminder,
          sceneId,
          npcId: execution.selection.npcDefinitionId ?? null,
          npcDisplayName: execution.selection.npcDisplayName ?? null,
          promptedAtMs,
          triggerReason: constraint.comprehensionCheckInFlight.triggerReason
        });
        setTurnsSinceLastProbe(execution, 0);
      } else {
        setTurnsSinceLastProbe(execution, getTurnsSinceLastProbe(execution) + 1);
      }

      // Write focus-term highlighting annotation onto the NPC turn so the
      // dialogue renderer can highlight target vocabulary and fire the star
      // celebration animation when the player produces a target lemma.
      const supportLang = execution.selection.supportLanguage ?? "en";
      const introduceTerms: string[] = [];
      const reinforceTerms: string[] = [];
      const glosses: Record<string, string> = {};

      for (const lemma of constraint.targetVocab.introduce) {
        const surface = lemma.lemmaId.replace(/_/g, " ");
        introduceTerms.push(surface);
        const gloss = services.atlas.getGloss(lemma.lemmaId, learner.targetLanguage, supportLang);
        if (gloss) glosses[surface] = gloss;
      }
      for (const lemma of constraint.targetVocab.reinforce) {
        const surface = lemma.lemmaId.replace(/_/g, " ");
        reinforceTerms.push(surface);
        const gloss = services.atlas.getGloss(lemma.lemmaId, learner.targetLanguage, supportLang);
        if (gloss) glosses[surface] = gloss;
      }

      const focusTerms = [...introduceTerms, ...reinforceTerms];
      if (focusTerms.length > 0) {
        normalizedTurn.annotations!["dialogueHighlight"] = {
          focusTerms,
          introduceTerms,
          celebrateTerms: [],
          glosses
        };
      }

      return normalizedTurn;
    }
  };
}
