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
  /**
   * Back-compat / tooling escape hatch only. The gateway resolves the model
   * SERVER-SIDE from `purpose` (Plan 073.2); production callers send `purpose`
   * and leave this unset so model choice stays a deploy-time decision.
   */
  model?: string;
  /**
   * Gateway-side model routing category. "teacher" resolves from
   * SUGARMAGIC_SUGARLANG_TEACHER_MODEL (sugarlang's own
   * `gatewayRuntimeConfigKeys` entry). Omitted => the gateway falls through to
   * the sugaragent DIALOGUE model, which is almost never what a sugarlang
   * caller wants — say what the call is for.
   */
  purpose?: "teacher";
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
