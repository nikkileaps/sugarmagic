/**
 * packages/plugins/src/catalog/sugarlang/runtime/llm/gateway-client.ts
 *
 * Purpose: HTTP client that calls the sugarlang gateway proxy for LLM generation.
 *
 * Exports:
 *   - SugarlangGatewayClient
 *
 * Relationships:
 *   - Implements SugarlangLLMClient from ./types.
 *   - Calls the SugarDeploy-managed proxy at /api/sugaragent/generate (shared
 *     generation route — the handler is a generic Claude proxy, not sugaragent-specific).
 *   - No dependency on sugaragent or any vendor SDK.
 *
 * THIS CLIENT MUST SEND THE PLAYER'S TOKEN
 *   It did not, and a deployed gateway running in `supabase-jwt` mode
 *   answered 401 to every Teacher call while NPC dialogue -- which goes
 *   through sugaragent's own client, to the SAME endpoint -- worked fine.
 *   Two call sites for one route, one of them unauthenticated. So the
 *   deployed Teacher had never once run.
 *
 *   The token getter comes from runtime-core, NOT from sugaragent: the
 *   access-token registry is host-owned infrastructure, so reading it costs
 *   sugarlang no dependency on another plugin. An empty token sends no
 *   header, which is correct against a gateway in `none` mode.
 *
 * Implements: Sugarlang gateway LLM provider
 *
 * Status: active
 */

import { getActiveAccessToken } from "@sugarmagic/runtime-core";
import type { SugarlangLLMClient, SugarlangLLMRequest, SugarlangLLMResult } from "./types";

function normalizeBaseUrl(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/** Resolves the player's access token per request. Injectable so a test can
 *  assert the header without a live identity provider. */
export type SugarlangAccessTokenGetter = () => Promise<string | null>;

export class SugarlangGatewayClient implements SugarlangLLMClient {
  private readonly baseUrl: string;
  private readonly getAccessToken: SugarlangAccessTokenGetter;

  constructor(
    baseUrl: string,
    getAccessToken: SugarlangAccessTokenGetter = getActiveAccessToken
  ) {
    if (!baseUrl.trim()) {
      throw new Error(
        "SugarlangGatewayClient requires a non-empty base URL. " +
        "Set SUGARMAGIC_SUGARLANG_PROXY_BASE_URL in your environment."
      );
    }
    this.baseUrl = normalizeBaseUrl(baseUrl.trim());
    this.getAccessToken = getAccessToken;
  }

  /** Read per request, never cached: the token rotates mid-session and
   *  supabase-js refreshes it in the background. */
  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    const trimmed = typeof token === "string" ? token.trim() : "";
    return trimmed ? { authorization: `Bearer ${trimmed}` } : {};
  }

  async generate(request: SugarlangLLMRequest): Promise<SugarlangLLMResult> {
    const response = await fetch(`${this.baseUrl}/api/sugaragent/generate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(await this.authHeaders())
      },
      body: JSON.stringify({
        model: request.model,
        purpose: request.purpose,
        // Both are sent. The gateway prefers `systemBlocks` when present and
        // falls back to `systemPrompt`, so an older gateway still works.
        systemPrompt: request.systemPrompt,
        ...(request.systemBlocks ? { systemBlocks: request.systemBlocks } : {}),
        userPrompt: request.userPrompt,
        maxTokens: request.maxTokens
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "(unreadable)");
      throw new Error(
        `Sugarlang gateway generate failed: ${response.status} ${response.statusText} — ${body}`
      );
    }

    const result = (await response.json()) as Record<string, unknown>;
    // The gateway has always returned these; nothing carried them, so a cache
    // hit was indistinguishable from a miss at every layer above.
    const usage = (result.usage ?? {}) as Record<string, unknown>;
    const count = (key: string): number | null =>
      typeof usage[key] === "number" ? (usage[key] as number) : null;

    return {
      text: typeof result.text === "string" ? result.text : "",
      requestId: typeof result.requestId === "string" ? result.requestId : null,
      inputTokens: count("inputTokens"),
      outputTokens: count("outputTokens"),
      cacheReadInputTokens: count("cacheReadInputTokens"),
      cacheCreationInputTokens: count("cacheCreationInputTokens")
    };
  }
}
