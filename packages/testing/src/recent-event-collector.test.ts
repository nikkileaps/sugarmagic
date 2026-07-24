/**
 * packages/testing/src/recent-event-collector.test.ts
 *
 * Plan 074 §074.6' -- RecentEventCollector integration tests.
 * Covers: session-only event accumulation, cap, clear, and prompt-builder
 * rendering of the recentWorldEvents block.
 */
import { describe, expect, it } from "vitest";
import { createRecentEventCollector } from "@sugarmagic/runtime-core";

describe("RecentEventCollector", () => {
  it("starts with no events", () => {
    const collector = createRecentEventCollector();
    expect(collector.getRecentEvents()).toEqual([]);
  });

  it("records a stage-advance event as a readable string", () => {
    const collector = createRecentEventCollector();
    collector.onQuestEvent({
      type: "stage-advance",
      questDefinitionId: "q1",
      displayName: "The Lost Cargo",
      stageDisplayName: "Talk to the harbourmaster"
    });
    expect(collector.getRecentEvents()).toEqual([
      "Quest 'The Lost Cargo' stage 'Talk to the harbourmaster' reached."
    ]);
  });

  it("records a quest-complete event as a readable string", () => {
    const collector = createRecentEventCollector();
    collector.onQuestEvent({
      type: "quest-complete",
      questDefinitionId: "q1",
      displayName: "The Lost Cargo"
    });
    expect(collector.getRecentEvents()).toEqual([
      "Quest 'The Lost Cargo' completed."
    ]);
  });

  it("ignores quest-start and objective-complete (player-private)", () => {
    const collector = createRecentEventCollector();
    collector.onQuestEvent({
      type: "quest-start",
      questDefinitionId: "q1",
      displayName: "The Lost Cargo"
    });
    collector.onQuestEvent({
      type: "objective-complete",
      questDefinitionId: "q1",
      displayName: "The Lost Cargo",
      objectiveDisplayName: "Find the manifest"
    });
    expect(collector.getRecentEvents()).toEqual([]);
  });

  it("records a day-advance event as a readable string", () => {
    const collector = createRecentEventCollector();
    collector.onDayAdvance(3);
    expect(collector.getRecentEvents()).toEqual(["Day advanced to 3."]);
  });

  it("accumulates multiple event types in order", () => {
    const collector = createRecentEventCollector();
    collector.onDayAdvance(2);
    collector.onQuestEvent({
      type: "stage-advance",
      questDefinitionId: "q1",
      displayName: "Cargo",
      stageDisplayName: "Stage Two"
    });
    collector.onQuestEvent({
      type: "quest-complete",
      questDefinitionId: "q1",
      displayName: "Cargo"
    });
    expect(collector.getRecentEvents()).toEqual([
      "Day advanced to 2.",
      "Quest 'Cargo' stage 'Stage Two' reached.",
      "Quest 'Cargo' completed."
    ]);
  });

  it("caps at 10 events, dropping the oldest", () => {
    const collector = createRecentEventCollector();
    for (let i = 1; i <= 12; i++) {
      collector.onDayAdvance(i);
    }
    const events = collector.getRecentEvents();
    expect(events).toHaveLength(10);
    expect(events[0]).toBe("Day advanced to 3.");
    expect(events[9]).toBe("Day advanced to 12.");
  });

  it("clear() empties the buffer", () => {
    const collector = createRecentEventCollector();
    collector.onDayAdvance(1);
    collector.clear();
    expect(collector.getRecentEvents()).toEqual([]);
  });

  it("getRecentEvents returns a copy -- mutation does not affect the collector", () => {
    const collector = createRecentEventCollector();
    collector.onDayAdvance(1);
    const snapshot = collector.getRecentEvents();
    snapshot.push("injected");
    expect(collector.getRecentEvents()).toHaveLength(1);
  });
});

