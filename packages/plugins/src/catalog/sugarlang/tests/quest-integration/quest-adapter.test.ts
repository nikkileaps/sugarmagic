/**
 * packages/plugins/src/catalog/sugarlang/tests/quest-integration/quest-adapter.test.ts
 *
 * Purpose: Verifies the thin quest action-proposal helpers used by placement completion.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Depends on ../../runtime/quest-integration/quest-adapter.
 *   - Guards the action shapes consumed later by runtime-core gameplay-session handling.
 *
 * Implements: Epic 11 quest integration
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  notifySugarlangQuestEvent,
  setSugarlangQuestFlag
} from "../../runtime/quest-integration/quest-adapter";

describe("quest-adapter", () => {
  it("builds a set-conversation-flag proposal", () => {
    expect(setSugarlangQuestFlag("sugarlang.placement.status", "completed")).toEqual({
      kind: "set-conversation-flag",
      key: "sugarlang.placement.status",
      value: "completed"
    });
  });

  it("builds a notify-quest-event proposal", () => {
    expect(notifySugarlangQuestEvent("sugarlang.placement.completed")).toEqual({
      kind: "notify-quest-event",
      eventName: "sugarlang.placement.completed"
    });
  });
});
