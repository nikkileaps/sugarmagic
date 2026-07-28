/**
 * packages/plugins/src/catalog/sugarlang/runtime/learner/learner-state-reducer.ts
 *
 * Purpose: Implements the single-writer learner-state reducer for sugarlang.
 *
 * Exports:
 *   - ReducerEvent
 *   - LearnerStateReducer
 *
 * Relationships:
 *   - Depends on learner persistence, the learner-prior provider, and sugarlang-owned blackboard facts.
 *   - Is consumed by later middleware work as the only supported learner-profile mutation path.
 *
 * Implements: Proposal 001 §Learner State Model / §Observer Latency Bias and In-Character Comprehension Checks
 *
 * Status: active
 */

import {
  type RuntimeBlackboard
} from "@sugarmagic/runtime-core";
import type {
  CEFRBand,
  LearnerId,
  LearnerPriorProvider,
  LearnerProfile,
  LemmaCard,
  LemmaRef,
  LexicalAtlasProvider,
  ObservationEvent,
  ObservationOutcome
} from "../types";
import type { CardStore } from "./card-store";
import {
  CEFR_BAND_ORDER,
  computeEvidenceShare,
  computePointEstimate,
  seedCefrPosteriorFromPlacement,
  seedCefrPosteriorFromSelfReport,
  updatePosterior
} from "./cefr-posterior";
import {
  CALIBRATION_CONFIDENCE_CEILING,
  CALIBRATION_OBSERVATION_WEIGHT,
  isInPostPlacementCalibration
} from "./calibration-window";
import {
  computeFatigueScore,
  computeProbeFailRate
} from "./session-signals";
import {
  createEmptyLearnerProfile,
  loadLearnerProfile,
  saveLearnerProfile
} from "./persistence";
import {
  LEARNER_PROFILE_FACT,
  SUGARLANG_PLACEMENT_STATUS_FACT,
  SUGARLANG_PLACEMENT_WRITER,
  createSugarlangPlacementStatusScope
} from "./fact-definitions";
import {
  createNoOpTelemetrySink,
  createTelemetryEvent,
  emitTelemetry,
  type TelemetrySink
} from "../telemetry/telemetry";
import { observationToOutcome } from "../budgeter/observations";
import {
  applyOutcome,
  commitProvisionalEvidence as commitCardProvisionalEvidence,
  decayProvisionalEvidence as decayCardProvisionalEvidence,
  discardProvisionalEvidence as discardCardProvisionalEvidence
} from "../budgeter/fsrs-adapter";

interface ReducerObservationEvent {
  type: "observation";
  observationEvent: ObservationEvent;
}

export interface PlacementCompletionEvent {
  type: "placement-completion";
  cefrBand: CEFRBand;
  confidence: number;
  completedAtMs: number;
  lemmasSeededFromFreeText: LemmaRef[];
}

export interface SessionStartEvent {
  type: "session-start";
  sessionId: string;
  startedAtMs: number;
}

export interface SessionEndEvent {
  type: "session-end";
  completedAtMs: number;
}

export interface SelfReportEvent {
  type: "self-report";
  band: CEFRBand;
}

export interface CommitProvisionalEvidenceEvent {
  type: "commit-provisional-evidence";
  targetLemmas: LemmaRef[];
  committedAtMs: number;
  probeTelemetry?: Record<string, unknown>;
}

export interface DiscardProvisionalEvidenceEvent {
  type: "discard-provisional-evidence";
  targetLemmas: LemmaRef[];
  discardedAtMs: number;
  probeTelemetry?: Record<string, unknown>;
}

export interface DecayProvisionalEvidenceEvent {
  type: "decay-provisional-evidence";
  currentSessionTurn: number;
  decayedAtMs: number;
}

/**
 * 087.4: Records a comprehension probe outcome into the session accumulator so that
 * probe failures feed the rolling strain estimate (probeFailRate in fatigueScore).
 */
export interface RecordProbeOutcomeEvent {
  type: "record-probe-outcome";
  /** True = all target lemmas passed. False = at least one failed (full-fail or mixed). */
  passed: boolean;
}

