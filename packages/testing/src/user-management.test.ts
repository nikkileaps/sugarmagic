import { describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  createDefaultMechanicsDefinition,
  createDefaultPlayerDefinition
} from "@sugarmagic/domain";
import {
  createAnonymousLocalIdentityProvider,
  createIndexedDBGameSaveStore,
  createRuntimeBootModel,
  createRuntimePluginManager,
  createSessionHudCard,
  GAME_SAVE_SCHEMA_VERSION,
  NotSupportedError,
  pickActiveRegionId,
  Position,
  resolveActiveGameSaveStore,
  resolveActiveIdentityProvider,
  spawnRuntimePlayerEntity,
  World,
  type GameSave,
  type GameSavePayload,
  type GameSaveStore,
  type GameSaveStoreContribution,
  type IdentityProviderContribution,
  type RuntimePluginInstance,
  type SignInWithPasswordInput,
  type User,
  type UserIdentityChangeListener,
  type UserIdentityProvider
} from "@sugarmagic/runtime-core";

function createFakeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => Array.from(data.keys())[index] ?? null,
    removeItem: (key) => {
      data.delete(key);
    },
    setItem: (key, value) => {
      data.set(key, value);
    }
  };
}

function createSequentialUuids(prefix: string): () => string {
  let counter = 0;
  return () => `${prefix}${counter++}`;
}

function makeStubUser(overrides: Partial<User> = {}): User {
  return {
    userId: "u_stub",
    displayName: null,
    email: null,
    isAnonymous: true,
    createdAt: new Date(0).toISOString(),
    ...overrides
  };
}

function makeStubIdentityProvider(label: string): UserIdentityProvider {
  const user = makeStubUser({ userId: `u_${label}` });
  return {
    currentUser: () => user,
    onChange: () => () => undefined,
    signIn: async () => {
      throw new NotSupportedError(`stub:${label}`);
    },
    signUp: async () => {
      throw new NotSupportedError(`stub:${label}`);
    },
    signOut: async () => undefined,
    linkAnonymousToCredentials: async () => {
      throw new NotSupportedError(`stub:${label}`);
    }
  };
}

function makeStubGameSaveStore(label: string): GameSaveStore {
  const records = new Map<string, GameSave>();
  return {
    load: async (userId) => {
      const record = records.get(userId);
      return record ? { ...record, payload: { ...record.payload } } : null;
    },
    save: async (userId, save) => {
      records.set(userId, {
        ...save,
        userId,
        lastPlayed: `${label}:${save.lastPlayed}`
      });
    },
    clear: async (userId) => {
      records.delete(userId);
    }
  };
}

function makeIdentityProviderContribution(args: {
  pluginId: string;
  contributionId: string;
  priority: number;
  provider: UserIdentityProvider;
  status?: "placeholder" | "ready";
}): IdentityProviderContribution {
  return {
    pluginId: args.pluginId,
    contributionId: args.contributionId,
    kind: "identity.provider",
    displayName: `${args.pluginId} identity`,
    priority: args.priority,
    payload: {
      providerId: `${args.pluginId}.identity`,
      summary: `${args.pluginId} identity provider`,
      status: args.status ?? "ready",
      provider: args.provider
    }
  };
}

function makeGameSaveStoreContribution(args: {
  pluginId: string;
  contributionId: string;
  priority: number;
  store: GameSaveStore;
  status?: "placeholder" | "ready";
}): GameSaveStoreContribution {
  return {
    pluginId: args.pluginId,
    contributionId: args.contributionId,
    kind: "save.store",
    displayName: `${args.pluginId} save store`,
    priority: args.priority,
    payload: {
      storeId: `${args.pluginId}.save`,
      summary: `${args.pluginId} save store`,
      status: args.status ?? "ready",
      store: args.store
    }
  };
}

function buildManager(plugins: RuntimePluginInstance[]) {
  return createRuntimePluginManager({
    boot: createRuntimeBootModel({
      hostKind: "studio",
      compileProfile: "authoring-preview",
      contentSource: "authored-game-root"
    }),
    plugins
  });
}

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

