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
import { createSugarlangLogger } from "../logger";
import { languageDisplayName } from "../language-names";
import { buildInterpretLexiconFromInventory } from "../inventory/competency-inventory-loader";
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
  SUGARLANG_SCHEDULE_ANNOTATION,
  extractCharacterVoiceReminder,
  buildEmptyPrescription,
  getSugarlangConversationId,
  getSugarlangTelemetryTurnId,
  getSugarAgentSessionId,
  getSceneId,
  isQuestObjectiveInFocus,
  isScriptedMode,
  shouldRunSugarlangForExecution,
  type SugarlangLoggerLike
} from "./shared";
import type { TeachSchedule } from "../scheduler/teach-schedule";
import {
  TARGET_LANGUAGE_RATIO_BY_POSTURE,
  getSentenceComplexityCap,
  postureForBand
} from "../teacher/band-envelope";

// Local structural type matching SugaragentContribution (sugaragent owns the
// full interface; we mirror only the fields we write -- no import needed).
interface SugarlangContributionShape {
  schemaVersion: 1;
  generateOverlay: string;
  generateReminder?: string;
  judgeDirectives?: string[];
  regenDirectives?: string[];
  interpretLexicon?: Record<string, string[]>;
  textConventions?: { preserveActionTags?: boolean };
  retrieveBiasTerms?: string[];
}
const SUGARAGENT_CONTRIB_SUGARLANG_KEY = "sugaragent.contrib/sugarlang" as const;

function buildConstraintReminder(
  targetLanguageRatio: number,
  targetLanguage: string,
  learnerCefr: string
): string | null {
  if (targetLanguageRatio <= 0) return null;
  const pct = Math.round(targetLanguageRatio * 100);
  const langName = languageDisplayName(targetLanguage);
  return `Language constraint: ~${pct}% ${langName}, learner at ${learnerCefr} level.`;
}

// NAMING HAZARD: this is NOT a lexicon. "Lexicon" elsewhere here means the atlas
// -- the whole word stock of a language. This is four keyword lists (greeting /
// farewell / gratitude / acknowledgement) of target-language surface forms, sent
// to sugaragent so detectSocialMove can recognize a player typing "adios" when
// its own patterns are English-only. Player INPUT recognition, not teaching.
// Rename to socialMoveCues when the sugaragent contribution contract is next
// touched -- docs/backlog/006-sugarlang-naming-cleanups.md has the blast radius.
function buildInterpretLexicon(targetLanguage: string): Record<string, string[]> | undefined {
  try {
    const lexicon = buildInterpretLexiconFromInventory(targetLanguage);
    const hasAny = Object.values(lexicon).some((forms) => forms.length > 0);
    return hasAny ? lexicon : undefined;
  } catch {
    return undefined;
  }
}

