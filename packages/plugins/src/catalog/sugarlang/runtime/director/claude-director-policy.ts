/**
 * packages/plugins/src/catalog/sugarlang/runtime/director/claude-director-policy.ts
 *
 * Purpose: Implements the Claude-backed structured-output Director policy.
 *
 * Exports:
 *   - ClaudeDirectorPolicy
 *
 * Relationships:
 *   - Implements the DirectorPolicy contract from runtime/contracts/providers.ts.
 *   - Will be consumed by SugarLangDirector once Epic 9 lands.
 *
 * Implements: Proposal 001 §3. Director
 *
 * Status: active
 */

import { AnthropicClient } from "../../../sugaragent/runtime/clients";
import { buildPostPlacementCalibrationHint, isInPostPlacementCalibration } from "./calibration-mode";
import {
  buildDirectorPrompt,
  estimatePromptTokens
} from "./prompt-builder";
import { parseDirective, repairDirective } from "./schema-parser";
import type {
  DirectorContext,
  DirectorPolicy,
  PedagogicalDirective
} from "../types";
import type { TelemetrySink } from "../telemetry/telemetry";

const DEFAULT_DIRECTOR_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 900;

const NO_OP_TELEMETRY: TelemetrySink = {
  emit() {
    return undefined;
  }
};

export interface DirectorClaudeClientResult {
  text: string;
  requestId?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadInputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
}

export interface DirectorClaudeClientRequest {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  cacheMarkers: string[];
}

export interface DirectorClaudeClient {
  generateStructuredDirective: (
    request: DirectorClaudeClientRequest
  ) => Promise<DirectorClaudeClientResult>;
}

export interface ClaudeDirectorPolicyOptions {
  client: DirectorClaudeClient;
  telemetry?: TelemetrySink;
  model?: string;
  maxTokens?: number;
  now?: () => number;
}

export class DirectorInvocationError extends Error {
  constructor(
    message: string,
    public readonly fallbackTriggerReason?:
      | PedagogicalDirective["comprehensionCheck"]["triggerReason"]
      | undefined,
    public readonly causeData?: unknown
  ) {
    super(message);
    this.name = "DirectorInvocationError";
  }
}

export function createAnthropicDirectorClient(
  client: AnthropicClient
): DirectorClaudeClient {
  return {
    async generateStructuredDirective(request): Promise<DirectorClaudeClientResult> {
      const response = await client.generateMessage({
        model: request.model,
        system: request.systemPrompt,
        userMessage: request.userPrompt,
        maxTokens: request.maxTokens
      });

      return {
        text: response.text,
        requestId: response.requestId
      };
    }
  };
}

export class ClaudeDirectorPolicy implements DirectorPolicy {
  private readonly client: DirectorClaudeClient;
  private readonly telemetry: TelemetrySink;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly now: () => number;

  constructor(options: ClaudeDirectorPolicyOptions) {
    this.client = options.client;
    this.telemetry = options.telemetry ?? NO_OP_TELEMETRY;
    this.model = options.model ?? DEFAULT_DIRECTOR_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.now = options.now ?? (() => Date.now());
  }

  async invoke(
    context: DirectorContext
  ): Promise<PedagogicalDirective> {
    const prompt = buildDirectorPrompt(context);
    const shouldAppendCalibrationHint =
      context.calibrationActive || isInPostPlacementCalibration(context.learner);
    const userPrompt = shouldAppendCalibrationHint
      ? `${prompt.user}\n\n${buildPostPlacementCalibrationHint()}`
      : prompt.user;
    const startedAt = this.now();

    await this.telemetry.emit("director.invocation-started", {
      conversationId: context.conversationId,
      model: this.model,
      timestamp: startedAt,
      cacheMarkers: prompt.cacheMarkers
    });

    let response: DirectorClaudeClientResult;
    try {
      response = await this.client.generateStructuredDirective({
        model: this.model,
        systemPrompt: prompt.system,
        userPrompt,
        maxTokens: this.maxTokens,
        cacheMarkers: prompt.cacheMarkers
      });
    } catch (error) {
      await this.telemetry.emit("director.invocation-failed", {
        conversationId: context.conversationId,
        model: this.model,
        latencyMs: this.now() - startedAt,
        reason: error instanceof Error ? error.message : "Claude request failed",
        timestamp: this.now()
      });
      throw new DirectorInvocationError(
        error instanceof Error ? error.message : "Claude request failed",
        undefined,
        error
      );
    }

    const parseResult = parseDirective(response.text, {
      context,
      telemetry: this.telemetry
    });

    let directive: PedagogicalDirective;
    let parseMode: "validated" | "repaired";

    if ("directive" in parseResult) {
      directive = parseResult.directive;
      parseMode = "validated";
    } else if (
      parseResult.error.code === "schema_validation_failed" &&
      parseResult.error.partial !== null
    ) {
      directive = repairDirective(parseResult.error.partial, context.prescription, context, {
        telemetry: this.telemetry
      });
      parseMode = "repaired";
    } else {
      throw new DirectorInvocationError(
        parseResult.error.message,
        parseResult.error.code === "hard_floor_violated"
          ? "director-deferred-override"
          : undefined,
        parseResult.error
      );
    }

    const endedAt = this.now();
    await this.telemetry.emit("director.invocation-completed", {
      conversationId: context.conversationId,
      model: this.model,
      latencyMs: endedAt - startedAt,
      requestId: response.requestId ?? null,
      parseMode,
      cacheHit: false,
      timestamp: endedAt,
      inputTokens:
        response.inputTokens ??
        estimatePromptTokens(prompt.system) + estimatePromptTokens(userPrompt),
      outputTokens: response.outputTokens ?? estimatePromptTokens(response.text),
      cacheReadInputTokens: response.cacheReadInputTokens ?? null,
      cacheCreationInputTokens: response.cacheCreationInputTokens ?? null
    });

    return directive;
  }
}
