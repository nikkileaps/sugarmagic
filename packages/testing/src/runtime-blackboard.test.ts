import { describe, expect, it, vi } from "vitest";
import {
  ENTITY_AFFECT_FACT,
  ENTITY_POSITION_FACT,
  ENTITY_PLAYER_SPATIAL_RELATION_FACT,
  QUEST_ACTIVE_STAGE_FACT,
  type BlackboardChangeEvent,
  createBlackboardScope,
  createRuntimeBlackboard,
  defineBlackboardFact,
  getActiveQuestStage,
  getEntityAffect,
  getEntityPlayerSpatialRelation,
  getEntityPosition,
  setActiveQuestStage,
  setEntityAffect,
  setEntityPlayerSpatialRelation,
  setEntityPosition
} from "@sugarmagic/runtime-core";

const TEST_GLOBAL_FACT = defineBlackboardFact<boolean>({
  key: "test.global-flag",
  ownerSystem: "director-system",
  allowedScopeKinds: ["global"],
  lifecycle: { kind: "persistent" }
});

const TEST_EPHEMERAL_FACT = defineBlackboardFact<string>({
  key: "test.ephemeral-note",
  ownerSystem: "sense-system",
  allowedScopeKinds: ["entity"],
  lifecycle: { kind: "ephemeral", expiresAfterMs: 50 }
});

describe("RuntimeBlackboard", () => {
  it("rejects writes from non-owner systems", () => {
    const blackboard = createRuntimeBlackboard({
      definitions: [ENTITY_POSITION_FACT]
    });

    expect(() =>
      blackboard.setFact({
        definition: ENTITY_POSITION_FACT,
        scope: createBlackboardScope("entity", "npc:rick-roll"),
        value: {
          entityId: "npc:rick-roll",
          x: 4,
          y: 2,
          z: 0,
          regionId: "region:station",
          sceneId: "scene:kiosk"
        },
        sourceSystem: "quest-system"
      })
    ).toThrow(/owned by/i);
  });

  it("rejects writes to disallowed scope kinds", () => {
    const blackboard = createRuntimeBlackboard({
      definitions: [TEST_GLOBAL_FACT]
    });

    expect(() =>
      blackboard.setFact({
        definition: TEST_GLOBAL_FACT,
        scope: createBlackboardScope("entity", "npc:station-manager"),
        value: true,
        sourceSystem: TEST_GLOBAL_FACT.ownerSystem
      })
    ).toThrow(/scope kind/i);
  });

  it("expires ephemeral facts and notifies subscribers", () => {
    vi.useFakeTimers();
    const blackboard = createRuntimeBlackboard({
      definitions: [TEST_EPHEMERAL_FACT]
    });
    const events: BlackboardChangeEvent[] = [];
    blackboard.subscribe((event) => {
      events.push(event);
    });

    blackboard.setFact({
      definition: TEST_EPHEMERAL_FACT,
      scope: createBlackboardScope("entity", "npc:rick-roll"),
      value: "fresh",
      sourceSystem: TEST_EPHEMERAL_FACT.ownerSystem
    });

    expect(
      blackboard.getFact(
        TEST_EPHEMERAL_FACT,
        createBlackboardScope("entity", "npc:rick-roll")
      )?.value
    ).toBe("fresh");

    vi.advanceTimersByTime(60);

    expect(
      blackboard.getFact(
        TEST_EPHEMERAL_FACT,
        createBlackboardScope("entity", "npc:rick-roll")
      )
    ).toBeNull();
    expect(events.map((event) => event.type)).toEqual(["set", "expire"]);
    expect(events[1]?.reason).toBe("ephemeral-expiry");

    vi.useRealTimers();
  });

  it("clears frame and session facts through their lifecycle hooks", () => {
    const blackboard = createRuntimeBlackboard({
      definitions: [ENTITY_POSITION_FACT, QUEST_ACTIVE_STAGE_FACT]
    });

    setEntityPosition(blackboard, {
      entityId: "npc:station-manager",
      x: 1,
      y: 2,
      z: 0,
      regionId: "region:station",
      sceneId: "scene:lobby"
    });
    setActiveQuestStage(blackboard, {
      questId: "quest:suitcase",
      stageId: "stage:start",
      stageDisplayName: "Start"
    });

    expect(getEntityPosition(blackboard, "npc:station-manager")?.sceneId).toBe("scene:lobby");
    expect(getActiveQuestStage(blackboard, "quest:suitcase")?.stageId).toBe("stage:start");

    blackboard.advanceFrame();
    expect(getEntityPosition(blackboard, "npc:station-manager")).toBeNull();
    expect(getActiveQuestStage(blackboard, "quest:suitcase")?.stageId).toBe("stage:start");

    blackboard.clearSessionFacts();
    expect(getActiveQuestStage(blackboard, "quest:suitcase")).toBeNull();
  });

  it("supports typed accessors while keeping listFacts for inspection", () => {
    const blackboard = createRuntimeBlackboard({
      definitions: [
        ENTITY_AFFECT_FACT,
        ENTITY_POSITION_FACT,
        ENTITY_PLAYER_SPATIAL_RELATION_FACT
      ]
    });

    setEntityAffect(blackboard, {
      entityId: "npc:rick-roll",
      mood: "friendly",
      urgency: "calm",
      stance: "open"
    });
    setEntityPosition(blackboard, {
      entityId: "npc:rick-roll",
      x: 8,
      y: 3,
      z: 0,
      regionId: "region:station",
      sceneId: "scene:kiosk"
    });
    setEntityPlayerSpatialRelation(blackboard, {
      entityId: "npc:rick-roll",
      playerEntityId: "player:mim",
      entityAreaId: "area:kiosk",
      playerAreaId: "area:exterior",
      sameArea: false,
      sameParentArea: false,
      proximityBand: "remote",
      distanceMeters: 8.5
    });

    expect(getEntityAffect(blackboard, "npc:rick-roll")?.mood).toBe("friendly");
    expect(getEntityPosition(blackboard, "npc:rick-roll")?.x).toBe(8);
    expect(getEntityPlayerSpatialRelation(blackboard, "npc:rick-roll")?.proximityBand).toBe("remote");

    const listedFacts = blackboard.listFacts(createBlackboardScope("entity", "npc:rick-roll"));
    expect(listedFacts).toHaveLength(3);
    expect(listedFacts.map((fact) => fact.key).sort()).toEqual([
      "entity.affect",
      "entity.player-spatial-relation",
      "entity.position"
    ]);
  });
});
