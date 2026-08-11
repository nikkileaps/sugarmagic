/**
 * packages/plugins/src/catalog/sugarlang/runtime/learner/persistence.ts
 *
 * Purpose: Implements learner-profile serialization plus save/load helpers that split card persistence from profile serialization.
 *
 * Exports:
 *   - PersistedLearnerProfileCore
 *   - createEmptyLearnerProfile
 *   - cloneLearnerProfile
 *   - serializeLearnerProfile
 *   - deserializeLearnerProfile
 *   - loadLearnerProfile
 *   - saveLearnerProfile
 *
 * Relationships:
 *   - Depends on the learner-profile contract, the card-store abstraction, and sugarlang-owned blackboard facts.
 *   - Is consumed by the learner reducer and BlackboardLearnerStore.
 *
 * Implements: Proposal 001 §Learner State Model
 *
 * Status: active
 */

import {
  createBlackboardScope,
  type RuntimeBlackboard
} from "@sugarmagic/runtime-core";
import type {
  CEFRBand,
  LearnerId,
  LearnerProfile,
  LemmaCard
} from "../types";
import { createUniformCefrPosterior } from "./cefr-posterior";
import { decayedRetrievability } from "./fsrs-adapter";
import {
  CARD_STORE_PAGE_SIZE,
  type CardStore
} from "./card-store";
import { LEARNER_PROFILE_FACT } from "./fact-definitions";

/**
 * The profile without the two things that are not stored state.
 *
 * `lemmaCards` are rows of their own in the same store. `learnerId` is DERIVED
 * IDENTITY -- the account, the player definition and the language pair joined
 * together -- so every reader already holds each part and stamps it on load.
 * Storing it means keeping a second copy of something that cannot disagree
 * without being wrong, and it did: the remote round trip rebuilt it from the
 * record key and handed back a learner called "core".
 */
export type PersistedLearnerProfileCore = Omit<
  LearnerProfile,
  "lemmaCards" | "learnerId"
>;

interface LoadLearnerProfileOptions {
  blackboard: RuntimeBlackboard;
  playerEntityId: string;
  cardStore: CardStore;
  /**
   * Where the profile CORE durably lives (Plan 092.6.4) -- the level, the
   * placement record, everything that is not a word.
   *
   * The blackboard below is memory for the life of the tab, so without this a
   * returning player is re-placed every session. Absent in tests and in a
   * browser with no storage, which behaves exactly as it did before.
   */
  profileStore?: LearnerProfileCoreStore;
  fallbackProfile: LearnerProfile;
  /**
   * Injectable clock, for decay.
   *
   * Retrievability falls with elapsed time and the intervals are days, so a
   * test that cannot move the clock cannot check any of it. Watching a session
   * proves nothing either way -- the movement inside one is real and far too
   * small to see.
   */
  now?: number;
}

interface SaveLearnerProfileOptions {
  blackboard: RuntimeBlackboard;
  playerEntityId: string;
  profile: LearnerProfile;
  cardStore: CardStore;
  /** See LoadLearnerProfileOptions. */
  profileStore?: LearnerProfileCoreStore;
  sourceSystem: string;
  changedCards?: LemmaCard[];
}

/**
 * The slice of an account store this module needs. Narrowed to two methods so
 * a test can supply a plain object, and so nothing here depends on how the
 * store is backed or whether it syncs.
 */
export interface LearnerProfileCoreStore {
  get: (key: string) => Promise<PersistedLearnerProfileCore | undefined>;
  put: (key: string, data: PersistedLearnerProfileCore) => Promise<void>;
}

/**
 * One learner has one core record. A fixed key rather than a generated one:
 * the store is already scoped to the account and the language pair, so there
 * is nothing left to distinguish.
 */
export const LEARNER_PROFILE_CORE_KEY = "core";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCefrBand(value: unknown): value is CEFRBand {
  return value === "A1" || value === "A2" || value === "B1" || value === "B2" || value === "C1" || value === "C2";
}

function cloneCard(card: LemmaCard): LemmaCard {
  return { ...card };
}

/** Deep-copies everything that is stored, which is neither the cards nor the
 *  derived learner id -- see `PersistedLearnerProfileCore`. */
function toPersistedCore(profile: LearnerProfile): PersistedLearnerProfileCore {
  const { lemmaCards: _lemmaCards, learnerId: _learnerId, ...core } = profile;
  return {
    ...core,
    currentSession: core.currentSession ? { ...core.currentSession } : null,
    assessment: { ...core.assessment },
    sessionHistory: core.sessionHistory.map((session) => ({ ...session })),
    cefrPosterior: Object.fromEntries(
      Object.entries(core.cefrPosterior).map(([band, weight]) => [band, { ...weight }])
    ) as LearnerProfile["cefrPosterior"]
  };
}

export function cloneLearnerProfile(profile: LearnerProfile): LearnerProfile {
  return {
    ...toPersistedCore(profile),
    learnerId: profile.learnerId,
    lemmaCards: Object.fromEntries(
      Object.entries(profile.lemmaCards).map(([lemmaId, card]) => [lemmaId, cloneCard(card)])
    )
  };
}

