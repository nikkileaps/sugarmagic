/**
 * packages/plugins/src/catalog/sugaragent/runtime/lore-relevance.test.ts
 *
 * Purpose: holds the game-side relevance threshold default in step with the
 * gateway's fallback, and proves the value reaches an outgoing search.
 *
 * The two defaults sit on opposite sides of an HTTP call and cannot share a
 * constant at runtime. They can share a test.
 *
 * Status: active
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LORE_RELEVANCE_FLOOR,
  MAX_LORE_RELEVANCE_FLOOR,
  MIN_LORE_RELEVANCE_FLOOR
} from "./lore-relevance";
import { GATEWAY_DEFAULT_SCORE_THRESHOLD } from "../../../deployment/gateway/core";
import { createSugarAgentVectorStoreProvider } from "./provider";
import type { SugarAgentPluginConfig } from "./types";

describe("lore relevance threshold defaults", () => {
  it("matches the gateway fallback for a request that omits the field", () => {
    expect(DEFAULT_LORE_RELEVANCE_FLOOR).toBe(GATEWAY_DEFAULT_SCORE_THRESHOLD);
  });

  it("sits inside the configurable range", () => {
    expect(DEFAULT_LORE_RELEVANCE_FLOOR).toBeGreaterThanOrEqual(MIN_LORE_RELEVANCE_FLOOR);
    expect(DEFAULT_LORE_RELEVANCE_FLOOR).toBeLessThanOrEqual(MAX_LORE_RELEVANCE_FLOOR);
  });
});

describe("createSugarAgentVectorStoreProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the project's threshold on a search", async () => {
    const requests: { url: string; init?: { body?: unknown } }[] = [];
    const fetchMock = vi.fn(async (url: string, init?: { body?: unknown }) => {
      requests.push({ url, init });
      return {
        ok: true,
        status: 200,
        async json() {
          return { results: [], requestId: null };
        },
        async text() {
          return "";
        }
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const config = {
      proxyBaseUrl: "https://gateway.test",
      gatewayBearerToken: "token",
      loreRelevanceFloor: 0.62
    } as unknown as SugarAgentPluginConfig;

    await createSugarAgentVectorStoreProvider(config).searchLore({
      vectorStoreId: "",
      query: "dock",
      maxResults: 4
    });

    expect(requests).toHaveLength(1);
    const body = JSON.parse(String(requests[0]!.init?.body));
    expect(body.scoreThreshold).toBe(0.62);
  });
});
