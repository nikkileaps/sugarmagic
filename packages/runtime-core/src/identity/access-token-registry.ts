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
 * ## Plan 051 §51.3 considered migrating this; intentionally not.
 *
 * Plan 051 introduces `host.state.user` (an `ObservableValue`
 * snapshot of the active provider's user). The plan's original
 * sketch said gateway clients could just call
 * `host.state.user.getSnapshot()?.getAccessToken?.()` and the
 * registry could retire. When 51.3 actually walked the code,
 * the structural reason this registry exists (above) still
 * holds: gateway-client factories live in PLUGIN code, which
 * has no reference to `host`. Killing this registry would
 * require either moving the host into runtime-core OR
 * threading the host through every plugin's factory context —
 * exactly the churn this registry was created to avoid. So the
 * registry stays. `host.state.user` is the source of truth for
 * READ-from-host paths (Session HUD, future Studio shell
 * surfaces); this registry is the source of truth for the
 * READ-from-plugin-runtime path. Both live downstream of the
 * same identity provider; no parallel-truth bug class exists.
 *
 * **Trigger to revisit:** if a future story moves the host
 * into runtime-core OR formalizes a host-to-plugin handle that
 * plugins can read through their factory context, this
 * registry retires in favor of that handle. Until then, leave
 * alone.
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
