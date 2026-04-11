/**
 * packages/plugins/src/catalog/sugarlang/runtime/middlewares/sugar-lang-context-middleware.ts
 *
 * Purpose: Implements the context-stage middleware that loads learner and scene state, computes placement flow, and writes turn annotations.
 *
 * Exports:
 *   - createSugarLangContextMiddleware
 *
 * Relationships:
 *   - Depends on the Sugarlang runtime service graph plus the ConversationMiddleware interface.
 *   - Writes the per-turn annotations that the Director and later analysis middlewares consume.
 *
 * Implements: Proposal 001 §End-to-End Turn Flow / §Placement Interaction Contract
 *
 * Status: active
 */

import type { ConversationMiddleware } from "@sugarmagic/runtime-core";
import { drainPendingHover } from "../dialogue-entry-decorator";
import {
  SUGARLANG_PLACEMENT_STATUS_FACT,
  SUGARLANG_PLACEMENT_WRITER,
  createSugarlangPlacementStatusScope,
  getSugarlangPlacementStatus
} from "../learner/fact-definitions";
import {
  createNoOpTelemetrySink,
  createTelemetryEvent,
  emitTelemetry,
  type TelemetrySink
} from "../telemetry/telemetry";
import type { SugarlangRuntimeServices } from "../runtime-services";
import {
  advancePlacementPhase,
  getPlacementQuestionnaireVersion,
  type PlacementPhaseStateValue
} from "../placement/placement-flow-orchestrator";
import {
  SUGARLANG_ACTIVE_QUEST_ESSENTIAL_ANNOTATION,
  SUGARLANG_FORCE_COMPREHENSION_CHECK_ANNOTATION,
  SUGARLANG_HOVER_LEMMA_ANNOTATION,
  SUGARLANG_LEARNER_SNAPSHOT_ANNOTATION,
  SUGARLANG_PENDING_PROVISIONAL_ANNOTATION,
  SUGARLANG_PLACEMENT_PHASE_STATE,
  SUGARLANG_PLACEMENT_FLOW_ANNOTATION,
  SUGARLANG_PREPLACEMENT_LINE_ANNOTATION,
  SUGARLANG_PRESCRIPTION_ANNOTATION,
  SUGARLANG_PROBE_FLOOR_ANNOTATION,
  SUGARLANG_QUEST_ESSENTIAL_IDS_ANNOTATION,
  buildEmptyPrescription,
  buildLearnerSnapshot,
  computePendingProvisionalLemmas,
  computeProbeFloorState,
  createNoOpSugarlangLogger,
  getSugarlangConversationId,
  getSugarlangTelemetryTurnId,
  getSugarAgentSessionId,
  getSceneId,
  getTurnsSinceLastProbe,
  shouldRunSugarlangForExecution,
  type PlacementFlowAnnotation,
  type SugarlangLoggerLike
} from "./shared";

export interface SugarLangContextMiddlewareDeps {
  services: SugarlangRuntimeServices;
  logger?: SugarlangLoggerLike;
  telemetry?: TelemetrySink;
}

function readPlacementState(
  execution: { state: Record<string, unknown> }
): PlacementPhaseStateValue | null {
  const value = execution.state[SUGARLANG_PLACEMENT_PHASE_STATE];
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (
      (record.phase === "opening-dialog" ||
        record.phase === "questionnaire" ||
        record.phase === "closing-dialog") &&
      typeof record.enteredAtTurn === "number"
    ) {
      return {
        phase: record.phase,
        enteredAtTurn: record.enteredAtTurn
      };
    }
  }
  if (
    value === "opening-dialog" ||
    value === "questionnaire" ||
    value === "closing-dialog"
  ) {
    return {
      phase: value,
      enteredAtTurn: 0
    };
  }
  return null;
}

function writePlacementState(
  execution: { state: Record<string, unknown> },
  phase: "opening-dialog" | "questionnaire" | "closing-dialog" | "not-active",
  enteredAtTurn: number
): void {
  if (phase === "not-active") {
    delete execution.state[SUGARLANG_PLACEMENT_PHASE_STATE];
    return;
  }

  execution.state[SUGARLANG_PLACEMENT_PHASE_STATE] = {
    phase,
    enteredAtTurn
  } satisfies PlacementPhaseStateValue;
}

