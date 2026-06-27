/**
 * packages/runtime-core/src/identity/access-token-registry.ts
 *
 * Purpose: Late-binding handoff of the active `UserIdentityProvider`'s
 * `getAccessToken()` to gateway-routed clients (e.g. SugarAgent's
 * gateway LLM/embeddings/vector-store clients) that need to send a
 * per-request Bearer token but are constructed BEFORE the runtime
 * host has resolved which identity provider contribution wins.
 *
 * Why a module-level holder (vs. wiring through factory context):
 *   - Runtime plugin instances are CREATED before the provider
 *     resolver runs (the resolver reads the resulting contributions).
 *   - So at construction time, gateway-client factories can't be
 *     handed a token getter — the provider isn't known yet.
 *   - A getter that defers the lookup to request time fixes that.
 *   - Threading the getter through `RuntimePluginFactoryContext`
 *     adds churn to a contract every plugin sees, when only the
 *     handful of plugins that hit the gateway need it.
 *
 * Single instance globally. The runtime host (target-web, Studio
 * preview iframe) registers the active provider right after
 * `resolveActiveIdentityProvider`; gateway clients read via
 * `getActiveAccessToken` per request.
 *
 * Implements: Plan 047 §Story 47.9.5
 *
 * Status: active
 */

import type { UserIdentityProvider } from "./index";

let activeProvider: UserIdentityProvider | null = null;

/**
 * Called by the runtime host once `resolveActiveIdentityProvider`
 * settles. Pass `null` to clear (e.g. tear-down, tests).
 */
export function registerActiveIdentityProvider(
  provider: UserIdentityProvider | null
): void {
  activeProvider = provider;
}

/**
 * Read the current user's access token. Returns `null` when no
 * provider is registered (boot hasn't completed) or when the
 * provider has no upstream session (anonymous-local; signed-out
 * Supabase). Callers should let the gateway respond 401 in those
 * cases rather than swallow the missing-token silently.
 */
export async function getActiveAccessToken(): Promise<string | null> {
  if (!activeProvider) return null;
  return activeProvider.getAccessToken();
}
