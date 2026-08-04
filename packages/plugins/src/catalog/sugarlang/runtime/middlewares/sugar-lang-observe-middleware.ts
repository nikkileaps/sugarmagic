/**
 * packages/plugins/src/catalog/sugarlang/runtime/middlewares/sugar-lang-observe-middleware.ts
 *
 * Purpose: Implements the analysis-stage middleware that extracts Sugarlang observations and routes them to the learner reducer.
 *
 * Exports:
 *   - createSugarLangObserveMiddleware
 *
 * Relationships:
 *   - Depends on the Sugarlang runtime service graph plus the ConversationMiddleware interface.
 *   - Is the single place where raw turn/input context becomes learner observations and probe lifecycle state.
 *
 * Implements: Proposal 001 §End-to-End Turn Flow / §Implicit Signal Collection
 *
 * Status: active
 */

import type { ConversationMiddleware } from "@sugarmagic/runtime-core";
import { getWorldDay, writeDialogueTeachLine } from "@sugarmagic/runtime-core";
import {
  createNoOpTelemetrySink,
  createTelemetryEvent,
  emitTelemetry,
  type TelemetrySink
} from "../telemetry/telemetry";
import { tokenize } from "../classifier/tokenize";
import { lemmatize } from "../classifier/lemmatize";
import { createChunkMatcher } from "../classifier/chunk-matcher";
import type { Exponent } from "../contracts/competency-inventory";
import { observationToOutcome } from "../learner/observations";
import { recordObservation } from "../debug/turn-debug-state";
import {
  getCompetencyForExponent as getInventoryCompetencyForExponent,
  getAllInventoryExponents
} from "../inventory/competency-inventory-loader";
import { countDiverseEncounters } from "../learner";
import { competencyRefs, vocabularyRefs } from "../contracts/teachable-ref";
import { buildHighlightTerms, focusTermsOf } from "../grading/highlight-terms";
import { findAmbientSpans } from "../grading/ambient-spans";
import { traceRealization } from "../teacher/teacher-trace";
import { MorphologyLoader } from "../classifier/morphology-loader";
import type { LemmaRef, SugarlangConstraint } from "../types";
import type { SugarlangRuntimeServices } from "../runtime-services";
import { createSugarlangLogger } from "../logger";
import {
  SUGARLANG_COMPLETED_OBJECTIVE_IDS_ANNOTATION,
  SUGARLANG_COMPREHENSION_PROBE_ID_ANNOTATION,
  SUGARLANG_CONSTRAINT_ANNOTATION,
  createObservationEvent,
  getChoiceLemmaRef,
  getHoverLemma,
  getSceneId,
  getStoredComprehensionCheck,
  getSugarlangConversationId,
  getSugarlangTelemetryTurnId,
  getSugarAgentSessionId,
  getTurnsSinceLastProbe,
  isPlayerSpokenTurn,
  isScriptedMode,
  normalizeTurn,
  setStoredComprehensionCheck,
  setTurnsSinceLastProbe,
  shouldRunSugarlangForExecution,
  type SugarlangLoggerLike
} from "./shared";

import type { ChunkMatcher } from "../classifier/chunk-matcher";

// Trie rebuild is O(inventory * avgSurfaceForms). Cache per language so it happens once per session.
const chunkMatcherCache = new Map<
  string,
  ChunkMatcher<Exponent> | null
>();

export interface SugarLangObserveMiddlewareDeps {
  services: SugarlangRuntimeServices;
  logger?: SugarlangLoggerLike;
  telemetry?: TelemetrySink;
}

function collectLemmasFromText(
  text: string,
  lang: string
): Array<{ surface: string; lemmaId: string | null }> {
  return tokenize(text, lang)
    .filter((token) => token.kind === "word")
    .map((token) => ({
      surface: token.surface,
      lemmaId: lemmatize(token.surface, lang)
    }));
}

/**
 * 090.4: observe records evidence about WORDS -- a hover, an encounter, a
 * production -- and its card store is keyed by lemmaId. So it narrows to the
 * vocabulary half, explicitly.
 *
 * COMPETENCIES ARE NOT SERVED HERE AND THAT IS A KNOWN GAP, not a decision that
 * they do not matter. A competency is evidenced by its exponents appearing in a
 * turn, which is what the chunk matcher finds and what `exponent:` cards used to
 * approximate by smuggling competencies through this lemma channel. Recording
 * competency evidence properly needs the realization output (090.11) so observe
 * can read what was actually taught rather than re-deriving it.
 *
 * Named narrowing rather than an inline `kind === "vocabulary"` so this gap is
 * visible at every call site instead of looking like ordinary list handling.
 */
function buildTargetLemmaSet(constraint: SugarlangConstraint): Set<string> {
  return new Set(
    [
      ...vocabularyRefs(constraint.targetVocab.introduce),
      ...vocabularyRefs(constraint.targetVocab.reinforce)
    ].map((lemma) => lemma.lemmaId)
  );
}