export type ReducerEvent =
  | ReducerObservationEvent
  | PlacementCompletionEvent
  | SessionStartEvent
  | SessionEndEvent
  | SelfReportEvent
  | CommitProvisionalEvidenceEvent
  | DiscardProvisionalEvidenceEvent
  | DecayProvisionalEvidenceEvent
  | RecordProbeOutcomeEvent;

export interface LearnerStateReducerOptions {
  profileId: LearnerId;
  playerEntityId: string;
  targetLanguage: string;
  supportLanguage: string;
  blackboard: RuntimeBlackboard;
  /** When provided and returns a non-null band, posterior and estimatedCefrBand
   *  updates are suppressed during observations (band stays pinned). FSRS card
   *  scheduling and session accumulators are unaffected. Debug-only. */
  debugPinnedBand?: () => CEFRBand | null;
  cardStore: CardStore;
  atlas: LexicalAtlasProvider;
  learnerPriorProvider: LearnerPriorProvider;
  telemetry?: TelemetrySink;
}

interface SessionAccumulator {
  lastTurnId: string | null;
  turns: number;
  lemmasSeen: number;
  hoverCount: number;
  /** 087.4: number of probes where at least one lemma failed (replaces retryCount). */
  probeFailCount: number;
  /** 087.4: total probes attempted this session (denominator for probeFailRate). */
  probeCount: number;
  totalResponseLatencyMs: number;
  latencySamples: number;
  lastObservedAtMs: number | null;
}

function createSessionAccumulator(profile: LearnerProfile): SessionAccumulator {
  const currentSession = profile.currentSession;
  if (!currentSession) {
    return {
      lastTurnId: null,
      turns: 0,
      lemmasSeen: 0,
      hoverCount: 0,
      probeFailCount: 0,
      probeCount: 0,
      totalResponseLatencyMs: 0,
      latencySamples: 0,
      lastObservedAtMs: null
    };
  }

  return {
    lastTurnId: null,
    turns: currentSession.turns,
    lemmasSeen: currentSession.turns,
    hoverCount: currentSession.hoverRate * currentSession.turns,
    // probeFailCount / probeCount cannot be reconstructed without probeCount.
    // Start fresh on session resume; the persisted fatigueScore captures prior strain.
    probeFailCount: 0,
    probeCount: 0,
    totalResponseLatencyMs: currentSession.avgResponseLatencyMs * currentSession.turns,
    latencySamples: currentSession.turns,
    lastObservedAtMs: null
  };
}

function createSeedProfile(options: LearnerStateReducerOptions): LearnerProfile {
  return {
    ...createEmptyLearnerProfile({
      learnerId: options.profileId,
      targetLanguage: options.targetLanguage,
      supportLanguage: options.supportLanguage
    }),
    cefrPosterior: options.learnerPriorProvider.getCefrInitialPosterior()
  };
}

function computeObservationSuccess(outcome: ObservationOutcome): boolean | null {
  switch (outcome.receptiveGrade) {
    case "Good":
    case "Easy":
      return true;
    case "Again":
    case "Hard":
      return false;
    case null:
      return null;
    default:
      return null;
  }
}

export class LearnerStateReducer {
  private serialQueue = Promise.resolve();
  private readonly telemetry: TelemetrySink;
  private readonly sessionAccumulators = new Map<string, SessionAccumulator>();

  constructor(private readonly options: LearnerStateReducerOptions) {
    this.telemetry = options.telemetry ?? createNoOpTelemetrySink();
  }

  async apply(event: ReducerEvent): Promise<void> {
    const pending = this.serialQueue.then(() => this.applyInternal(event));
    this.serialQueue = pending.catch(() => undefined);
    await pending;
  }

  /**
   * Drops every in-memory session accumulator (turn counts, latency /
   * hover / retry running sums). Called by the debug reset path so a wiped
   * learner does not inherit the previous session's signals.
   */
  resetSessionAccumulators(): void {
    this.sessionAccumulators.clear();
  }

