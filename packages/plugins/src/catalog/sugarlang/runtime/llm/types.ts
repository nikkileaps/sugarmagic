/**
 * packages/plugins/src/catalog/sugarlang/runtime/llm/types.ts
 *
 * Purpose: Defines sugarlang's own LLM gateway interface. No dependency on sugaragent.
 *
 * Exports:
 *   - SugarlangLLMRequest
 *   - SugarlangLLMResult
 *   - SugarlangLLMClient
 *
 * Relationships:
 *   - Is consumed by the Director, chunk extractor, and verify middleware repair path.
 *   - Is implemented by SugarlangGatewayClient.
 *
 * Implements: Sugarlang LLM gateway abstraction (independent of sugaragent)
 *
 * Status: active
 */

export interface SugarlangLLMRequest {
  model?: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
}

export interface SugarlangLLMResult {
  text: string;
  requestId: string | null;
}

/**
 * The single LLM abstraction sugarlang uses. Every Claude call in the plugin
 * goes through this interface — Director, chunk extractor, verify repair.
 * The implementation is always a gateway HTTP client; sugarlang never calls
 * vendor APIs directly.
 */
export interface SugarlangLLMClient {
  generate(request: SugarlangLLMRequest): Promise<SugarlangLLMResult>;
}
