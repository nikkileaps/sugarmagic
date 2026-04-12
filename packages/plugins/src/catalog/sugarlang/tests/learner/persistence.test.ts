/**
 * packages/plugins/src/catalog/sugarlang/tests/learner/persistence.test.ts
 *
 * Purpose: Verifies learner-profile persistence and card-store paging behavior.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Imports ../../runtime/learner/persistence and ../../runtime/learner/card-store as the implementations under test.
 *   - Covers the Epic 7 persistence acceptance criteria.
 *
 * Implements: Proposal 001 §Learner State Model
 *
 * Status: active
 */

import "fake-indexeddb/auto";
import {
  createBlackboardScope
} from "@sugarmagic/runtime-core";
import { describe, expect, it } from "vitest";
import {
  CARD_STORE_PAGE_SIZE,
  IndexedDBCardStore,
  MemoryCardStore,
  type CardStore,
  type CardStorePage
} from "../../runtime/learner/card-store";
import {
  LEARNER_PROFILE_FACT,
  SUGARLANG_LEARNER_STATE_WRITER
} from "../../runtime/learner/fact-definitions";
import {
  cloneLearnerProfile,
  deserializeLearnerProfile,
  loadLearnerProfile,
  saveLearnerProfile,
  serializeLearnerProfile
} from "../../runtime/learner/persistence";
import {
  createLearnerBlackboard,
  createLearnerProfile,
  createLemmaCard
} from "./test-helpers";

class CountingCardStore implements CardStore {
  public listPageCalls = 0;
  public bulkSetCalls = 0;

  constructor(private readonly delegate: CardStore) {}

  get(lemmaId: string) {
    return this.delegate.get(lemmaId);
  }

  set(card: ReturnType<typeof createLemmaCard>) {
    return this.delegate.set(card);
  }

  bulkGet(lemmaIds: string[]) {
    return this.delegate.bulkGet(lemmaIds);
  }

  async bulkSet(cards: ReturnType<typeof createLemmaCard>[]) {
    this.bulkSetCalls += 1;
    await this.delegate.bulkSet(cards);
  }

  list() {
    return this.delegate.list();
  }

  async listPage(cursor?: string | null, limit?: number): Promise<CardStorePage> {
    this.listPageCalls += 1;
    return this.delegate.listPage(cursor, limit);
  }

  count() {
    return this.delegate.count();
  }

  clear() {
    return this.delegate.clear();
  }
}

describe("learner persistence", () => {
  it("round-trips learner core serialization without cards", () => {
    const profile = createLearnerProfile("B1", {
      currentSession: {
        sessionId: "session-1",
        startedAt: 1_000,
        turns: 4,
        avgResponseLatencyMs: 800,
        hoverRate: 0.25,
        retryRate: 0.1,
        fatigueScore: 0.3
      },
      sessionHistory: [
        {
          sessionId: "session-0",
          startedAt: 100,
          completedAt: 500,
          turns: 3
        }
      ],
      assessment: {
        status: "evaluated",
        evaluatedCefrBand: "B1",
        cefrConfidence: 0.72,
        evaluatedAtMs: 5_000
      },
      lemmaCards: {
        hola: createLemmaCard("hola", "A1")
      }
    });

    const restored = deserializeLearnerProfile(serializeLearnerProfile(profile));
    expect(restored).toEqual({
      ...cloneLearnerProfile(profile),
      lemmaCards: {}
    });
  });

  it("survives indexeddb reloads and namespaces profiles independently", async () => {
    const cardA = createLemmaCard("hola", "A1");
    const cardB = createLemmaCard("ciao", "A1");
    const storeA = new IndexedDBCardStore({ profileId: "profile-a" });
    const storeB = new IndexedDBCardStore({ profileId: "profile-b" });

    await storeA.set(cardA);
    await storeB.set(cardB);

    const reloadedA = new IndexedDBCardStore({ profileId: "profile-a" });
    const reloadedB = new IndexedDBCardStore({ profileId: "profile-b" });

    expect(await reloadedA.get("hola")).toEqual(cardA);
    expect(await reloadedA.get("ciao")).toBeUndefined();
    expect(await reloadedB.get("ciao")).toEqual(cardB);
  });

  it("pages card save/load work for large profiles and stay fast", async () => {
    const blackboard = createLearnerBlackboard();
    const baseStore = new MemoryCardStore();
    const store = new CountingCardStore(baseStore);
    const profile = createLearnerProfile("A2");

    for (let index = 0; index < 5000; index += 1) {
      profile.lemmaCards[`lemma-${index}`] = createLemmaCard(`lemma-${index}`, "A2");
    }

    const saveStart = performance.now();
    await saveLearnerProfile({
      blackboard,
      playerEntityId: "player-1",
      profile,
      cardStore: store,
      sourceSystem: SUGARLANG_LEARNER_STATE_WRITER
    });
    const loaded = await loadLearnerProfile({
      blackboard,
      playerEntityId: "player-1",
      cardStore: store,
      fallbackProfile: createLearnerProfile("A1")
    });
    const elapsed = performance.now() - saveStart;

    expect(Object.keys(loaded.lemmaCards)).toHaveLength(5000);
    expect(store.bulkSetCalls).toBeGreaterThan(1);
    expect(store.listPageCalls).toBeGreaterThan(1);
    expect(store.bulkSetCalls).toBeGreaterThanOrEqual(
      Math.ceil(5000 / CARD_STORE_PAGE_SIZE)
    );
    expect(elapsed).toBeLessThan(200);
  });

  it("writes the latest profile into the blackboard while persisting changed cards", async () => {
    const blackboard = createLearnerBlackboard();
    const store = new MemoryCardStore();
    const profile = createLearnerProfile("B1", {
      lemmaCards: {
        hablar: createLemmaCard("hablar", "A2")
      }
    });

    await saveLearnerProfile({
      blackboard,
      playerEntityId: "player-2",
      profile,
      cardStore: store,
      sourceSystem: SUGARLANG_LEARNER_STATE_WRITER,
      changedCards: [profile.lemmaCards.hablar]
    });

    expect(
      blackboard.getFact(LEARNER_PROFILE_FACT, createBlackboardScope("entity", "player-2"))?.value
    ).toEqual(profile);
    expect(await store.get("hablar")).toEqual(profile.lemmaCards.hablar);
  });
});
