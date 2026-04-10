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
import { getSugarlangPlacementStatus } from "../learner/fact-definitions";
import type { TelemetrySink } from "../telemetry/telemetry";
import type { SugarlangRuntimeServices } from "../runtime-services";
import {
  SUGARLANG_ACTIVE_QUEST_ESSENTIAL_ANNOTATION,
  SUGARLANG_FORCE_COMPREHENSION_CHECK_ANNOTATION,
  SUGARLANG_LEARNER_SNAPSHOT_ANNOTATION,
  SUGARLANG_PENDING_PROVISIONAL_ANNOTATION,
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
  getPlacementPhase,
  getSceneId,
  getTurnsSinceLastProbe,
  maybeAdvancePlacementPhase,
  setPlacementPhase,
  type SugarlangLoggerLike
} from "./shared";

const NO_OP_TELEMETRY: TelemetrySink = {
  emit() {
    return undefined;
  }
};

export interface SugarLangContextMiddlewareDeps {
  services: SugarlangRuntimeServices;
  logger?: SugarlangLoggerLike;
  telemetry?: TelemetrySink;
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
  const telemetry = deps.telemetry ?? NO_OP_TELEMETRY;

  return {
    middlewareId: "sugarlang.context",
    displayName: "Sugarlang Context Middleware",
    priority: 10,
    stage: "context",
    async prepare(execution) {
      if (!execution.selection.targetLanguage) {
        return execution;
      }

      const services = deps.services.resolveForExecution(execution);
      if (!services) {
        return execution;
      }

      const learner = await services.learnerStore.getCurrentProfile();
      const placementStatus = deps.services.getBlackboard()
        ? getSugarlangPlacementStatus(
            deps.services.getBlackboard()!,
            learner.learnerId
          )
        : null;
      let placementPhase = maybeAdvancePlacementPhase(
        execution,
        placementStatus?.status === "completed"
          ? "not-active"
          : getPlacementPhase(execution, learner)
      );
      setPlacementPhase(execution, placementPhase);
      if (placementPhase !== "not-active") {
        execution.annotations[SUGARLANG_PLACEMENT_FLOW_ANNOTATION] = {
          phase: placementPhase
        };
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
        await telemetry.emit("pre-placement.opening-dialog-turn", {
          npcDefinitionId: execution.selection.npcDefinitionId ?? null,
          phase: placementPhase,
          lineId: (
            execution.annotations[SUGARLANG_PREPLACEMENT_LINE_ANNOTATION] as {
              lineId: string;
            }
          ).lineId
        });
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
            services.atlas.getLemma(
              lemma.lemmaId,
              execution.selection.supportLanguage ?? refreshedLearner.supportLanguage
            )?.gloss ??
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

      return execution;
    }
  };
}