// Story 47.2 — contribution kinds + boot-time resolvers. The two
// kinds (identity.provider, save.store) flow through the existing
// RuntimePluginContribution union; the resolvers pick the active
// implementation at boot, falling through to a supplied fallback
// when no plugin contributes.
describe("identity.provider + save.store contribution kinds", () => {
  it("resolveActiveIdentityProvider returns the fallback when no plugin contributes", () => {
    const fallback = makeStubIdentityProvider("fallback");
    const manager = buildManager([]);
    const resolved = resolveActiveIdentityProvider(manager, fallback);
    expect(resolved).toBe(fallback);
    expect(resolved.currentUser()?.userId).toBe("u_fallback");
  });

  it("resolveActiveIdentityProvider returns the single contributing provider", () => {
    const fallback = makeStubIdentityProvider("fallback");
    const supabase = makeStubIdentityProvider("supabase");
    const contribution = makeIdentityProviderContribution({
      pluginId: "sugarprofile",
      contributionId: "sugarprofile.identity",
      priority: 100,
      provider: supabase
    });
    const manager = buildManager([
      {
        pluginId: "sugarprofile",
        displayName: "SugarProfile",
        contributions: [contribution]
      }
    ]);
    const resolved = resolveActiveIdentityProvider(manager, fallback);
    expect(resolved).toBe(supabase);
    expect(resolved.currentUser()?.userId).toBe("u_supabase");
  });

  it("resolveActiveIdentityProvider returns the highest-priority contribution when two plugins contribute", () => {
    const fallback = makeStubIdentityProvider("fallback");
    const low = makeStubIdentityProvider("low");
    const high = makeStubIdentityProvider("high");
    const manager = buildManager([
      {
        pluginId: "low-plugin",
        displayName: "Low",
        contributions: [
          makeIdentityProviderContribution({
            pluginId: "low-plugin",
            contributionId: "low.identity",
            priority: 10,
            provider: low
          })
        ]
      },
      {
        pluginId: "high-plugin",
        displayName: "High",
        contributions: [
          makeIdentityProviderContribution({
            pluginId: "high-plugin",
            contributionId: "high.identity",
            priority: 200,
            provider: high
          })
        ]
      }
    ]);
    const warn = vi.fn();
    const resolved = resolveActiveIdentityProvider(manager, fallback, {
      warn
    });
    expect(resolved).toBe(high);
    expect(warn).toHaveBeenCalledTimes(1);
    const [message, payload] = warn.mock.calls[0];
    expect(message).toContain("identity.provider");
    expect((payload as { contributingPluginIds: string[] }).contributingPluginIds)
      .toEqual(["low-plugin", "high-plugin"]);
  });

  it("resolveActiveIdentityProvider does NOT warn for a single contributor", () => {
    const fallback = makeStubIdentityProvider("fallback");
    const supabase = makeStubIdentityProvider("supabase");
    const manager = buildManager([
      {
        pluginId: "sugarprofile",
        displayName: "SugarProfile",
        contributions: [
          makeIdentityProviderContribution({
            pluginId: "sugarprofile",
            contributionId: "sugarprofile.identity",
            priority: 100,
            provider: supabase
          })
        ]
      }
    ]);
    const warn = vi.fn();
    resolveActiveIdentityProvider(manager, fallback, { warn });
    expect(warn).not.toHaveBeenCalled();
  });

  it("resolveActiveGameSaveStore returns the fallback when no plugin contributes", () => {
    const fallback = makeStubGameSaveStore("fallback");
    const manager = buildManager([]);
    const resolved = resolveActiveGameSaveStore(manager, fallback);
    expect(resolved).toBe(fallback);
  });

  it("resolveActiveGameSaveStore returns the single contributing store", () => {
    const fallback = makeStubGameSaveStore("fallback");
    const cloud = makeStubGameSaveStore("cloud");
    const manager = buildManager([
      {
        pluginId: "sugarprofile",
        displayName: "SugarProfile",
        contributions: [
          makeGameSaveStoreContribution({
            pluginId: "sugarprofile",
            contributionId: "sugarprofile.save",
            priority: 100,
            store: cloud
          })
        ]
      }
    ]);
    const resolved = resolveActiveGameSaveStore(manager, fallback);
    expect(resolved).toBe(cloud);
  });

  it("resolveActiveGameSaveStore returns the highest-priority contribution when two plugins contribute", () => {
    const fallback = makeStubGameSaveStore("fallback");
    const low = makeStubGameSaveStore("low");
    const high = makeStubGameSaveStore("high");
    const manager = buildManager([
      {
        pluginId: "low-plugin",
        displayName: "Low",
        contributions: [
          makeGameSaveStoreContribution({
            pluginId: "low-plugin",
            contributionId: "low.save",
            priority: 10,
            store: low
          })
        ]
      },
      {
        pluginId: "high-plugin",
        displayName: "High",
        contributions: [
          makeGameSaveStoreContribution({
            pluginId: "high-plugin",
            contributionId: "high.save",
            priority: 200,
            store: high
          })
        ]
      }
    ]);
    const warn = vi.fn();
    const resolved = resolveActiveGameSaveStore(manager, fallback, { warn });
    expect(resolved).toBe(high);
    expect(warn).toHaveBeenCalledTimes(1);
    const [message] = warn.mock.calls[0];
    expect(message).toContain("save.store");
  });

  it("manager.getContributions exposes identity.provider + save.store under their kind keys", () => {
    const identityProvider = makeStubIdentityProvider("registry");
    const store = makeStubGameSaveStore("registry");
    const manager = buildManager([
      {
        pluginId: "sugarprofile",
        displayName: "SugarProfile",
        contributions: [
          makeIdentityProviderContribution({
            pluginId: "sugarprofile",
            contributionId: "sugarprofile.identity",
            priority: 100,
            provider: identityProvider
          }),
          makeGameSaveStoreContribution({
            pluginId: "sugarprofile",
            contributionId: "sugarprofile.save",
            priority: 100,
            store
          })
        ]
      }
    ]);
    const identityContributions = manager.getContributions("identity.provider");
    const saveContributions = manager.getContributions("save.store");
    expect(identityContributions).toHaveLength(1);
    expect(identityContributions[0].payload.provider).toBe(identityProvider);
    expect(saveContributions).toHaveLength(1);
    expect(saveContributions[0].payload.store).toBe(store);
  });
});

