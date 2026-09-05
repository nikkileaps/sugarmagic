/**
 * Volume roles at runtime (Plan 069.5).
 *
 * The three authored physical roles that DO something once you play:
 *   - blocker (directional: in / out / both) folded into the collision world,
 *   - containment boundary = block-out + a quest/flag condition gate,
 *   - on-enter trigger volumes edge-detected by the spatial area tracker.
 * All flat-ground XZ (Y ignored by the resolver; honored by the box test).
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultRegionLandscapeState,
  createRegionVolumeDefinition,
  type RegionDocument
} from "@sugarmagic/domain";
import {
  applyVolumeColliderGates,
  buildCollisionWorld,
  coerceWorldFlagValue,
  createSpatialAreaTracker,
  evaluateRegionQuestBinding,
  WorldFlagManager,
  resolveMove,
  resolveWorldFlagWriteValue
} from "@sugarmagic/runtime-core";

// A 4x4 box centered at the origin: interior x,z in [-2, 2].
const BOX_BOUNDS = {
  kind: "box" as const,
  center: [0, 0, 0] as [number, number, number],
  size: [4, 4, 4] as [number, number, number]
};
const R = 0.5;

describe("069.5 — directional blocker volumes join the collision world", () => {
  it("block-in: a body outside cannot cross into the box", () => {
    const world = buildCollisionWorld(
      [],
      [
        createRegionVolumeDefinition({
          volumeId: "vol:wall",
          roles: ["blocker"],
          blockDirection: "in",
          bounds: BOX_BOUNDS
        })
      ]
    );
    // From well outside (-4,0), lunge toward the interior (+3).
    const resolved = resolveMove({ x: -4, z: 0, radius: R }, { x: 3, z: 0 }, world);
    const finalX = -4 + resolved.x;
    // Kept out: circle centre stays at/left of the near face minus radius.
    expect(finalX).toBeLessThanOrEqual(-2 + 1e-6);
  });

  it("block-out (containment): a body inside cannot cross out", () => {
    const world = buildCollisionWorld(
      [],
      [
        createRegionVolumeDefinition({
          volumeId: "vol:pen",
          roles: ["containment-boundary"],
          // default block for a containment boundary is "out"
          bounds: BOX_BOUNDS
        })
      ]
    );
    // From inside (0,0), sprint out the +X side.
    const resolved = resolveMove({ x: 0, z: 0, radius: R }, { x: 5, z: 0 }, world);
    const finalX = 0 + resolved.x;
    // Held in: centre clamped to the far interior face minus radius (2 - 0.5).
    expect(finalX).toBeCloseTo(1.5, 5);
  });

  it("block-out does NOT drag in a body that is already outside", () => {
    const world = buildCollisionWorld(
      [],
      [
        createRegionVolumeDefinition({
          volumeId: "vol:pen",
          roles: ["containment-boundary"],
          blockDirection: "out",
          bounds: BOX_BOUNDS
        })
      ]
    );
    // Starts outside, moves further out — a pure retention volume ignores it.
    const resolved = resolveMove({ x: 5, z: 0, radius: R }, { x: 1, z: 0 }, world);
    expect(5 + resolved.x).toBeCloseTo(6, 5);
  });

  it("both: an impermeable membrane — can't enter and can't leave", () => {
    const world = buildCollisionWorld(
      [],
      [
        createRegionVolumeDefinition({
          volumeId: "vol:membrane",
          roles: ["blocker"],
          blockDirection: "both",
          bounds: BOX_BOUNDS
        })
      ]
    );
    const fromOutside = resolveMove(
      { x: -4, z: 0, radius: R },
      { x: 3, z: 0 },
      world
    );
    expect(-4 + fromOutside.x).toBeLessThanOrEqual(-2 + 1e-6);

    const fromInside = resolveMove({ x: 0, z: 0, radius: R }, { x: 5, z: 0 }, world);
    expect(0 + fromInside.x).toBeCloseTo(1.5, 5);
  });

  it("containment box narrower than the agent snaps the agent to center", () => {
    // Box X-size 0.4 < 2*radius(1.0): the safe interior [minX+r, maxX-r]
    // inverts, so the clamp falls back to the box center on that axis.
    const world = buildCollisionWorld(
      [],
      [
        createRegionVolumeDefinition({
          volumeId: "vol:thin",
          roles: ["containment-boundary"],
          blockDirection: "out",
          bounds: { kind: "box", center: [0, 0, 0], size: [0.4, 4, 4] }
        })
      ]
    );
    const resolved = resolveMove({ x: 0, z: 0, radius: R }, { x: 5, z: 0 }, world);
    expect(0 + resolved.x).toBeCloseTo(0, 5); // pinned to center X, not out at 5
  });

  it("slides along a blocker face (tangential motion survives)", () => {
    const world = buildCollisionWorld(
      [],
      [
        createRegionVolumeDefinition({
          volumeId: "vol:wall",
          roles: ["blocker"],
          blockDirection: "in",
          bounds: BOX_BOUNDS
        })
      ]
    );
    // Push diagonally into the left face — the Z component should carry.
    const resolved = resolveMove(
      { x: -2.5, z: 0, radius: R },
      { x: 1, z: 1 },
      world
    );
    expect(resolved.z).toBeCloseTo(1, 5);
    expect(-2.5 + resolved.x).toBeLessThanOrEqual(-2 + 1e-6);
  });
});

describe("069.5 — conditional containment gate", () => {
  const containment = createRegionVolumeDefinition({
    volumeId: "vol:cell",
    roles: ["containment-boundary"],
    blockDirection: "out",
    bounds: BOX_BOUNDS,
    condition: {
      questDefinitionId: null,
      questStageId: null,
      worldFlagEquals: { worldFlagId: "freed", valueType: "boolean", value: "true" }
    }
  });

  it("walls you in until the flag flips, then lets you out", () => {
    const world = buildCollisionWorld([], [containment]);
    expect(world.gates).toHaveLength(1);

    // Flag unset -> gate blocking: can't leave.
    applyVolumeColliderGates(world, { activeQuests: [], hasWorldFlag: () => false });
    const trapped = resolveMove({ x: 0, z: 0, radius: R }, { x: 5, z: 0 }, world);
    expect(0 + trapped.x).toBeCloseTo(1.5, 5);

    // Flag set -> gate open: walk straight out.
    applyVolumeColliderGates(world, {
      activeQuests: [],
      hasWorldFlag: (key, value) => key === "freed" && value === true
    });
    const freed = resolveMove({ x: 0, z: 0, radius: R }, { x: 5, z: 0 }, world);
    expect(0 + freed.x).toBeCloseTo(5, 5);
  });
});

describe("069.5 — shared quest/flag grammar (single evaluator)", () => {
  it("an all-null binding is vacuously satisfied", () => {
    expect(
      evaluateRegionQuestBinding(
        { questDefinitionId: null, questStageId: null, worldFlagEquals: null },
        { activeQuests: [] }
      )
    ).toBe(true);
  });

  it("a world-flag clause fails closed without the predicate, matches with it", () => {
    const binding = {
      questDefinitionId: null,
      questStageId: null,
      worldFlagEquals: { worldFlagId: "k", valueType: "boolean" as const, value: "true" }
    };
    expect(evaluateRegionQuestBinding(binding, { activeQuests: [] })).toBe(false);
    expect(
      evaluateRegionQuestBinding(binding, {
        activeQuests: [],
        hasWorldFlag: (key, value) => key === "k" && value === true
      })
    ).toBe(true);
  });

  it("matches quest definition + stage", () => {
    const binding = {
      questDefinitionId: "q1",
      questStageId: "s2",
      worldFlagEquals: null
    };
    expect(
      evaluateRegionQuestBinding(binding, {
        activeQuests: [{ questDefinitionId: "q1", stageId: "s2" }]
      })
    ).toBe(true);
    expect(
      evaluateRegionQuestBinding(binding, {
        activeQuests: [{ questDefinitionId: "q1", stageId: "other" }]
      })
    ).toBe(false);
  });

  it("coerces authored flag values", () => {
    expect(
      coerceWorldFlagValue({ valueType: "boolean", value: null })
    ).toBe(true);
    expect(
      coerceWorldFlagValue({ valueType: "number", value: "3" })
    ).toBe(3);
  });

  // Reading and writing share one coercion, so a flag written from an authored
  // declaration always matches a condition read from the same declaration --
  // including the valueless case, which lands on the declared type's zero at
  // both ends instead of `undefined` at one and `0` at the other. Wired through
  // the real flag store because the bug lived in the seam, not in either side.
  describe("a valueless flag condition matches a flag written the same way", () => {
    function gateOn(valueType: "boolean" | "number" | "string") {
      return {
        questDefinitionId: null,
        questStageId: null,
        worldFlagEquals: { worldFlagId: "gate", valueType, value: null }
      };
    }

    function contextFrom(flags: WorldFlagManager) {
      return {
        activeQuests: [],
        hasWorldFlag: (key: string, value?: unknown) => flags.hasFlag(key, value)
      };
    }

    function withFlag(value: unknown) {
      const flags = new WorldFlagManager();
      flags.setFlag("gate", value);
      return contextFrom(flags);
    }

    const withoutFlag = () => contextFrom(new WorldFlagManager());

    // The write side is what a valueless declaration stores; the read side has
    // to land on the same value. Anything else is a silent miss.
    it.each([
      ["number" as const, 0],
      ["string" as const, ""],
      ["boolean" as const, true]
    ])("%s: write and read agree on the valueless case", (valueType, stored) => {
      const declaration = { key: "gate", valueType, value: null };
      expect(resolveWorldFlagWriteValue(declaration)).toBe(stored);
      expect(coerceWorldFlagValue(declaration)).toBe(stored);
      expect(
        evaluateRegionQuestBinding(gateOn(valueType), withFlag(stored))
      ).toBe(true);
      expect(
        evaluateRegionQuestBinding(gateOn(valueType), withoutFlag())
      ).toBe(false);
    });

    it("a declared value still has to match what the flag holds", () => {
      const binding = {
        questDefinitionId: null,
        questStageId: null,
        worldFlagEquals: {
          worldFlagId: "gate",
          valueType: "number" as const,
          value: "3"
        }
      };
      expect(evaluateRegionQuestBinding(binding, withFlag(3))).toBe(true);
      expect(evaluateRegionQuestBinding(binding, withFlag(4))).toBe(false);
    });

    // Distinct from the valueless case above, which falls back to 0. Text that
    // is not a number is an authoring mistake, and reading it as 0 would
    // silently match a flag that happens to hold zero.
    it("a number condition whose value is not a number matches nothing", () => {
      expect(
        coerceWorldFlagValue({ valueType: "number", value: "abc" })
      ).toBeNaN();

      const binding = {
        questDefinitionId: null,
        questStageId: null,
        worldFlagEquals: {
          worldFlagId: "gate",
          valueType: "number" as const,
          value: "abc"
        }
      };
      expect(evaluateRegionQuestBinding(binding, withFlag(0))).toBe(false);
    });
  });

  it("write value is always the declared type (never boolean into a number slot)", () => {
    expect(
      resolveWorldFlagWriteValue({ valueType: "number", value: "7" })
    ).toBe(7);
    // Valueless declarations fall back to the TYPE's zero, not `true`.
    expect(
      resolveWorldFlagWriteValue({ valueType: "number", value: null })
    ).toBe(0);
    expect(
      resolveWorldFlagWriteValue({ valueType: "string", value: null })
    ).toBe("");
    expect(
      resolveWorldFlagWriteValue({ valueType: "boolean", value: null })
    ).toBe(true);
  });


  // Plan 077.4 (D5): compound AND binding -- stage + world-flag together.
  // Models the "upset passenger activates only after dock-worker conversation
  // AND the quest is at find-suitcase stage" pattern. The evaluator already
  // handled this; these tests document + lock the behavior.
  it("resolves compound stage-AND-flag binding only when both conditions hold", () => {
    const binding = {
      questDefinitionId: "quest.find-the-luggage",
      questStageId: "stage.find-suitcase",
      worldFlagEquals: { worldFlagId: "talkedToDockWorker", valueType: "boolean" as const, value: "true" }
    };
    const ctx = (stageId: string, hasFlag: boolean) => ({
      activeQuests: [{ questDefinitionId: "quest.find-the-luggage", stageId }],
      hasWorldFlag: (k: string, v: unknown) => k === "talkedToDockWorker" && v === hasFlag
    });

    // Both conditions hold -> active
    expect(evaluateRegionQuestBinding(binding, ctx("stage.find-suitcase", true))).toBe(true);
    // Flag missing -> not active
    expect(evaluateRegionQuestBinding(binding, ctx("stage.find-suitcase", false))).toBe(false);
    // Stage wrong (quest advanced) -> retires automatically
    expect(evaluateRegionQuestBinding(binding, ctx("stage.return-to-counter", true))).toBe(false);
    // Neither condition -> not active
    expect(evaluateRegionQuestBinding(binding, ctx("stage.return-to-counter", false))).toBe(false);
  });

  it("compound binding retires when stage advances (flag still set)", () => {
    // Verifies "retires when the stage advances" from 077.4 exit criterion.
    // The world flag stays set after the stage changes; only the stage gate
    // causes the binding to retire.
    const binding = {
      questDefinitionId: "quest.find-the-luggage",
      questStageId: "stage.find-suitcase",
      worldFlagEquals: { worldFlagId: "talkedToDockWorker", valueType: "boolean" as const, value: "true" }
    };
    const flagAlwaysSet = (k: string, v: unknown) =>
      k === "talkedToDockWorker" && v === true;

    expect(
      evaluateRegionQuestBinding(binding, {
        activeQuests: [{ questDefinitionId: "quest.find-the-luggage", stageId: "stage.find-suitcase" }],
        hasWorldFlag: flagAlwaysSet
      })
    ).toBe(true);

    // Stage advances; flag is still set but the binding should retire
    expect(
      evaluateRegionQuestBinding(binding, {
        activeQuests: [{ questDefinitionId: "quest.find-the-luggage", stageId: "stage.return-to-counter" }],
        hasWorldFlag: flagAlwaysSet
      })
    ).toBe(false);
  });

  it("a binding matches any quest in progress, not just the first", () => {
    // Which quest the player follows in their journal is a display choice and
    // must not decide whether a door is passable.
    const binding = {
      questDefinitionId: "quest.find-the-luggage",
      questStageId: "stage.find-suitcase",
      worldFlagEquals: null
    };
    expect(
      evaluateRegionQuestBinding(binding, {
        activeQuests: [
          { questDefinitionId: "quest.other", stageId: "stage.one" },
          { questDefinitionId: "quest.find-the-luggage", stageId: "stage.find-suitcase" }
        ]
      })
    ).toBe(true);
  });

  it("does not satisfy a binding from two different quests", () => {
    // The quest clause and the stage clause are checked against the SAME
    // quest. One active quest supplies the id, another the stage, and neither
    // satisfies the binding on its own.
    const binding = {
      questDefinitionId: "quest.find-the-luggage",
      questStageId: "stage.find-suitcase",
      worldFlagEquals: null
    };
    expect(
      evaluateRegionQuestBinding(binding, {
        activeQuests: [
          { questDefinitionId: "quest.find-the-luggage", stageId: "stage.elsewhere" },
          { questDefinitionId: "quest.other", stageId: "stage.find-suitcase" }
        ]
      })
    ).toBe(false);
  });
});

function regionWithVolumes(
  volumes: RegionDocument["volumes"]
): RegionDocument {
  return {
    placedLights: [],
    identity: { id: "region-trig", schema: "RegionDocument", version: 1 },
    displayName: "Trigger Region",
    placement: { gridPosition: { x: 0, y: 0 }, placementPolicy: "world-grid" },
    placedAssets: [],
    folders: [],
    environmentBinding: { defaultEnvironmentId: null },
    areas: [],
    volumes,
    behaviors: [],
    landscape: createDefaultRegionLandscapeState({}),
    markers: [],
    npcPresences: [],
    itemPresences: [],
    playerPresence: null
  };
}

describe("volume crossings (extends the area tracker)", () => {
  const bell = createRegionVolumeDefinition({
    volumeId: "vol:bell",
    bounds: { kind: "box", center: [10, 0, 0], size: [4, 4, 4] },
    onEnterActions: [{ type: "playCue", cueDefinitionId: "cue:bell" }],
    onExitActions: [{ type: "stopCue", cueDefinitionId: "cue:bell" }]
  });

  it("fires once on entry and re-arms only after an exit + re-entry", () => {
    const tracker = createSpatialAreaTracker(regionWithVolumes([bell]));
    const at = (x: number) => tracker.resolve("player", { x, y: 0, z: 0 });

    // Outside: no edge.
    expect(at(0).volumesEntered).toHaveLength(0);
    // Cross in: one enter edge.
    expect(at(10).volumesEntered.map((v) => v.volumeId)).toEqual(["vol:bell"]);
    // Still inside: no re-fire.
    expect(at(10).volumesEntered).toHaveLength(0);
    // Cross out: exit edge.
    expect(at(0).volumesExited.map((v) => v.volumeId)).toEqual(["vol:bell"]);
    // Re-enter: re-armed.
    expect(at(10).volumesEntered.map((v) => v.volumeId)).toEqual(["vol:bell"]);
  });

  it("reports every overlapping volume the point is inside", () => {
    const echo = createRegionVolumeDefinition({
      volumeId: "vol:echo",
      bounds: { kind: "box", center: [10, 0, 0], size: [6, 4, 6] },
      onEnterActions: [{ type: "playCue", cueDefinitionId: "cue:echo" }]
    });
    const tracker = createSpatialAreaTracker(regionWithVolumes([bell, echo]));
    tracker.resolve("player", { x: 0, y: 0, z: 0 });
    const entered = tracker.resolve("player", { x: 10, y: 0, z: 0 });
    expect(entered.volumesEntered.map((v) => v.volumeId).sort()).toEqual([
      "vol:bell",
      "vol:echo"
    ]);
  });

  it("does NOT fire when the entity SPAWNS inside a volume", () => {
    // The first resolve primes the inside-set without emitting edges, so
    // loading a save standing inside a volume does not re-run its enter
    // actions. Only a genuine crossing fires.
    const tracker = createSpatialAreaTracker(regionWithVolumes([bell]));
    const first = tracker.resolve("player", { x: 10, y: 0, z: 0 }); // spawn INSIDE
    expect(first.volumesEntered).toHaveLength(0);
    expect(first.volumesExited).toHaveLength(0);
    // Walking out then back in fires normally (primed, not suppressed).
    expect(
      tracker.resolve("player", { x: 0, y: 0, z: 0 }).volumesExited
    ).toHaveLength(1);
    expect(
      tracker.resolve("player", { x: 10, y: 0, z: 0 }).volumesEntered
    ).toHaveLength(1);
  });

  it("ignores a volume with no actions on either side", () => {
    // Nothing to run, so nothing to track -- a label-only volume is not a
    // crossing event.
    const label = createRegionVolumeDefinition({
      volumeId: "vol:market",
      roles: ["label"],
      bounds: { kind: "box", center: [10, 0, 0], size: [4, 4, 4] }
    });
    const tracker = createSpatialAreaTracker(regionWithVolumes([label]));
    tracker.resolve("player", { x: 0, y: 0, z: 0 });
    expect(
      tracker.resolve("player", { x: 10, y: 0, z: 0 }).volumesEntered
    ).toHaveLength(0);
  });
});
