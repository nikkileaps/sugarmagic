/**
 * targets/web/src/save/hostPlayerParticipant.test.ts
 *
 * Purpose: Verifies the host.player SaveParticipant factory
 * serializes live world state and threads deserialized slices
 * through the applyRestoredSlice callback so the runtime host
 * can drive spawn resolution from restored values.
 *
 * Implements: Plan 055 §055.3 tests
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import { PlayerControlled, Position, World } from "@sugarmagic/runtime-core";
import {
  HOST_PLAYER_PARTICIPANT_ID,
  HOST_PLAYER_SLICE_SCHEMA_VERSION,
  type HostPlayerSlice,
  createHostPlayerParticipant
} from "./hostPlayerParticipant";

function makeWorldWithPlayerAt(x: number, y: number, z: number): World {
  const world = new World();
  const entity = world.createEntity();
  world.addComponent(entity, new PlayerControlled());
  world.addComponent(entity, new Position(x, y, z));
  return world;
}

describe("createHostPlayerParticipant", () => {
  it("declares participantId 'host.player' at tier host-owned, schemaVersion 1", () => {
    const participant = createHostPlayerParticipant({
      getWorld: () => null,
      getCurrentRegionId: () => null,
      getPlayerYaw: () => null,
      applyRestoredSlice: () => {}
    });
    expect(participant.participantId).toBe(HOST_PLAYER_PARTICIPANT_ID);
    expect(participant.tier).toBe("host-owned");
    expect(participant.schemaVersion).toBe(HOST_PLAYER_SLICE_SCHEMA_VERSION);
  });

  describe("serialize", () => {
    it("returns live player position + current region id", () => {
      const world = makeWorldWithPlayerAt(3, 1, 5);
      const participant = createHostPlayerParticipant({
        getWorld: () => world,
        getCurrentRegionId: () => "region:hollow",
      getPlayerYaw: () => null,
        applyRestoredSlice: () => {}
      });
      expect(participant.serialize()).toEqual({
        currentRegionId: "region:hollow",
        playerPosition: { x: 3, y: 1, z: 5 },
        playerYaw: null
      });
    });

    it("returns null position when world is null (before host.start)", () => {
      const participant = createHostPlayerParticipant({
        getWorld: () => null,
        getCurrentRegionId: () => "region:hollow",
      getPlayerYaw: () => null,
        applyRestoredSlice: () => {}
      });
      expect(participant.serialize()).toEqual({
        currentRegionId: "region:hollow",
        playerPosition: null,
        playerYaw: null
      });
    });

    it("returns null position when the world has no player entity", () => {
      const world = new World(); // no player entity spawned
      const participant = createHostPlayerParticipant({
        getWorld: () => world,
        getCurrentRegionId: () => null,
      getPlayerYaw: () => null,
        applyRestoredSlice: () => {}
      });
      expect(participant.serialize()).toEqual({
        currentRegionId: null,
        playerPosition: null,
        playerYaw: null
      });
    });

    it("records which way the player is facing", () => {
      // Position alone puts a returning player in the right spot looking
      // the wrong way -- and after a region transition, "the wrong way" is
      // usually back at the wall they arrived through.
      const world = new World();
      const entity = world.createEntity();
      world.addComponent(entity, new PlayerControlled());
      world.addComponent(entity, new Position(3, 1, 5));
      const participant = createHostPlayerParticipant({
        getWorld: () => world,
        getCurrentRegionId: () => "region:hollow",
        getPlayerYaw: () => 1.5,
        applyRestoredSlice: () => {}
      });

      expect(participant.serialize().playerYaw).toBe(1.5);
    });
  });

  describe("deserialize", () => {
    it("hands the slice's data to applyRestoredSlice", () => {
      const apply = vi.fn();
      const participant = createHostPlayerParticipant({
        getWorld: () => null,
        getCurrentRegionId: () => null,
      getPlayerYaw: () => null,
        applyRestoredSlice: apply
      });
      const restored: HostPlayerSlice = {
        currentRegionId: "region:garden",
        playerPosition: { x: 2, y: 0, z: 4 }
      };
      participant.deserialize({ schemaVersion: 1, data: restored });
      expect(apply).toHaveBeenCalledExactlyOnceWith(restored);
    });

    it("hands null to applyRestoredSlice when no slice was stored", () => {
      const apply = vi.fn();
      const participant = createHostPlayerParticipant({
        getWorld: () => null,
        getCurrentRegionId: () => null,
      getPlayerYaw: () => null,
        applyRestoredSlice: apply
      });
      participant.deserialize(null);
      expect(apply).toHaveBeenCalledExactlyOnceWith(null);
    });
  });
});
