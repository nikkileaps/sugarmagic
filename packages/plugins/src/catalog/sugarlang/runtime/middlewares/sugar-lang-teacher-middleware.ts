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

import { teachableRefKey, toVocabularyRefs } from "../contracts/teachable-ref";
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
  LemmaRef,
  PedagogicalDirective,
  ProbeFloorState,
  SugarlangConstraint
} from "../types";
import { createSugarlangLogger } from "../logger";
import { languageDisplayName } from "../language-names";
import { buildInterpretLexiconFromInventory } from "../inventory/competency-inventory-loader";
import { createCompetencyDescriber } from "../inventory/describe-competency";
import {
  SUGARLANG_ACTIVE_QUEST_ESSENTIAL_ANNOTATION,
  SUGARLANG_COMPREHENSION_IN_FLIGHT_ANNOTATION,
  SUGARLANG_COMPREHENSION_PROBE_ID_ANNOTATION,
  SUGARLANG_CONSTRAINT_ANNOTATION,
  SUGARLANG_DIRECTIVE_ANNOTATION,
  SUGARLANG_FORCE_COMPREHENSION_CHECK_ANNOTATION,
  SUGARLANG_PENDING_PROVISIONAL_ANNOTATION,
  SUGARLANG_PREPLACEMENT_LINE_ANNOTATION,
  SUGARLANG_PROBE_FLOOR_ANNOTATION,
  SUGARLANG_SCHEDULE_ANNOTATION,
  extractCharacterVoiceReminder,
  getSugarlangConversationId,
  getSugarlangTelemetryTurnId,
  getSugarAgentSessionId,
  getSceneId,
  getTurnsSinceLastProbe,
  isQuestObjectiveInFocus,
  isScriptedMode,
  shouldRunSugarlangForExecution,
  type SugarlangLoggerLike
} from "./shared";
import type { TeachSchedule } from "../scheduler/teach-schedule";
import { composeSituation, situationKey } from "../situation";
import type { TeacherNpcContext, TeacherRecentTurn } from "../situation";
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

      const services = await deps.services.resolveForExecution(execution);
      if (!services) {
        return execution;
      }

      const learner = await services.learnerStore.getCurrentProfile();

      // Scripted mode: skip the teacher LLM call. Build a lightweight
      // constraint with posture/ratio based on the learner's level.
      // The authored text IS the curriculum — we only control language mix.
      // 086.4: scripted branch no longer sets generatorPromptOverlay or writes a
      // sugaragent contribution -- the scripted middleware reads baked variants
      // (target-dominant) or serves the beginner baked variant
      // (anchored/supported), zero LLM.
      if (isScriptedMode(execution)) {
        const targetLanguage =
          execution.selection.targetLanguage ?? learner.targetLanguage;
        // 090.8b: was an inlined band ternary plus its own 0.2/0.5/0.8 table --
        // a second answer to "how much target language at this band", living
        // alongside band-envelope's 0.3/0.65/0.85. Both were real and they
        // disagreed. 087.6 recorded the divergence and deferred the fold until
        // "scripted rendering next changes"; this is that change.
        //
        // PLAYER-VISIBLE: A1 scripted lines move from 20% to 30% target
        // language. nikki's call, 2026-07-30.
        const posture = postureForBand(learner.estimatedCefrBand);
        const ratio = TARGET_LANGUAGE_RATIO_BY_POSTURE[posture];
        // anchored/supported: "hover-only" because the marker places bare citation
        // forms and the observe middleware delivers gloss data via dialogueHighlight.
        // target-dominant: "none" -- the baked variant text is target-language already.
        const glossingStrategy =
          posture === "anchored" || posture === "supported" ? "hover-only" as const : "none" as const;
        const constraint: SugarlangConstraint = {
          generatorPromptOverlay: "",
          minimalGreetingMode: false,
          // 090.10: was seeded from the prescription. A scripted line's text is
          // already decided, so the slate only ever narrowed which already-present
          // words the marker substituted -- and the marker now draws the whole band
          // (090.8). Empty is the honest value: scripted mode teaches from the
          // authored text, not from a slate.
          targetVocab: { introduce: [], reinforce: [], avoid: [] },
          supportPosture: posture,
          targetLanguageRatio: ratio,
          interactionStyle: "natural_dialogue",
          glossingStrategy,
          sentenceComplexityCap: "free",
          targetLanguage,
          learnerCefr: learner.estimatedCefrBand
        };
        execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = constraint;
        logger.debug("Scripted mode: lightweight constraint built.", {
          learnerCefr: learner.estimatedCefrBand,
          posture,
          ratio
        });
        return execution;
      }

      // 090.10: THE PRESCRIPTION GATE IS GONE.
      //
      // This read `if (!prescription) return execution;` -- harmless while the
      // budgeter always wrote one, and fatal the moment it stopped: the guard
      // would be true every turn, the middleware would return early every turn,
      // and the Teacher would never run again. Nothing would fail; NPCs would
      // just quietly go back to ungraded output.
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
      const npc: TeacherNpcContext = {
        npcDefinitionId: execution.selection.npcDefinitionId ?? null,
        displayName: execution.selection.npcDisplayName ?? null,
        lorePageId: execution.selection.lorePageId ?? null,
        metadata: execution.selection.metadata
      };
      const recentTurns = buildRecentTurns(execution.state);
      // 090.3d: composed once per turn from the seeded compile half plus the
      // runtime context. Null only when there is no scene at all -- a situation
      // needs somewhere to BE, but needs nothing else.
      const situation =
        sceneId == null
          ? null
          : composeSituation({
              sceneId,
              sceneContext: deps.services.getSceneContext(sceneId),
              runtimeContext: execution.runtimeContext,
              npc,
              recentTurns,
              // 090.4: conversation state, and the one non-learner input to the
              // probe-floor signals the Teacher derives.
              turnsSinceLastProbe: getTurnsSinceLastProbe(execution)
            });

      let directive: PedagogicalDirective;
      const conversationId = getSugarlangConversationId(execution);
      const sessionId = getSugarAgentSessionId(execution);
      const traceTurnId = getSugarlangTelemetryTurnId(execution, "prepare");
      const currentSceneId = getSceneId(execution);
      // 090.4: this annotation-fed set still drives the VERIFIER's
      // parenthetical-gloss check (constraint.questEssentialLemmas below) --
      // that consumer is unchanged. The Teacher itself no longer reads it; it
      // derives its own quest-essential set from the situation (see
      // resolveQuestEssentialLemmaRefs at the invoke call below).
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
      // 090.4: the pending-provisional and probe-floor ANNOTATIONS are no
      // longer read here. Both are signals derived from the learner's own cards
      // plus `turnsSinceLastProbe` (learner/pacing-signals.ts), so the Teacher
      // derives them itself rather than being handed a copy that could disagree
      // with the learner it was also handed. The annotations still exist for
      // the observe/verify middlewares, which is a different consumer.

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
        // 090.4 DELETED THE 087.6 SCHEDULE-DRIVEN BRANCH THAT USED TO SIT HERE.
        //
        // It caught every learner with any card history -- `schedule &&
        // !schedule.isColdStart` -- and built the directive deterministically
        // from `prescription.introduce/reinforce/avoid`, never calling
        // `services.teacher.invoke` at all. So in steady state the Teacher did
        // not run, and the thing named "teacher middleware" was a passthrough
        // for the budgeter's output.
        //
        // It was added when the Teacher cost an LLM call per turn and that was
        // too expensive. The situation key (090.3b) removes the reason: the
        // Teacher now runs once per SITUATION rather than once per turn, so the
        // cost it was avoiding is already gone.
        //
        // This is the deletion the epic's closing invariant requires -- two
        // systems answering "what should be taught" is the condition it exists
        // to remove.
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
          atlas: services.atlas,
          // 090.3d: the live half. Composed here because this is where the
          // runtime context arrives on the execution object; `composeSituation`
          // is total, so an absent context yields a situation whose every field
          // says "unavailable" rather than no situation at all.
          ...(situation === null
            ? {}
            : { situation, situationKey: situationKey(situation) }),
          lang: {
            targetLanguage: execution.selection.targetLanguage ?? learner.targetLanguage,
            supportLanguage: execution.selection.supportLanguage ?? learner.supportLanguage
          },
          calibrationActive: false
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
                  extractCharacterVoiceReminder(npc),
                triggerReason:
                  directive.comprehensionCheck.triggerReason ??
                  "director-discretion"
              }
            }
          : {}),
        ...(teacherQuestEssentialLemmas.length
          ? {
              questEssentialLemmas: teacherQuestEssentialLemmas.map(
                // 090.4: quest-essential entries are genuinely word-shaped --
                // an objective names a lemma, not an act -- so the annotation
                // keeps LemmaRef and this stays a LemmaRef mapping.
                (entry: {
                  lemmaRef: LemmaRef;
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

      // 090.4: the describer was an unwired parameter until now, so every
      // competency reached the NPC as a bare id it could not act on.
      constraint.generatorPromptOverlay = buildGeneratorPromptOverlay(
        constraint,
        createCompetencyDescriber(constraint.targetLanguage)
      );
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
              .filter((t) => t.kind === "vocabulary")
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
          // 090.4: teachableRefKey rather than lemmaId -- telemetry logs
          // identity, and a competency has one too. Narrowing to words here
          // would make competency decisions invisible in the traces, which is
          // the opposite of what telemetry is for.
          introduce: constraint.targetVocab.introduce.map(teachableRefKey),
          reinforce: constraint.targetVocab.reinforce.map(teachableRefKey),
          avoid: constraint.targetVocab.avoid.map(teachableRefKey),
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
