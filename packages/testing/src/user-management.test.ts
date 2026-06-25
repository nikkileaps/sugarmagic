import { describe, expect, it } from "vitest";
import {
  GAME_SAVE_SCHEMA_VERSION,
  NotSupportedError,
  type GameSave,
  type GameSavePayload,
  type GameSaveStore,
  type SignInWithPasswordInput,
  type User,
  type UserIdentityChangeListener,
  type UserIdentityProvider
} from "@sugarmagic/runtime-core";

// Story 47.1 — contract-shape assertions. No implementations yet;
// these tests are deliberately typecheck-heavy. Stories 47.3+ add
// real round-trip coverage against concrete implementations.

describe("UserIdentityProvider contract", () => {
  it("exports a constructable User shape", () => {
    // Typecheck: the User shape compiles and the fields carry the
    // types Plan 047 §47.1 specifies. If a future change tightens
    // the shape, this test catches the unintended break.
    const user: User = {
      userId: "u_abc",
      displayName: "Nikki",
      email: "nikki@example.com",
      isAnonymous: false,
      createdAt: new Date(0).toISOString()
    };
    expect(user.userId).toBe("u_abc");
    expect(user.isAnonymous).toBe(false);
  });

  it("accepts an anonymous User with null displayName + email", () => {
    const anon: User = {
      userId: "u_anon",
      displayName: null,
      email: null,
      isAnonymous: true,
      createdAt: new Date(0).toISOString()
    };
    expect(anon.isAnonymous).toBe(true);
    expect(anon.displayName).toBeNull();
    expect(anon.email).toBeNull();
  });

  it("typechecks a UserIdentityProvider implementation", () => {
    // Build a no-op provider against the interface to prove the
    // shape compiles. Future implementations (anonymous-local in
    // story 47.3, supabase in 47.7) will replace this with real
    // round-trip coverage.
    const noopUser: User = {
      userId: "u_test",
      displayName: null,
      email: null,
      isAnonymous: true,
      createdAt: new Date(0).toISOString()
    };
    const listeners: UserIdentityChangeListener[] = [];
    const provider: UserIdentityProvider = {
      currentUser: () => noopUser,
      onChange: (listener) => {
        listeners.push(listener);
        return () => {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        };
      },
      signIn: async () => {
        throw new NotSupportedError("noop");
      },
      signUp: async () => {
        throw new NotSupportedError("noop");
      },
      signOut: async () => {
        /* no session */
      },
      linkAnonymousToCredentials: async () => {
        throw new NotSupportedError("noop");
      }
    };
    expect(provider.currentUser()?.userId).toBe("u_test");

    // onChange returns an unsubscribe function.
    const unsubscribe = provider.onChange(() => undefined);
    expect(typeof unsubscribe).toBe("function");
    unsubscribe();
  });

  it("NotSupportedError carries a suggested plugin id when given", () => {
    const error = new NotSupportedError(
      "credentialed sign-in requires SugarProfile",
      "sugarprofile"
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("NotSupportedError");
    expect(error.suggestedPluginId).toBe("sugarprofile");
  });

  it("NotSupportedError suggestedPluginId is null when omitted", () => {
    const error = new NotSupportedError("not supported");
    expect(error.suggestedPluginId).toBeNull();
  });

  it("typechecks the SignInWithPasswordInput shape", () => {
    const input: SignInWithPasswordInput = {
      email: "nikki@example.com",
      password: "hunter2"
    };
    expect(input.email).toBe("nikki@example.com");
  });
});

describe("GameSaveStore contract", () => {
  it("pins GAME_SAVE_SCHEMA_VERSION to a positive integer", () => {
    expect(typeof GAME_SAVE_SCHEMA_VERSION).toBe("number");
    expect(Number.isInteger(GAME_SAVE_SCHEMA_VERSION)).toBe(true);
    expect(GAME_SAVE_SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("ships at schema version 1 in story 47.1", () => {
    // Bumping this constant should be a deliberate event — every
    // implemented store reads it, every plugin contributing a custom
    // store reads it. The test pins the v1 number so a future bump
    // forces an intentional update here + a migration story.
    expect(GAME_SAVE_SCHEMA_VERSION).toBe(1);
  });

  it("typechecks a GameSavePayload with all-null defaults", () => {
    // Brand-new save: no region entered, no quest accepted, player
    // hasn't moved from spawn yet. All fields nullable per the
    // contract; runtime falls back to authored defaults from
    // boot.json when a field is null.
    const payload: GameSavePayload = {
      currentRegionId: null,
      currentQuestId: null,
      playerPosition: null
    };
    expect(payload.currentRegionId).toBeNull();
  });

  it("typechecks a GameSavePayload with populated state", () => {
    const payload: GameSavePayload = {
      currentRegionId: "hollow-station",
      currentQuestId: "find-the-cat",
      playerPosition: { x: 12.5, y: 0, z: -8.25 }
    };
    expect(payload.currentRegionId).toBe("hollow-station");
    expect(payload.playerPosition?.x).toBe(12.5);
  });

  it("typechecks a GameSave record", () => {
    const save: GameSave = {
      userId: "u_abc",
      lastPlayed: new Date(0).toISOString(),
      schemaVersion: GAME_SAVE_SCHEMA_VERSION,
      payload: {
        currentRegionId: "hollow-station",
        currentQuestId: null,
        playerPosition: null
      }
    };
    expect(save.userId).toBe("u_abc");
    expect(save.schemaVersion).toBe(GAME_SAVE_SCHEMA_VERSION);
  });

  it("typechecks a GameSaveStore implementation", () => {
    // In-memory store proves the interface shape compiles. Story
    // 47.4 lands the real IndexedDB-backed default.
    const records = new Map<string, GameSave>();
    const store: GameSaveStore = {
      load: async (userId) => records.get(userId) ?? null,
      save: async (userId, save) => {
        records.set(userId, save);
      },
      clear: async (userId) => {
        records.delete(userId);
      }
    };
    expect(typeof store.load).toBe("function");
    expect(typeof store.save).toBe("function");
    expect(typeof store.clear).toBe("function");
  });
});