  private async applyInternal(event: ReducerEvent): Promise<void> {
    const profile = await loadLearnerProfile({
      blackboard: this.options.blackboard,
      playerEntityId: this.options.playerEntityId,
      cardStore: this.options.cardStore,
      fallbackProfile: createSeedProfile(this.options)
    });
    const changedCards: LemmaCard[] = [];

    switch (event.type) {
      case "session-start":
        profile.currentSession = {
          sessionId: event.sessionId,
          startedAt: event.startedAtMs,
          turns: 0,
          avgResponseLatencyMs: 0,
          hoverRate: 0,
          probeFailRate: 0,
          fatigueScore: 0
        };
        this.sessionAccumulators.set(event.sessionId, createSessionAccumulator(profile));
        await emitTelemetry(
          this.telemetry,
          createTelemetryEvent("session.started", {
            sessionId: event.sessionId,
            timestamp: event.startedAtMs,
            learnerId: this.options.profileId
          })
        );
        break;
      case "session-end":
        if (profile.currentSession) {
          profile.sessionHistory = [
            ...profile.sessionHistory,
            {
              sessionId: profile.currentSession.sessionId,
              startedAt: profile.currentSession.startedAt,
              completedAt: event.completedAtMs,
              turns: profile.currentSession.turns
            }
          ].slice(-20);
          await emitTelemetry(
            this.telemetry,
            createTelemetryEvent("session.ended", {
              sessionId: profile.currentSession.sessionId,
              timestamp: event.completedAtMs,
              learnerId: this.options.profileId,
              completedAtMs: event.completedAtMs
            })
          );
          this.sessionAccumulators.delete(profile.currentSession.sessionId);
          profile.currentSession = null;
        }
        break;
      case "self-report":
        profile.cefrPosterior = seedCefrPosteriorFromSelfReport(event.band);
        profile.estimatedCefrBand = event.band;
        profile.assessment = {
          ...profile.assessment,
          status: "estimated",
          evaluatedCefrBand: null,
          cefrConfidence: computePointEstimate(profile.cefrPosterior).confidence,
          evaluatedAtMs: null
        };
        break;
      case "placement-completion":
        profile.assessment = {
          status: "evaluated",
          evaluatedCefrBand: event.cefrBand,
          cefrConfidence: event.confidence,
          evaluatedAtMs: event.completedAtMs
        };
        profile.estimatedCefrBand = event.cefrBand;
        // 081.4: the calibration window starts from what placement actually
        // concluded, not from whatever self-report seeded.
        profile.cefrPosterior = seedCefrPosteriorFromPlacement(
          event.cefrBand,
          event.confidence
        );
        this.options.blackboard.setFact({
          definition: SUGARLANG_PLACEMENT_STATUS_FACT,
          scope: createSugarlangPlacementStatusScope(this.options.profileId),
          value: {
            status: "completed",
            cefrBand: event.cefrBand,
            confidence: event.confidence,
            completedAt: event.completedAtMs
          },
          sourceSystem: SUGARLANG_PLACEMENT_WRITER
        });
        for (const lemma of event.lemmasSeededFromFreeText) {
          const existingCard = profile.lemmaCards[lemma.lemmaId];
          const seededCard =
            existingCard ??
            this.options.learnerPriorProvider.getInitialLemmaCard(
              lemma.lemmaId,
              lemma.lang,
              event.cefrBand
            );
          const nextCard = applyOutcome(
            seededCard,
            observationToOutcome({
              kind: "produced-typed",
              inputText: lemma.surfaceForm ?? lemma.lemmaId,
              observedAtMs: event.completedAtMs
            }),
            event.completedAtMs,
            profile.currentSession?.turns ?? 0
          );
          profile.lemmaCards[nextCard.lemmaId] = nextCard;
          changedCards.push(nextCard);
          await emitTelemetry(
            this.telemetry,
            createTelemetryEvent("fsrs.seeded-from-placement", {
              sessionId: profile.currentSession?.sessionId,
              timestamp: event.completedAtMs,
              lemmaId: nextCard.lemmaId,
              cefrBand: event.cefrBand,
              completedAtMs: event.completedAtMs
            })
          );
        }
        break;
      case "observation":
        changedCards.push(
          await this.applyObservation(profile, event.observationEvent)
        );
        break;
      case "commit-provisional-evidence":
        changedCards.push(
          ...(await this.commitProvisionalEvidence(profile, event))
        );
        break;
      case "discard-provisional-evidence":
        changedCards.push(
          ...(await this.discardProvisionalEvidence(profile, event))
        );
        break;
      case "decay-provisional-evidence":
        changedCards.push(
          ...(await this.decayProvisionalEvidence(profile, event))
        );
        break;
      case "record-probe-outcome": {
        // 087.4: fold probe outcomes into the session accumulator so they feed fatigueScore.
        const currentSession = profile.currentSession;
        if (currentSession) {
          const accumulator =
            this.sessionAccumulators.get(currentSession.sessionId) ??
            createSessionAccumulator(profile);
          accumulator.probeCount += 1;
          if (!event.passed) {
            accumulator.probeFailCount += 1;
          }
          this.sessionAccumulators.set(currentSession.sessionId, accumulator);
          currentSession.probeFailRate = computeProbeFailRate(
            accumulator.probeFailCount,
            accumulator.probeCount
          );
          currentSession.fatigueScore = computeFatigueScore(currentSession);
        }
        break;
      }
    }

    await saveLearnerProfile({
      blackboard: this.options.blackboard,
      playerEntityId: this.options.playerEntityId,
      profile,
      cardStore: this.options.cardStore,
      sourceSystem: LEARNER_PROFILE_FACT.ownerSystem,
      changedCards
    });
    await emitTelemetry(
      this.telemetry,
      createTelemetryEvent("learner-profile.updated", {
        sessionId: profile.currentSession?.sessionId,
        timestamp: Date.now(),
        eventType: event.type,
        learnerId: this.options.profileId
      })
    );
  }