// Story 47.3 — default AnonymousLocalIdentityProvider. The "no
// plugin installed" identity path: persists a UUIDv4 + createdAt in
// localStorage so the same browser carries the same identity across
// reloads. Credentialed operations throw NotSupportedError pointing
// at SugarProfile.
describe("AnonymousLocalIdentityProvider", () => {
  it("generates + persists a UUID on first currentUser call", () => {
    const storage = createFakeStorage();
    const provider = createAnonymousLocalIdentityProvider({
      storage,
      randomUuid: createSequentialUuids("uuid-"),
      nowIso: () => "2026-06-25T00:00:00.000Z"
    });
    const user = provider.currentUser();
    expect(user).not.toBeNull();
    expect(user?.userId).toBe("uuid-0");
    expect(user?.isAnonymous).toBe(true);
    expect(user?.email).toBeNull();
    expect(user?.displayName).toBeNull();
    expect(user?.createdAt).toBe("2026-06-25T00:00:00.000Z");
    // Persistence: storage now carries the record under the canonical key.
    const raw = storage.getItem("sugarmagic.anonymous-user-id");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? "{}")).toEqual({
      version: 1,
      userId: "uuid-0",
      createdAt: "2026-06-25T00:00:00.000Z"
    });
  });

  it("returns the same userId on successive currentUser calls", () => {
    const storage = createFakeStorage();
    const provider = createAnonymousLocalIdentityProvider({
      storage,
      randomUuid: createSequentialUuids("uuid-"),
      nowIso: () => "2026-06-25T00:00:00.000Z"
    });
    const first = provider.currentUser();
    const second = provider.currentUser();
    const third = provider.currentUser();
    expect(first?.userId).toBe("uuid-0");
    expect(second?.userId).toBe("uuid-0");
    expect(third?.userId).toBe("uuid-0");
  });

  it("regenerates the UUID after the persisted record is cleared", () => {
    const storage = createFakeStorage();
    const provider = createAnonymousLocalIdentityProvider({
      storage,
      randomUuid: createSequentialUuids("uuid-"),
      nowIso: () => "2026-06-25T00:00:00.000Z"
    });
    const first = provider.currentUser();
    expect(first?.userId).toBe("uuid-0");
    storage.removeItem("sugarmagic.anonymous-user-id");
    const second = provider.currentUser();
    expect(second?.userId).toBe("uuid-1");
  });

  it("rejects credentialed sign-in with NotSupportedError naming SugarProfile", async () => {
    const provider = createAnonymousLocalIdentityProvider({
      storage: createFakeStorage(),
      randomUuid: () => "uuid-fixed",
      nowIso: () => "2026-06-25T00:00:00.000Z"
    });
    await expect(
      provider.signIn({ email: "nikki@example.com", password: "x" })
    ).rejects.toThrow(NotSupportedError);
    try {
      await provider.signIn({ email: "nikki@example.com", password: "x" });
    } catch (error) {
      expect(error).toBeInstanceOf(NotSupportedError);
      expect((error as NotSupportedError).suggestedPluginId).toBe("sugarprofile");
      expect((error as Error).message).toMatch(/SugarProfile/);
    }
  });

  it("rejects sign-up + link operations with NotSupportedError", async () => {
    const provider = createAnonymousLocalIdentityProvider({
      storage: createFakeStorage(),
      randomUuid: () => "uuid-fixed",
      nowIso: () => "2026-06-25T00:00:00.000Z"
    });
    await expect(
      provider.signUp({ email: "nikki@example.com", password: "x" })
    ).rejects.toThrow(NotSupportedError);
    await expect(
      provider.linkAnonymousToCredentials({
        email: "nikki@example.com",
        password: "x"
      })
    ).rejects.toThrow(NotSupportedError);
  });

  it("signOut is a no-op that resolves cleanly", async () => {
    const storage = createFakeStorage();
    const provider = createAnonymousLocalIdentityProvider({
      storage,
      randomUuid: createSequentialUuids("uuid-"),
      nowIso: () => "2026-06-25T00:00:00.000Z"
    });
    const before = provider.currentUser();
    await expect(provider.signOut()).resolves.toBeUndefined();
    const after = provider.currentUser();
    // Signing out of the anonymous user does NOT clear the local
    // identity; it's a no-op so UIs can call signOut() uniformly.
    expect(after?.userId).toBe(before?.userId);
  });

  it("onChange registers + unregisters listeners cleanly", () => {
    const provider = createAnonymousLocalIdentityProvider({
      storage: createFakeStorage(),
      randomUuid: () => "uuid-fixed",
      nowIso: () => "2026-06-25T00:00:00.000Z"
    });
    const listener = vi.fn();
    const unsubscribe = provider.onChange(listener);
    expect(typeof unsubscribe).toBe("function");
    // Anonymous-local never fires onChange during the page lifetime,
    // so the listener should not have been called yet.
    expect(listener).not.toHaveBeenCalled();
    // Calling unsubscribe multiple times is safe.
    unsubscribe();
    unsubscribe();
  });

  it("recovers from a corrupt persisted record by regenerating", () => {
    const storage = createFakeStorage();
    storage.setItem("sugarmagic.anonymous-user-id", "{not-json");
    const provider = createAnonymousLocalIdentityProvider({
      storage,
      randomUuid: () => "uuid-recovered",
      nowIso: () => "2026-06-25T00:00:00.000Z"
    });
    const user = provider.currentUser();
    expect(user?.userId).toBe("uuid-recovered");
  });

  it("recovers from a wrong-version persisted record by regenerating", () => {
    const storage = createFakeStorage();
    storage.setItem(
      "sugarmagic.anonymous-user-id",
      JSON.stringify({ version: 99, userId: "stale", createdAt: "irrelevant" })
    );
    const provider = createAnonymousLocalIdentityProvider({
      storage,
      randomUuid: () => "uuid-fresh",
      nowIso: () => "2026-06-25T00:00:00.000Z"
    });
    const user = provider.currentUser();
    expect(user?.userId).toBe("uuid-fresh");
  });
});

