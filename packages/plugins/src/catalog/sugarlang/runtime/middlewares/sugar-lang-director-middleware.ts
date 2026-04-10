/**
 * packages/plugins/src/catalog/sugarlang/runtime/middlewares/sugar-lang-director-middleware.ts
 *
 * Purpose: Implements the policy-stage middleware that invokes the Director and writes the final Sugarlang constraint.
 *
 * Exports:
 *   - createSugarLangDirectorMiddleware
 *
 * Relationships:
 *   - Depends on the Sugarlang runtime service graph and ConversationMiddleware interface.
 *   - Reads context-stage annotations and emits the directive/constraint pair consumed downstream.
 *
 * Implements: Proposal 001 §End-to-End Turn Flow
 *
 * Status: active
 */

import type { ConversationMiddleware } from "@sugarmagic/runtime-core";
import type { TelemetrySink } from "../telemetry/telemetry";
import type { SugarlangRuntimeServices } from "../runtime-services";
import type {
  ActiveQuestEssentialLemma,
  DirectorRecentTurn,
  PedagogicalDirective,
  ProbeFloorState,
  SugarlangConstraint
} from "../types";
import {
  SUGARLANG_ACTIVE_QUEST_ESSENTIAL_ANNOTATION,
  SUGARLANG_COMPREHENSION_IN_FLIGHT_ANNOTATION,
  SUGARLANG_CONSTRAINT_ANNOTATION,
  SUGARLANG_DIRECTIVE_ANNOTATION,
  SUGARLANG_FORCE_COMPREHENSION_CHECK_ANNOTATION,
  SUGARLANG_PENDING_PROVISIONAL_ANNOTATION,
  SUGARLANG_PREPLACEMENT_LINE_ANNOTATION,
  SUGARLANG_PRESCRIPTION_ANNOTATION,
  SUGARLANG_PROBE_FLOOR_ANNOTATION,
  extractCharacterVoiceReminder,
  buildEmptyPrescription,
  createNoOpSugarlangLogger,
  type SugarlangLoggerLike
} from "./shared";

const NO_OP_TELEMETRY: TelemetrySink = {
  emit() {
    return undefined;
  }
};

export interface SugarLangDirectorMiddlewareDeps {
  services: SugarlangRuntimeServices;
  logger?: SugarlangLoggerLike;
  telemetry?: TelemetrySink;
}

function createPrePlacementDirective(): PedagogicalDirective {
  return {
    targetVocab: {
      introduce: [],
      reinforce: [],
      avoid: []
    },
    supportPosture: "anchored",
    targetLanguageRatio: 0,
    interactionStyle: "listening_first",
    glossingStrategy: "none",
    sentenceComplexityCap: "single-clause",
    comprehensionCheck: {
      trigger: false,
      probeStyle: "none",
      targetLemmas: []
    },
    directiveLifetime: {
      maxTurns: 1,
      invalidateOn: []
    },
    citedSignals: ["pre-placement-opening-dialog"],
    rationale: "Pre-placement opening dialog - pipeline bypassed.",
    confidenceBand: "high",
    isFallbackDirective: false
  };
}

function buildRecentTurns(state: Record<string, unknown>): DirectorRecentTurn[] {
  const sessionState = state["sugaragent.session"];
  if (
    typeof sessionState !== "object" ||
    sessionState === null ||
    !Array.isArray(
      (sessionState as { history?: Array<{ role?: unknown; text?: unknown }> }).history
    )
  ) {
    return [];
  }

  return (
    sessionState as { history: Array<{ role?: unknown; text?: unknown }> }
  ).history
    .slice(-4)
    .flatMap((entry, index) => {
      if (typeof entry.text !== "string" || entry.text.trim().length === 0) {
        return [];
      }

      return [
        {
          turnId: `history:${index}`,
          speaker: entry.role === "assistant" ? "npc" : "player",
          text: entry.text.trim()
        }
      ];
    });
}