export function createEmptyLearnerProfile(options: {
  learnerId: LearnerId;
  targetLanguage: string;
  supportLanguage: string;
  estimatedCefrBand?: CEFRBand;
}): LearnerProfile {
  const estimatedCefrBand = options.estimatedCefrBand ?? "A1";

  return {
    learnerId: options.learnerId,
    targetLanguage: options.targetLanguage,
    supportLanguage: options.supportLanguage,
    assessment: {
      status: "unassessed",
      evaluatedCefrBand: null,
      cefrConfidence: 1 / 6,
      evaluatedAtMs: null
    },
    estimatedCefrBand,
    cefrPosterior: createUniformCefrPosterior(),
    lemmaCards: {},
    currentSession: null,
    sessionHistory: []
  };
}

/**
 * A whole profile as one JSON string, cards excluded.
 *
 * KEEPS THE LEARNER ID, unlike the record store. This envelope stands on its
 * own -- whoever reads it back has nothing else to say who it is for -- where a
 * stored record sits in storage already scoped to one account and one language
 * pair, so there the id is derived and stamped on load.
 */
export function serializeLearnerProfile(profile: LearnerProfile): string {
  return JSON.stringify({
    ...toPersistedCore(profile),
    learnerId: profile.learnerId
  });
}

export function deserializeLearnerProfile(json: string): LearnerProfile {
  const parsed = JSON.parse(json) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("Invalid learner profile JSON: expected object root.");
  }
  if (typeof parsed.learnerId !== "string") {
    throw new Error("Invalid learner profile JSON: missing learnerId.");
  }
  if (typeof parsed.targetLanguage !== "string" || parsed.targetLanguage.length === 0) {
    throw new Error("Invalid learner profile JSON: missing targetLanguage.");
  }
  if (typeof parsed.supportLanguage !== "string" || parsed.supportLanguage.length === 0) {
    throw new Error("Invalid learner profile JSON: missing supportLanguage.");
  }
  if (!isCefrBand(parsed.estimatedCefrBand)) {
    throw new Error("Invalid learner profile JSON: estimatedCefrBand is invalid.");
  }
  if (!isRecord(parsed.assessment)) {
    throw new Error("Invalid learner profile JSON: missing assessment.");
  }
  if (!isRecord(parsed.cefrPosterior)) {
    throw new Error("Invalid learner profile JSON: missing cefrPosterior.");
  }
  if (!Array.isArray(parsed.sessionHistory)) {
    throw new Error("Invalid learner profile JSON: sessionHistory must be an array.");
  }

  return {
    learnerId: parsed.learnerId as LearnerId,
    targetLanguage: parsed.targetLanguage,
    supportLanguage: parsed.supportLanguage,
    assessment: {
      status:
        parsed.assessment.status === "estimated" ||
        parsed.assessment.status === "evaluated"
          ? parsed.assessment.status
          : "unassessed",
      evaluatedCefrBand: isCefrBand(parsed.assessment.evaluatedCefrBand)
        ? parsed.assessment.evaluatedCefrBand
        : null,
      cefrConfidence:
        typeof parsed.assessment.cefrConfidence === "number"
          ? parsed.assessment.cefrConfidence
          : 1 / 6,
      evaluatedAtMs:
        typeof parsed.assessment.evaluatedAtMs === "number"
          ? parsed.assessment.evaluatedAtMs
          : null
    },
    estimatedCefrBand: parsed.estimatedCefrBand,
    cefrPosterior: parsed.cefrPosterior as LearnerProfile["cefrPosterior"],
    lemmaCards: {},
    currentSession: isRecord(parsed.currentSession)
      ? {
          sessionId:
            typeof parsed.currentSession.sessionId === "string"
              ? parsed.currentSession.sessionId
              : "unknown-session",
          startedAt:
            typeof parsed.currentSession.startedAt === "number"
              ? parsed.currentSession.startedAt
              : 0,
          // 090.5: hoverRate / probeFailRate / fatigueScore / avgResponseLatencyMs
          // are no longer read back. Older saves may still carry them; extra keys
          // are simply ignored here, so no migration is needed.
          turns:
            typeof parsed.currentSession.turns === "number" ? parsed.currentSession.turns : 0
        }
      : null,
    sessionHistory: parsed.sessionHistory
      .filter(isRecord)
      .map((session) => ({
        sessionId: typeof session.sessionId === "string" ? session.sessionId : "unknown-session",
        startedAt: typeof session.startedAt === "number" ? session.startedAt : 0,
        completedAt: typeof session.completedAt === "number" ? session.completedAt : 0,
        turns: typeof session.turns === "number" ? session.turns : 0
      }))
  };
}

