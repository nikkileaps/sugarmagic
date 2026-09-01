/**
 * packages/plugins/src/catalog/sugarlang/tests/situation/warm-key-parity.test.ts
 *
 * Purpose: A situation composed for a WARM-UP produces the same key as one
 *   composed for a real TURN, given the same world.
 *
 * WHY THIS IS THE LOAD-BEARING TEST FOR THE WHOLE FEATURE
 *   A warm-up fills a directive slot the first turn will read. The read is
 *   gated on the situation key matching. If the two composition paths ever
 *   diverge, EVERY warm-up is wasted, the first turn is slow again, and
 *   nothing errors -- no exception, no failing test, no log. The feature just
 *   silently stops working (sugarmagic-latency-00m).
 *
 *   The specific way it nearly shipped broken: a situation composed with no
 *   ConversationRuntimeContext falls back to noRuntimeFacts(), and the key
 *   encodes every unavailable fact as "?". A real turn always has at least a
 *   time-of-day band, so the keys could never match.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { composeSituation, situationKey } from "../../runtime/situation";

const RUNTIME_CONTEXT = {
  here: { regionId: "region-1" },
  playerLocation: null,
  playerPosition: null,
  npcLocation: null,
  npcPosition: null,
  playerArea: null,
  npcArea: null,
  npcPlayerRelation: null,
  npcBehavior: null,
  trackedQuest: null,
  activeQuestStage: null,
  activeQuestObjectives: null,
  goalSurfacedCount: null,
  timeOfDay: "afternoon",
  knownFacts: null,
  recentWorldEvents: null
} as never;

describe("warm key parity", () => {
  it("THE ONE THAT MATTERS: the NPC makes no difference to the key", async () => {
    // A warm-up composes with npc absent; the turn composes with the real NPC.
    // If the NPC ever entered the key, every warm-up would miss.
    const warm = composeSituation({
      regionId: "region-1",
      sceneContext: null,
      runtimeContext: RUNTIME_CONTEXT
    });
    const turn = composeSituation({
      regionId: "region-1",
      sceneContext: null,
      runtimeContext: RUNTIME_CONTEXT,
      npc: {
        npcDefinitionId: "npc-finnick",
        displayName: "Finnick Thorn",
        lorePageId: "lore.npc.finnick"
      }
    });

    expect(situationKey(warm)).toBe(situationKey(turn));
  });

  it("a situation with NO runtime context can never match one that has it", async () => {
    // This is the failure the warm path was one line away from shipping:
    // silent, total, and invisible.
    const withoutContext = composeSituation({ regionId: "region-1", sceneContext: null });
    const withContext = composeSituation({
      regionId: "region-1",
      sceneContext: null,
      runtimeContext: RUNTIME_CONTEXT
    });

    expect(situationKey(withoutContext)).not.toBe(situationKey(withContext));
    // And the reason is legible: unavailable facts encode as "?".
    expect(situationKey(withoutContext)).toContain("time:?");
    expect(situationKey(withContext)).toContain("time:afternoon");
  });

  it("the key moves when the world moves, which is what triggers a re-warm", async () => {
    const afternoon = composeSituation({
      regionId: "region-1",
      sceneContext: null,
      runtimeContext: RUNTIME_CONTEXT
    });
    const evening = composeSituation({
      regionId: "region-1",
      sceneContext: null,
      runtimeContext: { ...(RUNTIME_CONTEXT as object), timeOfDay: "evening" } as never
    });

    expect(situationKey(afternoon)).not.toBe(situationKey(evening));
  });
});
