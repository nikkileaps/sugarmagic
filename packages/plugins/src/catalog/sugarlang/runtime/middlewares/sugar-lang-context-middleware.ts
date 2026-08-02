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
import { SugarlangMissingTargetLanguageError } from "../../config";
import { drainPendingHover } from "../dialogue-entry-decorator";
import {
  SUGARLANG_PLACEMENT_STATUS_FACT,
  SUGARLANG_PLACEMENT_WRITER,
  createSugarlangPlacementStatusScope,
  getSugarlangPlacementStatus
} from "../learner";
import type { TelemetrySink } from "../telemetry/telemetry";
import type { SugarlangRuntimeServices } from "../runtime-services";
import { getPlacementQuestionnaireVersion } from "../placement/placement-flow-orchestrator";
import { createSugarlangLogger } from "../logger";
import {
  SUGARLANG_ACTIVE_QUEST_ESSENTIAL_ANNOTATION,
  SUGARLANG_FORCE_COMPREHENSION_CHECK_ANNOTATION,
  SUGARLANG_HOVER_LEMMA_ANNOTATION,
  SUGARLANG_LEARNER_SNAPSHOT_ANNOTATION,
  SUGARLANG_PENDING_PROVISIONAL_ANNOTATION,
  SUGARLANG_PROBE_FLOOR_ANNOTATION,
  SUGARLANG_QUEST_ESSENTIAL_IDS_ANNOTATION,
  SUGARLANG_SCHEDULE_ANNOTATION,
  buildLearnerSnapshot,
  computePendingProvisionalLemmas,
  computeProbeFloorState,
  getSugarlangConversationId,
  getSceneId,
  getTurnsSinceLastProbe,
  shouldRunSugarlangForExecution,
  type SugarlangLoggerLike
} from "./shared";
import { loadCompetencyInventory } from "../inventory/competency-inventory-loader";
import type { SchedulerBoardView } from "../scheduler/scheduler-board-view";
import type { TeachSchedule } from "../scheduler/teach-schedule";
import { realizeCompetencyChunksFromSchedule } from "../scheduler/competency-chunk-realizer";
import type { Competency } from "../contracts/competency-inventory";
import { getWorldDay } from "@sugarmagic/runtime-core";

export interface SugarLangContextMiddlewareDeps {
  services: SugarlangRuntimeServices;
  logger?: SugarlangLoggerLike;
  telemetry?: TelemetrySink;
}

function resolvePlacementMinAnswersForValid(
  questionnaireMinAnswersForValid: number,
  configuredMinAnswersForValid: number | "use-bank-default"
): number {
  return typeof configuredMinAnswersForValid === "number"
    ? configuredMinAnswersForValid
    : questionnaireMinAnswersForValid;
}