/**
 * Is this card key a competency the Teacher is INTRODUCING this turn?
 *
 * A competency card is keyed `exponent:<id>`, so it never appears in the slate's
 * vocabulary refs and never will -- the slate names the competency, the card
 * names the exponent. Resolving the chunk back to its competency is the join
 * the two key spaces need.
 */
function isIntroducedCompetencyCard(
  cardKey: string,
  lang: string,
  constraint: SugarlangConstraint
): boolean {
  if (!cardKey.startsWith("exponent:")) return false;
  const competency = getInventoryCompetencyForExponent(
    cardKey.slice("exponent:".length),
    lang
  );
  if (!competency) return false;
  return competencyRefs(constraint.targetVocab.introduce).some(
    (ref) => ref.competencyId === competency.competencyId
  );
}

function extractProbeQuestion(text: string): string | null {
  const sentences = text
    .split(/(?<=[?.!])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const question = [...sentences].reverse().find((sentence) => sentence.endsWith("?"));
  return question ?? null;
}

function isLikelySupportLanguageFallback(
  responseText: string,
  targetLemmaCount: number
): boolean {
  return targetLemmaCount === 0 && /[A-Za-z]/.test(responseText);
}

export function createSugarLangObserveMiddleware(
  deps: SugarLangObserveMiddlewareDeps
): ConversationMiddleware {
  const logger = deps.logger ?? createSugarlangLogger({ debugLogging: false });
  const telemetry = deps.telemetry ?? createNoOpTelemetrySink();

  return {
    middlewareId: "sugarlang.observe",
    displayName: "Sugarlang Observe Middleware",
    priority: 90,
    stage: "analysis",
    async finalize(execution, turn) {
      const normalizedTurn = normalizeTurn(turn);
      if (!shouldRunSugarlangForExecution(execution)) {
        return normalizedTurn ?? turn;
      }

      // In agent mode, skip player-typed turns (observations are handled
      // differently for free-text input). In scripted mode, player lines are
      // authored content that should still get highlights and observations.
      if (
        !isScriptedMode(execution) &&
        normalizedTurn &&
        isPlayerSpokenTurn(normalizedTurn, deps.services.getPlayerDefinitionId())
      ) {
        return normalizedTurn;
      }

      const services = await deps.services.resolveForExecution(execution);
      if (!services) {
        return turn;
      }

      const conversationId = getSugarlangConversationId(execution);
      const sessionId = getSugarAgentSessionId(execution);
      const traceTurnId = getSugarlangTelemetryTurnId(execution, "finalize");
      const sceneId = getSceneId(execution);

      // Placement no longer passes through here. It used to bypass observation
      // on the questionnaire turn and apply the completion off the submit turn;
      // an assessment quest node now opens the form directly and sugarlang
      // scores it in submitPlacementQuestForm, telemetry and all.

      const constraint = execution.annotations[
        SUGARLANG_CONSTRAINT_ANNOTATION
      ] as SugarlangConstraint | undefined;
      if (!normalizedTurn || !constraint) {
        return turn;
      }

      const learner = await services.learnerStore.getCurrentProfile();
      const storedCheck = getStoredComprehensionCheck(execution);
      if (storedCheck && execution.input?.kind === "free_text") {
        const predictedRetrievabilities: Record<string, number> = {};
        for (const lemma of storedCheck.targetLemmas) {
          const card = learner.lemmaCards[lemma.lemmaId];
          if (card && typeof card.retrievability === "number") {
            predictedRetrievabilities[lemma.lemmaId] = card.retrievability;
          }
        }
        const responseLemmas = new Set(
          collectLemmasFromText(execution.input.text, learner.targetLanguage)
            .map((entry) => entry.lemmaId)
            .filter((lemmaId): lemmaId is string => typeof lemmaId === "string")
        );
        const responseTimestamp = Date.now();
        await emitTelemetry(
          telemetry,
          createTelemetryEvent("comprehension.probe-response-received", {
            conversationId,
            sessionId,
            turnId: traceTurnId,
            timestamp: responseTimestamp,
            probeId: storedCheck.probeId,
            sceneId: storedCheck.sceneId ?? sceneId ?? "unknown-scene",
            npcId: storedCheck.npcId,
            npcDisplayName: storedCheck.npcDisplayName,
            targetLemmas: storedCheck.targetLemmas,
            playerResponseText: execution.input.text,
            responseLatencyMs: Math.max(0, responseTimestamp - storedCheck.promptedAtMs),
            responseInputKind: "free_text"
          }),
          logger
        );

        const passed = storedCheck.targetLemmas.filter((lemma) =>
          responseLemmas.has(lemma.lemmaId)
        );
        const failed = storedCheck.targetLemmas.filter(
          (lemma) => !responseLemmas.has(lemma.lemmaId)
        );
        const classifierReasoning =
          passed.length > 0
            ? `Response lemmatized to ${[...responseLemmas].join(", ")} and matched target lemmas.`
            : "No target lemmas were found in the lemmatized response.";

        if (isLikelySupportLanguageFallback(execution.input.text, responseLemmas.size)) {
          await emitTelemetry(
            telemetry,
            createTelemetryEvent("comprehension.probe-language-fallback", {
              conversationId,
              sessionId,
              turnId: traceTurnId,
              timestamp: responseTimestamp,
              probeId: storedCheck.probeId,
              sceneId: storedCheck.sceneId ?? sceneId ?? "unknown-scene",
              npcId: storedCheck.npcId,
              npcDisplayName: storedCheck.npcDisplayName,
              targetLemmas: storedCheck.targetLemmas,
              playerResponseText: execution.input.text,
              detectedLang: learner.supportLanguage
            }),
            logger
          );
        }

        if (passed.length > 0) {
          await services.learnerStateReducer.apply({
            type: "commit-provisional-evidence",
            targetLemmas: passed,
            committedAtMs: responseTimestamp,
            probeTelemetry: {
              probeId: storedCheck.probeId,
              triggerReason: storedCheck.triggerReason
            }
          });
        }
        if (failed.length > 0) {
          await services.learnerStateReducer.apply({
            type: "discard-provisional-evidence",
            targetLemmas: failed,
            discardedAtMs: responseTimestamp,
            probeTelemetry: {
              probeId: storedCheck.probeId,
              triggerReason: storedCheck.triggerReason
            }
          });
        }

        // 087.4: Record the probe outcome in the session accumulator so it feeds fatigueScore.
        // All-passed = good signal; anything else (full-fail or mixed) = strain signal.
        try {
          await services.learnerStateReducer.apply({
            type: "record-probe-outcome",
            passed: passed.length === storedCheck.targetLemmas.length
          });
        } catch {
          // Non-fatal: strain signal missing for this probe, scheduling degrades gracefully.
        }

        if (passed.length === storedCheck.targetLemmas.length) {
          await emitTelemetry(
            telemetry,
            createTelemetryEvent("comprehension.probe-passed", {
              conversationId,
              sessionId,
              turnId: traceTurnId,
              timestamp: responseTimestamp,
              probeId: storedCheck.probeId,
              sceneId: storedCheck.sceneId ?? sceneId ?? "unknown-scene",
              npcId: storedCheck.npcId,
              npcDisplayName: storedCheck.npcDisplayName,
              targetLemmas: storedCheck.targetLemmas,
              playerResponseText: execution.input.text,
              lemmasPassed: passed.map((lemma) => lemma.lemmaId),
              classifierReasoning,
              predictedRetrievabilities: Object.keys(predictedRetrievabilities).length > 0
                ? predictedRetrievabilities
                : undefined
            }),
            logger
          );
        } else if (failed.length === storedCheck.targetLemmas.length) {
          await emitTelemetry(
            telemetry,
            createTelemetryEvent("comprehension.probe-failed", {
              conversationId,
              sessionId,
              turnId: traceTurnId,
              timestamp: responseTimestamp,
              probeId: storedCheck.probeId,
              sceneId: storedCheck.sceneId ?? sceneId ?? "unknown-scene",
              npcId: storedCheck.npcId,
              npcDisplayName: storedCheck.npcDisplayName,
              targetLemmas: storedCheck.targetLemmas,
              playerResponseText: execution.input.text,
              lemmasFailed: failed.map((lemma) => lemma.lemmaId),
              classifierReasoning,
              predictedRetrievabilities: Object.keys(predictedRetrievabilities).length > 0
                ? predictedRetrievabilities
                : undefined
            }),
            logger
          );
        } else {
          await emitTelemetry(
            telemetry,
            createTelemetryEvent("comprehension.probe-mixed-result", {
              conversationId,
              sessionId,
              turnId: traceTurnId,
              timestamp: responseTimestamp,
              probeId: storedCheck.probeId,
              sceneId: storedCheck.sceneId ?? sceneId ?? "unknown-scene",
              npcId: storedCheck.npcId,
              npcDisplayName: storedCheck.npcDisplayName,
              targetLemmas: storedCheck.targetLemmas,
              playerResponseText: execution.input.text,
              lemmasPassed: passed.map((lemma) => lemma.lemmaId),
              lemmasFailed: failed.map((lemma) => lemma.lemmaId),
              classifierReasoning,
              predictedRetrievabilities: Object.keys(predictedRetrievabilities).length > 0
                ? predictedRetrievabilities
                : undefined
            }),
            logger
          );
        }

        setStoredComprehensionCheck(execution, null);
      }

      const targetLemmaSet = buildTargetLemmaSet(constraint);
      const observedAtMs = Date.now();
      if (!sceneId) {
        return normalizedTurn;
      }

      // 085.3: Build chunk matcher from the hand-curated competency inventory so dynamic
      // NPC greetings are detected even when the phrase never appears in authored scene text.
      if (!chunkMatcherCache.has(learner.targetLanguage)) {
        let inventoryExponents: Exponent[] = [];
        try {
          inventoryExponents = getAllInventoryExponents(learner.targetLanguage);
        } catch {
          // Missing inventory for this language -- chunk detection skipped.
        }
        chunkMatcherCache.set(
          learner.targetLanguage,
          inventoryExponents.length > 0
            ? createChunkMatcher(inventoryExponents, learner.targetLanguage)
            : null
        );
      }
      const chunkMatcher = chunkMatcherCache.get(learner.targetLanguage) ?? null;

      const appliedObservations = [] as ReturnType<typeof createObservationEvent>[];
      // Track chunks the player already produced so the NPC-turn isNewCard check doesn't fire
      // on the same chunk within the same execution -- learner snapshot is stale after player pass.
      const playerProducedChunkIds = new Set<string>();

      if (execution.input?.kind === "free_text") {
        const lemmaCandidates = collectLemmasFromText(
          execution.input.text,
          learner.targetLanguage
        );
        // Deduplicate: only one observation per lemma per turn.
        const observedLemmaIds = new Set<string>();

        for (const candidate of lemmaCandidates) {
          if (!candidate.lemmaId || observedLemmaIds.has(candidate.lemmaId)) {
            continue;
          }

          // Only observe target lemmas (introduce/reinforce) or lemmas the
          // learner already has a card for. This avoids creating phantom
          // observations from English words that coincidentally match the
          // target-language morphology index.
          const isTargetLemma = targetLemmaSet.has(candidate.lemmaId);
          const hasExistingCard = candidate.lemmaId in learner.lemmaCards;

          if (!isTargetLemma && !hasExistingCard) {
            continue;
          }

          observedLemmaIds.add(candidate.lemmaId);
          const lemmaRef: LemmaRef = {
            lemmaId: candidate.lemmaId,
            lang: learner.targetLanguage
          };
          const observationEvent = createObservationEvent({
            execution,
            lemma: lemmaRef,
            observation: isTargetLemma
              ? {
                  kind: "produced-typed",
                  inputText: candidate.surface,
                  observedAtMs
                }
              : {
                  kind: "produced-unprompted",
                  observedAtMs
                }
          });
          appliedObservations.push(observationEvent);
          await services.learnerStateReducer.apply({
            type: "observation",
            observationEvent
          });
        }

        // 085.3: Chunk-produced observations for player free-text input.
        if (chunkMatcher) {
          const inputTokens = tokenize(execution.input.text, learner.targetLanguage);
          const chunkMatches = chunkMatcher.match(inputTokens, execution.input.text);
          const observedChunkIds = new Set<string>();
          for (const match of chunkMatches) {
            if (observedChunkIds.has(match.item.exponentId)) continue;
            observedChunkIds.add(match.item.exponentId);
            playerProducedChunkIds.add(match.item.exponentId);
            const observationEvent = createObservationEvent({
              execution,
              lemma: {
                lemmaId: `exponent:${match.item.exponentId}`,
                lang: learner.targetLanguage
              },
              observation: {
                kind: "chunk-produced",
                chunkId: match.item.exponentId,
                surfaceMatched: match.surfaceMatched,
                observedAtMs
              }
            });
            appliedObservations.push(observationEvent);
            await services.learnerStateReducer.apply({
              type: "observation",
              observationEvent
            });
          }
        }
      }

      const choiceLemma = getChoiceLemmaRef(
        execution.input,
        normalizedTurn.choices,
        execution
      );
      if (choiceLemma) {
        const observationEvent = createObservationEvent({
          execution,
          lemma: choiceLemma,
          observation: {
            kind: "produced-chosen",
            choiceSetId:
              execution.input?.kind === "choice" ? execution.input.choiceId : "choice",
            observedAtMs
          }
        });
        appliedObservations.push(observationEvent);
        await services.learnerStateReducer.apply({
          type: "observation",
          observationEvent
        });
      }

      const hoverLemma = getHoverLemma(execution);
      // A HOVER TERM IS NOT AUTOMATICALLY A LEMMA, and this write is PERSISTED.
      //
      // The term is whatever text the presentation layer highlighted, which
      // reaches here as `lemmaId` with no check that such a lemma exists --
      // `getHoverLemma` validates that it is a string and nothing more. Cards
      // live in two key spaces: atlas lemmas, and chunks keyed `exponent:<id>`.
      // A competency exponent surface is in neither, so hovering `buenos dias`
      // writes a card under a key nothing can ever read back. 45 of the 56
      // shipped competency surfaces are not atlas lemmas.
      //
      // In practice a competency surface no longer arrives raw: the highlight
      // terms carry a surface-to-chunk map, so the decorator resolves `buenos
      // dias` to its `exponent:` id before it gets here. This guard is the floor
      // under that, for anything the map does not cover -- and refusing is
      // right, because no card beats one filed under a key nothing reads.
      const hoverIsKnown =
        hoverLemma !== null &&
        (hoverLemma.lemma.lemmaId.startsWith("exponent:") ||
          services.atlas.getLemma(
            hoverLemma.lemma.lemmaId,
            hoverLemma.lemma.lang
          ) !== undefined);

      if (hoverLemma && !hoverIsKnown) {
        logger.debug("Sugarlang ignored a hover on a term that is not a lemma.", {
          term: hoverLemma.lemma.lemmaId,
          lang: hoverLemma.lemma.lang
        });
      }

      if (hoverLemma && hoverIsKnown) {
        // Distinguish introduce hover (positive first exposure) from reinforce
        // hover (needed help remembering). See observations.ts for the
        // pedagogical rationale behind the different FSRS grades.
        //
        // Competencies are checked as well as words. Checking only
        // `vocabularyRefs` meant a `exponent:` card could never match, so every
        // competency hover fell through to "hovered" -- graded Hard, with a
        // negative productive delta. A learner reaching for a competency the
        // Teacher was introducing was penalised for engaging with it.
        const isIntroduceHover =
          vocabularyRefs(constraint.targetVocab.introduce).some(
            (l) => l.lemmaId === hoverLemma.lemma.lemmaId
          ) ||
          isIntroducedCompetencyCard(
            hoverLemma.lemma.lemmaId,
            hoverLemma.lemma.lang,
            constraint
          );
        const observationEvent = createObservationEvent({
          execution,
          lemma: hoverLemma.lemma,
          observation: {
            kind: isIntroduceHover ? "hovered-introduce" : "hovered",
            dwellMs: hoverLemma.dwellMs,
            observedAtMs
          }
        });
        appliedObservations.push(observationEvent);
        await services.learnerStateReducer.apply({
          type: "observation",
          observationEvent
        });
      }

      const turnLemmas = collectLemmasFromText(normalizedTurn.text, learner.targetLanguage);
      // 087.2: world-day and NPC context for debt paydown signals.
      const blackboardForDebt = deps.services.getBlackboard();
      const debtDayIndex = blackboardForDebt ? getWorldDay(blackboardForDebt) : null;
      const debtNpcId = execution.selection.npcDefinitionId ?? null;

      for (const introduce of vocabularyRefs(constraint.targetVocab.introduce)) {
        if (!turnLemmas.some((entry) => entry.lemmaId === introduce.lemmaId)) {
          continue;
        }
        const observationEvent = createObservationEvent({
          execution,
          lemma: introduce,
          observation: {
            kind: "encountered",
            observedAtMs
          }
        });
        appliedObservations.push(observationEvent);
        await services.learnerStateReducer.apply({
          type: "observation",
          observationEvent
        });

        // 087.2: Create lemma-level debt on first introduction.
        // The learner snapshot pre-dates this turn, so absence from lemmaCards = new card.
        if (!(introduce.lemmaId in learner.lemmaCards)) {
          try {
            await services.ledgerStore.createDebt(introduce.lemmaId, "vocabulary", debtDayIndex);
            const debt = await services.ledgerStore.getDebt(introduce.lemmaId);
            if (debt) {
              void emitTelemetry(
                telemetry,
                createTelemetryEvent("debt.created", {
                  timestamp: observedAtMs,
                  conversationId,
                  sessionId,
                  turnId: traceTurnId,
                  itemId: introduce.lemmaId,
                  itemKind: "vocabulary",
                  createdDayIndex: debtDayIndex,
                  targetEncounters: debt.targetEncounters
                })
              );
            }
          } catch {
            // Debt ledger failure is non-fatal.
          }
        }
      }

      // 087.2: Paydown signals for reinforce/card-holding lemmas in NPC turn text.
      // Lemmas already in the card store (reviewCount > 0) sit in the REINFORCE list
      // and produce no FSRS observation here. We call the ledger directly -- bypassing
      // the reducer -- to avoid distorting FSRS grades while still recording diverse
      // encounter paydown for the outer-loop debt tracker.
      const isNpcTurn = !isPlayerSpokenTurn(normalizedTurn, deps.services.getPlayerDefinitionId());
      if (isNpcTurn) {
        const introduceIds = new Set(vocabularyRefs(constraint.targetVocab.introduce).map((l) => l.lemmaId));
        for (const { lemmaId } of turnLemmas) {
          if (!lemmaId) continue;
          // Skip introduce-list lemmas (handled above) and exponent ids.
          if (introduceIds.has(lemmaId) || lemmaId.startsWith("exponent:")) continue;
          // Only reinforce lemmas -- ones with an existing card in the snapshot.
          if (!(lemmaId in learner.lemmaCards)) continue;
          try {
            const entry = { npcDefinitionId: debtNpcId, sceneId, dayIndex: debtDayIndex };
            await services.ledgerStore.recordEncounter(lemmaId, entry);
            const debt = await services.ledgerStore.getDebt(lemmaId);
            if (debt) {
              const diverseCount = countDiverseEncounters(debt.encounters);
              void emitTelemetry(
                telemetry,
                createTelemetryEvent("debt.encounter", {
                  timestamp: observedAtMs,
                  conversationId,
                  sessionId,
                  turnId: traceTurnId,
                  itemId: lemmaId,
                  itemKind: "vocabulary",
                  npcDefinitionId: debtNpcId,
                  sceneId,
                  dayIndex: debtDayIndex,
                  diverseEncounterCountAfter: diverseCount,
                  targetEncounters: debt.targetEncounters,
                  debtPaid: diverseCount >= debt.targetEncounters
                })
              );
            }
          } catch {
            // Debt ledger failure is non-fatal.
          }
        }
      }

      // 085.3: Chunk observations on the turn text.
      // NPC turns -> chunk-encountered (receptive exposure).
      // Player turns in scripted mode -> chunk-produced (productive use).
      // 085.5: First chunk-encountered that creates a new chunk card triggers a teach-record write
      // and a teach-line annotation on the turn (one per turn, earliest new function wins).
      let teachLineSurface: string | null = null;
      if (chunkMatcher) {
        const turnTokens = tokenize(normalizedTurn.text, learner.targetLanguage);
        const chunkMatches = chunkMatcher.match(turnTokens, normalizedTurn.text);
        const isPlayerTurn = isPlayerSpokenTurn(
          normalizedTurn,
          deps.services.getPlayerDefinitionId()
        );
        const observedChunkIds = new Set<string>();
        let teachLineWritten = false;
        for (const match of chunkMatches) {
          if (observedChunkIds.has(match.item.exponentId)) continue;
          observedChunkIds.add(match.item.exponentId);

          // 085.5: Detect first-teach BEFORE applying the observation (new card = not yet in lemmaCards).
          // Also exclude chunks the player already produced this turn -- learner snapshot is stale.
          const isNewCard =
            !isPlayerTurn &&
            !(`exponent:${match.item.exponentId}` in learner.lemmaCards) &&
            !playerProducedChunkIds.has(match.item.exponentId);

          const observationEvent = createObservationEvent({
            execution,
            lemma: {
              lemmaId: `exponent:${match.item.exponentId}`,
              lang: learner.targetLanguage
            },
            observation: isPlayerTurn
              ? {
                  kind: "chunk-produced",
                  chunkId: match.item.exponentId,
                  surfaceMatched: match.surfaceMatched,
                  observedAtMs
                }
              : {
                  kind: "chunk-encountered",
                  chunkId: match.item.exponentId,
                  surfaceMatched: match.surfaceMatched,
                  observedAtMs
                }
          });
          appliedObservations.push(observationEvent);
          await services.learnerStateReducer.apply({
            type: "observation",
            observationEvent
          });

          // 085.5: First-teach beat -- write teach-record and annotate the turn once.
          // 087.2: Also create function-level debt at introduction and record encounter paydown
          //   for every NPC chunk match (not just first-teach).
          const fnEntry = getInventoryCompetencyForExponent(
            match.item.exponentId,
            learner.targetLanguage
          );
          if (isNewCard && !teachLineWritten && fnEntry) {
            const alreadyTaught = await services.teachRecordStore.has(fnEntry.competencyId);
            if (!alreadyTaught) {
              await services.teachRecordStore.write({
                competencyId: fnEntry.competencyId,
                taughtAtMs: observedAtMs,
                realizingChunkId: match.item.exponentId
              });
              // THE FIRST-TEACH BEAT (085.5): the first classifier-matched
              // encounter of a chunk that realizes a communicative function.
              // That reasoning lives HERE, with the writer -- runtime-core
              // renders a label and a line of text and knows nothing about
              // functions, chunks or first encounters. The key is generic
              // ("dialogueTeachLine", not "sugarlang.teachLine") so the
              // conversation layer holds no plugin knowledge.
              writeDialogueTeachLine(normalizedTurn.annotations!, {
                label: fnEntry.displayName,
                text: `"${match.surfaceMatched}" is a ${fnEntry.displayName.toLowerCase()}.`
              });
              teachLineWritten = true;
              teachLineSurface = match.surfaceMatched;

              // 087.2: Create function-level debt at introduction.
              try {
                await services.ledgerStore.createDebt(fnEntry.competencyId, "competency", debtDayIndex);
                const debt = await services.ledgerStore.getDebt(fnEntry.competencyId);
                if (debt) {
                  void emitTelemetry(
                    telemetry,
                    createTelemetryEvent("debt.created", {
                      timestamp: observedAtMs,
                      conversationId,
                      sessionId,
                      turnId: traceTurnId,
                      itemId: fnEntry.competencyId,
                      itemKind: "competency",
                      createdDayIndex: debtDayIndex,
                      targetEncounters: debt.targetEncounters
                    })
                  );
                }
              } catch {
                // Debt ledger failure is non-fatal.
              }
            }
          }

          // 087.2: Record encounter paydown for all NPC chunk matches (not just first-teach).
          // Chunks that aren't associated with a function are skipped.
          if (!isPlayerTurn && fnEntry) {
            try {
              const entry = { npcDefinitionId: debtNpcId, sceneId, dayIndex: debtDayIndex };
              await services.ledgerStore.recordEncounter(fnEntry.competencyId, entry);
              const debt = await services.ledgerStore.getDebt(fnEntry.competencyId);
              if (debt) {
                const diverseCount = countDiverseEncounters(debt.encounters);
                void emitTelemetry(
                  telemetry,
                  createTelemetryEvent("debt.encounter", {
                    timestamp: observedAtMs,
                    conversationId,
                    sessionId,
                    turnId: traceTurnId,
                    itemId: fnEntry.competencyId,
                    itemKind: "competency",
                    npcDefinitionId: debtNpcId,
                    sceneId,
                    dayIndex: debtDayIndex,
                    diverseEncounterCountAfter: diverseCount,
                    targetEncounters: debt.targetEncounters,
                    debtPaid: diverseCount >= debt.targetEncounters
                  })
                );
              }
            } catch {
              // Debt ledger failure is non-fatal.
            }
          }
        }
      }

      const completedObjectiveNodeIds = execution.annotations[
        SUGARLANG_COMPLETED_OBJECTIVE_IDS_ANNOTATION
      ] as string[] | undefined;
      if (Array.isArray(completedObjectiveNodeIds)) {
        for (const active of execution.runtimeContext?.activeQuestObjectives?.objectives ?? []) {
          if (!completedObjectiveNodeIds.includes(active.nodeId)) {
            continue;
          }
          for (const entry of collectLemmasFromText(active.description, learner.targetLanguage)) {
            if (!entry.lemmaId) {
              continue;
            }
            const observationEvent = createObservationEvent({
              execution,
              lemma: {
                lemmaId: entry.lemmaId,
                lang: learner.targetLanguage
              },
              observation: {
                kind: "quest-success",
                objectiveNodeId: active.nodeId,
                observedAtMs
              }
            });
            appliedObservations.push(observationEvent);
            await services.learnerStateReducer.apply({
              type: "observation",
              observationEvent
            });
          }
        }
      }

      if (appliedObservations.length > 0) {
        // One hook for every apply site above: they all push here first. The
        // debug HUD shows the most recent one, which is what answers "did that
        // hover do anything" -- the grade is null for passive exposure, and
        // that null is the answer, not a missing value.
        const latest = appliedObservations[appliedObservations.length - 1];
        recordObservation({
          kind: latest.observation.kind,
          cardKey: latest.lemma.lemmaId,
          grade: observationToOutcome(latest.observation).receptiveGrade,
          observedAtMs: Date.now()
        });

        const updatedProfile = await services.learnerStore.getCurrentProfile();
        const observationSummary = appliedObservations.map((obs) => ({
          lemma: obs.lemma.lemmaId,
          kind: obs.observation.kind,
          card: updatedProfile.lemmaCards[obs.lemma.lemmaId]
            ? {
                stability: updatedProfile.lemmaCards[obs.lemma.lemmaId].stability.toFixed(2),
                difficulty: updatedProfile.lemmaCards[obs.lemma.lemmaId].difficulty.toFixed(2),
                reviewCount: updatedProfile.lemmaCards[obs.lemma.lemmaId].reviewCount,
                productiveStrength: updatedProfile.lemmaCards[obs.lemma.lemmaId].productiveStrength.toFixed(2)
              }
            : null
        }));

        logger.debug("Observer applied observations this turn.", {
          turn: traceTurnId,
          observations: observationSummary,
          learnerBand: updatedProfile.estimatedCefrBand,
          totalCards: Object.keys(updatedProfile.lemmaCards).length
        });

        await emitTelemetry(
          telemetry,
          createTelemetryEvent("observe.observations-applied", {
            conversationId,
            sessionId,
            turnId: traceTurnId,
            timestamp: Date.now(),
            sceneId,
            observations: appliedObservations,
            learnerDelta: {
              updatedLemmaIds: [
                ...new Set(
                  appliedObservations.map((event) => event.lemma.lemmaId)
                )
              ]
            }
          }),
          logger
        );
      }

      if (constraint.comprehensionCheckInFlight) {
        const probeId =
          (execution.annotations[
            SUGARLANG_COMPREHENSION_PROBE_ID_ANNOTATION
          ] as string | undefined) ?? `${traceTurnId}:probe`;
        const promptedAtMs = Date.now();
        await emitTelemetry(
          telemetry,
          createTelemetryEvent("comprehension.probe-fired", {
            conversationId,
            sessionId,
            turnId: traceTurnId,
            timestamp: promptedAtMs,
            probeId,
            sceneId,
            npcId: execution.selection.npcDefinitionId ?? null,
            npcDisplayName: execution.selection.npcDisplayName ?? null,
            targetLemmas: constraint.comprehensionCheckInFlight.targetLemmas,
            generatedText: normalizedTurn.text,
            probeQuestionExtract: extractProbeQuestion(normalizedTurn.text)
          }),
          logger
        );
        setStoredComprehensionCheck(execution, {
          probeId,
          targetLemmas: constraint.comprehensionCheckInFlight.targetLemmas,
          probeStyle: constraint.comprehensionCheckInFlight.probeStyle,
          characterVoiceReminder:
            constraint.comprehensionCheckInFlight.characterVoiceReminder,
          sceneId,
          npcId: execution.selection.npcDefinitionId ?? null,
          npcDisplayName: execution.selection.npcDisplayName ?? null,
          promptedAtMs,
          triggerReason: constraint.comprehensionCheckInFlight.triggerReason
        });
        setTurnsSinceLastProbe(execution, 0);
      } else {
        setTurnsSinceLastProbe(execution, getTurnsSinceLastProbe(execution) + 1);
      }

      // Write focus-term highlighting annotation onto the NPC turn so the
      // dialogue renderer can highlight target vocabulary and fire the star
      // celebration animation when the player produces a target lemma.
      const supportLang = execution.selection.supportLanguage ?? "en";

      // ONE BUILDER, shared with the build-time bake (grading/highlight-terms.ts).
      // Scripted lines carry precomputed terms on their variant; agent lines
      // compute them here. Same question, so it must not be two answers -- the
      // drift would be "this word highlights differently depending on whether
      // the line was baked", which nobody would think to test for.
      const highlightTerms = buildHighlightTerms({
        text: normalizedTurn.text,
        introduce: constraint.targetVocab.introduce,
        reinforce: constraint.targetVocab.reinforce,
        atlas: services.atlas,
        targetLanguage: learner.targetLanguage,
        supportLanguage: supportLang,
        chunkMatcher
      });
      const { introduceTerms, glosses, creditByTerm } = highlightTerms;

      // 085.5 first-teach beat: fires the first time a learner meets a
      // competency-realizing chunk, INDEPENDENT of the slate. Different question
      // from the builder above ("you have not seen this") vs ("the Teacher wants
      // this now"), so it is not a duplicate enforcer -- but both push here, and
      // the `includes` check is what keeps a phrase from being listed twice and
      // highlighted once, which would read as a lost term.
      if (teachLineSurface && !introduceTerms.includes(teachLineSurface)) {
        introduceTerms.push(teachLineSurface);
      }
      // Assembled AFTER the beat's push, so a term added there is scanned for.
      const focusTerms = focusTermsOf(highlightTerms);

      // 090.11/090.12: AMBIENT -- target language the slate never asked for.
      //
      // Everything above is derived from `constraint.targetVocab`, which is why
      // only the Teacher's chosen words were ever known to the system. A line
      // could be half Spanish and the annotation would describe two words of it.
      // This is the rest of it: found by lemmatizing the finished text against
      // the atlas and subtracting what the slate already explains.
      //
      // Not styled -- see the note on `ambientSpans`. It exists so a SELECTED
      // span can be resolved, and so the realized ratio becomes measurable.
      let ambientSpans: ReturnType<typeof findAmbientSpans> = [];
      try {
        ambientSpans = findAmbientSpans({
          text: normalizedTurn.text,
          targetLanguage: learner.targetLanguage,
          atlas: services.atlas,
          // The SHARED loader, not a fresh one. `MorphologyLoader` caches per
          // INSTANCE, so `new MorphologyLoader()` here meant re-running
          // `assertValidMorphologyData` over the whole morphology file on every
          // NPC turn -- the same trap `GradedTextService` documents at its own
          // constructor, and the reason a shared instance exists on services.
          morphology: services.morphology,
          slateTerms: focusTerms
          // properNouns intentionally omitted: the scene vocabulary model is not
          // resolved on this path, and passing none is the safe direction -- a
          // name may appear as an ambient span, but `lookupSelection` refuses to
          // gloss anything the atlas cannot answer, so no card is offered for it.
          // Wire the real list through when the marker owns this (090.11).
        });
      } catch {
        // Detection is an affordance, not a turn requirement. A failure here
        // must not cost the player their line.
      }

      // 090.7: the realization half of the trace. The teacher trace shows the
      // DECISION and runs before any text exists; this shows what the text
      // actually did with it, and calls out DISJOINT explicitly.
      // WHAT THE TEACHER ASKED FOR, not every surface it might take.
      // `focusTerms` is now the full paradigm of each slated word, so passing it
      // straight through made the trace claim the Teacher had asked for
      // `estaciones` and `problemas`. Group the terms back under the thing they
      // are a form OF, which `creditByTerm` already records.
      const formsByAsked = new Map<string, string[]>();
      for (const term of focusTerms) {
        const asked = creditByTerm[term] ?? term;
        const forms = formsByAsked.get(asked) ?? [];
        if (term !== asked) forms.push(term);
        formsByAsked.set(asked, forms);
      }
      traceRealization({
        npcDisplayName: execution.selection.npcDisplayName ?? null,
        text: normalizedTurn.text,
        slate: [...formsByAsked.entries()].map(([asked, forms]) => ({
          asked,
          forms
        })),
        ambientSurfaces: ambientSpans.map((span) => span.surface)
      });

      // The annotation is written when there is ANYTHING to say -- taught terms
      // OR ambient spans. Previously it required focus terms, so a line that was
      // all unrequested Spanish produced no annotation at all, which is exactly
      // the line a player most needs to be able to interrogate.
      // rf6.11.1: the annotation no longer carries `ambientSpans`, and no longer
      // gets written just because some exist.
      //
      // `readDialogueHighlight` never copied the field into its return value, so
      // nothing downstream could see it -- and an annotation whose `focusTerms`
      // was empty said "this line was examined and teaches nothing", which is a
      // different claim from "this line was not marked".
      //
      // The COMPUTATION stays: `traceRealization` below reads it to print
      // "target language nobody asked for", which is the diagnostic that tells a
      // disjoint line (slate ignored) from a line the generator had no room for.
      if (focusTerms.length > 0) {
        normalizedTurn.annotations!["dialogueHighlight"] = {
          focusTerms,
          introduceTerms,
          celebrateTerms: [],
          glosses,
          creditByTerm
        };
      }

      return normalizedTurn;
    }
  };
}