  private async applyObservation(
    profile: LearnerProfile,
    observationEvent: ObservationEvent
  ): Promise<LemmaCard> {
    const currentSession =
      profile.currentSession ??
      {
        sessionId: observationEvent.context.sessionId,
        startedAt: observationEvent.observation.observedAtMs,
        turns: 0,
        avgResponseLatencyMs: 0,
        hoverRate: 0,
        probeFailRate: 0,
        fatigueScore: 0
      };
    profile.currentSession = currentSession;

    const accumulator =
      this.sessionAccumulators.get(currentSession.sessionId) ??
      createSessionAccumulator(profile);
    if (accumulator.lastTurnId !== observationEvent.context.turnId) {
      accumulator.turns += 1;
      accumulator.lastTurnId = observationEvent.context.turnId;
      if (accumulator.lastObservedAtMs !== null) {
        accumulator.totalResponseLatencyMs +=
          observationEvent.observation.observedAtMs - accumulator.lastObservedAtMs;
        accumulator.latencySamples += 1;
      }
    }
    accumulator.lastObservedAtMs = observationEvent.observation.observedAtMs;
    accumulator.lemmasSeen += 1;
    if (
      observationEvent.observation.kind === "hovered" ||
      observationEvent.observation.kind === "hovered-introduce"
    ) {
      accumulator.hoverCount += 1;
    }
    // produced-incorrect has no producers repo-wide (087.4 decision: retryRate dropped).
    // Probe outcomes are fed via record-probe-outcome events instead.

    const existingCard = profile.lemmaCards[observationEvent.lemma.lemmaId];
    const seededCard =
      existingCard ??
      this.options.learnerPriorProvider.getInitialLemmaCard(
        observationEvent.lemma.lemmaId,
        observationEvent.lemma.lang,
        profile.estimatedCefrBand
      );
    const outcome = observationToOutcome(observationEvent.observation);
    const nextCard = applyOutcome(
      seededCard,
      outcome,
      observationEvent.observation.observedAtMs,
      accumulator.turns
    );

    if (observationEvent.observation.kind === "rapid-advance") {
      await emitTelemetry(
        this.telemetry,
        createTelemetryEvent("fsrs.provisional-evidence-accumulated", {
          sessionId: currentSession.sessionId,
          turnId: observationEvent.context.turnId,
          conversationId: observationEvent.context.conversationId,
          timestamp: observationEvent.observation.observedAtMs,
          lemmaId: nextCard.lemmaId,
          previousEvidence: seededCard.provisionalEvidence,
          newEvidence: nextCard.provisionalEvidence,
          dwellMs: observationEvent.observation.dwellMs,
          sessionTurn: accumulator.turns
        })
      );
    }

    // Window state BEFORE this observation's turn count lands: a backstop
    // expiry on this very turn must still read as a close transition when
    // the close event is emitted below.
    const wasInCalibrationWindow = isInPostPlacementCalibration(profile);
    // Turns must be current before the calibration-window predicate reads them.
    currentSession.turns = accumulator.turns;

    const success = computeObservationSuccess(outcome);
    if (success !== null && !this.options.debugPinnedBand?.()) {
      // 081.4: during the post-placement calibration window, observations
      // carry elevated weight and confidence is recomputed from evidence
      // share, so the window closes on evidence with the turn backstop as
      // ceiling. Outside the window, evaluated confidence stays frozen.
      // When debugPinnedBand is active the block above is skipped to keep
      // the estimated band stable during automated verification sessions.
      const inCalibrationWindow = isInPostPlacementCalibration(profile);
      profile.cefrPosterior = updatePosterior(
        profile.cefrPosterior,
        nextCard.cefrPriorBand,
        success,
        inCalibrationWindow ? CALIBRATION_OBSERVATION_WEIGHT : 1
      );
      const pointEstimate = computePointEstimate(profile.cefrPosterior);
      profile.estimatedCefrBand = pointEstimate.band;
      if (profile.assessment.status !== "evaluated") {
        profile.assessment = {
          ...profile.assessment,
          status: "estimated",
          cefrConfidence: pointEstimate.confidence
        };
      } else if (inCalibrationWindow) {
        const settledConfidence = computeEvidenceShare(
          profile.cefrPosterior,
          pointEstimate.band
        );
        profile.assessment = {
          ...profile.assessment,
          cefrConfidence: settledConfidence
        };
      }
    }

    // Close-event emission sits outside the graded-observation block: a
    // turn-backstop close can land on a turn whose observation is ungraded
    // (success === null) and must still emit, and the window predicate must
    // be compared against its pre-turn state or backstop expiries on this
    // very turn read as "never open" and stay silent.
    if (wasInCalibrationWindow && !isInPostPlacementCalibration(profile)) {
      const placementBand =
        profile.assessment.evaluatedCefrBand ?? profile.estimatedCefrBand;
      const settledConfidence = profile.assessment.cefrConfidence;
      await emitTelemetry(
        this.telemetry,
        createTelemetryEvent("calibration.window-closed", {
          sessionId: currentSession.sessionId,
          turnId: observationEvent.context.turnId,
          conversationId: observationEvent.context.conversationId,
          timestamp: observationEvent.observation.observedAtMs,
          closeReason:
            settledConfidence >= CALIBRATION_CONFIDENCE_CEILING
              ? "confidence"
              : "turn-backstop",
          placementBand,
          settledBand: profile.estimatedCefrBand,
          bandDelta:
            CEFR_BAND_ORDER.indexOf(profile.estimatedCefrBand) -
            CEFR_BAND_ORDER.indexOf(placementBand),
          settledConfidence,
          sessionTurn: accumulator.turns
        })
      );
    }

    currentSession.hoverRate =
      accumulator.lemmasSeen > 0 ? accumulator.hoverCount / accumulator.lemmasSeen : 0;
    currentSession.probeFailRate = computeProbeFailRate(
      accumulator.probeFailCount,
      accumulator.probeCount
    );
    currentSession.avgResponseLatencyMs =
      accumulator.latencySamples > 0
        ? accumulator.totalResponseLatencyMs / accumulator.latencySamples
        : 0;
    currentSession.fatigueScore = computeFatigueScore(currentSession);

    this.sessionAccumulators.set(currentSession.sessionId, accumulator);
    profile.lemmaCards[nextCard.lemmaId] = nextCard;
    return nextCard;
  }

