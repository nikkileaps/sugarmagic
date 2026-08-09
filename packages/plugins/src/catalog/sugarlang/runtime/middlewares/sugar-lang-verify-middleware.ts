/**
 * packages/plugins/src/catalog/sugarlang/runtime/middlewares/sugar-lang-verify-middleware.ts
 *
 * Purpose: Implements the analysis-stage middleware that verifies generated turns against the comprehension envelope.
 *
 * Exports:
 *   - createSugarLangVerifyMiddleware
 *
 * Relationships:
 *   - Depends on the Sugarlang runtime service graph and ConversationMiddleware interface.
 *   - Reads the final constraint and enforces the envelope with one repair retry plus deterministic simplification fallback.
 *
 * Implements: Proposal 001 §End-to-End Turn Flow
 *
 * Status: active
 */

import type { ConversationMiddleware } from "@sugarmagic/runtime-core";
import { markTurnPhase, noteTurnFact } from "@sugarmagic/runtime-core";
import {
  createNoOpTelemetrySink,
  createTelemetryEvent,
  emitTelemetry,
  type TelemetrySink
} from "../telemetry/telemetry";
import type { EnvelopeVerdict, RatioConformance, VoiceChannelSpec } from "../types";
import type { SugarlangLLMClient } from "../llm/types";
import type { SugarlangRuntimeServices } from "../runtime-services";
import type { SugarlangConstraint } from "../types";
import { createSugarlangLogger } from "../logger";
import { vocabularyRefs } from "../contracts/teachable-ref";
import { allForms } from "../classifier/word-forms";
import { englishCollisionSurfaces } from "../classifier/english-collisions";
import { getAllInventoryExponents } from "../inventory/competency-inventory-loader";
import type { Exponent } from "../contracts/competency-inventory";
import { formatAlwaysTargetWords } from "../teacher/always-target-words";
import { INFLECT_SLATED_WORDS_PROMPT } from "../teacher/slate-prompt";
import { describeLanguageMix } from "../teacher/band-envelope";
import { ENVELOPE_KRASHEN_FLOOR } from "../classifier/envelope-rule";
import { languageDisplayName } from "../language-names";
import { exceedsReadabilityCeiling } from "../teacher/band-envelope";
import {
  SUGARLANG_CONSTRAINT_ANNOTATION,
  buildLearnerSnapshot,
  getSugarlangConversationId,
  getSugarlangTelemetryTurnId,
  getSugarAgentSessionId,
  getSceneId,
  isPlayerSpokenTurn,
  isQuestObjectiveInFocus,
  normalizeTurn,
  isScriptedMode,
  shouldRunSugarlangForExecution,
  textMentionsLemma,
  type SugarlangLoggerLike
} from "./shared";

/**
 * The lemma ids the Teacher chose to introduce, for the band-ceiling exemption.
 *
 * 090.10: was `constraint.rawPrescription` -- the budgeter's shortlist. The
 * exemption means "we are deliberately teaching this word, so do not flag it as
 * above the learner's band", which is a statement about the Teacher's decision,
 * not about what a lexical scan surfaced. Competency refs carry no lemmaId and
 * are filtered out by `vocabularyRefs`.
 */
// Matches MODERATION_DEFLECTED_DIAG_KEY; never import across the plugin boundary.
const MODERATION_DEFLECTED_DIAG = "moderationDeflected";

function taughtLemmaIds(constraint: SugarlangConstraint): string[] {
  return vocabularyRefs(constraint.targetVocab.introduce).map((ref) => ref.lemmaId);
}

/**
 * Returns [0,1]: fraction of the voice spec's markers (interjections, gesture tags)
 * present in the candidate text. Returns 1 when spec is null (neutral -- no preference).
 *
 * SURVIVED the repair-path deletion (latency epic): the repair's candidate
 * scoring died, but this also feeds the verify.drift-sample telemetry and the
 * voiceRetention timeline fact, and is re-exported through envelope-classifier
 * into the bake paths.
 */
export function computeVoiceRetentionScore(
  text: string,
  voiceSpec: VoiceChannelSpec | null | undefined
): number {
  if (!voiceSpec) return 1;
  let checks = 0;
  let retained = 0;
  if (voiceSpec.interjections.length > 0) {
    checks++;
    const lowerText = text.normalize("NFC").toLocaleLowerCase();
    if (voiceSpec.interjections.some((inj) => lowerText.includes(inj))) {
      retained++;
    }
  }
  if (voiceSpec.hasGestureTags) {
    checks++;
    if (/\*[^*\n]+\*/u.test(text)) retained++;
  }
  return checks === 0 ? 1 : retained / checks;
}

