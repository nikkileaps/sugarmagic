/**
 * packages/testing/src/player-known-facts.test.ts
 *
 * Plan 074 §074.5 -- Player-known-facts integration tests.
 * Covers: store behavior (learnFact, dedup/upsert, cap), blackboard wiring,
 * save participant serialize/restore, and SaveParticipant schema.
 */
import { describe, expect, it } from "vitest";
import {
  createPlayerKnownFactsStore,
  createPlayerKnownFactsSaveParticipant,
  PLAYER_KNOWN_FACTS_PARTICIPANT_ID,
  PLAYER_KNOWN_FACTS_SLICE_SCHEMA_VERSION
} from "@sugarmagic/runtime-core";
import {
  createRuntimeBlackboard,
  getPlayerKnownFacts,
  setPlayerKnownFacts
} from "@sugarmagic/runtime-core";

describe("PlayerKnownFactsStore", () => {
  it("starts empty", () => {
    const store = createPlayerKnownFactsStore();
    expect(store.getFactTexts()).toEqual([]);
    expect(store.getFacts()).toEqual([]);
  });

  it("learns a fact and returns its display text", () => {
    const store = createPlayerKnownFactsStore();
    store.learnFact("fact:suitcase", "Mim's suitcase was lost on the airship.");
    expect(store.getFactTexts()).toEqual(["Mim's suitcase was lost on the airship."]);
  });

  it("upserts: learning a fact with an existing id replaces its text and moves it to the end", () => {
    const store = createPlayerKnownFactsStore();
    store.learnFact("fact:suitcase", "Old text.");
    store.learnFact("fact:other", "Another fact.");
    store.learnFact("fact:suitcase", "Mim's suitcase was lost on the airship.");
    const texts = store.getFactTexts();
    // fact:suitcase moved to end; fact:other is first.
    expect(texts).toEqual(["Another fact.", "Mim's suitcase was lost on the airship."]);
  });

  it("caps at 20 facts, dropping the oldest when exceeded", () => {
    const store = createPlayerKnownFactsStore();
    for (let i = 0; i < 22; i += 1) {
      store.learnFact(`fact:${i}`, `Fact ${i}.`);
    }
    const texts = store.getFactTexts();
    expect(texts).toHaveLength(20);
    // oldest (fact:0, fact:1) dropped; newest retained
    expect(texts[0]).toBe("Fact 2.");
    expect(texts[19]).toBe("Fact 21.");
  });

  it("fires callback on learnFact", () => {
    const store = createPlayerKnownFactsStore();
    const received: string[][] = [];
    store.setChangeCallback((texts) => received.push(texts));
    store.learnFact("fact:a", "Fact A.");
    store.learnFact("fact:b", "Fact B.");
    expect(received).toEqual([["Fact A."], ["Fact A.", "Fact B."]]);
  });

  it("restore fires callback so the blackboard is updated", () => {
    const store = createPlayerKnownFactsStore();
    const received: string[][] = [];
    store.setChangeCallback((texts) => received.push(texts));
    store.restore([
      { id: "fact:a", text: "Fact A." },
      { id: "fact:b", text: "Fact B." }
    ]);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(["Fact A.", "Fact B."]);
    expect(store.getFactTexts()).toEqual(["Fact A.", "Fact B."]);
  });

  it("restore without callback wired does not throw", () => {
    const store = createPlayerKnownFactsStore();
    expect(() => store.restore([{ id: "fact:a", text: "Fact A." }])).not.toThrow();
  });
});

