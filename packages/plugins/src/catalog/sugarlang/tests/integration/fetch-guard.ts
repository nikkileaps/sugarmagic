/**
 * packages/plugins/src/catalog/sugarlang/tests/integration/fetch-guard.ts
 *
 * Purpose: Shared fetch stub for the sugarlang E2E goldens. Enforces the 081.5
 *          exit criterion "suite fails on any unmocked URL": any fetch a test
 *          has not explicitly claimed via a handler throws with the attempted
 *          URL, so an accidental network dependency fails loudly instead of
 *          silently hitting a vendor or gateway endpoint.
 *
 * Exports:
 *   - installFetchGuard
 *   - uninstallFetchGuard
 *
 * Relationships:
 *   - House pattern: packages/testing/src/sugaragent-runtime.test.ts
 *     (vi.stubGlobal on fetch, throw on any unexpected URL).
 *
 * Implements: Plan 081 story 081.5 (E2E goldens)
 *
 * Status: active
 */

import { vi, type Mock } from "vitest";

/**
 * Optional per-test handler. Return a Response (or a promise of one) to claim
 * the call; return null to fall through to the guard, which throws.
 */
export type FetchGuardHandler = (
  url: string,
  init: RequestInit | undefined
) => Response | Promise<Response> | null;

// URLs of fetches no handler claimed since the last installFetchGuard. Kept
// module-level so uninstallFetchGuard can fail the test even when runtime code
// swallowed the guard's throw in a try/catch (e.g. the scripted middleware's
// LLM-failure fallback path).
let unclaimedUrls: string[] = [];

/**
 * Stubs global fetch with a guard mock. Calls the optional handler first; any
 * call the handler does not claim throws with the attempted URL. Returns the
 * mock so tests can assert on call counts and request bodies.
 */
export function installFetchGuard(handler?: FetchGuardHandler): Mock {
  unclaimedUrls = [];
  const guard = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (handler) {
      const response = await handler(url, init);
      if (response) {
        return response;
      }
    }
    unclaimedUrls.push(url);
    throw new Error(
      "Unmocked fetch in sugarlang integration test: " +
        url +
        " -- the E2E goldens are deterministic; stub this call explicitly via installFetchGuard(handler)."
    );
  });
  vi.stubGlobal("fetch", guard);
  return guard;
}

/**
 * Restores the real global fetch. Call from afterEach. Throws (failing the
 * test) if any fetch went unclaimed during the test, even when the guard's
 * in-line throw was swallowed by a try/catch in runtime code.
 */
export function uninstallFetchGuard(): void {
  vi.unstubAllGlobals();
  if (unclaimedUrls.length > 0) {
    const urls = unclaimedUrls.join(", ");
    unclaimedUrls = [];
    throw new Error(
      "Unmocked fetch calls occurred during this test (possibly swallowed by runtime error handling): " +
        urls
    );
  }
}

/** Builds a JSON Response the way the gateway would return it. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
