/**
 * packages/testing/src/playthrough-identity-save-slice.test.ts
 *
 * Purpose: Verifies the playthrough.identity save-participant +
 * its `getActivePlaythroughId` registry getter, and the
 * `getActiveUserId` addition to the identity registry.
 *
 * The load-bearing behavior (Plan 073 §D1): deserialize(null)
 * MINTS a fresh id (New Game / first boot / pre-073 save);
 * deserialize(present slice) ADOPTS the stored id (Continue). A
 * New Game -> reload therefore yields a DIFFERENT playthroughId
 * than the prior playthrough, which is exactly how downstream
 * plugin stores detect "start fresh".
 *
 * Implements: Plan 073 §073.1 tests
 *
 * Status: active
 */

import { afterEach, describe, expect, it } from "vitest";
import type { SaveSlice, User, UserIdentityProvider } from "@sugarmagic/runtime-core";
import {
  createPlaythroughIdentitySaveParticipant,
  getActivePlaythroughId,
  getActiveUserId,
  registerActiveIdentityProvider,
  resetActivePlaythroughIdForTests,
  type PlaythroughIdentitySlice
} from "@sugarmagic/runtime-core";

afterEach(() => {
  resetActivePlaythroughIdForTests();
  registerActiveIdentityProvider(null);
});

/** Deterministic uuid factory: emits mint-1, mint-2, ... so tests
 *  can assert a fresh mint vs. an adopted id. */
function sequentialUuids(): () => string {
  let n = 0;
  return () => `mint-${++n}`;
}

function sliceOf(playthroughId: string): SaveSlice<PlaythroughIdentitySlice> {
  return { schemaVersion: 1, data: { playthroughId } };
}

describe("playthrough.identity save participant", () => {
  it("mints a fresh id on deserialize(null) and exposes it via the registry", () => {
    const participant = createPlaythroughIdentitySaveParticipant({
      randomUuid: sequentialUuids()
    });
    expect(getActivePlaythroughId()).toBeNull();

    participant.deserialize(null);

    expect(getActivePlaythroughId()).toBe("mint-1");
    expect(participant.serialize()).toEqual({ playthroughId: "mint-1" });
  });

  it("adopts a stored id on deserialize(present slice) (Continue)", () => {
    const participant = createPlaythroughIdentitySaveParticipant({
      randomUuid: sequentialUuids()
    });

    participant.deserialize(sliceOf("existing-playthrough"));

    expect(getActivePlaythroughId()).toBe("existing-playthrough");
    // No mint consumed — serialize round-trips the adopted id.
    expect(participant.serialize()).toEqual({
      playthroughId: "existing-playthrough"
    });
  });

  it("mints a NEW id when the same participant re-boots into an absent slice (New Game)", () => {
    const mint = sequentialUuids();
    const first = createPlaythroughIdentitySaveParticipant({ randomUuid: mint });
    first.deserialize(null);
    const before = getActivePlaythroughId();

    // New Game deletes the save row + reloads -> a fresh participant
    // boots with no slice.
    resetActivePlaythroughIdForTests();
    const afterReload = createPlaythroughIdentitySaveParticipant({
      randomUuid: mint
    });
    afterReload.deserialize(null);
    const after = getActivePlaythroughId();

    expect(before).toBe("mint-1");
    expect(after).toBe("mint-2");
    expect(after).not.toBe(before);
  });

  it("re-mints when the stored id is blank or malformed", () => {
    const participant = createPlaythroughIdentitySaveParticipant({
      randomUuid: sequentialUuids()
    });

    participant.deserialize({
      schemaVersion: 1,
      data: { playthroughId: "   " } as PlaythroughIdentitySlice
    });

    expect(getActivePlaythroughId()).toBe("mint-1");
  });

  it("declares host-owned tier so it settles in Phase 1", () => {
    const participant = createPlaythroughIdentitySaveParticipant();
    expect(participant.tier).toBe("host-owned");
    expect(participant.participantId).toBe("playthrough.identity");
    expect(participant.schemaVersion).toBe(1);
  });
});

describe("getActiveUserId", () => {
  it("returns null when no identity provider is registered", () => {
    expect(getActiveUserId()).toBeNull();
  });

  it("reads the active provider's current userId", () => {
    const user: User = {
      userId: "user-42",
      displayName: null,
      email: null,
      isAnonymous: true,
      createdAt: "2026-07-21T00:00:00.000Z"
    };
    const provider = {
      currentUser: () => user,
      onChange: () => () => {},
      signIn: async () => user,
      signUp: async () => user,
      signOut: async () => {},
      linkAnonymousToCredentials: async () => user,
      getAccessToken: async () => null
    } satisfies UserIdentityProvider;

    registerActiveIdentityProvider(provider);

    expect(getActiveUserId()).toBe("user-42");
  });

  it("returns null when the provider has no current user", () => {
    const provider = {
      currentUser: () => null,
      onChange: () => () => {},
      signIn: async () => {
        throw new Error("unused");
      },
      signUp: async () => {
        throw new Error("unused");
      },
      signOut: async () => {},
      linkAnonymousToCredentials: async () => {
        throw new Error("unused");
      },
      getAccessToken: async () => null
    } satisfies UserIdentityProvider;

    registerActiveIdentityProvider(provider);

    expect(getActiveUserId()).toBeNull();
  });
});