describe("player known facts blackboard helpers", () => {
  it("getPlayerKnownFacts returns empty array by default", () => {
    const blackboard = createRuntimeBlackboard();
    expect(getPlayerKnownFacts(blackboard)).toEqual([]);
  });

  it("setPlayerKnownFacts round-trips through the blackboard", () => {
    const blackboard = createRuntimeBlackboard();
    setPlayerKnownFacts(blackboard, ["Fact A.", "Fact B."]);
    expect(getPlayerKnownFacts(blackboard)).toEqual(["Fact A.", "Fact B."]);
  });

  it("store->callback->blackboard: learnFact updates the blackboard", () => {
    const blackboard = createRuntimeBlackboard();
    const store = createPlayerKnownFactsStore();
    store.setChangeCallback((texts) => setPlayerKnownFacts(blackboard, texts));
    setPlayerKnownFacts(blackboard, []);

    store.learnFact("fact:suitcase", "Mim's suitcase was lost on the airship.");
    expect(getPlayerKnownFacts(blackboard)).toEqual([
      "Mim's suitcase was lost on the airship."
    ]);
  });
});

describe("playerKnownFactsSaveParticipant", () => {
  it("participantId and schema version are correct", () => {
    const store = createPlayerKnownFactsStore();
    const participant = createPlayerKnownFactsSaveParticipant({
      getPlayerKnownFactsStore: () => store
    });
    expect(participant.participantId).toBe(PLAYER_KNOWN_FACTS_PARTICIPANT_ID);
    expect(participant.schemaVersion).toBe(PLAYER_KNOWN_FACTS_SLICE_SCHEMA_VERSION);
  });

  it("serialize returns empty facts when store is empty", () => {
    const store = createPlayerKnownFactsStore();
    const participant = createPlayerKnownFactsSaveParticipant({
      getPlayerKnownFactsStore: () => store
    });
    expect(participant.serialize()).toEqual({ facts: [] });
  });

  it("serialize captures learned facts", () => {
    const store = createPlayerKnownFactsStore();
    store.learnFact("fact:suitcase", "Mim's suitcase was lost.");
    const participant = createPlayerKnownFactsSaveParticipant({
      getPlayerKnownFactsStore: () => store
    });
    expect(participant.serialize()).toEqual({
      facts: [{ id: "fact:suitcase", text: "Mim's suitcase was lost." }]
    });
  });

  it("deserialize restores facts into the store and fires its callback", () => {
    const store = createPlayerKnownFactsStore();
    const received: string[][] = [];
    store.setChangeCallback((texts) => received.push(texts));
    const participant = createPlayerKnownFactsSaveParticipant({
      getPlayerKnownFactsStore: () => store
    });
    participant.deserialize({
      participantId: PLAYER_KNOWN_FACTS_PARTICIPANT_ID,
      schemaVersion: PLAYER_KNOWN_FACTS_SLICE_SCHEMA_VERSION,
      data: { facts: [{ id: "fact:a", text: "Fact A." }] }
    });
    expect(store.getFactTexts()).toEqual(["Fact A."]);
    expect(received).toHaveLength(1);
  });

  it("deserialize(null) resets to empty", () => {
    const store = createPlayerKnownFactsStore();
    store.learnFact("fact:a", "Fact A.");
    const participant = createPlayerKnownFactsSaveParticipant({
      getPlayerKnownFactsStore: () => store
    });
    participant.deserialize(null);
    expect(store.getFactTexts()).toEqual([]);
  });

  it("null getter is a no-op (does not throw)", () => {
    const participant = createPlayerKnownFactsSaveParticipant({
      getPlayerKnownFactsStore: () => null
    });
    expect(() => participant.serialize()).not.toThrow();
    expect(() => participant.deserialize(null)).not.toThrow();
  });

  it("slice contains no wall-clock timestamps", () => {
    const store = createPlayerKnownFactsStore();
    store.learnFact("fact:a", "Fact A.");
    const participant = createPlayerKnownFactsSaveParticipant({
      getPlayerKnownFactsStore: () => store
    });
    const slice = JSON.stringify(participant.serialize());
    // Wall-clock values would be >= 2^40 (year 2004+); any integer that large
    // in the JSON string is a bug (no-wallclock house rule).
    expect(slice).not.toMatch(/[0-9]{13,}/);
  });
});