export function createSugarLangDirectorMiddleware(
  deps: SugarLangDirectorMiddlewareDeps
): ConversationMiddleware {
  const logger = deps.logger ?? createNoOpSugarlangLogger();
  const telemetry = deps.telemetry ?? NO_OP_TELEMETRY;

  return {
    middlewareId: "sugarlang.director",
    displayName: "Sugarlang Director Middleware",
    priority: 30,
    stage: "policy",
    async prepare(execution) {
      const prescription = execution.annotations[
        SUGARLANG_PRESCRIPTION_ANNOTATION
      ] as SugarlangConstraint["rawPrescription"] | undefined;
      if (!prescription) {
        return execution;
      }
      const placementFlow = execution.annotations["sugarlang.placementFlow"] as
        | { phase?: string }
        | undefined;
      if (placementFlow?.phase === "questionnaire") {
        return execution;
      }

      const services = deps.services.resolveForExecution(execution);
      if (!services) {
        return execution;
      }

      const learner = await services.learnerStore.getCurrentProfile();
      const prePlacementOpeningLine = execution.annotations[
        SUGARLANG_PREPLACEMENT_LINE_ANNOTATION
      ] as SugarlangConstraint["prePlacementOpeningLine"] | undefined;
      const sceneId = execution.runtimeContext?.here?.sceneId;
      const scene =
        prePlacementOpeningLine || sceneId == null
          ? null
          : await services.sceneLexiconStore.ensure(sceneId);
      let directive: PedagogicalDirective;

      if (prePlacementOpeningLine) {
        directive = createPrePlacementDirective();
        await telemetry.emit("director.pre-placement-bypass", {
          conversationId:
            execution.selection.npcDefinitionId ??
            execution.selection.dialogueDefinitionId ??
            "conversation",
          lineId: prePlacementOpeningLine.lineId
        });
      } else {
        if (!scene) {
          logger.warn("Skipping Sugarlang director middleware - no scene id.");
          return execution;
        }
        directive = await services.director.invoke({
          conversationId:
            execution.selection.npcDefinitionId ??
            execution.selection.dialogueDefinitionId ??
            "conversation",
          learner,
          scene,
          prescription,
          npc: {
            npcDefinitionId: execution.selection.npcDefinitionId ?? null,
            displayName: execution.selection.npcDisplayName ?? null,
            lorePageId: execution.selection.lorePageId ?? null,
            metadata: execution.selection.metadata
          },
          recentTurns: buildRecentTurns(execution.state),
          lang: {
            targetLanguage: execution.selection.targetLanguage ?? learner.targetLanguage,
            supportLanguage: execution.selection.supportLanguage ?? learner.supportLanguage
          },
          calibrationActive: false,
          pendingProvisionalLemmas:
            (execution.annotations[SUGARLANG_PENDING_PROVISIONAL_ANNOTATION] as
              | Array<{
                  lemmaRef: { lemmaId: string; lang: string };
                  evidenceAmount: number;
                  turnsPending: number;
                }>
              | undefined) ?? [],
          probeFloorState:
            (execution.annotations[SUGARLANG_PROBE_FLOOR_ANNOTATION] as
              | ProbeFloorState
              | undefined) ?? {
              turnsSinceLastProbe: 0,
              totalPendingLemmas: 0,
              softFloorReached: false,
              hardFloorReached: false
            },
          activeQuestEssentialLemmas:
            (execution.annotations[SUGARLANG_ACTIVE_QUEST_ESSENTIAL_ANNOTATION] as
              | ActiveQuestEssentialLemma[]
              | undefined) ?? [],
          selectionMetadata: execution.selection.metadata
        });
      }

      const constraint: SugarlangConstraint = {
        targetVocab: directive.targetVocab,
        supportPosture: directive.supportPosture,
        targetLanguageRatio: directive.targetLanguageRatio,
        interactionStyle: directive.interactionStyle,
        glossingStrategy: directive.glossingStrategy,
        sentenceComplexityCap: directive.sentenceComplexityCap,
        targetLanguage: execution.selection.targetLanguage ?? learner.targetLanguage,
        learnerCefr: learner.estimatedCefrBand,
        rawPrescription: prescription,
        ...(directive.comprehensionCheck.trigger
          ? {
              comprehensionCheckInFlight: {
                active: true,
                probeStyle: directive.comprehensionCheck.probeStyle as
                  | "recall"
                  | "recognition"
                  | "production",
                targetLemmas: directive.comprehensionCheck.targetLemmas,
                characterVoiceReminder:
                  directive.comprehensionCheck.characterVoiceReminder ??
                  extractCharacterVoiceReminder({
                    conversationId:
                      execution.selection.npcDefinitionId ??
                      execution.selection.dialogueDefinitionId ??
                      "conversation",
                    learner,
                    scene:
                      scene ??
                      {
                        sceneId: "unknown-scene",
                        contentHash: "unknown",
                        pipelineVersion: "unknown",
                        atlasVersion: "unknown",
                        profile: "runtime-preview",
                        lemmas: {},
                        properNouns: [],
                        anchors: [],
                        questEssentialLemmas: []
                      },
                    prescription,
                    npc: {
                      npcDefinitionId: execution.selection.npcDefinitionId ?? null,
                      displayName: execution.selection.npcDisplayName ?? null,
                      lorePageId: execution.selection.lorePageId ?? null,
                      metadata: execution.selection.metadata
                    },
                    recentTurns: buildRecentTurns(execution.state),
                    lang: {
                      targetLanguage:
                        execution.selection.targetLanguage ?? learner.targetLanguage,
                      supportLanguage:
                        execution.selection.supportLanguage ?? learner.supportLanguage
                    },
                    calibrationActive: false,
                    pendingProvisionalLemmas: [],
                    probeFloorState: {
                      turnsSinceLastProbe: 0,
                      totalPendingLemmas: 0,
                      softFloorReached: false,
                      hardFloorReached: false
                    },
                    activeQuestEssentialLemmas: [],
                    selectionMetadata: execution.selection.metadata
                  }),
                triggerReason:
                  directive.comprehensionCheck.triggerReason ??
                  "director-discretion"
              }
            }
          : {}),
        ...((execution.annotations[
          SUGARLANG_ACTIVE_QUEST_ESSENTIAL_ANNOTATION
        ] as SugarlangConstraint["questEssentialLemmas"])?.length
          ? {
              questEssentialLemmas: (
                execution.annotations[
                  SUGARLANG_ACTIVE_QUEST_ESSENTIAL_ANNOTATION
                ] as Array<{
                  lemmaRef: SugarlangConstraint["targetVocab"]["introduce"][number];
                  sourceObjectiveDisplayName: string;
                  supportLanguageGloss: string;
                }>
              ).map((entry) => ({
                lemmaRef: entry.lemmaRef,
                sourceObjectiveDisplayName: entry.sourceObjectiveDisplayName,
                supportLanguageGloss: entry.supportLanguageGloss
              }))
            }
          : {}),
        ...(prePlacementOpeningLine ? { prePlacementOpeningLine } : {})
      };

      execution.annotations[SUGARLANG_DIRECTIVE_ANNOTATION] = directive;
      execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = constraint;
      if (constraint.comprehensionCheckInFlight) {
        execution.annotations[SUGARLANG_COMPREHENSION_IN_FLIGHT_ANNOTATION] = true;
        await telemetry.emit("comprehension.probe-triggered", {
          conversationId:
            execution.selection.npcDefinitionId ??
            execution.selection.dialogueDefinitionId ??
            "conversation",
          targetLemmas: constraint.comprehensionCheckInFlight.targetLemmas.map(
            (lemma) => lemma.lemmaId
          ),
          triggerReason: constraint.comprehensionCheckInFlight.triggerReason
        });
      }

      if (
        execution.annotations[SUGARLANG_FORCE_COMPREHENSION_CHECK_ANNOTATION] === true &&
        directive.comprehensionCheck.trigger &&
        directive.comprehensionCheck.triggerReason === "director-deferred-override"
      ) {
        await telemetry.emit("comprehension.director-hard-floor-violated", {
          conversationId:
            execution.selection.npcDefinitionId ??
            execution.selection.dialogueDefinitionId ??
            "conversation"
        });
      }

      return execution;
    }
  };
}