// Story 47.4 — default IndexedDBGameSaveStore. The "no plugin
// installed" save path: one IndexedDB database, one object store
// keyed by userId, load/save/clear with userId-assertion defense
// in depth. Tests run against fake-indexeddb so each test gets a
// fresh, isolated IDBFactory.
describe("IndexedDBGameSaveStore", () => {
  function makeStore(nowIso?: () => string) {
    return createIndexedDBGameSaveStore({
      indexedDB: new IDBFactory(),
      nowIso: nowIso ?? (() => "2026-06-25T12:00:00.000Z")
    });
  }

  function makePayload(overrides: Partial<{
    currentRegionId: string | null;
    currentQuestId: string | null;
    playerPosition: { x: number; y: number; z: number } | null;
  }> = {}) {
    return {
      currentRegionId: "hollow-station",
      currentQuestId: "find-the-cat",
      playerPosition: { x: 1, y: 2, z: 3 },
      ...overrides
    };
  }

  it("load of a user with no save returns null", async () => {
    const store = makeStore();
    const result = await store.load("u_never_played");
    expect(result).toBeNull();
  });

  it("save then load round-trips the payload", async () => {
    const store = makeStore(() => "2026-06-25T12:00:00.000Z");
    const payload = makePayload();
    await store.save("u_alpha", {
      userId: "u_alpha",
      lastPlayed: "stamped-at-write-time-anyway",
      schemaVersion: GAME_SAVE_SCHEMA_VERSION,
      payload
    });
    const reloaded = await store.load("u_alpha");
    expect(reloaded).not.toBeNull();
    expect(reloaded?.userId).toBe("u_alpha");
    expect(reloaded?.payload).toEqual(payload);
    // The store stamps lastPlayed + schemaVersion at write time
    // regardless of what the caller passed.
    expect(reloaded?.lastPlayed).toBe("2026-06-25T12:00:00.000Z");
    expect(reloaded?.schemaVersion).toBe(GAME_SAVE_SCHEMA_VERSION);
  });

  it("save rewrites the existing record (no duplicate rows)", async () => {
    let counter = 0;
    const store = makeStore(() => `t${counter++}`);
    await store.save("u_alpha", {
      userId: "u_alpha",
      lastPlayed: "",
      schemaVersion: GAME_SAVE_SCHEMA_VERSION,
      payload: makePayload({ currentRegionId: "first" })
    });
    await store.save("u_alpha", {
      userId: "u_alpha",
      lastPlayed: "",
      schemaVersion: GAME_SAVE_SCHEMA_VERSION,
      payload: makePayload({ currentRegionId: "second" })
    });
    const reloaded = await store.load("u_alpha");
    expect(reloaded?.payload.currentRegionId).toBe("second");
    expect(reloaded?.lastPlayed).toBe("t1");
  });

  it("clear removes the record; subsequent load returns null", async () => {
    const store = makeStore();
    await store.save("u_alpha", {
      userId: "u_alpha",
      lastPlayed: "",
      schemaVersion: GAME_SAVE_SCHEMA_VERSION,
      payload: makePayload()
    });
    expect(await store.load("u_alpha")).not.toBeNull();
    await store.clear("u_alpha");
    expect(await store.load("u_alpha")).toBeNull();
  });

  it("records for different userIds do not collide", async () => {
    const store = makeStore();
    await store.save("u_alpha", {
      userId: "u_alpha",
      lastPlayed: "",
      schemaVersion: GAME_SAVE_SCHEMA_VERSION,
      payload: makePayload({ currentRegionId: "alpha-region" })
    });
    await store.save("u_beta", {
      userId: "u_beta",
      lastPlayed: "",
      schemaVersion: GAME_SAVE_SCHEMA_VERSION,
      payload: makePayload({ currentRegionId: "beta-region" })
    });
    const alpha = await store.load("u_alpha");
    const beta = await store.load("u_beta");
    expect(alpha?.payload.currentRegionId).toBe("alpha-region");
    expect(beta?.payload.currentRegionId).toBe("beta-region");
    await store.clear("u_alpha");
    expect(await store.load("u_alpha")).toBeNull();
    // Clearing alpha does NOT affect beta.
    expect(await store.load("u_beta")).not.toBeNull();
  });

  it("save throws when the GameSave.userId disagrees with the key", async () => {
    const store = makeStore();
    await expect(
      store.save("u_alpha", {
        userId: "u_beta",
        lastPlayed: "",
        schemaVersion: GAME_SAVE_SCHEMA_VERSION,
        payload: makePayload()
      })
    ).rejects.toThrow(/Refusing to write cross-user state/);
  });

  it("load throws on an empty userId", async () => {
    const store = makeStore();
    await expect(store.load("")).rejects.toThrow(/non-empty userId/);
  });

  it("save throws on an empty userId", async () => {
    const store = makeStore();
    await expect(
      store.save("", {
        userId: "",
        lastPlayed: "",
        schemaVersion: GAME_SAVE_SCHEMA_VERSION,
        payload: makePayload()
      })
    ).rejects.toThrow(/non-empty userId/);
  });

  it("clear throws on an empty userId", async () => {
    const store = makeStore();
    await expect(store.clear("")).rejects.toThrow(/non-empty userId/);
  });

  it("two stores opened against the same factory share the underlying database", async () => {
    // Real-world usage: a single createIndexedDBGameSaveStore() per
    // page is the norm. But if two are constructed, both pointing at
    // the same IDBFactory, they should see the same data (the
    // database name + version are constants). This test asserts the
    // contract is "the database is keyed by name+version, not by
    // store-instance identity."
    const factory = new IDBFactory();
    const storeA = createIndexedDBGameSaveStore({
      indexedDB: factory,
      nowIso: () => "2026-06-25T12:00:00.000Z"
    });
    const storeB = createIndexedDBGameSaveStore({
      indexedDB: factory,
      nowIso: () => "2026-06-25T12:00:00.000Z"
    });
    await storeA.save("u_alpha", {
      userId: "u_alpha",
      lastPlayed: "",
      schemaVersion: GAME_SAVE_SCHEMA_VERSION,
      payload: makePayload({ currentRegionId: "shared" })
    });
    const fromB = await storeB.load("u_alpha");
    expect(fromB?.payload.currentRegionId).toBe("shared");
  });
});

// Story 47.5 — boot-path wiring. Pure helpers the runtime host uses
// to decide between resuming-from-save and starting-from-authored-
// defaults. The host integration itself is verified by manual
// playtest (heavy three.js / WebGL deps make Node-level integration
// testing impractical); these tests cover the swappable surface.
describe("pickActiveRegionId", () => {
  function makeSave(
    overrides: Partial<{
      currentRegionId: string | null;
      currentQuestId: string | null;
      playerPosition: { x: number; y: number; z: number } | null;
    }> = {}
  ) {
    return {
      userId: "u_alpha",
      lastPlayed: "2026-06-25T12:00:00.000Z",
      schemaVersion: GAME_SAVE_SCHEMA_VERSION,
      payload: {
        currentRegionId: "saved-region",
        currentQuestId: null,
        playerPosition: null,
        ...overrides
      }
    };
  }

  it("returns the save's currentRegionId when a save with a region is present", () => {
    expect(
      pickActiveRegionId("authored-region", makeSave({ currentRegionId: "saved" }))
    ).toBe("saved");
  });

  it("falls back to the authored region id when no save is present", () => {
    expect(pickActiveRegionId("authored-region", null)).toBe("authored-region");
  });

  it("falls back to the authored region id when the save carries a null currentRegionId", () => {
    expect(
      pickActiveRegionId("authored-region", makeSave({ currentRegionId: null }))
    ).toBe("authored-region");
  });

  it("returns the authored value unchanged when both are undefined / null", () => {
    expect(pickActiveRegionId(null, null)).toBeNull();
    expect(pickActiveRegionId(undefined, null)).toBeUndefined();
  });

  it("the save still wins even when the authored value is null / undefined", () => {
    expect(
      pickActiveRegionId(null, makeSave({ currentRegionId: "saved-from-save" }))
    ).toBe("saved-from-save");
    expect(
      pickActiveRegionId(
        undefined,
        makeSave({ currentRegionId: "saved-from-save" })
      )
    ).toBe("saved-from-save");
  });
});

