/**
 * packages/plugins/src/catalog/sugaragent/runtime/lore-relevance.test.ts
 *
 * Purpose: verifies the shared relevance floor filter used by
 * RetrieveStage and the quest-context middleware.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  applyRelevanceFloor,
  DEFAULT_LORE_RELEVANCE_FLOOR,
  MAX_LORE_RELEVANCE_FLOOR,
  MIN_LORE_RELEVANCE_FLOOR
} from "./lore-relevance";

function scored(...scores: number[]): { score: number }[] {
  return scores.map((score) => ({ score }));
}

describe("applyRelevanceFloor", () => {
  it("keeps items at or above the floor and reports the rest", () => {
    const result = applyRelevanceFloor(scored(0.9, 0.5, 0.2), 0.5);

    expect(result.kept.map((item) => item.score)).toEqual([0.9, 0.5]);
    expect(result.droppedScores).toEqual([0.2]);
  });

  it("keeps the original order", () => {
    const result = applyRelevanceFloor(scored(0.4, 0.95, 0.6), 0.5);

    expect(result.kept.map((item) => item.score)).toEqual([0.95, 0.6]);
  });

  it("keeps everything when the floor is off", () => {
    const result = applyRelevanceFloor(scored(0.9, 0.01, 0), 0);

    expect(result.kept).toHaveLength(3);
    expect(result.droppedScores).toEqual([]);
  });

  it("keeps everything when the floor is not a usable number", () => {
    const result = applyRelevanceFloor(scored(0.9, 0.01), Number.NaN);

    expect(result.kept).toHaveLength(2);
    expect(result.droppedScores).toEqual([]);
  });

  it("can drop every item", () => {
    const result = applyRelevanceFloor(scored(0.1, 0.2), 0.8);

    expect(result.kept).toEqual([]);
    expect(result.droppedScores).toEqual([0.1, 0.2]);
  });

  it("does not mutate the input", () => {
    const items = scored(0.9, 0.1);
    applyRelevanceFloor(items, 0.5);

    expect(items).toHaveLength(2);
  });

  it("ships with the floor off, within the configurable range", () => {
    expect(DEFAULT_LORE_RELEVANCE_FLOOR).toBe(0);
    expect(DEFAULT_LORE_RELEVANCE_FLOOR).toBeGreaterThanOrEqual(
      MIN_LORE_RELEVANCE_FLOOR
    );
    expect(DEFAULT_LORE_RELEVANCE_FLOOR).toBeLessThanOrEqual(
      MAX_LORE_RELEVANCE_FLOOR
    );
  });
});
