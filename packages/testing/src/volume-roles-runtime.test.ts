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
      worldFlagEquals: { key: "freed", valueType: "boolean", value: "true" }
    }
  });

  it("walls you in until the flag flips, then lets you out", () => {
    const world = buildCollisionWorld([], [containment]);
    expect(world.gates).toHaveLength(1);

    // Flag unset -> gate blocking: can't leave.
    applyVolumeColliderGates(world, { activeQuest: null, hasWorldFlag: () => false });
    const trapped = resolveMove({ x: 0, z: 0, radius: R }, { x: 5, z: 0 }, world);
    expect(0 + trapped.x).toBeCloseTo(1.5, 5);

    // Flag set -> gate open: walk straight out.
    applyVolumeColliderGates(world, {
      activeQuest: null,
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
        { activeQuest: null }
      )
    ).toBe(true);
  });

  it("a world-flag clause fails closed without the predicate, matches with it", () => {
    const binding = {
      questDefinitionId: null,
      questStageId: null,
      worldFlagEquals: { key: "k", valueType: "boolean" as const, value: "true" }
    };
    expect(evaluateRegionQuestBinding(binding, { activeQuest: null })).toBe(false);
    expect(
      evaluateRegionQuestBinding(binding, {
        activeQuest: null,
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
        activeQuest: { questDefinitionId: "q1", stageId: "s2" }
      })
    ).toBe(true);
    expect(
      evaluateRegionQuestBinding(binding, {
        activeQuest: { questDefinitionId: "q1", stageId: "other" }
      })
    ).toBe(false);
  });

  it("coerces authored flag values", () => {
    expect(
      coerceWorldFlagValue({ key: "k", valueType: "boolean", value: null })
    ).toBe(true);
    expect(
      coerceWorldFlagValue({ key: "k", valueType: "number", value: "3" })
    ).toBe(3);
  });

  it("write value is always the declared type (never boolean into a number slot)", () => {
    expect(
      resolveWorldFlagWriteValue({ key: "k", valueType: "number", value: "7" })
    ).toBe(7);
    // Valueless declarations fall back to the TYPE's zero, not `true`.
    expect(
      resolveWorldFlagWriteValue({ key: "k", valueType: "number", value: null })
    ).toBe(0);
    expect(
      resolveWorldFlagWriteValue({ key: "k", valueType: "string", value: null })
    ).toBe("");
    expect(
      resolveWorldFlagWriteValue({ key: "k", valueType: "boolean", value: null })
    ).toBe(true);
  });
});

function regionWithVolumes(
  volumes: RegionDocument["volumes"]
): RegionDocument {
  return {
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
    gameplayPlacements: []
  };
}

describe("069.5 — on-enter trigger tracker (extends the area tracker)", () => {
  const trigger = createRegionVolumeDefinition({
    volumeId: "trig:bell",
    roles: ["trigger"],
    bounds: { kind: "box", center: [10, 0, 0], size: [4, 4, 4] },
    trigger: {
      timing: "on-enter",
      action: { audioCueId: "cue:bell", setWorldFlag: null }
    }
  });

  it("fires once on entry and re-arms only after an exit + re-entry", () => {
    const tracker = createSpatialAreaTracker(regionWithVolumes([trigger]));
    const at = (x: number) => tracker.resolve("player", { x, y: 0, z: 0 });

    // Outside: no edge.
    expect(at(0).triggersEntered).toHaveLength(0);
    // Cross in: one enter edge.
    const entered = at(10);
    expect(entered.triggersEntered.map((v) => v.volumeId)).toEqual(["trig:bell"]);
    // Still inside: no re-fire.
    expect(at(10).triggersEntered).toHaveLength(0);
    // Cross out: exit edge.
    expect(at(0).triggersExited.map((v) => v.volumeId)).toEqual(["trig:bell"]);
    // Re-enter: re-armed.
    expect(at(10).triggersEntered.map((v) => v.volumeId)).toEqual(["trig:bell"]);
  });

  it("reports every overlapping trigger volume the point is inside", () => {
    const other = createRegionVolumeDefinition({
      volumeId: "trig:echo",
      roles: ["trigger"],
      bounds: { kind: "box", center: [10, 0, 0], size: [6, 4, 6] },
      trigger: {
        timing: "on-enter",
        action: { audioCueId: "cue:echo", setWorldFlag: null }
      }
    });
    const tracker = createSpatialAreaTracker(regionWithVolumes([trigger, other]));
    tracker.resolve("player", { x: 0, y: 0, z: 0 });
    const entered = tracker.resolve("player", { x: 10, y: 0, z: 0 });
    expect(entered.triggersEntered.map((v) => v.volumeId).sort()).toEqual([
      "trig:bell",
      "trig:echo"
    ]);
  });

  it("does NOT fire when the entity SPAWNS inside a trigger (prime-on-first-resolve)", () => {
    // Regression (mini-review r2 #2): the first resolve primes the inside-set
    // without emitting edges — a spawn inside an on-enter trigger must not
    // play the cue / set the flag on load. Only a genuine crossing fires.
    const tracker = createSpatialAreaTracker(regionWithVolumes([trigger]));
    const first = tracker.resolve("player", { x: 10, y: 0, z: 0 }); // spawn INSIDE
    expect(first.triggersEntered).toHaveLength(0);
    expect(first.triggersExited).toHaveLength(0);
    // Walking out then back in fires normally (primed, not suppressed).
    expect(
      tracker.resolve("player", { x: 0, y: 0, z: 0 }).triggersExited
    ).toHaveLength(1);
    expect(
      tracker.resolve("player", { x: 10, y: 0, z: 0 }).triggersEntered
    ).toHaveLength(1);
  });

  it("ignores 'always' triggers (those are the continuous ambient bed)", () => {
    const always = createRegionVolumeDefinition({
      volumeId: "trig:wind",
      roles: ["trigger"],
      bounds: { kind: "box", center: [10, 0, 0], size: [4, 4, 4] },
      trigger: {
        timing: "always",
        action: { audioCueId: "cue:wind", setWorldFlag: null }
      }
    });
    const tracker = createSpatialAreaTracker(regionWithVolumes([always]));
    tracker.resolve("player", { x: 0, y: 0, z: 0 });
    expect(tracker.resolve("player", { x: 10, y: 0, z: 0 }).triggersEntered).toHaveLength(
      0
    );
  });
});
