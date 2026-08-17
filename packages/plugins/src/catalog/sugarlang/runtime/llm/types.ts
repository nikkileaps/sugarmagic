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
  /**
   * A JSON Schema the reply must satisfy.
   *
   * WHY THIS EXISTS. Every compile-time extractor used to ask for JSON in the
   * prompt and hope: pull the JSON-looking substring out of the reply, parse
   * it, and only then check it against a schema. One malformed array element
   * lost the whole extraction, and it did -- the scene-context pass failed on
   * `arrival-station` across several edits with "Expected ',' or ']' after
   * array element", so that scene reached the Teacher with no concepts at all
   * and nobody noticed until a play session showed the slate frozen.
   *
   * With a schema here the model is CONSTRAINED as it generates, so invalid
   * JSON stops being a thing that can happen rather than a thing to catch.
   *
   * PLAIN JSON SCHEMA, not a vendor shape. The gateway owns the translation to
   * whatever the model provider calls this, including dropping the keywords
   * the provider does not accept -- a caller writes one schema and does not
   * track that list.
   *
   * Callers should keep validating what comes back. This makes malformed
   * output unreachable through the gateway, not unimaginable.
   */
  outputSchema?: Record<string, unknown>;
}

export interface SugarlangLLMResult {
  text: string;
  requestId: string | null;
  /**
   * Why the model stopped: "end_turn" for a finished reply, "max_tokens" for
   * one cut off at the ceiling, or null from a gateway too old to say.
   *
   * A truncated reply and a malformed one both arrive as text that will not
   * parse, and telling them apart from the parser's message alone is guesswork
   * -- the scene-context pass was misdiagnosed as bad JSON for days when every
   * failing reply had simply run out of room. Check this before blaming the
   * model's syntax.
   */
  stopReason?: string | null;
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