function buildLanguageJudgeDirective(
  targetLanguageRatio: number,
  targetLanguage: string
): string | null {
  if (targetLanguageRatio <= 0) return null;
  const ratioPercent = Math.round(targetLanguageRatio * 100);
  const langName = languageDisplayName(targetLanguage);
  return (
    `This NPC reply is language-directed for a language-learning player: ` +
    `about ${ratioPercent}% ${langName} mixed with the support language is intentional game system behavior. ` +
    `Language choice and language mixing are never IN-CHARACTER violations.`
  );
}

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
  const logger = deps.logger ?? createSugarlangLogger({ debugLogging: false });
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

      const placementFlow = execution.annotations["sugarlang.placementFlow"] as
        | { phase?: string }
        | undefined;
      if (placementFlow?.phase === "questionnaire") {
        return execution;
      }

      const services = await deps.services.resolveForExecution(execution);
      if (!services) {
        return execution;
      }

      const prescription = execution.annotations[
        SUGARLANG_PRESCRIPTION_ANNOTATION
      ] as SugarlangConstraint["rawPrescription"] | undefined;

      const learner = await services.learnerStore.getCurrentProfile();

      // Scripted mode: skip the teacher LLM call. Build a lightweight
      // constraint with posture/ratio based on the learner's level.
      // The authored text IS the curriculum — we only control language mix.
      // Runs even without a prescription (prescription-less scripted dialogue
      // still needs a constraint so the scripted middleware can adapt the text).
      // 086.4: scripted branch no longer sets generatorPromptOverlay or writes a
      // sugaragent contribution -- the scripted middleware reads baked variants
      // (target-dominant) or runs diglotWeave (anchored/supported), zero LLM.
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
        // anchored/supported: "hover-only" because the weave places bare citation
        // forms and the observe middleware delivers gloss data via dialogueHighlight.
        // target-dominant: "none" -- the baked variant text is target-language already.
        const glossingStrategy =
          posture === "anchored" || posture === "supported" ? "hover-only" as const : "none" as const;
        const constraint: SugarlangConstraint = {
          generatorPromptOverlay: "",
          minimalGreetingMode: false,
          targetVocab: {
            introduce: prescription?.introduce ?? [],
            reinforce: prescription?.reinforce ?? [],
            avoid: prescription?.avoid ?? []
          },
          supportPosture: posture,
          targetLanguageRatio: ratio,
          interactionStyle: "natural_dialogue",
          glossingStrategy,
          sentenceComplexityCap: "free",
          targetLanguage,
          learnerCefr: learner.estimatedCefrBand,
          rawPrescription: prescription ?? buildEmptyPrescription("scripted-mode-no-prescription")
        };
        execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = constraint;
        logger.debug("Scripted mode: lightweight constraint built.", {
          learnerCefr: learner.estimatedCefrBand,
          posture,
          ratio,
          hadPrescription: Boolean(prescription)
        });
        return execution;
      }

      if (!prescription) {
        return execution;
      }
      const schedule = execution.annotations[SUGARLANG_SCHEDULE_ANNOTATION] as
        | TeachSchedule
        | undefined;
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
      const pendingProvisional = (
        execution.annotations[SUGARLANG_PENDING_PROVISIONAL_ANNOTATION] as
          | Array<{
              lemmaRef: { lemmaId: string; lang: string };
              evidenceAmount: number;
              turnsPending: number;
            }>
          | undefined
      ) ?? [];
      const probeFloorState = (
        execution.annotations[SUGARLANG_PROBE_FLOOR_ANNOTATION] as
          | ProbeFloorState
          | undefined
      ) ?? {
        turnsSinceLastProbe: 0,
        totalPendingLemmas: 0,
        softFloorReached: false,
        hardFloorReached: false
      };

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
      } else if (schedule && !schedule.isColdStart) {
        // 087.6: schedule-driven realization. The outer loop has already determined
        // what to teach; derive the directive deterministically without an LLM call.
        // Directive lifetime is maxTurns=1 (free to recompute every turn since this
        // path is deterministic and cheap). Fall through to the LLM path below when
        // no schedule is present (cold-start or first-session) -- that path amortizes
        // the LLM call over 3 turns.
        const targetLanguage = execution.selection.targetLanguage ?? learner.targetLanguage;
        // Envelope values come from the shared band-envelope table -- NOT inlined.
        // A divergent copy here silently loosens the level control 083 enforces.
        const posture = postureForBand(learner.estimatedCefrBand);
        const ratio = TARGET_LANGUAGE_RATIO_BY_POSTURE[posture];
        const glossingStrategy =
          posture === "target-dominant" ? "none" as const : "hover-only" as const;
        // A probe needs something to probe ABOUT: hardFloorReached can fire on the
        // turns-since-probe clause alone (25 turns) with zero pending lemmas, which
        // would arm the probe machinery with an empty target list -- and observe
        // would then vacuously score it passed (0 of 0) into the strain model.
        const probeTargets = pendingProvisional.slice(0, 2).map((p) => p.lemmaRef);
        const probeTrigger =
          probeTargets.length > 0 &&
          (probeFloorState.hardFloorReached ||
            (probeFloorState.softFloorReached && pendingProvisional.length >= 5));
        directive = {
          targetVocab: {
            introduce: prescription.introduce,
            reinforce: prescription.reinforce,
            avoid: prescription.avoid
          },
          supportPosture: posture,
          targetLanguageRatio: ratio,
          interactionStyle: "natural_dialogue",
          glossingStrategy,
          sentenceComplexityCap: getSentenceComplexityCap(learner.estimatedCefrBand),
          comprehensionCheck: {
            trigger: probeTrigger,
            probeStyle: probeTrigger ? "recall" : "none",
            targetLemmas: probeTrigger ? probeTargets : [],
            ...(probeTrigger
              ? {
                  triggerReason: probeFloorState.hardFloorReached
                    ? ("hard-floor-turns" as const)
                    : ("soft-floor" as const)
                }
              : {})
          },
          directiveLifetime: { maxTurns: 1, invalidateOn: [] },
          citedSignals: ["schedule-driven"],
          rationale: `Schedule-driven: ${schedule.teachables.length} teachable(s) paced by outer loop.`,
          confidenceBand: "high",
          isFallbackDirective: false
        };
        logger.debug("Schedule-driven directive built without teacher LLM.", {
          conversationId,
          sessionId,
          turnId: traceTurnId,
          sceneId: currentSceneId,
          targetLanguage,
          posture,
          ratio,
          scheduleTeachableCount: schedule.teachables.length,
          introduceCount: prescription.introduce.length,
          probeTrigger
        });
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
          atlas: services.atlas,
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
          pendingProvisionalLemmas: pendingProvisional,
          probeFloorState,
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
                    atlas: services.atlas,
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
      // Plan 073.4 — minimalGreetingMode is a PEDAGOGICAL brevity signal only
      // (short opening for a conservative beginner). First-meeting vs
      // repeat-visit semantics belong to SugarAgent's memory mechanic, not
      // here, so this decision does not read metCount.
      constraint.minimalGreetingMode = computeMinimalGreetingMode(
        constraint,
        execution.input?.kind === "free_text"
      );

      execution.annotations[SUGARLANG_DIRECTIVE_ANNOTATION] = directive;
      execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = constraint;
      const judgeDirective = buildLanguageJudgeDirective(
        constraint.targetLanguageRatio,
        constraint.targetLanguage
      );
      const langLexicon = buildInterpretLexicon(constraint.targetLanguage);
      const npcDefId = execution.selection.npcDefinitionId ?? null;
      const voiceSpec =
        npcDefId && scene?.npcVoiceSpecs
          ? (scene.npcVoiceSpecs[npcDefId] ?? null)
          : null;
      const constraintReminder = buildConstraintReminder(
        constraint.targetLanguageRatio,
        constraint.targetLanguage,
        constraint.learnerCefr
      );
      // 087.6: when the schedule drives the directive, publish the top scheduled
      // lemma ids as retrieveBiasTerms so sugaragent's RetrieveStage can bias the
      // vector-store query toward topics that exercise what the learner needs to
      // practice. Fluency items (well-known lemmas recycled for ease) are excluded;
      // only active teach targets are relevant for retrieval bias.
      const scheduledBiasTerms: string[] =
        schedule && !schedule.isColdStart
          ? schedule.teachables
              .filter((t) => t.kind === "vocabulary" && t.teachReason !== "fluency")
              .slice(0, 3)
              .map((t) => t.id)
          : [];
      const contrib: SugarlangContributionShape = {
        schemaVersion: 1,
        generateOverlay: constraint.generatorPromptOverlay,
        ...(constraintReminder ? { generateReminder: constraintReminder } : {}),
        ...(judgeDirective ? { judgeDirectives: [judgeDirective], regenDirectives: [judgeDirective] } : {}),
        ...(langLexicon ? { interpretLexicon: langLexicon } : {}),
        ...(voiceSpec?.hasGestureTags ? { textConventions: { preserveActionTags: true } } : {}),
        ...(scheduledBiasTerms.length > 0 ? { retrieveBiasTerms: scheduledBiasTerms } : {})
      };
      execution.annotations[SUGARAGENT_CONTRIB_SUGARLANG_KEY] = contrib;
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