/**
 * Competency cards written before the key space was renamed.
 *
 * They were keyed `chunk:<chunkId>`; they are now `exponent:<exponentId>`, and
 * the ids differ too -- exponent ids are generated from the phrase, so no
 * rewrite maps one onto the other. Nothing reads `chunk:` any more.
 *
 * DROPPED RATHER THAN MIGRATED, and rather than left alone. Left alone they
 * are worse than absent: `exponent:` is what marks a card as a competency, so
 * a `chunk:` card reads as a WORD everywhere -- it is counted as vocabulary in
 * the debug state, and it passes the provisional filter, which is how a phrase
 * could be picked as the target of a comprehension probe about a word that
 * does not exist.
 *
 * The learner loses the review history of phrases they met before the rename.
 * That is the smaller cost, and it is honest: the alternative is a rewrite
 * that has to guess which exponent an old chunk became.
 *
 * Removable once no store predates the rename -- there is one player and one
 * machine, so that is a decision rather than a discovery.
 */
function isDeadChunkCardKey(cardKey: string): boolean {
  return cardKey.startsWith("chunk:");
}

export async function loadLearnerProfile(
  options: LoadLearnerProfileOptions
): Promise<LearnerProfile> {
  // THE DURABLE COPY FIRST (Plan 092.6.4). The blackboard is memory for the
  // life of the tab; before this it was the only home the core had, so a
  // returning player arrived with their words intact and their level gone and
  // was re-placed every session.
  //
  // A read that fails is not fatal -- the blackboard or the default still
  // produces a playable learner, and the alternative is refusing to start.
  let persistedCore: PersistedLearnerProfileCore | undefined;
  if (options.profileStore) {
    try {
      persistedCore = await options.profileStore.get(LEARNER_PROFILE_CORE_KEY);
    } catch (error) {
      console.warn("[sugarlang] could not read the stored learner core", error);
    }
  }

  const envelope = options.blackboard.getFact(
    LEARNER_PROFILE_FACT,
    createBlackboardScope("entity", options.playerEntityId)
  );
  // STAMPED HERE, never read from storage. The caller built the fallback with
  // the authoritative learner id, and it is the only id this load can be for --
  // the store it just read from is scoped to that same account and language
  // pair. A stored copy could only ever agree or be wrong.
  const learnerId = options.fallbackProfile.learnerId;
  const baseProfile = persistedCore
    ? cloneLearnerProfile({
        ...persistedCore,
        learnerId,
        lemmaCards: {}
      })
    : envelope?.value
      ? cloneLearnerProfile({ ...envelope.value, learnerId })
      : cloneLearnerProfile(options.fallbackProfile);

  const lemmaCards: Record<string, LemmaCard> = {
    ...Object.fromEntries(
      Object.entries(baseProfile.lemmaCards).map(([lemmaId, card]) => [lemmaId, cloneCard(card)])
    )
  };

  let cursor: string | null = null;
  while (true) {
    const page = await options.cardStore.listPage(cursor, CARD_STORE_PAGE_SIZE);
    for (const card of page.cards) {
      if (isDeadChunkCardKey(card.lemmaId)) continue;
      lemmaCards[card.lemmaId] = cloneCard(card);
    }
    if (!page.nextCursor) {
      break;
    }
    cursor = page.nextCursor;
  }

  // DECAY HAPPENS HERE, on the way out, for every card.
  //
  // Retrievability is a function of how long it has been, not a value to store
  // and trust. It is written as 1 by every graded observation and nothing
  // lowers it, so a card read straight from the store claims the learner
  // remembers it perfectly however long ago that was.
  //
  // This is the one place worth doing it: every read of a profile comes through
  // here, so a caller cannot forget. Doing it at each reader instead is how the
  // stored value and the real one drift, and the drift is invisible -- a stale
  // 1.0 looks exactly like a fresh one.
  //
  // NOT written back. The store keeps what was measured at review time; this is
  // the derived view. Persisting it would bake a timestamp into the number and
  // make the next load decay from the wrong instant.
  const now = options.now ?? Date.now();
  for (const [lemmaId, card] of Object.entries(lemmaCards)) {
    lemmaCards[lemmaId] = {
      ...card,
      retrievability: decayedRetrievability(card, now)
    };
  }

  return {
    ...baseProfile,
    lemmaCards
  };
}

export async function saveLearnerProfile(
  options: SaveLearnerProfileOptions
): Promise<void> {
  const cardsToPersist = options.changedCards ?? Object.values(options.profile.lemmaCards);

  for (let index = 0; index < cardsToPersist.length; index += CARD_STORE_PAGE_SIZE) {
    await options.cardStore.bulkSet(cardsToPersist.slice(index, index + CARD_STORE_PAGE_SIZE));
  }

  options.blackboard.setFact({
    definition: LEARNER_PROFILE_FACT,
    scope: createBlackboardScope("entity", options.playerEntityId),
    value: cloneLearnerProfile(options.profile),
    sourceSystem: options.sourceSystem
  });

  // The durable copy of everything that is not a word. Written WITHOUT the
  // cards: they are rows of their own in the same account store, and copying
  // them in here would double every write and give the two copies a chance to
  // disagree. And without the learner id, which the reader stamps -- see
  // `PersistedLearnerProfileCore`.
  if (options.profileStore) {
    const core = toPersistedCore(options.profile);
    try {
      await options.profileStore.put(LEARNER_PROFILE_CORE_KEY, core);
    } catch (error) {
      // A turn must not fail because storage did. The blackboard above still
      // carries the profile for this session.
      console.warn("[sugarlang] could not persist the learner core", error);
    }
  }
}