describe("spawnRuntimePlayerEntity with positionOverride", () => {
  it("spawns at the override position when provided", () => {
    const world = new World();
    const player = createDefaultPlayerDefinition("project:test", {
      definitionId: "project:test:player:default"
    });
    const spawn = spawnRuntimePlayerEntity(
      world,
      null,
      player,
      createDefaultMechanicsDefinition(),
      { positionOverride: { x: 12.5, y: 3, z: -8.25 } }
    );
    expect(spawn.position).toEqual([12.5, 3, -8.25]);
    const position = world.getComponent(spawn.entity, Position);
    expect(position?.x).toBe(12.5);
    expect(position?.y).toBe(3);
    expect(position?.z).toBe(-8.25);
  });

  it("falls back to [0,0,0] when no override and no region is supplied", () => {
    const world = new World();
    const player = createDefaultPlayerDefinition("project:test", {
      definitionId: "project:test:player:default"
    });
    const spawn = spawnRuntimePlayerEntity(
      world,
      null,
      player,
      createDefaultMechanicsDefinition()
    );
    expect(spawn.position).toEqual([0, 0, 0]);
  });

  it("explicit null positionOverride falls through to the region default", () => {
    const world = new World();
    const player = createDefaultPlayerDefinition("project:test", {
      definitionId: "project:test:player:default"
    });
    const spawn = spawnRuntimePlayerEntity(
      world,
      null,
      player,
      createDefaultMechanicsDefinition(),
      { positionOverride: null }
    );
    expect(spawn.position).toEqual([0, 0, 0]);
  });
});

