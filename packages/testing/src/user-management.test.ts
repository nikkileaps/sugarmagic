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
  createUIActionRegistry,
  createUIStateStore,
  GAME_SAVE_SCHEMA_VERSION,
  getActiveAccessToken,
  NotSupportedError,
  pickGameSavePayload,
  Position,
  registerActiveIdentityProvider,
  registerDefaultUIActions,
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
import {
  SugarAgentGatewayLLMClient,
  SugarAgentGatewayEmbeddingsClient,
  SugarAgentGatewayVectorStoreClient,
  createCookieSessionStorage,
  normalizeSugarProfilePluginConfig
} from "@sugarmagic/plugins";
import {
  gameSavePayloadsEqual,
  migrateLocalSaveToCloud,
  runAutosaveTick,
  waitForActiveUser
} from "@sugarmagic/target-web";

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
    },
    getAccessToken: async () => null
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
      },
      getAccessToken: async () => null
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
      slices: {},
      currentRegionId: null,
      currentQuestId: null,
      playerPosition: null
    };
    expect(payload.currentRegionId).toBeNull();
  });

  it("typechecks a GameSavePayload with populated state", () => {
    const payload: GameSavePayload = {
      slices: {},
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
        slices: {},
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

  // resolveActiveGameSaveStore wraps the resolved store via
  // createSerializedSaveStore so resetForNewGame is always
  // available on the active store. These tests assert
  // delegation to the underlying instead of instance equality.
  async function expectResolvedDelegatesTo(
    resolved: GameSaveStore,
    target: GameSaveStore,
    label: string
  ): Promise<void> {
    const baseSave: GameSave = {
      userId: "u",
      lastPlayed: "iso",
      schemaVersion: GAME_SAVE_SCHEMA_VERSION,
      payload: {
        slices: {},
        currentRegionId: "r",
        currentQuestId: null,
        playerPosition: null
      }
    };
    await resolved.save("u", baseSave);
    const direct = await target.load("u");
    expect(direct?.lastPlayed).toBe(`${label}:iso`);
    // resetForNewGame is the new structural primitive — the
    // wrapped resolver output must expose it.
    expect(typeof (resolved as { resetForNewGame?: unknown }).resetForNewGame)
      .toBe("function");
  }

  it("resolveActiveGameSaveStore returns the fallback when no plugin contributes", async () => {
    const fallback = makeStubGameSaveStore("fallback");
    const manager = buildManager([]);
    const resolved = resolveActiveGameSaveStore(manager, fallback);
    await expectResolvedDelegatesTo(resolved, fallback, "fallback");
  });

  it("resolveActiveGameSaveStore returns the single contributing store", async () => {
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
    await expectResolvedDelegatesTo(resolved, cloud, "cloud");
  });

  it("resolveActiveGameSaveStore returns the highest-priority contribution when two plugins contribute", async () => {
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
    await expectResolvedDelegatesTo(resolved, high, "high");
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
      slices: {},
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

// Story 47.5.5 — Session debug HUD card. Studio Preview only; the
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
      getUser: () => makeUser(),
      getSavedGameSnapshot: () => null
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
      getUser: () => makeUser({ userId: "ab12cd34ef56gh78" }),
      getSavedGameSnapshot: () => ({
        lastPlayed: "2026-06-25T12:00:00.000Z",
        slices: {},
        currentRegionId: "hollow-station",
        currentQuestId: "find-the-cat"
      })
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
      getUser: () => makeUser({ userId: "uuid-test-1234567890", isAnonymous: false }),
      getSavedGameSnapshot: () => null
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
    const card = createSessionHudCard({
      getUser: () => null,
      getSavedGameSnapshot: () => null
    });
    const container = createFakeElement("div", createFakeDocument());
    card.payload.renderCard(
      container as unknown as HTMLElement,
      makeContext(null)
    );
    expect(findRowValue(container, "User")).toBe("-");
    expect(findRowValue(container, "Anon")).toBe("-");
  });

  it("47.10 — updateCard refreshes User/Anon/Save rows from the getters (sign-in + autosave write)", () => {
    let liveUser = makeUser({
      userId: "0bb0684c-131d-4ef2-89e7-b24c28cfee58",
      isAnonymous: true
    });
    let liveSnapshot: {
      lastPlayed: string;
      currentRegionId: string | null;
      currentQuestId: string | null;
    } | null = null;
    const card = createSessionHudCard({
      getUser: () => liveUser,
      getSavedGameSnapshot: () => liveSnapshot
    });
    const container = createFakeElement("div", createFakeDocument());
    card.payload.renderCard(
      container as unknown as HTMLElement,
      makeContext({ x: 0, y: 0, z: 0 })
    );
    expect(findRowValue(container, "Anon")).toBe("yes");
    expect(findRowValue(container, "Save")).toBe("(none)");

    // Simulate sign-in: same userId (linkAnonymousToCredentials)
    // but isAnonymous flips false. updateCard should reflect both.
    liveUser = { ...liveUser, isAnonymous: false, email: "p@example.com" };
    // Simulate autosave write at the same tick.
    liveSnapshot = {
      lastPlayed: "2026-06-27T17:00:00.000Z",
      currentRegionId: "garden",
      currentQuestId: "find-the-cat"
    };
    card.payload.updateCard!(makeContext({ x: 1, y: 0, z: 1 }));
    expect(findRowValue(container, "Anon")).toBe("no");
    expect(findRowValue(container, "Save")).toBe("present");
    expect(findRowValue(container, "Last Played")).toBe(
      "2026-06-27T17:00:00.000Z"
    );
    expect(findRowValue(container, "Region")).toBe("garden");
    expect(findRowValue(container, "Quest")).toBe("find-the-cat");
  });

  it("updateCard refreshes the position row from a fresh context tick", () => {
    const card = createSessionHudCard({
      getUser: () => makeUser(),
      getSavedGameSnapshot: () => null
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
      getUser: () => makeUser({ userId: "abc123" }),
      getSavedGameSnapshot: () => null
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
      getUser: () =>
        makeUser({
          userId: "9969d6fa-1234-5678-9abc-def012345678"
        }),
      getSavedGameSnapshot: () => null
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
      getUser: () => makeUser({ userId: fullId }),
      getSavedGameSnapshot: () => null
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
      getUser: () => makeUser({ userId: "9969d6fa-1234-5678-9abc-def012345678" }),
      getSavedGameSnapshot: () => null
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
    const card = createSessionHudCard({
      getUser: () => null,
      getSavedGameSnapshot: () => null
    });
    const container = createFakeElement("div", createFakeDocument());
    card.payload.renderCard(
      container as unknown as HTMLElement,
      makeContext(null)
    );
    const userValue = findRowValueElement(container, "User");
    expect(userValue?.title).toBe("");
    // Chip-pill styles are absent (47.10 follow-up sets each chip
    // property explicitly to "" on null users to keep updateCard
    // idempotent across sign-in/sign-out flips — so we assert the
    // load-bearing chip indicator is empty, not the whole style map).
    expect(userValue?.style.borderRadius).toBe("");
    expect(userValue?.style.background).toBe("");
    expect(userValue?.style.border).toBe("");
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

// Story 47.8 — pure helpers + mocked-client tests for the
// SugarProfile Supabase managed-files emission, the
// SupabaseGameSaveStore, and the SupabaseProfileStore.
describe("extractSupabaseProjectRef", () => {
  it("pulls the ref out of a canonical Supabase URL", async () => {
    const { extractSupabaseProjectRef } = await import("@sugarmagic/plugins");
    expect(extractSupabaseProjectRef("https://fhhcmtbtozlxaboqhrla.supabase.co")).toBe(
      "fhhcmtbtozlxaboqhrla"
    );
  });

  it("tolerates a trailing slash", async () => {
    const { extractSupabaseProjectRef } = await import("@sugarmagic/plugins");
    expect(extractSupabaseProjectRef("https://abc123def.supabase.co/")).toBe(
      "abc123def"
    );
  });

  it("returns null on a non-Supabase URL", async () => {
    const { extractSupabaseProjectRef } = await import("@sugarmagic/plugins");
    expect(extractSupabaseProjectRef("https://example.com")).toBeNull();
    expect(extractSupabaseProjectRef("")).toBeNull();
  });

  it("matches http:// fallback for local Supabase dev setups", async () => {
    const { extractSupabaseProjectRef } = await import("@sugarmagic/plugins");
    expect(extractSupabaseProjectRef("http://abc.supabase.co")).toBe("abc");
  });
});

describe("buildSupabaseManagedFiles", () => {
  // Domain helpers needed only by this block — import lazily so
  // the existing test setup at the top of the file stays focused.
  async function loadDomainHelpers() {
    return await import("@sugarmagic/domain");
  }

  async function makeGameProjectWithSugarProfile(config: {
    enabled: boolean;
    enableLogin: boolean;
    supabaseUrl: string;
  }) {
    const { normalizeGameProject, createDefaultDeploymentSettings, createPluginConfigurationRecord } = await loadDomainHelpers();
    return normalizeGameProject({
      identity: { id: "wordlark", schema: "GameProject", version: 1 },
      displayName: "Wordlark",
      gameRootPath: ".",
      deployment: createDefaultDeploymentSettings(),
      regionRegistry: [],
      pluginConfigurations: [
        createPluginConfigurationRecord("sugarprofile", config.enabled, {
          enableLogin: config.enableLogin,
          supabaseUrl: config.supabaseUrl,
          supabaseAnonKey: "anon-key",
          allowAnonymous: false
        })
      ],
      contentLibraryId: "wordlark:content-library",
      playerDefinition: {
        definitionId: "player",
        displayName: "Player",
        physicalProfile: { height: 1.8, radius: 0.35, eyeHeight: 1.62 },
        movementProfile: { walkSpeed: 4.5, runSpeed: 6.5, acceleration: 10 },
        presentation: {
          modelAssetDefinitionId: null,
          animationAssetBindings: { idle: null, walk: null, run: null }
        },
        casterProfile: {
          initialBattery: 100,
          rechargeRate: 1,
          initialResonance: 0,
          allowedSpellTags: [],
          blockedSpellTags: []
        }
      },
      spellDefinitions: [],
      itemDefinitions: [],
      documentDefinitions: [],
      npcDefinitions: [],
      dialogueDefinitions: [],
      questDefinitions: []
    });
  }

  it("emits no files when SugarProfile is disabled", async () => {
    const { buildSupabaseManagedFiles } = await import("@sugarmagic/plugins");
    const project = await makeGameProjectWithSugarProfile({
      enabled: false,
      enableLogin: true,
      supabaseUrl: "https://fhhcmtbtozlxaboqhrla.supabase.co"
    });
    expect(buildSupabaseManagedFiles(project)).toEqual([]);
  });

  it("emits no files when enableLogin is off", async () => {
    const { buildSupabaseManagedFiles } = await import("@sugarmagic/plugins");
    const project = await makeGameProjectWithSugarProfile({
      enabled: true,
      enableLogin: false,
      supabaseUrl: "https://fhhcmtbtozlxaboqhrla.supabase.co"
    });
    expect(buildSupabaseManagedFiles(project)).toEqual([]);
  });

  it("emits no files when supabaseUrl is empty", async () => {
    const { buildSupabaseManagedFiles } = await import("@sugarmagic/plugins");
    const project = await makeGameProjectWithSugarProfile({
      enabled: true,
      enableLogin: true,
      supabaseUrl: ""
    });
    expect(buildSupabaseManagedFiles(project)).toEqual([]);
  });

  it("emits config.toml + 0001_initial.sql when fully configured", async () => {
    const { buildSupabaseManagedFiles } = await import("@sugarmagic/plugins");
    const project = await makeGameProjectWithSugarProfile({
      enabled: true,
      enableLogin: true,
      supabaseUrl: "https://fhhcmtbtozlxaboqhrla.supabase.co"
    });
    const files = buildSupabaseManagedFiles(project);
    expect(files.map((f) => f.relativePath).sort()).toEqual([
      "deployment/supabase/config.toml",
      "deployment/supabase/migrations/0001_initial.sql"
    ]);
    const configToml = files.find(
      (f) => f.relativePath === "deployment/supabase/config.toml"
    );
    expect(configToml?.content).toContain('project_id = "fhhcmtbtozlxaboqhrla"');
    const migration = files.find(
      (f) => f.relativePath === "deployment/supabase/migrations/0001_initial.sql"
    );
    expect(migration?.content).toContain("create table if not exists public.saves");
    expect(migration?.content).toContain("create table if not exists public.profiles");
    expect(migration?.content).toContain(
      "create trigger on_auth_user_created"
    );
    expect(migration?.content).toContain(
      "alter table public.saves enable row level security"
    );
    expect(migration?.content).toContain(
      "alter table public.profiles enable row level security"
    );
  });
});

// Mocked Supabase client for the save + profile stores. Builds a
// tiny in-memory PostgREST-shaped client; rejects writes when the
// suppressed mode is on (simulates RLS denial).
describe("SupabaseGameSaveStore", () => {
  interface MockGameSaveRow {
    user_id: string;
    last_played: string;
    schema_version: number;
    payload: unknown;
  }

  function createMockPostgrestClient() {
    const records = new Map<string, MockGameSaveRow>();
    let rlsBlocked = false;
    function makeQuery(table: string) {
      const filters: Array<{ column: string; value: string }> = [];
      return {
        select(_columns: string) {
          return {
            eq(column: string, value: string) {
              filters.push({ column, value });
              return {
                async maybeSingle<T>() {
                  if (table !== "saves") return { data: null, error: null };
                  const eqUserId = filters.find((f) => f.column === "user_id");
                  const found = eqUserId ? records.get(eqUserId.value) : null;
                  return {
                    data: (found as T | undefined) ?? null,
                    error: null
                  };
                }
              };
            }
          };
        },
        async upsert(
          row: Record<string, unknown>,
          _options: { onConflict: string }
        ) {
          if (rlsBlocked) {
            return {
              error: {
                message:
                  "new row violates row-level security policy for table saves"
              }
            };
          }
          const userId = String(row.user_id);
          records.set(userId, {
            user_id: userId,
            last_played: String(row.last_played),
            schema_version: Number(row.schema_version),
            payload: row.payload
          });
          return { error: null };
        },
        delete() {
          return {
            async eq(column: string, value: string) {
              if (column === "user_id") records.delete(value);
              return { error: null };
            }
          };
        }
      };
    }
    return {
      from(table: string) {
        return makeQuery(table);
      },
      _records: records,
      _setRlsBlocked: (next: boolean) => {
        rlsBlocked = next;
      }
    };
  }

  it("load returns null when no row exists", async () => {
    const mock = createMockPostgrestClient();
    const { createSupabaseGameSaveStore } = await import("@sugarmagic/plugins");
    const store = createSupabaseGameSaveStore({ client: mock as never });
    const result = await store.load("u_missing");
    expect(result).toBeNull();
  });

  it("save then load round-trips the payload", async () => {
    const mock = createMockPostgrestClient();
    const { createSupabaseGameSaveStore } = await import("@sugarmagic/plugins");
    const store = createSupabaseGameSaveStore({ client: mock as never });
    await store.save("u_alpha", {
      userId: "u_alpha",
      lastPlayed: "(ignored, stamped server-side)",
      schemaVersion: GAME_SAVE_SCHEMA_VERSION,
      payload: {
        slices: {},
        currentRegionId: "hollow-station",
        currentQuestId: "find-the-cat",
        playerPosition: { x: 1, y: 2, z: 3 }
      }
    });
    const reloaded = await store.load("u_alpha");
    expect(reloaded?.userId).toBe("u_alpha");
    expect(reloaded?.payload.currentRegionId).toBe("hollow-station");
    expect(reloaded?.payload.playerPosition).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("save throws on RLS denial (cross-user write attempt)", async () => {
    const mock = createMockPostgrestClient();
    mock._setRlsBlocked(true);
    const { createSupabaseGameSaveStore } = await import("@sugarmagic/plugins");
    const store = createSupabaseGameSaveStore({ client: mock as never });
    await expect(
      store.save("u_alpha", {
        userId: "u_alpha",
        lastPlayed: "",
        schemaVersion: GAME_SAVE_SCHEMA_VERSION,
        payload: {
          slices: {},
          currentRegionId: null,
          currentQuestId: null,
          playerPosition: null
        }
      })
    ).rejects.toThrow(/row-level security/);
  });

  it("save refuses when GameSave.userId mismatches the key", async () => {
    const mock = createMockPostgrestClient();
    const { createSupabaseGameSaveStore } = await import("@sugarmagic/plugins");
    const store = createSupabaseGameSaveStore({ client: mock as never });
    await expect(
      store.save("u_alpha", {
        userId: "u_beta",
        lastPlayed: "",
        schemaVersion: GAME_SAVE_SCHEMA_VERSION,
        payload: {
          slices: {},
          currentRegionId: null,
          currentQuestId: null,
          playerPosition: null
        }
      })
    ).rejects.toThrow(/cross-user state/);
  });

  it("clear removes the record", async () => {
    const mock = createMockPostgrestClient();
    const { createSupabaseGameSaveStore } = await import("@sugarmagic/plugins");
    const store = createSupabaseGameSaveStore({ client: mock as never });
    await store.save("u_alpha", {
      userId: "u_alpha",
      lastPlayed: "",
      schemaVersion: GAME_SAVE_SCHEMA_VERSION,
      payload: {
        slices: {},
        currentRegionId: null,
        currentQuestId: null,
        playerPosition: null
      }
    });
    expect(await store.load("u_alpha")).not.toBeNull();
    await store.clear("u_alpha");
    expect(await store.load("u_alpha")).toBeNull();
  });
});

describe("SupabaseProfileStore", () => {
  interface MockProfileRow {
    user_id: string;
    display_name: string | null;
    locale: string;
    preferences: Record<string, unknown>;
    updated_at: string;
  }

  function createMockProfilesClient() {
    const records = new Map<string, MockProfileRow>();
    function selectChain(table: string) {
      const filters: Array<{ column: string; value: string }> = [];
      return {
        eq(column: string, value: string) {
          filters.push({ column, value });
          return {
            async maybeSingle<T>() {
              if (table !== "profiles") return { data: null, error: null };
              const eqUserId = filters.find((f) => f.column === "user_id");
              const found = eqUserId ? records.get(eqUserId.value) : null;
              return {
                data: (found as T | undefined) ?? null,
                error: null
              };
            },
            async single<T>() {
              const eqUserId = filters.find((f) => f.column === "user_id");
              const found = eqUserId ? records.get(eqUserId.value) : null;
              if (!found) {
                return {
                  data: null,
                  error: { message: "row not found" }
                };
              }
              return { data: found as T, error: null };
            }
          };
        }
      };
    }
    function upsertChain(table: string) {
      return (
        row: Record<string, unknown>,
        _options: { onConflict: string }
      ) => {
        if (table !== "profiles") {
          return {
            select: () => ({
              async single() {
                return { data: null, error: { message: "wrong table" } };
              }
            }),
            then(resolve: (v: { error: null }) => unknown) {
              return Promise.resolve({ error: null }).then(resolve);
            }
          };
        }
        const userId = String(row.user_id);
        const existing = records.get(userId);
        const next: MockProfileRow = {
          user_id: userId,
          display_name:
            row.display_name === undefined
              ? (existing?.display_name ?? null)
              : (row.display_name as string | null),
          locale:
            row.locale === undefined
              ? (existing?.locale ?? "en")
              : String(row.locale),
          preferences:
            row.preferences === undefined
              ? (existing?.preferences ?? {})
              : (row.preferences as Record<string, unknown>),
          updated_at: String(
            row.updated_at ?? existing?.updated_at ?? "2026-06-26T00:00:00.000Z"
          )
        };
        records.set(userId, next);
        return {
          select(_columns: string) {
            return {
              async single<T>() {
                return { data: next as T, error: null };
              }
            };
          },
          then(resolve: (v: { error: null }) => unknown) {
            return Promise.resolve({ error: null }).then(resolve);
          }
        };
      };
    }
    return {
      from(table: string) {
        return {
          select(_columns: string) {
            return selectChain(table);
          },
          upsert: upsertChain(table)
        };
      },
      _records: records
    };
  }

  it("load returns null when no row exists", async () => {
    const mock = createMockProfilesClient();
    const { createSupabaseProfileStore } = await import("@sugarmagic/plugins");
    const store = createSupabaseProfileStore({ client: mock as never });
    expect(await store.load("u_missing")).toBeNull();
  });

  it("update upserts a profile with the supplied fields + defaults", async () => {
    const mock = createMockProfilesClient();
    const { createSupabaseProfileStore } = await import("@sugarmagic/plugins");
    const store = createSupabaseProfileStore({ client: mock as never });
    const result = await store.update("u_alpha", {
      displayName: "Nikki",
      locale: "es-MX"
    });
    expect(result.displayName).toBe("Nikki");
    expect(result.locale).toBe("es-MX");
    expect(result.preferences).toEqual({});
  });

  it("update merging respects undefined fields (leaves untouched)", async () => {
    const mock = createMockProfilesClient();
    const { createSupabaseProfileStore } = await import("@sugarmagic/plugins");
    const store = createSupabaseProfileStore({ client: mock as never });
    await store.update("u_alpha", {
      displayName: "Nikki",
      locale: "es-MX"
    });
    const result = await store.update("u_alpha", {
      displayName: "Updated"
    });
    expect(result.displayName).toBe("Updated");
    // Locale should NOT be reset to default — undefined patch field
    // leaves the column alone.
    expect(result.locale).toBe("es-MX");
  });

  it("setPreference merges into existing preferences without clobbering siblings", async () => {
    const mock = createMockProfilesClient();
    const { createSupabaseProfileStore } = await import("@sugarmagic/plugins");
    const store = createSupabaseProfileStore({ client: mock as never });
    await store.update("u_alpha", {
      preferences: { "ui.audio.master": 0.7, "ui.color-mode": "dark" }
    });
    await store.setPreference("u_alpha", "sugarlang.uiLocale", "es");
    const after = await store.load("u_alpha");
    expect(after?.preferences).toEqual({
      "ui.audio.master": 0.7,
      "ui.color-mode": "dark",
      "sugarlang.uiLocale": "es"
    });
  });

  it("setPreference rejects empty key", async () => {
    const mock = createMockProfilesClient();
    const { createSupabaseProfileStore } = await import("@sugarmagic/plugins");
    const store = createSupabaseProfileStore({ client: mock as never });
    await expect(
      store.setPreference("u_alpha", "", "value")
    ).rejects.toThrow(/non-empty key/);
  });
});

describe("47.9.5 — getAccessToken on identity providers", () => {
  it("AnonymousLocalIdentityProvider returns null (no upstream session)", async () => {
    const provider = createAnonymousLocalIdentityProvider({
      storage: createFakeStorage(),
      nowIso: () => "2026-06-26T00:00:00.000Z",
      randomUuid: createSequentialUuids("anon_")
    });
    expect(await provider.getAccessToken()).toBeNull();
  });

  it("SupabaseIdentityProvider returns the live session access_token", async () => {
    const session = {
      access_token: "live-token-rev-1",
      refresh_token: "refresh",
      expires_in: 3600,
      expires_at: 1700000000,
      token_type: "bearer",
      user: {
        id: "u_supabase",
        aud: "authenticated",
        role: "authenticated",
        email: "p@example.com",
        is_anonymous: false,
        created_at: "2026-06-26T00:00:00.000Z",
        app_metadata: {},
        user_metadata: {}
      }
    };
    const client = {
      auth: {
        getSession: vi.fn(async () => ({
          data: { session },
          error: null
        })),
        onAuthStateChange: vi.fn(() => ({
          data: { subscription: { unsubscribe: vi.fn() } }
        })),
        signInAnonymously: vi.fn(async () => ({
          data: { session: null, user: null },
          error: null
        }))
      }
    };
    const { createSupabaseIdentityProvider } = await import(
      "@sugarmagic/plugins"
    );
    const provider = createSupabaseIdentityProvider({
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon",
      allowAnonymous: false,
      client: client as never
    });
    expect(await provider.getAccessToken()).toBe("live-token-rev-1");

    // Rotation: a subsequent supabase-js refresh changes the cached
    // session's access_token; the next getAccessToken call must read
    // the new value (not cached at construction).
    session.access_token = "live-token-rev-2";
    expect(await provider.getAccessToken()).toBe("live-token-rev-2");
    // getSession is also invoked once during the provider's async
    // bootstrap; the load-bearing assertion is that getAccessToken
    // calls it AT LEAST once per invocation, not at construction
    // time only — that's what proves token rotation works.
    expect(
      client.auth.getSession.mock.calls.length
    ).toBeGreaterThanOrEqual(2);
  });

  it("SupabaseIdentityProvider getAccessToken returns null on getSession error", async () => {
    const client = {
      auth: {
        getSession: vi.fn(async () => ({
          data: { session: null },
          error: { message: "network" } as unknown
        })),
        onAuthStateChange: vi.fn(() => ({
          data: { subscription: { unsubscribe: vi.fn() } }
        })),
        signInAnonymously: vi.fn(async () => ({
          data: { session: null, user: null },
          error: null
        }))
      }
    };
    const { createSupabaseIdentityProvider } = await import(
      "@sugarmagic/plugins"
    );
    const provider = createSupabaseIdentityProvider({
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon",
      allowAnonymous: false,
      client: client as never
    });
    expect(await provider.getAccessToken()).toBeNull();
  });
});

describe("47.9.5 — access-token registry", () => {
  it("returns null when no provider is registered", async () => {
    registerActiveIdentityProvider(null);
    expect(await getActiveAccessToken()).toBeNull();
  });

  it("forwards to the registered provider on each call", async () => {
    const stub: UserIdentityProvider = {
      currentUser: () => null,
      onChange: () => () => undefined,
      signIn: async () => {
        throw new NotSupportedError("stub");
      },
      signUp: async () => {
        throw new NotSupportedError("stub");
      },
      signOut: async () => undefined,
      linkAnonymousToCredentials: async () => {
        throw new NotSupportedError("stub");
      },
      getAccessToken: vi
        .fn(async (): Promise<string | null> => null)
        .mockResolvedValueOnce("token-rev-1")
        .mockResolvedValueOnce("token-rev-2")
    };
    registerActiveIdentityProvider(stub);
    try {
      expect(await getActiveAccessToken()).toBe("token-rev-1");
      expect(await getActiveAccessToken()).toBe("token-rev-2");
      expect(stub.getAccessToken).toHaveBeenCalledTimes(2);
    } finally {
      registerActiveIdentityProvider(null);
    }
  });
});

describe("47.9.5 — SugarAgent gateway clients send Authorization from the live getter", () => {
  function makeFetchStub(responseBody: Record<string, unknown>) {
    const captured: { calls: RequestInit[]; urls: string[] } = {
      calls: [],
      urls: []
    };
    const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.urls.push(typeof input === "string" ? input : String(input));
      captured.calls.push(init ?? {});
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });
    return { fetchStub, captured };
  }

  it("invokes the getter on every request and forwards the latest token", async () => {
    const tokens = ["token-A", "token-B"];
    const getter = vi.fn(async () => tokens.shift() ?? null);
    const { fetchStub, captured } = makeFetchStub({
      ok: true,
      reply: "hi",
      modelUsed: "test",
      diagnostics: { stage: "generate" }
    });
    vi.stubGlobal("fetch", fetchStub);
    try {
      const client = new SugarAgentGatewayLLMClient(
        "https://gateway.example",
        getter
      );
      await client.generate({
        model: "test",
        systemPrompt: "s",
        userPrompt: "u"
      });
      await client.generate({
        model: "test",
        systemPrompt: "s",
        userPrompt: "u"
      });
      expect(getter).toHaveBeenCalledTimes(2);
      const headersA = (captured.calls[0].headers ?? {}) as Record<string, string>;
      const headersB = (captured.calls[1].headers ?? {}) as Record<string, string>;
      expect(headersA.authorization).toBe("Bearer token-A");
      expect(headersB.authorization).toBe("Bearer token-B");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("omits the Authorization header when the getter returns null", async () => {
    const { fetchStub, captured } = makeFetchStub({
      ok: true,
      embedding: { values: [0.1] }
    });
    vi.stubGlobal("fetch", fetchStub);
    try {
      const client = new SugarAgentGatewayEmbeddingsClient(
        "https://gateway.example",
        async () => null
      );
      await client.createEmbedding({ model: "m", input: "x" });
      const headers = (captured.calls[0].headers ?? {}) as Record<string, string>;
      expect(headers.authorization).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("omits the Authorization header when the getter returns empty string", async () => {
    const { fetchStub, captured } = makeFetchStub({
      ok: true,
      matches: []
    });
    vi.stubGlobal("fetch", fetchStub);
    try {
      const client = new SugarAgentGatewayVectorStoreClient(
        "https://gateway.example",
        async () => "   "
      );
      await client.search({ vectorStoreId: "vs", query: "find", maxResults: 1 });
      const headers = (captured.calls[0].headers ?? {}) as Record<string, string>;
      expect(headers.authorization).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("47.10 — gameSavePayloadsEqual", () => {
  it("treats deep-equal payloads as equal", () => {
    const a: GameSavePayload = {
      slices: {},
      currentRegionId: "r1",
      currentQuestId: "q1",
      playerPosition: { x: 1, y: 2, z: 3 }
    };
    const b: GameSavePayload = {
      slices: {},
      currentRegionId: "r1",
      currentQuestId: "q1",
      playerPosition: { x: 1, y: 2, z: 3 }
    };
    expect(gameSavePayloadsEqual(a, b)).toBe(true);
  });

  it("detects position drift", () => {
    const a: GameSavePayload = {
      slices: {},
      currentRegionId: "r1",
      currentQuestId: null,
      playerPosition: { x: 1, y: 2, z: 3 }
    };
    const b: GameSavePayload = {
      slices: {},
      currentRegionId: "r1",
      currentQuestId: null,
      playerPosition: { x: 1, y: 2.5, z: 3 }
    };
    expect(gameSavePayloadsEqual(a, b)).toBe(false);
  });

  it("treats null vs object position as not equal", () => {
    const a: GameSavePayload = {
      slices: {},
      currentRegionId: "r1",
      currentQuestId: null,
      playerPosition: null
    };
    const b: GameSavePayload = {
      slices: {},
      currentRegionId: "r1",
      currentQuestId: null,
      playerPosition: { x: 0, y: 0, z: 0 }
    };
    expect(gameSavePayloadsEqual(a, b)).toBe(false);
    expect(gameSavePayloadsEqual(b, a)).toBe(false);
  });

  it("returns false when region or quest changes", () => {
    const base: GameSavePayload = {
      slices: {},
      currentRegionId: "r1",
      currentQuestId: "q1",
      playerPosition: null
    };
    expect(
      gameSavePayloadsEqual(base, { ...base, currentRegionId: "r2" })
    ).toBe(false);
    expect(
      gameSavePayloadsEqual(base, { ...base, currentQuestId: null })
    ).toBe(false);
  });
});

function makeInMemorySaveStore(): GameSaveStore & {
  records: Map<string, GameSave>;
  saveCalls: number;
} {
  const records = new Map<string, GameSave>();
  let saveCalls = 0;
  return {
    async load(userId) {
      return records.get(userId) ?? null;
    },
    async save(userId, save) {
      if (save.userId !== userId) {
        throw new Error("cross-user write");
      }
      saveCalls += 1;
      records.set(userId, { ...save });
    },
    async clear(userId) {
      records.delete(userId);
    },
    get saveCalls() {
      return saveCalls;
    },
    records
  };
}

describe("47.10 — runAutosaveTick", () => {
  const payloadA: GameSavePayload = {
    slices: {},
    currentRegionId: "garden",
    currentQuestId: null,
    playerPosition: { x: 1, y: 0, z: 1 }
  };
  const payloadB: GameSavePayload = {
    slices: {},
    currentRegionId: "garden",
    currentQuestId: null,
    playerPosition: { x: 2, y: 0, z: 1 }
  };

  it("writes when payload changes from lastWritten", async () => {
    const store = makeInMemorySaveStore();
    const source = { getCurrentSavePayload: () => payloadA };
    const result = await runAutosaveTick({
      source,
      store,
      userId: "u_alpha",
      lastWritten: null,
      nowIso: () => "2026-06-27T00:00:00.000Z"
    });
    expect(result.written).toBe(true);
    expect(result.payload).toEqual(payloadA);
    expect(store.records.get("u_alpha")?.payload).toEqual(payloadA);
    expect(store.records.get("u_alpha")?.lastPlayed).toBe(
      "2026-06-27T00:00:00.000Z"
    );
    expect(store.records.get("u_alpha")?.schemaVersion).toBe(
      GAME_SAVE_SCHEMA_VERSION
    );
  });

  it("skips the write when payload deep-equals lastWritten", async () => {
    const store = makeInMemorySaveStore();
    const cloned: GameSavePayload = JSON.parse(JSON.stringify(payloadA));
    const source = { getCurrentSavePayload: () => cloned };
    const result = await runAutosaveTick({
      source,
      store,
      userId: "u_alpha",
      lastWritten: payloadA
    });
    expect(result.written).toBe(false);
    expect(result.payload).toBe(payloadA);
    expect(store.saveCalls).toBe(0);
  });

  it("writes again when the payload moves to a new position", async () => {
    const store = makeInMemorySaveStore();
    let live: GameSavePayload = payloadA;
    const source = { getCurrentSavePayload: () => live };
    let lastWritten: GameSavePayload | null = null;
    let result = await runAutosaveTick({
      source,
      store,
      userId: "u_alpha",
      lastWritten
    });
    lastWritten = result.payload;
    live = payloadB;
    result = await runAutosaveTick({
      source,
      store,
      userId: "u_alpha",
      lastWritten
    });
    expect(result.written).toBe(true);
    expect(store.saveCalls).toBe(2);
    expect(store.records.get("u_alpha")?.payload).toEqual(payloadB);
  });

  it("no-ops when source returns null (boot not settled)", async () => {
    const store = makeInMemorySaveStore();
    const source = { getCurrentSavePayload: () => null };
    const result = await runAutosaveTick({
      source,
      store,
      userId: "u_alpha",
      lastWritten: null
    });
    expect(result.written).toBe(false);
    expect(store.saveCalls).toBe(0);
  });
});

describe("47.10 — migrateLocalSaveToCloud", () => {
  const samplePayload: GameSavePayload = {
    slices: {},
    currentRegionId: "garden",
    currentQuestId: "q1",
    playerPosition: { x: 5, y: 0, z: 7 }
  };

  it("copies the local save to cloud and clears the local record", async () => {
    const local = makeInMemorySaveStore();
    const cloud = makeInMemorySaveStore();
    await local.save("u_shared", {
      userId: "u_shared",
      lastPlayed: "2026-06-26T00:00:00.000Z",
      schemaVersion: GAME_SAVE_SCHEMA_VERSION,
      payload: samplePayload
    });
    const result = await migrateLocalSaveToCloud({
      localStore: local,
      cloudStore: cloud,
      fromUserId: "u_shared",
      toUserId: "u_shared"
    });
    expect(result.migrated).toBe(true);
    expect(cloud.records.get("u_shared")?.payload).toEqual(samplePayload);
    expect(local.records.has("u_shared")).toBe(false);
  });

  it("no-ops when the local store has no save under fromUserId", async () => {
    const local = makeInMemorySaveStore();
    const cloud = makeInMemorySaveStore();
    const result = await migrateLocalSaveToCloud({
      localStore: local,
      cloudStore: cloud,
      fromUserId: "u_empty",
      toUserId: "u_empty"
    });
    expect(result.migrated).toBe(false);
    expect(cloud.records.size).toBe(0);
  });

  it("leaves the local save intact when the cloud write throws", async () => {
    const local = makeInMemorySaveStore();
    const cloud: GameSaveStore = {
      async load() {
        return null;
      },
      async save() {
        throw new Error("cloud unavailable");
      },
      async clear() {
        // unused
      }
    };
    await local.save("u_x", {
      userId: "u_x",
      lastPlayed: "2026-06-26T00:00:00.000Z",
      schemaVersion: GAME_SAVE_SCHEMA_VERSION,
      payload: samplePayload
    });
    const result = await migrateLocalSaveToCloud({
      localStore: local,
      cloudStore: cloud,
      fromUserId: "u_x",
      toUserId: "u_x"
    });
    expect(result.migrated).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(local.records.get("u_x")?.payload).toEqual(samplePayload);
  });

  it("supports a userId rename when fromUserId !== toUserId", async () => {
    const local = makeInMemorySaveStore();
    const cloud = makeInMemorySaveStore();
    await local.save("u_anon", {
      userId: "u_anon",
      lastPlayed: "2026-06-26T00:00:00.000Z",
      schemaVersion: GAME_SAVE_SCHEMA_VERSION,
      payload: samplePayload
    });
    const result = await migrateLocalSaveToCloud({
      localStore: local,
      cloudStore: cloud,
      fromUserId: "u_anon",
      toUserId: "u_real"
    });
    expect(result.migrated).toBe(true);
    expect(cloud.records.get("u_real")?.payload).toEqual(samplePayload);
    expect(cloud.records.has("u_anon")).toBe(false);
    expect(local.records.has("u_anon")).toBe(false);
  });
});

describe("47.10 boot-ordering — waitForActiveUser", () => {
  function makeUser(overrides: Partial<User> = {}): User {
    return {
      userId: "u_settled",
      displayName: null,
      email: null,
      isAnonymous: false,
      createdAt: "2026-06-27T00:00:00.000Z",
      ...overrides
    };
  }

  function makeDeferredProvider(initial: User | null): {
    provider: UserIdentityProvider;
    emit: (next: User | null) => void;
  } {
    let current: User | null = initial;
    const listeners = new Set<UserIdentityChangeListener>();
    const provider: UserIdentityProvider = {
      currentUser: () => current,
      onChange: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      signIn: async () => {
        throw new NotSupportedError("stub");
      },
      signUp: async () => {
        throw new NotSupportedError("stub");
      },
      signOut: async () => undefined,
      linkAnonymousToCredentials: async () => {
        throw new NotSupportedError("stub");
      },
      getAccessToken: async () => null
    };
    return {
      provider,
      emit: (next) => {
        current = next;
        for (const listener of listeners) listener(next);
      }
    };
  }

  it("resolves synchronously when currentUser() already returns a user", async () => {
    const { provider } = makeDeferredProvider(makeUser());
    expect(await waitForActiveUser(provider)).toEqual(makeUser());
  });

  it("waits for onChange to fire then resolves to the first non-null user", async () => {
    const { provider, emit } = makeDeferredProvider(null);
    const promise = waitForActiveUser(provider);
    // Settle async bootstrap.
    setTimeout(() => emit(makeUser({ userId: "u_late" })), 10);
    expect(await promise).toEqual(makeUser({ userId: "u_late" }));
  });

  it("resolves to null when the timeout expires before any user settles", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { provider } = makeDeferredProvider(null);
    const result = await waitForActiveUser(provider, { timeoutMs: 25 });
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("ignores onChange events that fire null after subscribing", async () => {
    const { provider, emit } = makeDeferredProvider(null);
    const promise = waitForActiveUser(provider, { timeoutMs: 50 });
    // Spurious null emissions should not resolve early.
    setTimeout(() => emit(null), 5);
    setTimeout(() => emit(makeUser({ userId: "u_real" })), 15);
    expect(await promise).toEqual(makeUser({ userId: "u_real" }));
  });
});

describe("47.10.5 — pickGameSavePayload", () => {
  const samplePayload: GameSavePayload = {
    slices: {},
    currentRegionId: "save-region",
    currentQuestId: "save-quest",
    playerPosition: { x: 1, y: 2, z: 3 }
  };
  const authoredDefault: GameSavePayload = {
    slices: {},
    currentRegionId: "authored-default-region",
    currentQuestId: null,
    playerPosition: { x: 0, y: 0, z: 0 }
  };

  it("save wins over authored default", () => {
    expect(pickGameSavePayload(samplePayload, authoredDefault)).toBe(
      samplePayload
    );
  });

  it("authored default wins over null", () => {
    expect(pickGameSavePayload(null, authoredDefault)).toBe(authoredDefault);
  });

  it("returns null when neither save nor default is set", () => {
    expect(pickGameSavePayload(null, null)).toBeNull();
  });
});

describe("47.10.5 — save-aware UI actions", () => {
  it("start-new-game delegates to transitions.startNewGame()", async () => {
    // Plan 054 §054.4 — ui-actions hands off to the host's
    // transition object. The destructive flow (reset + reload)
    // is the host's job; ui-actions just dispatches.
    const stateStore = createUIStateStore({
      activeOverlayMenuKey: "start-menu",
      savePresent: true
    });
    const registry = createUIActionRegistry();
    const startNewGame = vi.fn(async () => undefined);
    registerDefaultUIActions(registry, {
      stateStore,
      transitions: {
        startNewGame,
        continueGame: vi.fn(),
        pauseGame: vi.fn(),
        resumeGame: vi.fn(),
        quitToMenu: vi.fn()
      }
    });
    registry.dispatch({ action: "start-new-game" });
    await Promise.resolve();
    expect(startNewGame).toHaveBeenCalledTimes(1);
  });

  it("continue-game delegates to transitions.continueGame()", async () => {
    const stateStore = createUIStateStore({
      activeOverlayMenuKey: "start-menu",
      savePresent: true
    });
    const registry = createUIActionRegistry();
    const continueGame = vi.fn();
    registerDefaultUIActions(registry, {
      stateStore,
      transitions: {
        startNewGame: vi.fn(),
        continueGame,
        pauseGame: vi.fn(),
        resumeGame: vi.fn(),
        quitToMenu: vi.fn()
      }
    });
    registry.dispatch({ action: "continue-game" });
    expect(continueGame).toHaveBeenCalledTimes(1);
  });
});

describe("47.10.5 — UIStateStore.savePresent", () => {
  it("defaults to false when not specified", () => {
    const store = createUIStateStore();
    expect(store.getState().savePresent).toBe(false);
  });

  it("respects the initial value passed in", () => {
    const store = createUIStateStore({ savePresent: true });
    expect(store.getState().savePresent).toBe(true);
  });

  it("setState({savePresent: true}) merges without clobbering other fields", () => {
    const store = createUIStateStore({
      activeOverlayMenuKey: "start-menu",
      savePresent: false
    });
    store.setState({ savePresent: true });
    expect(store.getState()).toEqual({
      activeOverlayMenuKey: "start-menu",
      savePresent: true,
      // Story 50.1 — added to RuntimeUIState; defaults false.
      loginModalOpen: false,
      // Plan 059 §059.4 — added to RuntimeUIState; defaults false.
      episodesOpen: false
    });
  });

  it("subscribers fire on savePresent change", () => {
    const store = createUIStateStore({ savePresent: false });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.setState({ savePresent: true });
    expect(listener).toHaveBeenCalledTimes(1);
    store.setState({ activeOverlayMenuKey: "pause-menu" });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    store.setState({ activeOverlayMenuKey: null });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

// Plan 061 §061.1 — cookie-domain session storage. The adapter
// persists the Supabase session in parent-domain cookies so the
// launch page + game share one session. Chunking survives the
// ~4KB per-cookie ceiling (same scheme as @supabase/ssr).
describe("cookie session storage (Plan 061)", () => {
  function installCookieJar(): () => void {
    // Minimal document.cookie semantics: assignment upserts one
    // cookie; Max-Age=0 deletes; reads return "k=v; k2=v2".
    const jar = new Map<string, string>();
    const fakeDocument = {
      get cookie(): string {
        return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
      },
      set cookie(assignment: string) {
        const [pair, ...attributes] = assignment.split("; ");
        const eq = pair.indexOf("=");
        const name = pair.slice(0, eq);
        const value = pair.slice(eq + 1);
        const maxAge = attributes
          .map((attr) => /^Max-Age=(-?\d+)$/.exec(attr))
          .find(Boolean);
        if (maxAge && Number(maxAge[1]) <= 0) {
          jar.delete(name);
        } else {
          jar.set(name, value);
        }
      }
    };
    const prior = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = fakeDocument;
    return () => {
      (globalThis as { document?: unknown }).document = prior;
    };
  }

  it("round-trips small values through a single cookie", () => {
    const restore = installCookieJar();
    try {
      const storage = createCookieSessionStorage(".example.com");
      storage.setItem("sb-test-auth-token", '{"access_token":"abc"}');
      expect(storage.getItem("sb-test-auth-token")).toBe(
        '{"access_token":"abc"}'
      );
      storage.removeItem("sb-test-auth-token");
      expect(storage.getItem("sb-test-auth-token")).toBeNull();
    } finally {
      restore();
    }
  });

  it("chunks values past the cookie ceiling and reassembles them", () => {
    const restore = installCookieJar();
    try {
      const storage = createCookieSessionStorage(".example.com");
      // ~12KB payload — forces 4+ chunks.
      const large = JSON.stringify({ token: "x".repeat(12000) });
      storage.setItem("sb-test-auth-token", large);
      // The whole-key cookie must NOT exist (it would be over-limit).
      expect(document.cookie).not.toContain("sb-test-auth-token={");
      expect(storage.getItem("sb-test-auth-token")).toBe(large);
      storage.removeItem("sb-test-auth-token");
      expect(storage.getItem("sb-test-auth-token")).toBeNull();
      expect(document.cookie).toBe("");
    } finally {
      restore();
    }
  });

  it("re-setting a shrunk value clears stale chunks first", () => {
    const restore = installCookieJar();
    try {
      const storage = createCookieSessionStorage(".example.com");
      storage.setItem("k", "y".repeat(9000));
      storage.setItem("k", "small");
      expect(storage.getItem("k")).toBe("small");
      // No orphaned chunk cookies left behind.
      expect(document.cookie).toBe(`k=${encodeURIComponent("small")}`);
    } finally {
      restore();
    }
  });

  it("normalizes sessionCookieDomain from plugin config", () => {
    expect(
      normalizeSugarProfilePluginConfig({
        enableLogin: true,
        sessionCookieDomain: "  .wordlarkhollow.com  "
      }).sessionCookieDomain
    ).toBe(".wordlarkhollow.com");
    expect(
      normalizeSugarProfilePluginConfig({}).sessionCookieDomain
    ).toBe("");
  });
});
