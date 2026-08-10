/**
 * packages/plugins/src/catalog/sugarlang/tests/llm/gateway-client-auth.test.ts
 *
 * Purpose: Sugarlang's LLM client sends the player's access token.
 *
 * WHY THIS EXISTS
 *   It did not, and the deployed Teacher had never once run. A gateway in
 *   `supabase-jwt` mode answered 401 to every Teacher call while NPC dialogue
 *   -- sugaragent's client, SAME endpoint -- worked fine. Two call sites for
 *   one route, one of them unauthenticated, and nothing compared them. The
 *   only visible symptom was a slow first turn.
 *
 * Status: active
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { SugarlangGatewayClient } from "../../runtime/llm/gateway-client";

interface CapturedInit {
  headers?: Record<string, string>;
}

function stubFetch() {
  const fetchMock = vi.fn(async (_url: string, _init?: CapturedInit) => ({
    ok: true,
    json: async () => ({ text: "ok" }),
    text: async () => "ok"
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function authHeaderAt(
  fetchMock: ReturnType<typeof stubFetch>,
  index: number
): string | undefined {
  return fetchMock.mock.calls[index]?.[1]?.headers?.authorization;
}

const request = {
  model: "claude",
  purpose: "teacher",
  systemPrompt: "sys",
  userPrompt: "usr",
  maxTokens: 10
} as never;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sugarlang's LLM client authenticates", () => {
  it("THE PROD BUG: attaches the player's token to the generate call", async () => {
    const fetchMock = stubFetch();
    const client = new SugarlangGatewayClient(
      "http://gateway.test",
      async () => "jwt-abc"
    );

    await client.generate(request);

    expect(authHeaderAt(fetchMock, 0)).toBe("Bearer jwt-abc");
  });

  it("sends NO auth header when there is no token, so an open gateway still works", async () => {
    const fetchMock = stubFetch();
    const client = new SugarlangGatewayClient(
      "http://gateway.test",
      async () => null
    );

    await client.generate(request);

    expect(authHeaderAt(fetchMock, 0)).toBeUndefined();
  });

  it("reads the token PER REQUEST, because it rotates mid-session", async () => {
    // supabase-js refreshes in the background. Caching the token at
    // construction would send a stale one after the first rotation and 401
    // for the rest of the session.
    const fetchMock = stubFetch();
    let current = "first";
    const client = new SugarlangGatewayClient(
      "http://gateway.test",
      async () => current
    );

    await client.generate(request);
    current = "second";
    await client.generate(request);

    expect(authHeaderAt(fetchMock, 0)).toBe("Bearer first");
    expect(authHeaderAt(fetchMock, 1)).toBe("Bearer second");
  });
});
