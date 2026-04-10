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
import {
  PROVISIONAL_EVIDENCE_DECAY_TURN_THRESHOLD,
  PROVISIONAL_EVIDENCE_MAX
} from "../types";
import type { CardStore } from "./card-store";
import {
  computePointEstimate,
  seedCefrPosteriorFromSelfReport,
  updatePosterior
} from "./cefr-posterior";
import {
  computeFatigueScore
} from "./session-signals";
import {
  createEmptyLearnerProfile,
  loadLearnerProfile,
  saveLearnerProfile
} from "./persistence";
import {
  LEARNER_PROFILE_FACT,
  SUGARLANG_LEARNER_STATE_WRITER,
  SUGARLANG_PLACEMENT_STATUS_FACT,
  SUGARLANG_PLACEMENT_WRITER,
  createSugarlangPlacementStatusScope
} from "./fact-definitions";
import type { TelemetrySink } from "../telemetry/telemetry";

interface ReducerObservationEvent {
  type: "observation";
  observationEvent: ObservationEvent;
}

export interface PlacementCompletionEvent {
  type: "placement-completion";
  cefrBand: CEFRBand;
  confidence: number;
  completedAtMs: number;
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

export type ReducerEvent =
  | ReducerObservationEvent
  | PlacementCompletionEvent
  | SessionStartEvent
  | SessionEndEvent
  | SelfReportEvent
  | CommitProvisionalEvidenceEvent
  | DiscardProvisionalEvidenceEvent
  | DecayProvisionalEvidenceEvent;

export interface LearnerStateReducerOptions {
  profileId: LearnerId;
  playerEntityId: string;
  targetLanguage: string;
  supportLanguage: string;
  blackboard: RuntimeBlackboard;
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
  retryCount: number;
  totalResponseLatencyMs: number;
  latencySamples: number;
  lastObservedAtMs: number | null;
}

const NO_OP_TELEMETRY: TelemetrySink = {
  emit() {
    return undefined;
  }
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function cloneCard(card: LemmaCard): LemmaCard {
  return { ...card };
}

function createSessionAccumulator(profile: LearnerProfile): SessionAccumulator {
  const currentSession = profile.currentSession;
  if (!currentSession) {
    return {
      lastTurnId: null,
      turns: 0,
      lemmasSeen: 0,
      hoverCount: 0,
      retryCount: 0,
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
    retryCount: currentSession.retryRate * currentSession.turns,
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

function mapObservationToOutcome(event: ObservationEvent): ObservationOutcome {
  switch (event.observation.kind) {
    case "encountered":
      return {
        receptiveGrade: null,
        productiveStrengthDelta: 0,
        provisionalEvidenceDelta: 0
      };
    case "rapid-advance":
      return {
        receptiveGrade: null,
        productiveStrengthDelta: 0,
        provisionalEvidenceDelta: computeProvisionalEvidenceDelta(
          event.observation.dwellMs
        )
      };
    case "hovered":
      return {
        receptiveGrade: "Hard",
        productiveStrengthDelta: -0.05,
        provisionalEvidenceDelta: 0
      };
    case "quest-success":
      return {
        receptiveGrade: "Good",
        productiveStrengthDelta: 0,
        provisionalEvidenceDelta: 0
      };
    case "produced-chosen":
      return {
        receptiveGrade: "Good",
        productiveStrengthDelta: 0.15,
        provisionalEvidenceDelta: 0
      };
    case "produced-typed":
      return {
        receptiveGrade: "Easy",
        productiveStrengthDelta: 0.3,
        provisionalEvidenceDelta: 0
      };
    case "produced-unprompted":
      return {
        receptiveGrade: "Easy",
        productiveStrengthDelta: 0.5,
        provisionalEvidenceDelta: 0
      };
    case "produced-incorrect":
      return {
        receptiveGrade: "Again",
        productiveStrengthDelta: -0.2,
        provisionalEvidenceDelta: 0
      };
  }
}

function applyFsrsGrade(card: LemmaCard, grade: "Again" | "Hard" | "Good" | "Easy", reviewedAtMs: number): LemmaCard {
  const next = cloneCard(card);
  next.lastReviewedAt = reviewedAtMs;
  next.reviewCount += 1;

  switch (grade) {
    case "Again":
      next.difficulty = clamp(next.difficulty + 0.6, 1, 10);
      next.stability = clamp(next.stability * 0.65, 0.2, 365);
      next.retrievability = clamp(next.retrievability * 0.45, 0.05, 1);
      next.lapseCount += 1;
      break;
    case "Hard":
      next.difficulty = clamp(next.difficulty + 0.15, 1, 10);
      next.stability = clamp(next.stability * 1.05 + 0.15, 0.2, 365);
      next.retrievability = clamp(next.retrievability + 0.03, 0.05, 1);
      break;
    case "Good":
      next.difficulty = clamp(next.difficulty - 0.1, 1, 10);
      next.stability = clamp(next.stability * 1.25 + 0.35, 0.2, 365);
      next.retrievability = clamp(next.retrievability + 0.08, 0.05, 1);
      break;
    case "Easy":
      next.difficulty = clamp(next.difficulty - 0.2, 1, 10);
      next.stability = clamp(next.stability * 1.45 + 0.5, 0.2, 365);
      next.retrievability = clamp(next.retrievability + 0.12, 0.05, 1);
      break;
  }

  return next;
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
  }
}

export function computeProvisionalEvidenceDelta(dwellMs: number): number {
  return clamp(dwellMs / 10000, 0.05, 0.4);
}

export class LearnerStateReducer {
  private serialQueue = Promise.resolve();
  private readonly telemetry: TelemetrySink;
  private readonly sessionAccumulators = new Map<string, SessionAccumulator>();

  constructor(private readonly options: LearnerStateReducerOptions) {
    this.telemetry = options.telemetry ?? NO_OP_TELEMETRY;
  }

  async apply(event: ReducerEvent): Promise<void> {
    const pending = this.serialQueue.then(() => this.applyInternal(event));
    this.serialQueue = pending.catch(() => undefined);
    await pending;
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
          retryRate: 0,
          fatigueScore: 0
        };
        this.sessionAccumulators.set(event.sessionId, createSessionAccumulator(profile));
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
    }

    await saveLearnerProfile({
      blackboard: this.options.blackboard,
      playerEntityId: this.options.playerEntityId,
      profile,
      cardStore: this.options.cardStore,
      sourceSystem: LEARNER_PROFILE_FACT.ownerSystem,
      changedCards
    });
    await this.telemetry.emit("learner-profile.updated", {
      eventType: event.type,
      learnerId: this.options.profileId
    });
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
        retryRate: 0,
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
    if (observationEvent.observation.kind === "hovered") {
      accumulator.hoverCount += 1;
    }
    if (observationEvent.observation.kind === "produced-incorrect") {
      accumulator.retryCount += 1;
    }

    const existingCard = profile.lemmaCards[observationEvent.lemma.lemmaId];
    const seededCard =
      existingCard ??
      this.options.learnerPriorProvider.getInitialLemmaCard(
        observationEvent.lemma.lemmaId,
        observationEvent.lemma.lang,
        profile.estimatedCefrBand
      );
    let nextCard = cloneCard(seededCard);
    const outcome = mapObservationToOutcome(observationEvent);

    if (observationEvent.observation.kind === "rapid-advance") {
      nextCard.provisionalEvidence = clamp(
        nextCard.provisionalEvidence + outcome.provisionalEvidenceDelta,
        0,
        PROVISIONAL_EVIDENCE_MAX
      );
      if (nextCard.provisionalEvidenceFirstSeenTurn === null) {
        nextCard.provisionalEvidenceFirstSeenTurn = accumulator.turns;
      }
      await this.telemetry.emit("fsrs.provisional-evidence-accumulated", {
        lemmaId: nextCard.lemmaId,
        previousEvidence: seededCard.provisionalEvidence,
        nextEvidence: nextCard.provisionalEvidence,
        dwellMs: observationEvent.observation.dwellMs
      });
    } else if (outcome.receptiveGrade) {
      nextCard = applyFsrsGrade(
        nextCard,
        outcome.receptiveGrade,
        observationEvent.observation.observedAtMs
      );
    }

    nextCard.productiveStrength = clamp01(
      nextCard.productiveStrength + outcome.productiveStrengthDelta
    );
    if (outcome.productiveStrengthDelta > 0) {
      nextCard.lastProducedAtMs = observationEvent.observation.observedAtMs;
    }

    const success = computeObservationSuccess(outcome);
    if (success !== null) {
      profile.cefrPosterior = updatePosterior(
        profile.cefrPosterior,
        nextCard.cefrPriorBand,
        success
      );
      const pointEstimate = computePointEstimate(profile.cefrPosterior);
      profile.estimatedCefrBand = pointEstimate.band;
      if (profile.assessment.status !== "evaluated") {
        profile.assessment = {
          ...profile.assessment,
          status: "estimated",
          cefrConfidence: pointEstimate.confidence
        };
      }
    }

    currentSession.turns = accumulator.turns;
    currentSession.hoverRate =
      accumulator.lemmasSeen > 0 ? accumulator.hoverCount / accumulator.lemmasSeen : 0;
    currentSession.retryRate =
      accumulator.turns > 0 ? accumulator.retryCount / accumulator.turns : 0;
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
      let nextCard = applyFsrsGrade(card, "Good", event.committedAtMs);
      nextCard = {
        ...nextCard,
        provisionalEvidence: 0,
        provisionalEvidenceFirstSeenTurn: null
      };
      profile.lemmaCards[target.lemmaId] = nextCard;
      changedCards.push(nextCard);
      await this.telemetry.emit("fsrs.provisional-evidence-committed", {
        lemmaId: target.lemmaId,
        previousEvidence,
        stabilityDelta: nextCard.stability - beforeStability,
        probeTelemetry: event.probeTelemetry ?? null
      });
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

      const nextCard = {
        ...card,
        provisionalEvidence: 0,
        provisionalEvidenceFirstSeenTurn: null
      };
      profile.lemmaCards[target.lemmaId] = nextCard;
      changedCards.push(nextCard);
      await this.telemetry.emit("fsrs.provisional-evidence-discarded", {
        lemmaId: target.lemmaId,
        discardedEvidence: card.provisionalEvidence,
        probeTelemetry: event.probeTelemetry ?? null,
        discardedAtMs: event.discardedAtMs
      });
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
        if (
          card.provisionalEvidenceFirstSeenTurn === null ||
          event.currentSessionTurn - card.provisionalEvidenceFirstSeenTurn <=
            PROVISIONAL_EVIDENCE_DECAY_TURN_THRESHOLD
        ) {
          continue;
        }

        const nextCard = {
          ...card,
          provisionalEvidence: 0,
          provisionalEvidenceFirstSeenTurn: null
        };
        profile.lemmaCards[nextCard.lemmaId] = nextCard;
        changedCards.push(nextCard);
        await this.telemetry.emit("fsrs.provisional-evidence-decayed", {
          lemmaId: nextCard.lemmaId,
          decayedAtMs: event.decayedAtMs
        });
      }

      if (!page.nextCursor) {
        break;
      }
      cursor = page.nextCursor;
    }

    return changedCards;
  }
}
