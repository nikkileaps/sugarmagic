/**
 * targets/web/src/save/waitForActiveUser.ts
 *
 * Purpose: Block the boot sequence until the active
 * `UserIdentityProvider` has settled on a current user, so the boot
 * save-load reads under the right userId.
 *
 * Why this exists: SugarProfile's Supabase provider bootstraps
 * asynchronously — it calls `supabase.auth.getSession()` (and
 * optionally `signInAnonymously`) to restore the prior session.
 * During that window, `provider.currentUser()` returns `null`.
 * App.tsx needs to wait for the user to settle BEFORE calling
 * `store.load(userId)` so a signed-in returning player reads
 * their cloud save (not the anonymous fallback's old save).
 *
 * Anonymous-local providers return their user synchronously, so
 * this helper resolves instantly when no async bootstrap is in
 * flight.
 *
 * Implements: Plan 047 §Story 47.10 boot-ordering follow-up
 *
 * Status: active
 */

import type { User, UserIdentityProvider } from "@sugarmagic/runtime-core";

export interface WaitForActiveUserOptions {
  /** Maximum time to wait for the user to settle before giving up
   *  and resolving to `null`. Defaults to 5000ms — long enough for
   *  Supabase auth restoration on a slow connection, short enough
   *  to avoid an infinite loading state when the network is dead. */
  timeoutMs?: number;
}

/**
 * Resolve to the provider's current user once it settles, or to
 * `null` after the timeout expires. Resolves synchronously when
 * `currentUser()` already returns non-null.
 */
export function waitForActiveUser(
  provider: UserIdentityProvider,
  options: WaitForActiveUserOptions = {}
): Promise<User | null> {
  const initial = provider.currentUser();
  if (initial) return Promise.resolve(initial);
  const timeoutMs = options.timeoutMs ?? 5000;
  return new Promise<User | null>((resolve) => {
    let settled = false;
    // Bare setTimeout/clearTimeout (not window.*) so this helper
    // works under Node test runners where `window` is undefined.
    // Browsers expose the same names globally.
    const unsubscribe = provider.onChange((next) => {
      if (settled || !next) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(next);
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      console.warn(
        `[waitForActiveUser] provider did not settle within ${timeoutMs}ms; ` +
          "continuing with no user (gateway requests will 401, save load skipped)."
      );
      resolve(null);
    }, timeoutMs);
  });
}
