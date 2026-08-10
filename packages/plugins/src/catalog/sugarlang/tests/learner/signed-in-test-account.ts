/**
 * packages/plugins/src/catalog/sugarlang/tests/learner/signed-in-test-account.ts
 *
 * Purpose: Puts a signed-in account in place for tests that touch per-player
 *   storage.
 *
 * WHY TESTS NEED THIS NOW
 *   Plan 092.6.1 keys every per-player store on the account, and the runtime
 *   reads it through `getActiveUserId()` -- a module-level holder the host
 *   fills once identity resolves. A test that never fills it is a browser with
 *   nobody signed in, so the runtime correctly declines to open any store.
 *
 *   This registers a real `UserIdentityProvider` rather than stubbing the
 *   getter, so tests exercise the same path production does. Unsupported
 *   operations throw, matching the interface's contract that an implementation
 *   must never silently no-op.
 *
 * Exports:
 *   - signInTestAccount
 *   - TEST_ACCOUNT_USER_ID
 *
 * Status: active
 */

import {
  registerActiveIdentityProvider,
  type User,
  type UserIdentityProvider
} from "@sugarmagic/runtime-core";

export const TEST_ACCOUNT_USER_ID = "user-test-account";

function unsupported(operation: string): never {
  throw new Error(`[test] ${operation} is not supported by the test account.`);
}

/**
 * Registers a signed-in account and returns a function that clears it.
 *
 * Call in `beforeEach` and clear in `afterEach` -- the holder is module-level
 * and shared, so a test that leaves an account registered signs the next one
 * in behind its back.
 */
export function signInTestAccount(
  userId: string = TEST_ACCOUNT_USER_ID
): () => void {
  const user: User = {
    userId,
    displayName: null,
    email: null,
    isAnonymous: false,
    createdAt: "2026-01-01T00:00:00.000Z"
  };
  const provider: UserIdentityProvider = {
    currentUser: () => user,
    onChange: () => () => undefined,
    signIn: async () => unsupported("signIn"),
    signUp: async () => unsupported("signUp"),
    signOut: async () => unsupported("signOut"),
    linkAnonymousToCredentials: async () =>
      unsupported("linkAnonymousToCredentials"),
    getAccessToken: async () => null
  };
  registerActiveIdentityProvider(provider);
  return () => registerActiveIdentityProvider(null);
}
