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
import { formatAlwaysTargetWords } from "../teacher/always-target-words";
import { INFLECT_SLATED_WORDS_PROMPT } from "../teacher/slate-prompt";
import { describeLanguageMix } from "../teacher/band-envelope";
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
function taughtLemmaIds(constraint: SugarlangConstraint): string[] {
  return vocabularyRefs(constraint.targetVocab.introduce).map((ref) => ref.lemmaId);
}

export interface SugarLangVerifyMiddlewareDeps {
  services: SugarlangRuntimeServices;
  logger?: SugarlangLoggerLike;
  telemetry?: TelemetrySink;
}

const REPAIR_CANDIDATE_COUNT = 3;
// Published diagnostic key from sugaragent's moderation middleware (084.6).
// Matches MODERATION_DEFLECTED_DIAG_KEY; never import across the plugin boundary.
const MODERATION_DEFLECTED_DIAG = "moderationDeflected";

interface CandidateScore {
  score: number;
  passes: boolean;
  coverageRatio: number;
  measuredRatio: number;
  conformance: RatioConformance;
  voiceRetentionScore: number;
}

interface RepairResult {
  selectedText: string;
  selectedIndex: number;
  selectedPasses: boolean;
  candidateScores: CandidateScore[];
}

function scoreCandidateVerdict(verdict: EnvelopeVerdict): Omit<CandidateScore, "voiceRetentionScore"> {
  const directed = verdict.languageRatioVerdict.directedRatio;
  const measured = verdict.languageRatioVerdict.measuredRatio;

  // 090.4: SCORED ON DISTANCE FROM THE TARGET, not on "did we reach it".
  //
  // This was `Math.min(measured / directed, 1)`, which caps at 1 -- so a reply
  // three times over the directed ratio scored EXACTLY the same as one that hit
  // it. Overshoot was invisible to selection as well as to the pass gate, so
  // among several candidates the most over-the-top one could win on coverage
  // with nothing pulling the other way.
  const ratioFraction =
    directed > 0 ? Math.max(0, 1 - Math.abs(measured - directed) / directed) : 1;

  return {
    score: verdict.profile.coverageRatio * 0.5 + ratioFraction * 0.5,
    // Both directions fail. `over-ratio` did not exist as a verdict until 090.4,
    // so "too much target language" was unrejectable -- an A1 learner could be
    // handed a full-Spanish paragraph and every gate passed it.
    passes:
      verdict.withinEnvelope &&
      verdict.languageRatioVerdict.conformance !== "under-ratio" &&
      verdict.languageRatioVerdict.conformance !== "over-ratio",
    coverageRatio: verdict.profile.coverageRatio,
    measuredRatio: measured,
    conformance: verdict.languageRatioVerdict.conformance
  };
}