export function createSugarLangContextMiddleware(
  deps: SugarLangContextMiddlewareDeps
): ConversationMiddleware {
  const logger = deps.logger ?? createSugarlangLogger({ debugLogging: false });

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
      // THE RUNTIME DOES NOT RUN WITHOUT A LANGUAGE (nikki, 2026-07-31).
      //
      // This used to `return execution` here, so a shipped game with sugarlang
      // enabled and no target language ran every conversation with sugarlang
      // silently inert -- nothing graded, nothing taught, nothing said. That is
      // indistinguishable from "the teaching is bad" and is the worst possible
      // presentation of a one-field configuration mistake.
      //
      // We are past every layer that is allowed to be relaxed about this: Studio
      // tolerates a null language because a freshly installed plugin has none,
      // and preview refuses to launch. Reaching HERE with no language means a
      // BUILT GAME shipped misconfigured, so it fails loudly.
      //
      // `shouldRunSugarlangForExecution` above is the enabled-check: if the
      // plugin is not participating in this conversation we already returned.
      if (!targetLanguage) {
        throw new SugarlangMissingTargetLanguageError();
      }
      // Ensure the selection carries targetLanguage for downstream readers.
      execution.selection.targetLanguage = targetLanguage;

      const services = await deps.services.resolveForExecution(execution);
      if (!services) {
        return execution;
      }

      const learner = await services.learnerStore.getCurrentProfile();
      const config = deps.services.getConfig();
      const blackboard = deps.services.getBlackboard();
      const placementStatus = blackboard
        ? getSugarlangPlacementStatus(blackboard, learner.learnerId)
        : null;
      // PLACEMENT IS NOT A CONVERSATION. It used to be handled here: an
      // annotation, a phase, an in-progress write, and a scoring branch on
      // quest_form input -- all so a form could be delivered as a dialogue
      // turn. An assessment quest node now opens the form directly through the
      // "quest.assessment" contribution, and sugarlang scores it there.
      // See sugarmagic-placement-sequencing-38i.

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

      // 087.1: outer-loop schedule. Computed from the scene lexicon + learner state
      // that are already in hand. Fail-safe: any error means no annotation, which
      // preserves today's rendering behavior exactly.
      // availableCompetencies is declared here so it's accessible for the post-prescribe
      // function-chunk realization step (087.3).
      let availableCompetencies: Competency[] = [];
      try {
        const teachRecords = await services.teachRecordStore.list();
        const activeDebts = await services.ledgerStore.getActiveDebts();
        try {
          availableCompetencies = loadCompetencyInventory(targetLanguage).competencies;
        } catch {
          // No inventory for this language.
        }
        const board: SchedulerBoardView = {
          learner: {
            cefrBand: learner.estimatedCefrBand,
            cefrConfidence: learner.assessment.cefrConfidence,
            lemmaCards: learner.lemmaCards,
          },
          curriculum: {
            introducedCompetencyIds: new Set(teachRecords.map((r) => r.competencyId)),
            availableCompetencies,
            activeDebts
          },
          scene: {
            sceneId,
            dayIndex: blackboard ? getWorldDay(blackboard) : null,
            sceneLemmaIds: (sceneLexicon?.lemmaIds ?? []).filter(
              (id) => !id.startsWith("chunk:")
            )
          },
          conversationId: getSugarlangConversationId(execution),
          npcDefinitionId: execution.selection.npcDefinitionId ?? null,
          targetLanguage
        };
        execution.annotations[SUGARLANG_SCHEDULE_ANNOTATION] =
          services.outerLoopScheduler.compute(board);
      } catch {
        // Scheduler failure is non-fatal.
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
      // 090.10: THE PRESCRIBER IS GONE, AND WITH IT THE COMPETENCY SIDE DOOR.
      //
      // What used to be here: `budgeter.prescribe()` produced a ranked, capped
      // shortlist of lemmas; it was annotated for the teacher middleware, and
      // scheduled competencies were expanded into `chunk:` pseudo-lemmas and
      // INJECTED into `prescription.introduce` so they could ride the lemma
      // channel. That shortlist was not an input to the Teacher's decision, it
      // WAS the decision -- the Teacher could only pick 1-2 items from what a
      // lexical scan had already chosen.
      //
      // It is the motivating bug end to end: `queso` never entered
      // `sceneLexicon.lemmas` (the sole candidate source) for an agent NPC whose
      // lines do not exist at compile time, so it never entered the prescription,
      // and the Teacher was then forbidden from naming it. The Teacher did not
      // fail to think of cheese; it was structurally prohibited from saying it.
      //
      // What replaces it: the SITUATION supplies candidates (concepts resolved
      // against the atlas, 090.2), LEARNING STATUS supplies eligibility (090.9),
      // and the Teacher ranks (090.4). Competencies need no side door because
      // the slate carries teachables directly and the prompt now lists the
      // inventory the Teacher may choose from (090.10a).
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

      // 090.10: `budgeter.prescription-generated` deleted with the budgeter that
      // emitted it. `rationale-trace` reads that event optionally and falls back
      // through `??` chains, so the debug panel degrades rather than breaking;
      // retargeting the trace onto the slate + realization is 090.7's job.

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