  private async commitProvisionalEvidence(
    profile: LearnerProfile,
    event: CommitProvisionalEvidenceEvent
  ): Promise<LemmaCard[]> {
    const changedCards: LemmaCard[] = [];

    for (const target of event.targetLemmas) {
      const card = profile.lemmaCards[target.lemmaId];
      if (!card || card.provisionalEvidence <= 0) {
        continue;
      }

      const previousEvidence = card.provisionalEvidence;
      const beforeStability = card.stability;
      const nextCard = commitCardProvisionalEvidence(card, event.committedAtMs);
      profile.lemmaCards[target.lemmaId] = nextCard;
      changedCards.push(nextCard);
      await emitTelemetry(
        this.telemetry,
        createTelemetryEvent("fsrs.provisional-evidence-committed", {
          sessionId: profile.currentSession?.sessionId,
          timestamp: event.committedAtMs,
          probeId:
            typeof event.probeTelemetry?.probeId === "string"
              ? event.probeTelemetry.probeId
              : null,
          lemmaId: target.lemmaId,
          committedAmount: previousEvidence,
          previousStability: beforeStability,
          newStability: nextCard.stability
        })
      );
    }

    return changedCards;
  }

  private async discardProvisionalEvidence(
    profile: LearnerProfile,
    event: DiscardProvisionalEvidenceEvent
  ): Promise<LemmaCard[]> {
    const changedCards: LemmaCard[] = [];

    for (const target of event.targetLemmas) {
      const card = profile.lemmaCards[target.lemmaId];
      if (!card || card.provisionalEvidence <= 0) {
        continue;
      }

      const nextCard = discardCardProvisionalEvidence(card);
      profile.lemmaCards[target.lemmaId] = nextCard;
      changedCards.push(nextCard);
      await emitTelemetry(
        this.telemetry,
        createTelemetryEvent("fsrs.provisional-evidence-discarded", {
          sessionId: profile.currentSession?.sessionId,
          timestamp: event.discardedAtMs,
          probeId:
            typeof event.probeTelemetry?.probeId === "string"
              ? event.probeTelemetry.probeId
              : null,
          lemmaId: target.lemmaId,
          discardedAmount: card.provisionalEvidence
        })
      );
    }

    return changedCards;
  }