/**
 * Returns [0,1]: fraction of the voice spec's markers (interjections, gesture tags)
 * present in the candidate text. Returns 1 when spec is null (neutral -- no preference).
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

function buildVoiceRubricLine(spec: VoiceChannelSpec): string | null {
  const parts: string[] = [];
  if (spec.interjections.length > 0) {
    parts.push(spec.interjections.join(", "));
  }
  if (spec.hasGestureTags) {
    parts.push("any *...* gesture tags");
  }
  if (parts.length === 0) return null;
  return `Keep the NPC's signature markers verbatim (${parts.join("; ")}) -- these are exempt from simplification.`;
}

function parseCandidates(text: string): string[] {
  let cleaned = text.trim();
  // Strip markdown code fences (```json ... ``` or ``` ... ```) before parsing.
  const fenceMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)```$/s);
  if (fenceMatch?.[1] !== undefined) {
    cleaned = fenceMatch[1].trim();
  }
  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (Array.isArray(parsed) && parsed.every((c) => typeof c === "string")) {
      return (parsed as string[]).filter((c) => (c as string).trim().length > 0);
    }
  } catch {}
  // Fallback: treat the whole response as a single candidate
  return cleaned ? [cleaned] : [];
}

async function repairWithBestOfN(
  originalText: string,
  originalVerdict: EnvelopeVerdict,
  constraint: SugarlangConstraint,
  llmClient: SugarlangLLMClient | null,
  checkCandidate: (text: string) => EnvelopeVerdict,
  voiceSpec: VoiceChannelSpec | null | undefined,
  n: number = REPAIR_CANDIDATE_COUNT
): Promise<RepairResult | null> {
  if (!llmClient) {
    return null;
  }

  const targetLang = languageDisplayName(constraint.targetLanguage);
  const pct = Math.round(constraint.targetLanguageRatio * 100);
  // 090.4: the repair prompt talks about WORDS, so it narrows to the vocabulary
  // half explicitly. `vocabularyRefs` rather than an inline kind check, so this
  // reads as a decision -- a competency is an act and has no place in "use these
  // words if natural"; its exponents reach the model through the generator
  // overlay instead.
  const vocabContext = [
    `Forbidden words (use simpler synonyms): ${vocabularyRefs(constraint.targetVocab.avoid).map((l) => l.lemmaId).join(", ") || "(none)"}.`,
    `Use these words if natural: ${[
      ...vocabularyRefs(constraint.targetVocab.introduce).map((l) => l.lemmaId),
      ...vocabularyRefs(constraint.targetVocab.reinforce).map((l) => l.lemmaId)
    ].join(", ") || "(none)"}. Do not force them.`
  ].join("\n");
  const voiceRubricLine = voiceSpec ? buildVoiceRubricLine(voiceSpec) : null;

  const result = await llmClient.generate({
    systemPrompt: [
      `You are editing an NPC line for a ${targetLang}-learning game.`,
      `Say the same thing in simpler, clearer language.`,
      `Preserve the meaning and any important information.`,
      `Simplify the expression, never change what is being communicated.`,
      `Do NOT add inline glosses, parenthetical translations, or line-by-line word pairings.`,
      `The NPC speaks naturally -- never write a word followed by its translation on the next line.`,
      ...(voiceRubricLine ? [voiceRubricLine] : []),
      // THE THIRD PATH THAT WRITES WHAT THE PLAYER READS. Repair rewrites the
      // turn and assigns the result straight back, so a line that was generated
      // correctly can be replaced by one that was never told these rules.
      // Repair fires on ordinary under-ratio turns at the anchored end, which
      // is exactly the band these rules exist for.
      ...formatAlwaysTargetWords(
        constraint.targetLanguage,
        constraint.learnerCefr,
        targetLang
      ),
      ...(vocabularyRefs(constraint.targetVocab.introduce).length > 0 ||
      vocabularyRefs(constraint.targetVocab.reinforce).length > 0
        ? [INFLECT_SLATED_WORDS_PROMPT]
        : []),
      `Return exactly ${n} alternative versions as a JSON array.`
    ].join(" "),
    userPrompt: [
      `Original: ${originalText}`,
      `Learner level: ${constraint.learnerCefr}. Sentence complexity: ${constraint.sentenceComplexityCap}.`,
      // describeLanguageMix rather than a third phrasing of the same fact --
      // the bake and the overlay already share it, and this one had drifted to
      // a bare percentage with none of the posture guidance.
      describeLanguageMix(
        constraint.supportPosture,
        targetLang,
        constraint.targetLanguageRatio
      ),
      vocabContext,
      ``,
      `Return a JSON array of exactly ${n} versions, nothing else: ["...", "...", "..."]`
    ].join("\n"),
    maxTokens: 160 * n + 40
  });

  const candidates = parseCandidates(result.text);
  if (candidates.length === 0) {
    return null;
  }

  const originalScore = scoreCandidateVerdict(originalVerdict);
  const scored = candidates.map((text) => ({
    text,
    details: {
      ...scoreCandidateVerdict(checkCandidate(text)),
      voiceRetentionScore: computeVoiceRetentionScore(text, voiceSpec)
    } satisfies CandidateScore
  }));

  // Among passing candidates, prefer the one with highest voice retention
  const passing = scored.filter((c) => c.details.passes);
  if (passing.length > 0) {
    const best = passing.reduce((a, b) =>
      b.details.voiceRetentionScore > a.details.voiceRetentionScore ? b : a
    );
    return {
      selectedText: best.text,
      selectedIndex: scored.indexOf(best),
      selectedPasses: true,
      candidateScores: scored.map((c) => c.details)
    };
  }

  // No passing candidate: use best-scoring by envelope/ratio if it beats the original
  const best = scored.reduce((a, b) => (b.details.score > a.details.score ? b : a));
  if (best.details.score > originalScore.score) {
    return {
      selectedText: best.text,
      selectedIndex: scored.indexOf(best),
      selectedPasses: false,
      candidateScores: scored.map((c) => c.details)
    };
  }

  return null;
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
        supportPosture: constraint.supportPosture
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
          voiceRetentionScore: computeVoiceRetentionScore(originalTurnText, voiceSpec)
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
      if (
        verdict.withinEnvelope &&
        ratioVerdict.conformance !== "under-ratio" &&
        !tooDenseToRead
      ) {
        return normalizedTurn;
      }

      // Deterministic-skip: no repair on canned/fallback turns (084.6).
      // Classifier + telemetry ran above to keep the metric honest.
      const isDeterministic =
        normalizedTurn.diagnostics?.llmBackend === "deterministic" ||
        normalizedTurn.diagnostics?.[MODERATION_DEFLECTED_DIAG] === true;
      if (isDeterministic) {
        await emitTelemetry(
          telemetry,
          createTelemetryEvent("verify.deterministic-bypass", {
            conversationId,
            sessionId,
            turnId: traceTurnId,
            timestamp: Date.now(),
            sceneId: sceneId ?? null,
            reason: normalizedTurn.diagnostics?.moderationDeflected === true ? "moderation-deflected" : "deterministic-backend"
          }),
          logger
        );
        return normalizedTurn;
      }

      // Build violation labels for telemetry (not used as the repair prompt -- 083.2
      // uses the SAY IT SIMPLER framing inside repairWithBestOfN).
      const violationLabels: string[] = [];
      if (ratioVerdict.conformance === "under-ratio") {
        const pct = Math.round(constraint.targetLanguageRatio * 100);
        violationLabels.push(
          `Rewrite this reply so about ${pct}% of it is in ${languageDisplayName(constraint.targetLanguage)}; keep the meaning.`
        );
      }
      // The other direction. Without this the ceiling triggered a repair whose
      // violation list was EMPTY -- the model was asked to fix a line and never
      // told what was wrong with it, which is worse than not repairing at all.
      if (tooDenseToRead) {
        const pct = Math.round(constraint.targetLanguageRatio * 100);
        violationLabels.push(
          `This is too dense to read at ${constraint.learnerCefr}. Rewrite it with about ${pct}% ${languageDisplayName(constraint.targetLanguage)} and the rest in plain English; keep the meaning.`
        );
      }
      violationLabels.push(
        ...verdict.violations.map(
          (violation) => `Remove or simplify "${violation.lemmaRef.lemmaId}".`
        )
      );
      if (!verdict.withinEnvelope && violationLabels.length === 0) {
        violationLabels.push("Say it simpler using words the learner knows.");
      }

      const checkCandidate = (text: string): EnvelopeVerdict =>
        services.classifier.check(text, learner, {
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
          supportPosture: constraint.supportPosture
        });

      const repairResult = await repairWithBestOfN(
        normalizedTurn.text,
        verdict,
        constraint,
        services.llmClient,
        checkCandidate,
        voiceSpec
      );

      if (repairResult) {
        normalizedTurn.text = repairResult.selectedText;
        if (repairResult.selectedPasses) {
          await emitTelemetry(
            telemetry,
            createTelemetryEvent("verify.repair-triggered", {
              conversationId,
              sessionId,
              turnId: traceTurnId,
              timestamp: Date.now(),
              sceneId: sceneId ?? "",
              originalText: originalTurnText,
              repairedText: repairResult.selectedText,
              violations: violationLabels,
              repairPrompt: violationLabels,
              candidateCount: repairResult.candidateScores.length,
              selectedIndex: repairResult.selectedIndex,
              candidateScores: repairResult.candidateScores
            }),
            logger
          );
        }
        return normalizedTurn;
      }

      // repairResult is null: no candidate beat the original, SO THE ORIGINAL
      // SHIPS. Out of envelope, but grammatical and meaningful.
      //
      // 2026-08-02 DELETED the autoSimplify fallback that used to run here. It
      // rewrote the finished line in place, swapping each out-of-band lemma for
      // a lower-band one -- and `entry.lemmaId` is a bare CITATION FORM, so for
      // a verb it spliced in another verb's infinitive. The substitution table
      // was chosen by band and part of speech with no notion of meaning: 2,996
      // lemmas mapped to `el`, 910 to `y`, so `sostener` became "and". It
      // produced sentences that passed a band check and meant nothing.
      //
      // Untaught but correct beats rewritten into nonsense -- the same rule the
      // scripted path took on 2026-07-31 and item text took in story 1. The
      // verdict still records the failure, so nothing is hidden by shipping the
      // original.

      return normalizedTurn;
    }
  };
}
