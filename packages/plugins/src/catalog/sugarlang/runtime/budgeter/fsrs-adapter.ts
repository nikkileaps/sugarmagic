/**
 * packages/plugins/src/catalog/sugarlang/runtime/budgeter/fsrs-adapter.ts
 *
 * Purpose: Wraps the external ts-fsrs scheduler in sugarlang-owned card helpers.
 *
 * Exports:
 *   - PRODUCTIVE_DECAY_HALF_LIFE_DAYS
 *   - PRODUCTIVE_DECAY_LOW_STRENGTH_MULTIPLIER
 *   - PROVISIONAL_EVIDENCE_MAX
 *   - PROVISIONAL_EVIDENCE_DECAY_TURN_THRESHOLD
 *   - ProductiveDecayConfig
 *   - createFsrsEngine
 *   - lemmaCardToFsrsCard
 *   - fsrsCardToLemmaCard
 *   - applyOutcome
 *   - decayProductiveStrength
 *   - seedCardFromAtlas
 *   - commitProvisionalEvidence
 *   - discardProvisionalEvidence
 *   - decayProvisionalEvidence
 *
 * Relationships:
 *   - Depends on learner-profile and observation contract types plus the external ts-fsrs package.
 *   - Is consumed by the Budgeter, learner reducer, and learner-prior provider.
 *
 * Implements: Proposal 001 §1. Lexical Budgeter / §Why This Is Real ML at the Core
 *
 * Status: active
 */

import {
  State,
  createEmptyCard,
  fsrs,
  type Card as FsrsCard
} from "ts-fsrs";
import type {
  AtlasLemmaEntry,
  CEFRBand,
  LemmaCard,
  ObservationOutcome
} from "../types";
import {
  INITIAL_PRODUCTIVE_STRENGTH,
  INITIAL_PROVISIONAL_EVIDENCE,
  PROVISIONAL_EVIDENCE_DECAY_TURN_THRESHOLD,
  PROVISIONAL_EVIDENCE_MAX
} from "../types";
export {
  PROVISIONAL_EVIDENCE_DECAY_TURN_THRESHOLD,
  PROVISIONAL_EVIDENCE_MAX
} from "../types";

