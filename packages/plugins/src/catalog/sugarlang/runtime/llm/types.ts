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
 *   - Is consumed by the Teacher, chunk extractor, and verify middleware repair path.
 *   - Is implemented by SugarlangGatewayClient.
 *
 * Implements: Sugarlang LLM gateway abstraction (independent of sugaragent)
 *
 * Status: active
 */

/**
 * The purpose every COMPILE-time extraction pass sends.
 *
 * Shared so the three passes (multi-word expressions, line intent, scene
 * concepts) cannot drift onto different routing and quietly get different
 * models. They are one budget: authoring-time, cached by content hash.
 */
export const EXTRACTION_PURPOSE = "extraction" as const;

export interface SugarlangLLMRequest {
  /**
   * Back-compat / tooling escape hatch only. The gateway resolves the model
   * SERVER-SIDE from `purpose` (Plan 073.2); production callers send `purpose`
   * and leave this unset so model choice stays a deploy-time decision.
   */
  model?: string;
  /**
   * Gateway-side model routing category, each resolving from a
   * SUGARMAGIC_SUGARLANG_* env var declared in sugarlang's own
   * `gatewayRuntimeConfigKeys`:
   *
   *   "teacher"    -> SUGARMAGIC_SUGARLANG_TEACHER_MODEL     runtime judgment
   *   "extraction" -> SUGARMAGIC_SUGARLANG_EXTRACTION_MODEL  compile-time passes
   *
   * Omitted => the gateway falls through to the sugaragent DIALOGUE model,
   * which is almost never what a sugarlang caller wants — say what the call is
   * for. Adding a value here means adding it to PURPOSE_MODELS in
   * deployment/gateway/core.ts and to the manifest, or it silently falls
   * through.
   */
  purpose?: "teacher" | "extraction";
  systemPrompt: string;
  /**
   * System content as blocks, with caching breakpoints. When present the
   * gateway sends Anthropic system blocks and marks `cache: true` ones with
   * `cache_control: ephemeral`; when absent it falls back to `systemPrompt`,
   * uncached.
   */
  systemBlocks?: Array<{ text: string; cache?: boolean }>;
  userPrompt: string;
  maxTokens?: number;
}

export interface SugarlangLLMResult {
  text: string;
  requestId: string | null;
  /**
   * What the call cost. The gateway has always returned these; nothing carried
   * them, so a cache hit was indistinguishable from a miss.
   */
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadInputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
}

/**
 * The single LLM abstraction sugarlang uses. Every Claude call in the plugin
 * goes through this interface — Teacher, chunk extractor, verify repair.
 * The implementation is always a gateway HTTP client; sugarlang never calls
 * vendor APIs directly.
 */
export interface SugarlangLLMClient {
  generate(request: SugarlangLLMRequest): Promise<SugarlangLLMResult>;
}