function resolvePlacementMinAnswersForValid(
  questionnaireMinAnswersForValid: number,
  configuredMinAnswersForValid: number | "use-bank-default"
): number {
  return typeof configuredMinAnswersForValid === "number"
    ? configuredMinAnswersForValid
    : questionnaireMinAnswersForValid;
}

function pickPrePlacementOpeningLine(executionText: {
  npcDisplayName?: string;
  description?: string | null;
  supportLanguage: string;
}): { text: string; lang: string; lineId: string } {
  const raw =
    executionText.description
      ?.split(/\n+/)
      .map((line) => line.trim())
      .find(Boolean) ??
    `${executionText.npcDisplayName ?? "Hello"}. Let's figure out the right starting point.`;

  return {
    text: raw,
    lang: executionText.supportLanguage,
    lineId: `opening:${(executionText.npcDisplayName ?? "npc").toLowerCase()}`
  };
}

export function createSugarLangContextMiddleware(
  deps: SugarLangContextMiddlewareDeps
): ConversationMiddleware {
  const logger = deps.logger ?? createNoOpSugarlangLogger();
  const telemetry = deps.telemetry ?? createNoOpTelemetrySink();

  return {
    middlewareId: "sugarlang.context",
    displayName: "Sugarlang Context Middleware",
    priority: 10,
    stage: "context",
    async prepare(execution) {
      if (!shouldRunSugarlangForExecution(execution)) {
        return execution;
      }

      // The target language can come from the conversation selection (if the
      // conversation host sets it) or from the plugin's configured target
      // language. The plugin config is the primary source in practice because
      // the gameplay session doesn't set targetLanguage on the selection.
      const targetLanguage =
        execution.selection.targetLanguage ||
        deps.services.getTargetLanguage();
      if (!targetLanguage) {
        return execution;
      }
      // Ensure the selection carries targetLanguage for downstream readers.
      execution.selection.targetLanguage = targetLanguage;

      const services = deps.services.resolveForExecution(execution);
      if (!services) {
        return execution;
      }

      const learner = await services.learnerStore.getCurrentProfile();
      const config = deps.services.getConfig();
      const blackboard = deps.services.getBlackboard();
      const placementStatus = blackboard
        ? getSugarlangPlacementStatus(blackboard, learner.learnerId)
        : null;
      const turnCount = execution.state["sugaragent.session"] &&
        typeof execution.state["sugaragent.session"] === "object" &&
        execution.state["sugaragent.session"] !== null &&
        typeof (execution.state["sugaragent.session"] as { turnCount?: unknown }).turnCount ===
          "number"
        ? (execution.state["sugaragent.session"] as { turnCount: number }).turnCount
        : 0;
      const placementState = readPlacementState(execution);
      const isPlacementNpc =
        config.placement.enabled &&
        execution.selection.metadata?.sugarlangRole === "placement";
      let placementPhase: PlacementFlowAnnotation["phase"] =
        !isPlacementNpc || placementStatus?.status === "completed"
          ? placementState?.phase === "closing-dialog" &&
            turnCount - placementState.enteredAtTurn < config.placement.closingDialogTurns
            ? "closing-dialog"
            : "not-active"
          : placementState?.phase ?? "opening-dialog";
      let placementFlowAnnotation: PlacementFlowAnnotation | null = null;

      if (
        placementPhase === "questionnaire" &&
        execution.input?.kind === "placement_questionnaire"
      ) {
        const questionnaire = services.placementQuestionnaireLoader.getQuestionnaire(
          execution.selection.targetLanguage ?? learner.targetLanguage
        );
        const scoreResult = services.placementScoreEngine.scoreResponses(
          execution.input.response,
          questionnaire
        );
        placementPhase = "closing-dialog";
        writePlacementState(execution, "closing-dialog", turnCount);
        placementFlowAnnotation = {
          phase: "closing-dialog",
          questionnaireVersion: getPlacementQuestionnaireVersion(questionnaire),
          scoreResult
        };
      } else if (placementPhase !== "not-active") {
        const advancedPhase = advancePlacementPhase({
          currentPhase: placementPhase,
          currentTurnCount: placementState ? turnCount - placementState.enteredAtTurn : turnCount,
          openingDialogTurns: config.placement.openingDialogTurns,
          closingDialogTurns: config.placement.closingDialogTurns,
          questionnaireSubmitted: false
        });
        if (advancedPhase !== placementPhase) {
          writePlacementState(execution, advancedPhase, turnCount);
          placementPhase = advancedPhase;
        } else {
          writePlacementState(execution, placementPhase, placementState?.enteredAtTurn ?? turnCount);
        }
      } else {
        writePlacementState(execution, "not-active", turnCount);
      }

      if (placementPhase !== "not-active") {
        const questionnaire =
          placementPhase === "questionnaire"
            ? services.placementQuestionnaireLoader.getQuestionnaire(
                execution.selection.targetLanguage ?? learner.targetLanguage
              )
            : null;
        if (placementFlowAnnotation) {
          execution.annotations[SUGARLANG_PLACEMENT_FLOW_ANNOTATION] =
            placementFlowAnnotation;
        } else {
          execution.annotations[SUGARLANG_PLACEMENT_FLOW_ANNOTATION] = {
            phase: placementPhase,
            ...(questionnaire
              ? {
                  questionnaireVersion:
                    getPlacementQuestionnaireVersion(questionnaire),
                  minAnswersForValid: resolvePlacementMinAnswersForValid(
                    questionnaire.minAnswersForValid,
                    config.placement.minAnswersForValid
                  )
                }
              : {})
          } satisfies PlacementFlowAnnotation;
        }
      }

      if (
        isPlacementNpc &&
        blackboard &&
        placementStatus?.status !== "completed" &&
        (placementPhase === "opening-dialog" || placementPhase === "questionnaire")
      ) {
        blackboard.setFact({
          definition: SUGARLANG_PLACEMENT_STATUS_FACT,
          scope: createSugarlangPlacementStatusScope(learner.learnerId),
          value: {
            status: "in-progress",
            ...(placementStatus?.cefrBand ? { cefrBand: placementStatus.cefrBand } : {}),
            ...(placementStatus?.confidence ? { confidence: placementStatus.confidence } : {})
          },
          sourceSystem: SUGARLANG_PLACEMENT_WRITER
        });
      }

      if (placementPhase === "questionnaire") {
        execution.annotations[SUGARLANG_PRESCRIPTION_ANNOTATION] = buildEmptyPrescription(
          "Placement questionnaire phase - no prescription needed."
        );
        return execution;
      }

      if (placementPhase === "opening-dialog") {
        const npc = deps.services.findNpcDefinition(
          execution.selection.npcDefinitionId
        );
        execution.annotations[SUGARLANG_PRESCRIPTION_ANNOTATION] =
          buildEmptyPrescription(
            "Pre-placement opening dialog - no prescription needed."
          );
        execution.annotations[SUGARLANG_PREPLACEMENT_LINE_ANNOTATION] =
          pickPrePlacementOpeningLine({
            npcDisplayName: execution.selection.npcDisplayName,
            description: npc?.description ?? null,
            supportLanguage: execution.selection.supportLanguage ?? "en"
          });
        await emitTelemetry(
          telemetry,
          createTelemetryEvent("pre-placement.opening-dialog-turn", {
            conversationId: getSugarlangConversationId(execution),
            sessionId: getSugarAgentSessionId(execution),
            turnId: getSugarlangTelemetryTurnId(execution, "prepare"),
            timestamp: Date.now(),
            npcDefinitionId: execution.selection.npcDefinitionId ?? null,
            phase: placementPhase,
            lineId: (
              execution.annotations[SUGARLANG_PREPLACEMENT_LINE_ANNOTATION] as {
                lineId: string;
              }
            ).lineId
          }),
          logger
        );
        return execution;
      }

      const sceneId = getSceneId(execution);
      if (!sceneId) {
        logger.warn("Skipping Sugarlang context middleware - no active scene id.");
        return execution;
      }

      let sceneLexicon;
      try {
        sceneLexicon = await services.sceneLexiconStore.ensure(sceneId);
      } catch (error) {
        logger.warn("Skipping Sugarlang turn after scene lexicon load failure.", {
          sceneId,
          reason: error instanceof Error ? error.message : String(error)
        });
        return execution;
      }

      await services.learnerStateReducer.apply({
        type: "decay-provisional-evidence",
        currentSessionTurn: learner.currentSession?.turns ?? 0,
        decayedAtMs: Date.now()
      });
      const refreshedLearner = await services.learnerStore.getCurrentProfile();
      const pendingProvisional = computePendingProvisionalLemmas(refreshedLearner);
      const probeFloorState = computeProbeFloorState(
        pendingProvisional,
        getTurnsSinceLastProbe(execution)
      );
      const activeObjectiveIds = new Set(
        execution.runtimeContext?.activeQuestObjectives?.objectives.map(
          (objective) => objective.nodeId
        ) ?? []
      );
      const activeQuestEssentialLemmas = sceneLexicon.questEssentialLemmas
        .filter((lemma) => activeObjectiveIds.has(lemma.sourceObjectiveNodeId))
        .map((lemma) => ({
          lemmaRef: {
            lemmaId: lemma.lemmaId,
            lang: lemma.lang
          },
          sourceObjectiveNodeId: lemma.sourceObjectiveNodeId,
          sourceObjectiveDisplayName: lemma.sourceObjectiveDisplayName,
          sourceQuestId: lemma.sourceQuestId,
          cefrBand: lemma.cefrBand,
          supportLanguageGloss:
            services.atlas.getGloss(
              lemma.lemmaId,
              lemma.lang,
              execution.selection.supportLanguage ?? "en"
            ) ??
            lemma.sourceObjectiveDisplayName
        }));
      const prescription = await services.budgeter.prescribe({
        learner: refreshedLearner,
        sceneLexicon,
        conversationState: {
          currentSessionTurn: refreshedLearner.currentSession?.turns ?? 0,
          turnSeconds: undefined,
          nowMs: Date.now()
        },
        activeQuestEssentialLemmas: activeQuestEssentialLemmas.map((entry) => ({
          lemmaId: entry.lemmaRef.lemmaId,
          lang: entry.lemmaRef.lang,
          cefrBand: entry.cefrBand,
          sourceQuestId: entry.sourceQuestId,
          sourceObjectiveNodeId: entry.sourceObjectiveNodeId,
          sourceObjectiveDisplayName: entry.sourceObjectiveDisplayName
        }))
      });

      execution.annotations[SUGARLANG_PRESCRIPTION_ANNOTATION] = prescription;

      logger.debug("Budgeter prescription details.", {
        introduce: prescription.introduce.map((l) => {
          const info = sceneLexicon.lemmas[l.lemmaId];
          return {
            lemmaId: l.lemmaId,
            freq: info?.frequencyRank ?? null,
            sceneWeight: info?.sceneWeight ?? 0,
            isAnchor: sceneLexicon.anchors.includes(l.lemmaId)
          };
        }),
        anchor: prescription.anchor?.lemmaId ?? null,
        candidateCount: Object.keys(sceneLexicon.lemmas).length
      });
      execution.annotations[SUGARLANG_LEARNER_SNAPSHOT_ANNOTATION] =
        buildLearnerSnapshot(refreshedLearner);
      execution.annotations[SUGARLANG_PENDING_PROVISIONAL_ANNOTATION] =
        pendingProvisional;
      execution.annotations[SUGARLANG_PROBE_FLOOR_ANNOTATION] = probeFloorState;
      execution.annotations[SUGARLANG_ACTIVE_QUEST_ESSENTIAL_ANNOTATION] =
        activeQuestEssentialLemmas;
      execution.annotations[SUGARLANG_QUEST_ESSENTIAL_IDS_ANNOTATION] = new Set(
        activeQuestEssentialLemmas.map((entry) => entry.lemmaRef.lemmaId)
      );
      if (probeFloorState.hardFloorReached) {
        execution.annotations[SUGARLANG_FORCE_COMPREHENSION_CHECK_ANNOTATION] = true;
      }

      await emitTelemetry(
        telemetry,
        createTelemetryEvent("budgeter.prescription-generated", {
          conversationId: getSugarlangConversationId(execution),
          sessionId: getSugarAgentSessionId(execution),
          turnId: getSugarlangTelemetryTurnId(execution, "prepare"),
          timestamp: Date.now(),
          sceneId,
          learnerSnapshot: buildLearnerSnapshot(refreshedLearner),
          prescription,
          rationale: prescription.rationale,
          pendingProvisionalSnapshot: pendingProvisional,
          probeFloorState,
          questEssentialState: {
            activeQuestEssentialLemmas
          }
        }),
        logger
      );

      // Drain any pending hover observation from the UI layer so the
      // observer middleware can process it during finalize.
      const hover = drainPendingHover();
      if (hover) {
        execution.annotations[SUGARLANG_HOVER_LEMMA_ANNOTATION] = {
          lemmaId: hover.lemmaId,
          lang: hover.lang,
          dwellMs: hover.dwellMs
        };
      }

      return execution;
    }
  };
}