export const PRODUCTIVE_DECAY_HALF_LIFE_DAYS = 60;
export const PRODUCTIVE_DECAY_LOW_STRENGTH_MULTIPLIER = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ProductiveDecayConfig {
  halfLifeDays: number;
  lowStrengthMultiplier: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function getBandIndex(band: CEFRBand): number {
  switch (band) {
    case "A1":
      return 0;
    case "A2":
      return 1;
    case "B1":
      return 2;
    case "B2":
      return 3;
    case "C1":
      return 4;
    case "C2":
      return 5;
  }
}

function mapFsrsGrade(grade: ObservationOutcome["receptiveGrade"]): 1 | 2 | 3 | 4 {
  switch (grade) {
    case "Again":
      return 1;
    case "Hard":
      return 2;
    case "Good":
      return 3;
    case "Easy":
      return 4;
    case null:
      return 3;
  }
}

export function createFsrsEngine(options: { retention?: number } = {}) {
  return fsrs({
    request_retention: options.retention ?? 0.9,
    enable_fuzz: false,
    enable_short_term: false
  });
}

export function lemmaCardToFsrsCard(card: LemmaCard): FsrsCard {
  const base = createEmptyCard(new Date(card.lastReviewedAt ?? 0));

  return {
    ...base,
    due: new Date(card.lastReviewedAt ?? 0),
    stability: Math.max(0.1, card.stability),
    difficulty: clamp(card.difficulty, 1, 10),
    elapsed_days: 0,
    scheduled_days: Math.max(0, Math.round(card.stability)),
    learning_steps: 0,
    reps: card.reviewCount,
    lapses: card.lapseCount,
    state: State.Review,
    last_review: card.lastReviewedAt ? new Date(card.lastReviewedAt) : undefined
  };
}

export function fsrsCardToLemmaCard(
  fsrsCard: FsrsCard,
  previousCard: LemmaCard,
  now: number,
  engine = createFsrsEngine()
): LemmaCard {
  return {
    ...previousCard,
    difficulty: fsrsCard.difficulty,
    stability: fsrsCard.stability,
    retrievability: engine.get_retrievability(fsrsCard, new Date(now), false),
    lastReviewedAt: fsrsCard.last_review?.getTime() ?? now,
    reviewCount: fsrsCard.reps,
    lapseCount: fsrsCard.lapses
  };
}

export function applyOutcome(
  card: LemmaCard,
  outcome: ObservationOutcome,
  now = Date.now(),
  sessionTurn?: number
): LemmaCard {
  const engine = createFsrsEngine();
  let nextCard: LemmaCard = { ...card };

  if (outcome.receptiveGrade !== null) {
    const elapsedDays =
      card.lastReviewedAt === null ? 0 : Math.max(0, (now - card.lastReviewedAt) / DAY_MS);
    const nextState = engine.next_state(
      {
        stability: Math.max(0.1, card.stability),
        difficulty: clamp(card.difficulty, 1, 10)
      },
      elapsedDays,
      mapFsrsGrade(outcome.receptiveGrade),
      clamp(card.retrievability, 0.01, 0.999)
    );
    nextCard = {
      ...nextCard,
      difficulty: nextState.difficulty,
      stability: nextState.stability,
      retrievability: 1,
      lastReviewedAt: now,
      reviewCount: card.reviewCount + 1,
      lapseCount:
        card.lapseCount + (outcome.receptiveGrade === "Again" ? 1 : 0)
    };
  }

  nextCard.productiveStrength = clamp01(
    nextCard.productiveStrength + outcome.productiveStrengthDelta
  );
  if (outcome.productiveStrengthDelta > 0) {
    nextCard.lastProducedAtMs = now;
  }

  const previousEvidence = nextCard.provisionalEvidence;
  nextCard.provisionalEvidence = clamp(
    nextCard.provisionalEvidence + outcome.provisionalEvidenceDelta,
    0,
    PROVISIONAL_EVIDENCE_MAX
  );
  if (
    outcome.provisionalEvidenceDelta > 0 &&
    previousEvidence === 0 &&
    nextCard.provisionalEvidenceFirstSeenTurn === null &&
    typeof sessionTurn === "number"
  ) {
    nextCard.provisionalEvidenceFirstSeenTurn = sessionTurn;
  }

  return nextCard;
}

export function decayProductiveStrength(
  card: LemmaCard,
  now: number,
  config: ProductiveDecayConfig = {
    halfLifeDays: PRODUCTIVE_DECAY_HALF_LIFE_DAYS,
    lowStrengthMultiplier: PRODUCTIVE_DECAY_LOW_STRENGTH_MULTIPLIER
  }
): LemmaCard {
  if (card.lastProducedAtMs === null || card.productiveStrength <= 0) {
    return { ...card };
  }

  const elapsedDays = Math.max(0, (now - card.lastProducedAtMs) / DAY_MS);
  const halfLifeDays =
    config.halfLifeDays *
    (1 + (1 - card.productiveStrength) * (config.lowStrengthMultiplier - 1));
  const decayedStrength =
    card.productiveStrength * 0.5 ** (elapsedDays / Math.max(0.1, halfLifeDays));

  return {
    ...card,
    productiveStrength: clamp01(decayedStrength)
  };
}

export function seedCardFromAtlas(
  lemmaId: string,
  lang: string,
  atlasEntry: Pick<AtlasLemmaEntry, "cefrPriorBand" | "cefrPriorSource">,
  learnerBand: CEFRBand
): LemmaCard {
  const bandDelta = getBandIndex(atlasEntry.cefrPriorBand) - getBandIndex(learnerBand);

  return {
    lemmaId,
    difficulty: clamp(3 + bandDelta * 0.75, 1, 8),
    stability: clamp(2.4 - bandDelta * 0.35, 0.4, 5),
    retrievability: clamp(0.82 - bandDelta * 0.08, 0.2, 0.97),
    lastReviewedAt: null,
    reviewCount: 0,
    lapseCount: 0,
    cefrPriorBand: atlasEntry.cefrPriorBand,
    priorWeight: atlasEntry.cefrPriorSource === "frequency-derived" ? 0.8 : 1,
    productiveStrength: INITIAL_PRODUCTIVE_STRENGTH,
    lastProducedAtMs: null,
    provisionalEvidence: INITIAL_PROVISIONAL_EVIDENCE,
    provisionalEvidenceFirstSeenTurn: null
  };
}

export function commitProvisionalEvidence(
  card: LemmaCard,
  now = Date.now()
): LemmaCard {
  if (card.provisionalEvidence <= 0) {
    return { ...card };
  }

  const committed = applyOutcome(
    card,
    {
      receptiveGrade: "Good",
      productiveStrengthDelta: 0,
      provisionalEvidenceDelta: 0
    },
    now
  );

  return {
    ...committed,
    provisionalEvidence: 0,
    provisionalEvidenceFirstSeenTurn: null
  };
}

export function discardProvisionalEvidence(card: LemmaCard): LemmaCard {
  return {
    ...card,
    provisionalEvidence: 0,
    provisionalEvidenceFirstSeenTurn: null
  };
}

export function decayProvisionalEvidence(
  card: LemmaCard,
  currentSessionTurn: number
): LemmaCard {
  if (
    card.provisionalEvidenceFirstSeenTurn === null ||
    currentSessionTurn - card.provisionalEvidenceFirstSeenTurn <=
      PROVISIONAL_EVIDENCE_DECAY_TURN_THRESHOLD
  ) {
    return { ...card };
  }

  return {
    ...card,
    provisionalEvidence: 0,
    provisionalEvidenceFirstSeenTurn: null
  };
}
