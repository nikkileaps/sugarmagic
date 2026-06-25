import { describe, expect, it, vi } from "vitest";
import {
  createAnonymousLocalIdentityProvider,
  createRuntimeBootModel,
  createRuntimePluginManager,
  GAME_SAVE_SCHEMA_VERSION,
  NotSupportedError,
  resolveActiveGameSaveStore,
  resolveActiveIdentityProvider,
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
