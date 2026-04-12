/**
 * packages/plugins/src/catalog/sugarlang/runtime/middlewares/sugar-lang-teacher-middleware.ts
 *
 * Purpose: Implements the policy-stage middleware that invokes the teacher and writes the final Sugarlang constraint.
 *
 * Exports:
 *   - createSugarLangTeacherMiddleware
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
import {
  buildGeneratorPromptOverlay,
  buildScriptedGeneratorPromptOverlay,
  computeMinimalGreetingMode
} from "./generator-prompt-overlay";
import {
  createNoOpTelemetrySink,
  createTelemetryEvent,
  emitTelemetry,
  type TelemetrySink
} from "../telemetry/telemetry";
import type { SugarlangRuntimeServices } from "../runtime-services";
import type {
  ActiveQuestEssentialLemma,
  TeacherRecentTurn,
  PedagogicalDirective,
  ProbeFloorState,
  SugarlangConstraint
} from "../types";
import {
  SUGARLANG_ACTIVE_QUEST_ESSENTIAL_ANNOTATION,
  SUGARLANG_COMPREHENSION_IN_FLIGHT_ANNOTATION,
  SUGARLANG_COMPREHENSION_PROBE_ID_ANNOTATION,
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
  getSugarlangConversationId,
  getSugarlangTelemetryTurnId,
  getSugarAgentSessionId,
  getSceneId,
  isQuestObjectiveInFocus,
  isScriptedMode,
  shouldRunSugarlangForExecution,
  type SugarlangLoggerLike
} from "./shared";

export interface SugarLangTeacherMiddlewareDeps {
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

function buildRecentTurns(state: Record<string, unknown>): TeacherRecentTurn[] {
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

export function createSugarLangTeacherMiddleware(
  deps: SugarLangTeacherMiddlewareDeps
): ConversationMiddleware {
  const logger = deps.logger ?? createNoOpSugarlangLogger();
  const telemetry = deps.telemetry ?? createNoOpTelemetrySink();

  return {
    middlewareId: "sugarlang.teacher",
    displayName: "Sugarlang Teacher Middleware",
    priority: 30,
    stage: "policy",
    async prepare(execution) {
      if (!shouldRunSugarlangForExecution(execution)) {
        return execution;
      }

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

      // Scripted mode: skip the teacher LLM call. Build a lightweight
      // constraint with posture/ratio based on the learner's level.
      // The authored text IS the curriculum — we only control language mix.
      if (isScriptedMode(execution)) {
        const targetLanguage =
          execution.selection.targetLanguage ?? learner.targetLanguage;
        const posture =
          learner.estimatedCefrBand === "A1" ? "anchored" as const
            : learner.estimatedCefrBand === "A2" ? "supported" as const
            : "target-dominant" as const;
        const ratio =
          posture === "anchored" ? 0.2
            : posture === "supported" ? 0.5
            : 0.8;
        const overlay = buildScriptedGeneratorPromptOverlay(
          learner.estimatedCefrBand,
          posture,
          ratio,
          targetLanguage
        );
        const constraint: SugarlangConstraint = {
          generatorPromptOverlay: overlay,
          minimalGreetingMode: false,
          targetVocab: {
            introduce: prescription.introduce,
            reinforce: prescription.reinforce,
            avoid: prescription.avoid
          },
          supportPosture: posture,
          targetLanguageRatio: ratio,
          interactionStyle: "natural_dialogue",
          glossingStrategy: "none",
          sentenceComplexityCap: "free",
          targetLanguage,
          learnerCefr: learner.estimatedCefrBand,
          rawPrescription: prescription
        };
        execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = constraint;
        logger.debug("Scripted mode: lightweight constraint built.", {
          learnerCefr: learner.estimatedCefrBand,
          posture,
          ratio
        });
        return execution;
      }
      const prePlacementOpeningLine = execution.annotations[
        SUGARLANG_PREPLACEMENT_LINE_ANNOTATION
      ] as SugarlangConstraint["prePlacementOpeningLine"] | undefined;
      const sceneId = execution.runtimeContext?.here?.sceneId;
      const scene =
        prePlacementOpeningLine || sceneId == null
          ? null
          : await services.sceneLexiconStore.ensure(sceneId);
      let directive: PedagogicalDirective;
      const conversationId = getSugarlangConversationId(execution);
      const sessionId = getSugarAgentSessionId(execution);
      const traceTurnId = getSugarlangTelemetryTurnId(execution, "prepare");
      const currentSceneId = getSceneId(execution);
      const annotatedQuestEssentialLemmas =
        (execution.annotations[SUGARLANG_ACTIVE_QUEST_ESSENTIAL_ANNOTATION] as
          | ActiveQuestEssentialLemma[]
          | undefined) ?? [];
      const questObjectiveInFocus = isQuestObjectiveInFocus(
        execution,
        annotatedQuestEssentialLemmas
      );
      const teacherQuestEssentialLemmas = questObjectiveInFocus
        ? annotatedQuestEssentialLemmas
        : [];

      if (prePlacementOpeningLine) {
        directive = createPrePlacementDirective();
        await emitTelemetry(
          telemetry,
          createTelemetryEvent("director.pre-placement-bypass", {
            conversationId,
            sessionId,
            turnId: traceTurnId,
            timestamp: Date.now(),
            sceneId: currentSceneId,
            lineId: prePlacementOpeningLine.lineId
          }),
          logger
        );
      } else {
        if (!scene) {
          logger.warn("Skipping Sugarlang teacher middleware - no scene id.");
          return execution;
        }
        directive = await services.teacher.invoke({
          conversationId,
          telemetryContext: {
            turnId: traceTurnId,
            sessionId
          },
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
          activeQuestEssentialLemmas: teacherQuestEssentialLemmas,
          selectionMetadata: execution.selection.metadata
        });
      }

      const constraint: SugarlangConstraint = {
        generatorPromptOverlay: "",
        minimalGreetingMode: false,
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
        ...(teacherQuestEssentialLemmas.length
          ? {
              questEssentialLemmas: teacherQuestEssentialLemmas.map(
                (entry: {
                  lemmaRef: SugarlangConstraint["targetVocab"]["introduce"][number];
                  sourceObjectiveDisplayName: string;
                  supportLanguageGloss: string;
                }) => ({
                  lemmaRef: entry.lemmaRef,
                  sourceObjectiveDisplayName: entry.sourceObjectiveDisplayName,
                  supportLanguageGloss: entry.supportLanguageGloss
                })
              )
            }
          : {}),
        ...(prePlacementOpeningLine ? { prePlacementOpeningLine } : {})
      };

      constraint.generatorPromptOverlay = buildGeneratorPromptOverlay(constraint);
      constraint.minimalGreetingMode = computeMinimalGreetingMode(
        constraint,
        execution.input?.kind === "free_text"
      );

      execution.annotations[SUGARLANG_DIRECTIVE_ANNOTATION] = directive;
      execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = constraint;
      logger.info("Teacher finalized Sugarlang guidance and constraint.", {
        conversationId,
        sessionId,
        turnId: traceTurnId,
        sceneId: currentSceneId,
        npcDefinitionId: execution.selection.npcDefinitionId ?? null,
        npcDisplayName: execution.selection.npcDisplayName ?? null,
        directive,
        constraintSummary: {
          supportPosture: constraint.supportPosture,
          targetLanguageRatio: constraint.targetLanguageRatio,
          interactionStyle: constraint.interactionStyle,
          glossingStrategy: constraint.glossingStrategy,
          sentenceComplexityCap: constraint.sentenceComplexityCap,
          introduce: constraint.targetVocab.introduce.map((lemma) => lemma.lemmaId),
          reinforce: constraint.targetVocab.reinforce.map((lemma) => lemma.lemmaId),
          avoid: constraint.targetVocab.avoid.map((lemma) => lemma.lemmaId),
          comprehensionCheckActive:
            constraint.comprehensionCheckInFlight?.active ?? false,
          prePlacementOpeningLine: constraint.prePlacementOpeningLine ?? null
        }
      });
      if (constraint.comprehensionCheckInFlight) {
        const probeId = `${traceTurnId}:probe:${constraint.comprehensionCheckInFlight.targetLemmas
          .map((lemma) => lemma.lemmaId)
          .join(",")}`;
        execution.annotations[SUGARLANG_COMPREHENSION_IN_FLIGHT_ANNOTATION] = true;
        execution.annotations[SUGARLANG_COMPREHENSION_PROBE_ID_ANNOTATION] = probeId;
        await emitTelemetry(
          telemetry,
          createTelemetryEvent("comprehension.probe-triggered", {
            conversationId,
            sessionId,
            turnId: traceTurnId,
            timestamp: Date.now(),
            probeId,
            sceneId: currentSceneId ?? "unknown-scene",
            npcId: execution.selection.npcDefinitionId ?? null,
            npcDisplayName: execution.selection.npcDisplayName ?? null,
            targetLemmas: constraint.comprehensionCheckInFlight.targetLemmas,
            probeStyle: constraint.comprehensionCheckInFlight.probeStyle,
            triggerReason: constraint.comprehensionCheckInFlight.triggerReason,
            characterVoiceReminder:
              constraint.comprehensionCheckInFlight.characterVoiceReminder,
            currentPendingProvisionalCount: (
              execution.annotations[SUGARLANG_PENDING_PROVISIONAL_ANNOTATION] as
                | Array<unknown>
                | undefined
            )?.length ?? 0,
            turnsSinceLastProbe:
              (
                execution.annotations[SUGARLANG_PROBE_FLOOR_ANNOTATION] as
                  | ProbeFloorState
                  | undefined
              )?.turnsSinceLastProbe ?? 0
          }),
          logger
        );
      }

      if (
        execution.annotations[SUGARLANG_FORCE_COMPREHENSION_CHECK_ANNOTATION] === true &&
        directive.comprehensionCheck.trigger &&
        directive.comprehensionCheck.triggerReason === "director-deferred-override"
      ) {
        await emitTelemetry(
          telemetry,
          createTelemetryEvent("comprehension.director-hard-floor-violated", {
            conversationId,
            sessionId,
            turnId: traceTurnId,
            timestamp: Date.now(),
            sceneId: currentSceneId ?? undefined,
            hardFloorReason:
              (
                execution.annotations[SUGARLANG_PROBE_FLOOR_ANNOTATION] as
                  | ProbeFloorState
                  | undefined
              )?.hardFloorReason ?? null
          }),
          logger
        );
      }

      return execution;
    }
  };
}