  private async decayProvisionalEvidence(
    profile: LearnerProfile,
    event: DecayProvisionalEvidenceEvent
  ): Promise<LemmaCard[]> {
    const changedCards: LemmaCard[] = [];
    let cursor: string | null = null;

    while (true) {
      const page = await this.options.cardStore.listPage(cursor);
      for (const card of page.cards) {
        const nextCard = decayCardProvisionalEvidence(card, event.currentSessionTurn);
        if (nextCard.provisionalEvidence === card.provisionalEvidence) {
          continue;
        }
        profile.lemmaCards[nextCard.lemmaId] = nextCard;
        changedCards.push(nextCard);
        await emitTelemetry(
          this.telemetry,
          createTelemetryEvent("fsrs.provisional-evidence-decayed", {
            sessionId: profile.currentSession?.sessionId,
            timestamp: event.decayedAtMs,
            lemmaId: nextCard.lemmaId,
            decayedAmount: Math.max(
              0,
              card.provisionalEvidence - nextCard.provisionalEvidence
            ),
            turnsPending:
              card.provisionalEvidenceFirstSeenTurn === null
                ? undefined
                : Math.max(
                    0,
                    event.currentSessionTurn - card.provisionalEvidenceFirstSeenTurn
                  )
          })
        );
      }

      if (!page.nextCursor) {
        break;
      }
      cursor = page.nextCursor;
    }

    return changedCards;
  }
}
