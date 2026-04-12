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
 * Implements: Sugarlang gateway LLM provider
 *
 * Status: active
 */

import type { SugarlangLLMClient, SugarlangLLMRequest, SugarlangLLMResult } from "./types";

function normalizeBaseUrl(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export class SugarlangGatewayClient implements SugarlangLLMClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    if (!baseUrl.trim()) {
      throw new Error(
        "SugarlangGatewayClient requires a non-empty base URL. " +
        "Set SUGARMAGIC_SUGARLANG_PROXY_BASE_URL in your environment."
      );
    }
    this.baseUrl = normalizeBaseUrl(baseUrl.trim());
  }

  async generate(request: SugarlangLLMRequest): Promise<SugarlangLLMResult> {
    const response = await fetch(`${this.baseUrl}/api/sugaragent/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        systemPrompt: request.systemPrompt,
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
    return {
      text: typeof result.text === "string" ? result.text : "",
      requestId: typeof result.requestId === "string" ? result.requestId : null
    };
  }
}
