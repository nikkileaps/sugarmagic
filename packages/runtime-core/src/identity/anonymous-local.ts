/**
 * packages/runtime-core/src/identity/anonymous-local.ts
 *
 * Purpose: Default `UserIdentityProvider` implementation for the
 * "no plugin installed" path. Persists a UUIDv4 + creation timestamp
 * in `localStorage` so the same browser carries the same identity
 * across reloads. SugarProfile (Plan 047 §47.7) overrides this with
 * a credentialed Supabase identity when the plugin is enabled.
 *
 * Implements: Plan 047 §Story 47.3
 *
 * Status: active
 */

import {
  NotSupportedError,
  type User,
  type UserIdentityChangeListener,
  type UserIdentityProvider
} from "./index";

/** Single localStorage key carrying the JSON-serialized anonymous
 *  identity record. Versioned via the inner `version` field so a
 *  future migration can detect + reshape stale records. */
const STORAGE_KEY = "sugarmagic.anonymous-user-id";

/** Record persisted to localStorage. Stored as JSON so the userId
 *  and the createdAt timestamp travel together. */
interface PersistedRecord {
  version: 1;
  userId: string;
  createdAt: string;
}

export interface AnonymousLocalIdentityProviderOptions {
  /** Storage adapter to read/write the persisted record. Defaults
   *  to `globalThis.localStorage`. Tests inject a fake. */
  storage?: Storage;
  /** ISO-timestamp factory for the `createdAt` field on the
   *  persisted record. Defaults to `new Date().toISOString()`. */
  nowIso?: () => string;
  /** UUIDv4 factory. Defaults to `crypto.randomUUID()`. */
  randomUuid?: () => string;
}

function defaultStorage(): Storage | null {
  const candidate = (globalThis as { localStorage?: Storage }).localStorage;
  return candidate ?? null;
}

function defaultNowIso(): string {
  return new Date().toISOString();
}

function defaultRandomUuid(): string {
  // crypto.randomUUID is available in modern browsers + Node 19+.
  // Tests can inject a deterministic factory via options.
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } })
    .crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  throw new Error(
    "[runtime-core] crypto.randomUUID is not available. Inject a randomUuid factory via AnonymousLocalIdentityProviderOptions, or use this provider in an environment that ships crypto.randomUUID (modern browser / Node 19+)."
  );
}

function readPersisted(storage: Storage): PersistedRecord | null {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedRecord>;
    if (
      parsed &&
      parsed.version === 1 &&
      typeof parsed.userId === "string" &&
      parsed.userId.length > 0 &&
      typeof parsed.createdAt === "string"
    ) {
      return { version: 1, userId: parsed.userId, createdAt: parsed.createdAt };
    }
  } catch {
    // fall through; the corrupt entry gets overwritten on next write
  }
  return null;
}

function writePersisted(storage: Storage, record: PersistedRecord): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(record));
}

function toUser(record: PersistedRecord): User {
  return {
    userId: record.userId,
    displayName: null,
    email: null,
    isAnonymous: true,
    createdAt: record.createdAt
  };
}

/**
 * Creates an in-process `UserIdentityProvider` backed by
 * `localStorage`. `currentUser()` lazily generates + persists a
 * UUIDv4 on first call and returns the same user record on every
 * subsequent call within the same browser. Clearing the persisted
 * record (devtools, separate tab) produces a new UUID on the next
 * `currentUser()` call.
 *
 * Throws `NotSupportedError` from `signIn` / `signUp` /
 * `linkAnonymousToCredentials` since credentialed auth requires
 * SugarProfile (or a similar plugin). `signOut` is a no-op — there
 * is no session to clear; UIs should check `currentUser.isAnonymous`
 * before showing a sign-out affordance.
 *
 * `onChange` listeners are registered but never invoked: the
 * anonymous user does not change during the page's lifetime. The
 * returned function is a noop unsubscribe; it's safe to call
 * multiple times.
 */
export function createAnonymousLocalIdentityProvider(
  options: AnonymousLocalIdentityProviderOptions = {}
): UserIdentityProvider {
  const resolvedStorage: Storage | null =
    options.storage ?? defaultStorage();
  const nowIso = options.nowIso ?? defaultNowIso;
  const randomUuid = options.randomUuid ?? defaultRandomUuid;

  if (!resolvedStorage) {
    throw new Error(
      "[runtime-core] AnonymousLocalIdentityProvider needs a Storage. globalThis.localStorage was not available; inject one via AnonymousLocalIdentityProviderOptions.storage."
    );
  }
  const storage: Storage = resolvedStorage;

  const listeners = new Set<UserIdentityChangeListener>();

  function ensureRecord(): PersistedRecord {
    const existing = readPersisted(storage);
    if (existing) return existing;
    const fresh: PersistedRecord = {
      version: 1,
      userId: randomUuid(),
      createdAt: nowIso()
    };
    writePersisted(storage, fresh);
    return fresh;
  }

  return {
    currentUser(): User {
      return toUser(ensureRecord());
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async signIn() {
      throw new NotSupportedError(
        "Credentialed sign-in requires an identity-provider plugin. Install SugarProfile (Plan 047) to enable email/password sign-in.",
        "sugarprofile"
      );
    },
    async signUp() {
      throw new NotSupportedError(
        "Credentialed sign-up requires an identity-provider plugin. Install SugarProfile (Plan 047) to enable email/password sign-up.",
        "sugarprofile"
      );
    },
    async signOut() {
      // No session to clear; the anonymous identity is the player's
      // identity. Resolving without side effects mirrors the
      // implementation contract in identity/index.ts and lets UIs
      // call signOut() uniformly across providers without branching
      // on which one is active.
    },
    async linkAnonymousToCredentials() {
      throw new NotSupportedError(
        "Anonymous-to-credentialed upgrade requires an identity-provider plugin. Install SugarProfile (Plan 047) to upgrade the anonymous user to a real account.",
        "sugarprofile"
      );
    }
  };
}
