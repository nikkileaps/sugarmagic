/**
 * packages/plugins/src/catalog/sugarlang/tests/quest-integration/placement-completion.test.ts
 *
 * Purpose: Verifies the action proposals emitted when placement finishes.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Depends on ../../runtime/quest-integration/placement-completion.
 *   - Guards the quest/event contract for the placement completion handoff.
 *
 * Implements: Epic 11 Story 11.3
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  emitPlacementCompleted,
  SUGARLANG_PLACEMENT_COMPLETED_EVENT,
  SUGARLANG_PLACEMENT_COMPLETED_FLAG
} from "../../runtime/quest-integration/placement-completion";

describe("placement-completion", () => {
  it("emits the expected quest flag and event proposals", () => {
    expect(
      emitPlacementCompleted({
        cefrBand: "B1",
        confidence: 0.72,
        perBandScores: {
          A1: { correct: 2, total: 2 },
          A2: { correct: 2, total: 2 },
          B1: { correct: 1, total: 2 },
          B2: { correct: 0, total: 0 },
          C1: { correct: 0, total: 0 },
          C2: { correct: 0, total: 0 }
        },
        lemmasSeededFromFreeText: [],
        skippedCount: 1,
        totalCount: 6,
        scoredAtMs: 1234,
        questionnaireVersion: "es-placement-v1"
      })
    ).toEqual([
      {
        kind: "set-conversation-flag",
        key: SUGARLANG_PLACEMENT_COMPLETED_FLAG,
        value: "completed"
      },
      {
        kind: "set-conversation-flag",
        key: "sugarlang.placement.cefrBand",
        value: "B1"
      },
      {
        kind: "set-conversation-flag",
        key: "sugarlang.placement.confidence",
        value: "0.72"
      },
      {
        kind: "notify-quest-event",
        eventName: SUGARLANG_PLACEMENT_COMPLETED_EVENT
      }
    ]);
  });
});