// Story 47.5.5 — Session debug HUD card. Studio Playtest only; the
// `hostKinds: ["studio"]` filter keeps it out of published-web. The
// factory closes over its DOM refs so updateCard refreshes the live
// position without rebuilding the panel.
describe("createSessionHudCard", () => {
  // Minimal fake DOM. createSessionHudCard uses only createElement /
  // appendChild / textContent / className / ownerDocument; rolling
  // these by hand avoids pulling in jsdom for one story's worth of
  // tests.
  interface FakeElement {
    nodeName: string;
    className: string;
    textContent: string;
    title: string;
    style: Record<string, string>;
    children: FakeElement[];
    ownerDocument: FakeDocument;
    appendChild(child: FakeElement): FakeElement;
    append(...nodes: FakeElement[]): void;
  }

  interface FakeDocument {
    createElement(tag: string): FakeElement;
  }

  function createFakeElement(
    tag: string,
    ownerDocument: FakeDocument
  ): FakeElement {
    const element: FakeElement = {
      nodeName: tag.toUpperCase(),
      className: "",
      textContent: "",
      title: "",
      style: {},
      children: [],
      ownerDocument,
      appendChild(child) {
        element.children.push(child);
        return child;
      },
      append(...nodes) {
        for (const node of nodes) element.children.push(node);
      }
    };
    return element;
  }

  function createFakeDocument(): FakeDocument {
    const document: FakeDocument = {
      createElement: (tag: string) => createFakeElement(tag, document)
    };
    return document;
  }

  function findRowValue(
    container: FakeElement,
    label: string
  ): string | undefined {
    for (const card of container.children) {
      for (const row of card.children) {
        const [labelEl, valueEl] = row.children;
        if (labelEl?.textContent === label) {
          return valueEl?.textContent;
        }
      }
    }
    return undefined;
  }

  function findRowValueElement(
    container: FakeElement,
    label: string
  ): FakeElement | undefined {
    for (const card of container.children) {
      for (const row of card.children) {
        const [labelEl, valueEl] = row.children;
        if (labelEl?.textContent === label) {
          return valueEl;
        }
      }
    }
    return undefined;
  }

  function makeContext(
    playerPosition: { x: number; y: number; z: number } | null
  ) {
    // The HUD card only reads gameplaySession.playerPosition.
    // Casting through `unknown` lets us avoid building the full
    // DebugHudCardContext fixture for a one-field consumer.
    return {
      gameplaySession: { playerPosition }
    } as unknown as Parameters<
      NonNullable<ReturnType<typeof createSessionHudCard>["payload"]["renderCard"]>
    >[1];
  }

  function makeUser(overrides: Partial<{
    userId: string;
    displayName: string | null;
    email: string | null;
    isAnonymous: boolean;
    createdAt: string;
  }> = {}) {
    return {
      userId: "abcdef1234567890",
      displayName: null,
      email: null,
      isAnonymous: true,
      createdAt: "2026-06-25T00:00:00.000Z",
      ...overrides
    };
  }

  it("contributes the canonical static fields for the debug HUD registry", () => {
    const card = createSessionHudCard({
      user: makeUser(),
      savedGameSnapshot: null
    });
    expect(card.kind).toBe("debug.hudCard");
    expect(card.hostKinds).toEqual(["studio"]);
    expect(card.pluginId).toBe("runtime-core.session");
    expect(card.contributionId).toBe("runtime-core.session.hud");
    expect(card.payload.cardId).toBe("session");
    expect(card.displayName).toBe("Session");
    expect(typeof card.payload.renderCard).toBe("function");
    expect(typeof card.payload.updateCard).toBe("function");
  });

  it("renders the user + save + position rows with the expected static values", () => {
    const card = createSessionHudCard({
      user: makeUser({ userId: "ab12cd34ef56gh78" }),
      savedGameSnapshot: {
        lastPlayed: "2026-06-25T12:00:00.000Z",
        currentRegionId: "hollow-station",
        currentQuestId: "find-the-cat"
      }
    });
    const container = createFakeElement("div", createFakeDocument());
    card.payload.renderCard(
      container as unknown as HTMLElement,
      makeContext({ x: 12.5, y: 0, z: -8.25 })
    );
    expect(findRowValue(container, "User")).toBe("ab12cd34...");
    expect(findRowValue(container, "Anon")).toBe("yes");
    expect(findRowValue(container, "Save")).toBe("present");
    expect(findRowValue(container, "Last Played")).toBe(
      "2026-06-25T12:00:00.000Z"
    );
    expect(findRowValue(container, "Region")).toBe("hollow-station");
    expect(findRowValue(container, "Quest")).toBe("find-the-cat");
    expect(findRowValue(container, "Position")).toBe("12.50, 0.00, -8.25");
  });

  it("shows '(none)' for save when no save is loaded and dashes for nullable fields", () => {
    const card = createSessionHudCard({
      user: makeUser({ userId: "uuid-test-1234567890", isAnonymous: false }),
      savedGameSnapshot: null
    });
    const container = createFakeElement("div", createFakeDocument());
    card.payload.renderCard(
      container as unknown as HTMLElement,
      makeContext(null)
    );
    expect(findRowValue(container, "Anon")).toBe("no");
    expect(findRowValue(container, "Save")).toBe("(none)");
    expect(findRowValue(container, "Last Played")).toBe("-");
    expect(findRowValue(container, "Region")).toBe("-");
    expect(findRowValue(container, "Quest")).toBe("-");
    expect(findRowValue(container, "Position")).toBe("-");
  });

  it("shows dashes everywhere when user is null", () => {
    const card = createSessionHudCard({ user: null, savedGameSnapshot: null });
    const container = createFakeElement("div", createFakeDocument());
    card.payload.renderCard(
      container as unknown as HTMLElement,
      makeContext(null)
    );
    expect(findRowValue(container, "User")).toBe("-");
    expect(findRowValue(container, "Anon")).toBe("-");
  });

  it("updateCard refreshes the position row from a fresh context tick", () => {
    const card = createSessionHudCard({
      user: makeUser(),
      savedGameSnapshot: null
    });
    const container = createFakeElement("div", createFakeDocument());
    card.payload.renderCard(
      container as unknown as HTMLElement,
      makeContext(null)
    );
    expect(findRowValue(container, "Position")).toBe("-");
    card.payload.updateCard!(makeContext({ x: 1.234, y: 5.678, z: -9.012 }));
    expect(findRowValue(container, "Position")).toBe("1.23, 5.68, -9.01");
  });

  it("does not preserve a short userId past 12 chars (no truncation)", () => {
    const card = createSessionHudCard({
      user: makeUser({ userId: "abc123" }),
      savedGameSnapshot: null
    });
    const container = createFakeElement("div", createFakeDocument());
    card.payload.renderCard(
      container as unknown as HTMLElement,
      makeContext(null)
    );
    expect(findRowValue(container, "User")).toBe("abc123");
  });

  it("truncates a real UUID to the first dash-separated segment", () => {
    const card = createSessionHudCard({
      user: makeUser({
        userId: "9969d6fa-1234-5678-9abc-def012345678"
      }),
      savedGameSnapshot: null
    });
    const container = createFakeElement("div", createFakeDocument());
    card.payload.renderCard(
      container as unknown as HTMLElement,
      makeContext(null)
    );
    expect(findRowValue(container, "User")).toBe("9969d6fa");
  });

  it("sets the full userId as the title attribute for hover-to-reveal", () => {
    const fullId = "9969d6fa-1234-5678-9abc-def012345678";
    const card = createSessionHudCard({
      user: makeUser({ userId: fullId }),
      savedGameSnapshot: null
    });
    const container = createFakeElement("div", createFakeDocument());
    card.payload.renderCard(
      container as unknown as HTMLElement,
      makeContext(null)
    );
    const userValue = findRowValueElement(container, "User");
    expect(userValue?.title).toBe(fullId);
  });

  it("applies chip-pill styling to the User row when a user is present", () => {
    const card = createSessionHudCard({
      user: makeUser({ userId: "9969d6fa-1234-5678-9abc-def012345678" }),
      savedGameSnapshot: null
    });
    const container = createFakeElement("div", createFakeDocument());
    card.payload.renderCard(
      container as unknown as HTMLElement,
      makeContext(null)
    );
    const userValue = findRowValueElement(container, "User");
    expect(userValue?.style.borderRadius).toBe("999px");
    expect(userValue?.style.display).toBe("inline-block");
    // Sanity-check the cursor stays the default for non-clickable
    // contexts (the chip click handler is in the React IdChip
    // component; the HUD render is observation-only).
    expect(userValue?.style.cursor).toBe("default");
  });

  it("does NOT apply chip styling or title when user is null", () => {
    const card = createSessionHudCard({ user: null, savedGameSnapshot: null });
    const container = createFakeElement("div", createFakeDocument());
    card.payload.renderCard(
      container as unknown as HTMLElement,
      makeContext(null)
    );
    const userValue = findRowValueElement(container, "User");
    expect(userValue?.title).toBe("");
    // Style map untouched.
    expect(Object.keys(userValue?.style ?? {}).length).toBe(0);
  });
});

// Story 47.5.5 follow-up — IdChip React component shares the same
// truncation logic via the exported `truncateIdForChip` helper.
// Testing the truncation helper directly avoids needing jsdom for
// the React component (the rendered DOM is covered by Mantine's
// own test suite + manual eyeball).
describe("truncateIdForChip", () => {
  it("returns the first dash-separated segment for UUIDs", async () => {
    const { truncateIdForChip } = await import("@sugarmagic/ui");
    expect(truncateIdForChip("9969d6fa-1234-5678-9abc-def012345678")).toBe(
      "9969d6fa"
    );
  });

  it("returns the first segment for game ids like 'wordlark-v1-...'", async () => {
    const { truncateIdForChip } = await import("@sugarmagic/ui");
    expect(truncateIdForChip("wordlark-v1-1dqlc-sugarmagic-gateway")).toBe(
      "wordlark"
    );
  });

  it("falls back to first-8-plus-ellipsis when there is no dash", async () => {
    const { truncateIdForChip } = await import("@sugarmagic/ui");
    expect(truncateIdForChip("abcdef1234567890")).toBe("abcdef12...");
  });

  it("returns short ids unchanged", async () => {
    const { truncateIdForChip } = await import("@sugarmagic/ui");
    expect(truncateIdForChip("abc")).toBe("abc");
    expect(truncateIdForChip("abc-def")).toBe("abc");
  });

  it("falls back when the first dash is past the 12-char window", async () => {
    const { truncateIdForChip } = await import("@sugarmagic/ui");
    expect(truncateIdForChip("verylongprefix-tail")).toBe("verylong...");
  });
});