export interface SugarLangVerifyMiddlewareDeps {
  services: SugarlangRuntimeServices;
  logger?: SugarlangLoggerLike;
  telemetry?: TelemetrySink;
}


export function createSugarLangVerifyMiddleware(
  deps: SugarLangVerifyMiddlewareDeps
): ConversationMiddleware {
  const logger = deps.logger ?? createSugarlangLogger({ debugLogging: false });
  const telemetry = deps.telemetry ?? createNoOpTelemetrySink();

  return {
    middlewareId: "sugarlang.verify",
    displayName: "Sugarlang Verify Middleware",
    priority: 20,
    stage: "analysis",
    async finalize(execution, turn) {
      const normalizedTurn = normalizeTurn(turn);
      if (!normalizedTurn) {
        return turn;
      }

      if (!shouldRunSugarlangForExecution(execution)) {
        return normalizedTurn;
      }

      // Skip verification for scripted dialogue — the adaptation is handled
      // by the scripted middleware, not the verify/repair pipeline.
      if (isScriptedMode(execution)) {
        return normalizedTurn;
      }

      if (isPlayerSpokenTurn(normalizedTurn, deps.services.getPlayerDefinitionId())) {
        return normalizedTurn;
      }

      const constraint = execution.annotations[
        SUGARLANG_CONSTRAINT_ANNOTATION
      ] as SugarlangConstraint | undefined;
      if (!constraint) {
        return normalizedTurn;
      }

      if (deps.services.getConfig().verifyEnabled === false) {
        logger.info(
          "Sugarlang verify temporarily bypassed; returning generated turn unchanged.",
          {
            speakerId: normalizedTurn.speakerId ?? null,
            speakerLabel: normalizedTurn.speakerLabel ?? null,
            textPreview: normalizedTurn.text.slice(0, 200)
          }
        );
        return normalizedTurn;
      }

      const conversationId = getSugarlangConversationId(execution);
      const sessionId = getSugarAgentSessionId(execution);
      const traceTurnId = getSugarlangTelemetryTurnId(execution, "finalize");
      if (constraint.prePlacementOpeningLine) {
        await emitTelemetry(
          telemetry,
          createTelemetryEvent("verify.pre-placement-bypass", {
            conversationId,
            sessionId,
            turnId: traceTurnId,
            timestamp: Date.now(),
            sceneId: getSceneId(execution)
          }),
          logger
        );
        return normalizedTurn;
      }

      const services = await deps.services.resolveForExecution(execution);
      if (!services) {
        return normalizedTurn;
      }
      const originalTurnText = normalizedTurn.text;

      const learner = await services.learnerStore.getCurrentProfile();
      const sceneId = getSceneId(execution);

      // Load scene when available. The ratio check runs even without it -- empty
      // proper-noun exclusion is accepted noise; telemetry notes the degraded path.
      let scene: Awaited<ReturnType<typeof services.sceneLexiconStore.ensure>> | null = null;
      if (sceneId) {
        scene = await services.sceneLexiconStore.ensure(sceneId);
      }

      const questEssentialLemmaIds = execution.annotations[
        "sugarlang.questEssentialLemmaIds"
      ] as Set<string> | undefined;
      const npcDefinitionId = execution.selection?.npcDefinitionId ?? null;
      const voiceSpec =
        npcDefinitionId && scene?.npcVoiceSpecs
          ? (scene.npcVoiceSpecs[npcDefinitionId] ?? null)
          : null;
      const voiceInterjections =
        voiceSpec && voiceSpec.interjections.length > 0
          ? new Set(voiceSpec.interjections)
          : undefined;
      // THE HONEST-INSTRUMENT INPUTS (sugarmagic-latency-psm). A slated word's
      // stored forms are target-language wherever they appear; competency
      // exponents ("me gusta") are matched as spans even in dynamic lines the
      // scene lexicon never saw; and English-collision spellings count only
      // inside one of those. Without these, English prose reads as Spanish and
      // every recorded number lies.
      const slateForms = new Set<string>();
      for (const ref of vocabularyRefs([
        ...constraint.targetVocab.introduce,
        ...constraint.targetVocab.reinforce
      ])) {
        slateForms.add(ref.lemmaId.normalize("NFC").toLocaleLowerCase());
        for (const form of allForms(
          services.atlas.getForms(ref.lemmaId, constraint.targetLanguage)
        )) {
          slateForms.add(form.normalize("NFC").toLocaleLowerCase());
        }
      }
      let inventoryExponents: Exponent[] | undefined;
      try {
        inventoryExponents = getAllInventoryExponents(constraint.targetLanguage);
      } catch {
        // No inventory for this language: spans fall back to scene chunks only.
      }

      const verdict = services.classifier.check(normalizedTurn.text, learner, {
        taughtLemmaIds: scene ? taughtLemmaIds(constraint) : null,
        knownEntities: scene ? new Set(scene.properNouns) : new Set(),
        questEssentialLemmas: questEssentialLemmaIds ?? new Set<string>(),
        voiceInterjections,
        lang: constraint.targetLanguage,
        sceneLexicon: scene ?? undefined,
        conversationId,
        sessionId,
        turnId: traceTurnId,
        directedRatio: constraint.targetLanguageRatio,
        supportPosture: constraint.supportPosture,
        inventoryExponents,
        englishCollisions: englishCollisionSurfaces(constraint.targetLanguage),
        recognizedTargetSurfaces: slateForms
      });
      await emitTelemetry(
        telemetry,
        createTelemetryEvent("classifier.verdict", {
          conversationId,
          sessionId,
          turnId: traceTurnId,
          timestamp: Date.now(),
          sceneId: sceneId ?? null,
          learnerSnapshot: buildLearnerSnapshot(learner),
          verdict,
          inputText: normalizedTurn.text,
          constraint
        }),
        logger
      );
      await emitTelemetry(
        telemetry,
        createTelemetryEvent("verify.ratio-verdict", {
          conversationId,
          sessionId,
          turnId: traceTurnId,
          timestamp: Date.now(),
          sceneId: sceneId ?? null,
          measuredRatio: verdict.languageRatioVerdict.measuredRatio,
          directedRatio: verdict.languageRatioVerdict.directedRatio,
          posture: verdict.languageRatioVerdict.posture,
          // THE GROUPING KEY FOR RATIO ANALYSIS (nikki, 2026-07-31).
          //
          // "at band X the intended ratio was Y and we got Z" is the question
          // worth asking, and it could not be answered from this event: posture
          // was here but band was not, and posture does not invert -- B1, B2, C1
          // and C2 all map to `target-dominant`, so grouping by posture merges
          // four bands into one bucket.
          //
          // With band + directed + measured the categorical `conformance` below
          // stops being the analysis surface and becomes what it should be: a
          // derived convenience. Any threshold can be recomputed after the fact
          // from the raw numbers, including ones we have not thought of.
          learnerCefr: constraint.learnerCefr,
          conformance: verdict.languageRatioVerdict.conformance,
          denominator: verdict.profile.ratioCheckTokens,
          degradedExclusion: !sceneId
        }),
        logger
      );
      // 083.5 — per-turn drift sample: baseline ratio + envelope + voice score
      // before any repair, keyed by conversation-ordinal turn index.
      const sessionHistory = (
        execution.state["sugaragent.session"] as { history?: unknown[] } | undefined
      )?.history;
      const turnIndex = Array.isArray(sessionHistory) ? sessionHistory.length : 0;
      // Canned/fallback turns are marked ON the sample rather than skipped or
      // separately evented (the old verify.deterministic-bypass event died with
      // the gate): unmarked deterministic turns would silently pollute the
      // distributions the quality baseline reads.
      const isDeterministic =
        normalizedTurn.diagnostics?.llmBackend === "deterministic" ||
        normalizedTurn.diagnostics?.[MODERATION_DEFLECTED_DIAG] === true;
      await emitTelemetry(
        telemetry,
        createTelemetryEvent("verify.drift-sample", {
          conversationId,
          sessionId,
          turnId: traceTurnId,
          timestamp: Date.now(),
          sceneId: sceneId ?? null,
          turnIndex,
          measuredRatio: verdict.languageRatioVerdict.measuredRatio,
          directedRatio: verdict.languageRatioVerdict.directedRatio,
          ratioConformance: verdict.languageRatioVerdict.conformance,
          withinEnvelope: verdict.withinEnvelope,
          voiceRetentionScore: computeVoiceRetentionScore(originalTurnText, voiceSpec),
          deterministic: isDeterministic
        }),
        logger
      );
      if (scene) {
        for (const lemmaId of verdict.profile.questEssentialLemmasMatched) {
          const questEssential = constraint.questEssentialLemmas?.find(
            (entry) => entry.lemmaRef.lemmaId === lemmaId
          );
          if (!questEssential) {
            continue;
          }
          await emitTelemetry(
            telemetry,
            createTelemetryEvent("quest-essential.classifier-exempted-lemma", {
              conversationId,
              sessionId,
              turnId: traceTurnId,
              timestamp: Date.now(),
              sceneId,
              lemmaRef: questEssential.lemmaRef,
              cefrBand:
                scene.questEssentialLemmas.find((entry) => entry.lemmaId === lemmaId)?.cefrBand ??
                "unknown",
              learnerBand: learner.estimatedCefrBand,
              sourceObjectiveDisplayName: questEssential.sourceObjectiveDisplayName
            }),
            logger
          );
        }
      }

      // Parenthetical gloss enforcement removed — the UI handles vocabulary
      // glossing via hover tooltips. The NPC speaks naturally.

      const ratioVerdict = verdict.languageRatioVerdict;

      // TOO DENSE TO READ -> REPAIR. This gate previously only caught
      // `under-ratio`, so "too much target language" was unrepairable: an A1
      // learner could be handed a full-Spanish paragraph and every gate passed
      // it. `over-ratio` was added as a verdict to name that, but the verdict
      // alone changed nothing here -- `"over-ratio" !== "under-ratio"` is true,
      // so those turns still returned before repair could start.
      //
      // DELIBERATELY NOT `conformance !== "over-ratio"` (nikki, 2026-07-31).
      // `over-ratio` means "off the directed ratio", which at A1 fires from 0.45
      // -- off-target and perfectly readable. Repairing every one of those buys
      // a second LLM call on most turns to correct a tuning miss.
      //
      // The trigger is the READABILITY CEILING instead: far above the directed
      // ratio, per band, and null (no guard) at C1/C2 where a fully
      // target-language line is the goal. Rare by construction.
      const tooDenseToRead = exceedsReadabilityCeiling(
        ratioVerdict.measuredRatio,
        constraint.learnerCefr
      );

      // Spike (sugarmagic-latency-cex): repair fires on EVERY turn, and a story
      // cannot be written against a symptom. These say which trigger fired and
      // how far off the line actually landed -- the difference between "the
      // generator undershoots", "the envelope is too tight", and "the
      // measurement is wrong" is three different fixes.
      noteTurnFact(
        "envelopeRatio",
        `${ratioVerdict.measuredRatio.toFixed(2)}->${ratioVerdict.directedRatio.toFixed(2)}:${ratioVerdict.conformance}`
      );
      noteTurnFact("tooDense", tooDenseToRead);
      // The trigger that turned out to be the real one: word-level band
      // violations. NAME the words -- "withinEnvelope=false" says a repair is
      // coming, but which lemmas tripped it is the difference between "the
      // generator reaches above band", "the atlas has gaps", and "an exemption
      // channel is not covering something it should".
      if (verdict.violations.length > 0) {
        noteTurnFact(
          "envelopeViolations",
          verdict.violations.map((violation) => violation.lemmaRef.lemmaId).join(",")
        );
      }
      // Measurement only (nikki, 2026-08-06): the comprehensibility floor is
      // being demoted from gate to metric in psm. These say how often it is the
      // thing that fired -- BEFORE the behaviour changes -- so the demotion is
      // made against data rather than a sample of one.
      noteTurnFact("coverage", verdict.profile.coverageRatio.toFixed(2));
      // en3 baseline leg: voice retention on the ORIGINAL text, same input the
      // drift-sample event uses.
      noteTurnFact(
        "voiceRetention",
        computeVoiceRetentionScore(normalizedTurn.text, voiceSpec).toFixed(2)
      );
      noteTurnFact(
        "floorFailed",
        verdict.profile.coverageRatio < ENVELOPE_KRASHEN_FLOOR
      );
      // THE ENVELOPE NO LONGER GATES (sugarmagic-latency-psm; nikki,
      // 2026-08-06). Everything above is computed and recorded; nothing below
      // this line alters the turn. Measured before the change, the
      // deterministic gate fired on ~100% of turns -- essentially always
      // wrongly (English homographs, and a comprehension floor whose
      // arithmetic cannot work on deliberately mixed lines) -- and every
      // firing bought a 5-12s repair call, so the player nearly always read a
      // repair candidate instead of the generator's line. Language-quality
      // judgment moves to the Judge (latency epic, judge story).
      //
      // REVISIT TRIGGER: if the now-honest telemetry shows genuinely
      // incomprehensible lines shipping (not mixed-text artifacts),
      // accelerate the judge story's gating phase rather than resurrecting a
      // deterministic gate here.
      return normalizedTurn;
    }
  };
}