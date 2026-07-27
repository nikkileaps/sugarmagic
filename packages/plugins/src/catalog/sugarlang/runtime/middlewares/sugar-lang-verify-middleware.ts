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
import { autoSimplify } from "../classifier/auto-simplify";
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
import { languageDisplayName } from "../language-names";
import {
  SUGARLANG_CONSTRAINT_ANNOTATION,
  SUGARLANG_PLACEMENT_FLOW_ANNOTATION,
  buildLearnerSnapshot,
  findQuestEssentialUses,
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
  const ratioFraction = directed > 0
    ? Math.min(verdict.languageRatioVerdict.measuredRatio / directed, 1)
    : 1;
  return {
    score: verdict.profile.coverageRatio * 0.5 + ratioFraction * 0.5,
    passes: verdict.withinEnvelope && verdict.languageRatioVerdict.conformance !== "under-ratio",
    coverageRatio: verdict.profile.coverageRatio,
    measuredRatio: verdict.languageRatioVerdict.measuredRatio,
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
  const vocabContext = [
    `Forbidden words (use simpler synonyms): ${constraint.targetVocab.avoid.map((l) => l.lemmaId).join(", ") || "(none)"}.`,
    `Use these words if natural: ${[
      ...constraint.targetVocab.introduce.map((l) => l.lemmaId),
      ...constraint.targetVocab.reinforce.map((l) => l.lemmaId)
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
      `Return exactly ${n} alternative versions as a JSON array.`
    ].join(" "),
    userPrompt: [
      `Original: ${originalText}`,
      `Learner level: ${constraint.learnerCefr}. Sentence complexity: ${constraint.sentenceComplexityCap}.`,
      `About ${pct}% of the words should be in ${targetLang}.`,
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

      const placementFlow = execution.annotations[
        SUGARLANG_PLACEMENT_FLOW_ANNOTATION
      ] as { phase?: string } | undefined;
      const conversationId = getSugarlangConversationId(execution);
      const sessionId = getSugarAgentSessionId(execution);
      const traceTurnId = getSugarlangTelemetryTurnId(execution, "finalize");
      if (constraint.prePlacementOpeningLine || placementFlow?.phase === "opening-dialog") {
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
        prescription: scene ? constraint.rawPrescription : null,
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
          prescription: constraint.rawPrescription,
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
          conformance: verdict.languageRatioVerdict.conformance,
          denominator: verdict.profile.ratioCheckTokens,
          degradedExclusion: !sceneId
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
      if (verdict.withinEnvelope && ratioVerdict.conformance !== "under-ratio") {
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
          prescription: scene ? constraint.rawPrescription : null,
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

      // repairResult is null: no candidate beat the original.
      // Lemma-substitution fallback: autoSimplify handles lemma violations only.
      // For ratio-only failures autoSimplify is a no-op (zero violations) -- the
      // original is the terminal result. (083.2, review round 1)
      if (verdict.violations.length > 0) {
        try {
          const simplified = autoSimplify(
            normalizedTurn.text,
            verdict.violations.map((violation) => violation.lemmaRef),
            learner
          );
          const originalText = normalizedTurn.text;
          normalizedTurn.text = simplified.text;
          await emitTelemetry(
            telemetry,
            createTelemetryEvent("verify.auto-simplify-triggered", {
              conversationId,
              sessionId,
              turnId: traceTurnId,
              timestamp: Date.now(),
              sceneId: sceneId ?? "",
              originalText,
              simplifiedText: simplified.text,
              substitutions: verdict.violations.map(
                (violation) => violation.lemmaRef.lemmaId
              )
            }),
            logger
          );
        } catch (error) {
          logger.warn("Sugarlang autoSimplify failed; returning original turn.", {
            reason: error instanceof Error ? error.message : String(error)
          });
        }
      }

      return normalizedTurn;
    }
  };
}