// Story 47.7 — SupabaseIdentityProvider. Wraps supabase.auth and
// satisfies the runtime-core UserIdentityProvider contract. Tested
// via a hand-rolled mock client because the real supabase-js client
// requires a live Supabase project and network. The mock surfaces
// only the auth methods the provider touches; everything else is
// intentionally undefined.
describe("createSupabaseIdentityProvider", () => {
  interface MockSession {
    user: MockSupabaseUser;
  }

  interface MockSupabaseUser {
    id: string;
    email: string | null;
    is_anonymous: boolean;
    created_at: string;
    user_metadata?: Record<string, unknown>;
  }

  type AuthChangeCallback = (event: string, session: MockSession | null) => void;

  interface MockClient {
    auth: {
      getSession: () => Promise<{
        data: { session: MockSession | null };
        error: null;
      }>;
      signInAnonymously: () => Promise<{
        data: { user: MockSupabaseUser | null; session: MockSession | null };
        error: null;
      }>;
      signInWithPassword: (input: {
        email: string;
        password: string;
      }) => Promise<{
        data: { user: MockSupabaseUser | null; session: MockSession | null };
        error: null;
      }>;
      signUp: (input: { email: string; password: string }) => Promise<{
        data: { user: MockSupabaseUser | null; session: MockSession | null };
        error: null;
      }>;
      signOut: () => Promise<{ error: null }>;
      updateUser: (attrs: { email?: string; password?: string }) => Promise<{
        data: { user: MockSupabaseUser | null };
        error: null;
      }>;
      onAuthStateChange: (cb: AuthChangeCallback) => {
        data: { subscription: { unsubscribe: () => void } };
      };
    };
    emit: (event: string, session: MockSession | null) => void;
    calls: {
      signInAnonymously: number;
      signInWithPassword: number;
      signUp: number;
      signOut: number;
      updateUser: number;
    };
  }

  function makeMockUser(overrides: Partial<MockSupabaseUser> = {}): MockSupabaseUser {
    return {
      id: "u_supabase_default",
      email: null,
      is_anonymous: false,
      created_at: "2026-06-25T00:00:00.000Z",
      ...overrides
    };
  }

  function createMockSupabaseClient(initial?: {
    session?: MockSession | null;
  }): MockClient {
    let currentSession: MockSession | null = initial?.session ?? null;
    const subscribers = new Set<AuthChangeCallback>();
    let counter = 0;
    const calls = {
      signInAnonymously: 0,
      signInWithPassword: 0,
      signUp: 0,
      signOut: 0,
      updateUser: 0
    };
    return {
      auth: {
        getSession: async () => ({
          data: { session: currentSession },
          error: null
        }),
        signInAnonymously: async () => {
          calls.signInAnonymously++;
          const user = makeMockUser({
            id: `u_anon_${counter++}`,
            is_anonymous: true,
            email: null
          });
          currentSession = { user };
          return {
            data: { user, session: currentSession },
            error: null
          };
        },
        signInWithPassword: async (input) => {
          calls.signInWithPassword++;
          const user = makeMockUser({
            id: `u_password_${counter++}`,
            is_anonymous: false,
            email: input.email
          });
          currentSession = { user };
          return {
            data: { user, session: currentSession },
            error: null
          };
        },
        signUp: async (input) => {
          calls.signUp++;
          const user = makeMockUser({
            id: `u_signup_${counter++}`,
            is_anonymous: false,
            email: input.email
          });
          currentSession = { user };
          return {
            data: { user, session: currentSession },
            error: null
          };
        },
        signOut: async () => {
          calls.signOut++;
          currentSession = null;
          return { error: null };
        },
        updateUser: async (attrs) => {
          calls.updateUser++;
          if (!currentSession) {
            return { data: { user: null }, error: null };
          }
          const updated = {
            ...currentSession.user,
            email: attrs.email ?? currentSession.user.email,
            is_anonymous: false
          };
          currentSession = { user: updated };
          return { data: { user: updated }, error: null };
        },
        onAuthStateChange: (cb) => {
          subscribers.add(cb);
          return {
            data: {
              subscription: {
                unsubscribe: () => {
                  subscribers.delete(cb);
                }
              }
            }
          };
        }
      },
      emit: (event, session) => {
        currentSession = session;
        for (const cb of subscribers) cb(event, session);
      },
      calls
    };
  }

  async function waitFor(
    predicate: () => boolean,
    options: { timeoutMs?: number; intervalMs?: number } = {}
  ): Promise<void> {
    const timeout = options.timeoutMs ?? 1000;
    const interval = options.intervalMs ?? 5;
    const start = performance.now();
    while (!predicate()) {
      if (performance.now() - start > timeout) {
        throw new Error("[test] waitFor timed out");
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  it("signs in anonymously on bootstrap when allowAnonymous + no session", async () => {
    const mock = createMockSupabaseClient();
    const { createSupabaseIdentityProvider } = await import(
      "@sugarmagic/plugins"
    );
    const provider = createSupabaseIdentityProvider({
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon-key",
      allowAnonymous: true,
      client: mock as never
    });
    await waitFor(() => provider.currentUser() !== null);
    const user = provider.currentUser();
    expect(user?.isAnonymous).toBe(true);
    expect(user?.userId.startsWith("u_anon_")).toBe(true);
    expect(mock.calls.signInAnonymously).toBe(1);
  });

  it("does NOT sign in anonymously when allowAnonymous is false", async () => {
    const mock = createMockSupabaseClient();
    const { createSupabaseIdentityProvider } = await import(
      "@sugarmagic/plugins"
    );
    const provider = createSupabaseIdentityProvider({
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon-key",
      allowAnonymous: false,
      client: mock as never
    });
    // Give bootstrap a moment to run (getSession will resolve, find
    // no session, and stop because allowAnonymous is off).
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(provider.currentUser()).toBeNull();
    expect(mock.calls.signInAnonymously).toBe(0);
  });

  it("uses an existing session at bootstrap when one is already present", async () => {
    const existing = makeMockUser({
      id: "u_existing",
      is_anonymous: false,
      email: "n@example.com"
    });
    const mock = createMockSupabaseClient({ session: { user: existing } });
    const { createSupabaseIdentityProvider } = await import(
      "@sugarmagic/plugins"
    );
    const provider = createSupabaseIdentityProvider({
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon-key",
      allowAnonymous: true,
      client: mock as never
    });
    await waitFor(() => provider.currentUser() !== null);
    expect(provider.currentUser()?.userId).toBe("u_existing");
    expect(provider.currentUser()?.isAnonymous).toBe(false);
    expect(provider.currentUser()?.email).toBe("n@example.com");
    expect(mock.calls.signInAnonymously).toBe(0);
  });

  it("signIn flips the cached user to credentialed", async () => {
    const mock = createMockSupabaseClient();
    const { createSupabaseIdentityProvider } = await import(
      "@sugarmagic/plugins"
    );
    const provider = createSupabaseIdentityProvider({
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon-key",
      allowAnonymous: true,
      client: mock as never
    });
    await waitFor(() => provider.currentUser() !== null);
    const signedIn = await provider.signIn({
      email: "n@example.com",
      password: "hunter2"
    });
    expect(signedIn.isAnonymous).toBe(false);
    expect(signedIn.email).toBe("n@example.com");
    expect(provider.currentUser()?.userId).toBe(signedIn.userId);
    expect(mock.calls.signInWithPassword).toBe(1);
  });

  it("signUp returns the new user + caches it", async () => {
    const mock = createMockSupabaseClient();
    const { createSupabaseIdentityProvider } = await import(
      "@sugarmagic/plugins"
    );
    const provider = createSupabaseIdentityProvider({
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon-key",
      allowAnonymous: false,
      client: mock as never
    });
    const next = await provider.signUp({
      email: "fresh@example.com",
      password: "p"
    });
    expect(next.email).toBe("fresh@example.com");
    expect(provider.currentUser()?.userId).toBe(next.userId);
    expect(mock.calls.signUp).toBe(1);
  });

  it("linkAnonymousToCredentials preserves userId", async () => {
    const mock = createMockSupabaseClient();
    const { createSupabaseIdentityProvider } = await import(
      "@sugarmagic/plugins"
    );
    const provider = createSupabaseIdentityProvider({
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon-key",
      allowAnonymous: true,
      client: mock as never
    });
    await waitFor(() => provider.currentUser()?.isAnonymous === true);
    const anonId = provider.currentUser()!.userId;
    const linked = await provider.linkAnonymousToCredentials({
      email: "n@example.com",
      password: "p"
    });
    expect(linked.userId).toBe(anonId);
    expect(linked.isAnonymous).toBe(false);
    expect(linked.email).toBe("n@example.com");
    expect(mock.calls.updateUser).toBe(1);
  });

  it("linkAnonymousToCredentials throws when current user is already credentialed", async () => {
    const existing = makeMockUser({
      id: "u_existing",
      is_anonymous: false,
      email: "already@example.com"
    });
    const mock = createMockSupabaseClient({ session: { user: existing } });
    const { createSupabaseIdentityProvider } = await import(
      "@sugarmagic/plugins"
    );
    const provider = createSupabaseIdentityProvider({
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon-key",
      allowAnonymous: true,
      client: mock as never
    });
    await waitFor(() => provider.currentUser() !== null);
    await expect(
      provider.linkAnonymousToCredentials({
        email: "next@example.com",
        password: "p"
      })
    ).rejects.toThrow(NotSupportedError);
    expect(mock.calls.updateUser).toBe(0);
  });

  it("linkAnonymousToCredentials throws when there is no current user", async () => {
    const mock = createMockSupabaseClient();
    const { createSupabaseIdentityProvider } = await import(
      "@sugarmagic/plugins"
    );
    const provider = createSupabaseIdentityProvider({
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon-key",
      allowAnonymous: false,
      client: mock as never
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(
      provider.linkAnonymousToCredentials({
        email: "n@example.com",
        password: "p"
      })
    ).rejects.toThrow(NotSupportedError);
  });

  it("signOut clears the cached user", async () => {
    const mock = createMockSupabaseClient();
    const { createSupabaseIdentityProvider } = await import(
      "@sugarmagic/plugins"
    );
    const provider = createSupabaseIdentityProvider({
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon-key",
      allowAnonymous: true,
      client: mock as never
    });
    await waitFor(() => provider.currentUser() !== null);
    expect(provider.currentUser()).not.toBeNull();
    await provider.signOut();
    expect(provider.currentUser()).toBeNull();
    expect(mock.calls.signOut).toBe(1);
  });

  it("onChange fires when the auth state changes externally", async () => {
    const mock = createMockSupabaseClient();
    const { createSupabaseIdentityProvider } = await import(
      "@sugarmagic/plugins"
    );
    const provider = createSupabaseIdentityProvider({
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon-key",
      allowAnonymous: false,
      client: mock as never
    });
    const seen: Array<{ userId: string | null; isAnonymous: boolean }> = [];
    provider.onChange((user) => {
      seen.push({
        userId: user?.userId ?? null,
        isAnonymous: user?.isAnonymous ?? false
      });
    });
    const newUser = makeMockUser({ id: "u_external", is_anonymous: false });
    mock.emit("SIGNED_IN", { user: newUser });
    await waitFor(() => seen.length > 0);
    expect(seen[seen.length - 1].userId).toBe("u_external");
    expect(provider.currentUser()?.userId).toBe("u_external");
  });
});
