/**
 * packages/plugins/src/catalog/sugarlang/runtime/teacher/policies/llm-teacher-policy.ts
 *
 * Purpose: Implements the Claude-backed structured-output Teacher'spolicy.
 *
 * Exports:
 *   - ClaudeTeacherPolicy
 *
 * Relationships:
 *   - Implements the TeacherPolicy contract from runtime/contracts/providers.ts.
 *   - Will be consumed by SugarLangTeacher once Epic 9 lands.
 *
 * Implements: Proposal 001 §3. Teacher's *
 * Status: active
 */

import type { SugarlangLLMClient } from "../../llm/types";
import { buildPostPlacementCalibrationHint, isInPostPlacementCalibration } from "../calibration-mode";
import {
  buildTeacherPrompt,
  estimatePromptTokens
} from "../prompt-builder";
import { parseDirective, repairDirective } from "../schema-parser";
import type {
  TeacherContext,
  TeacherPolicy,
  PedagogicalDirective
} from "../../types";
import {
  createNoOpTelemetrySink,
  createTelemetryEvent,
  emitTelemetry,
  type TelemetrySink
} from "../../telemetry/telemetry";

const DEFAULT_DIRECTOR_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 900;

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

export interface ClaudeTeacherPolicyOptions {
  client: DirectorClaudeClient;
  telemetry?: TelemetrySink;
  logger?: TeacherPolicyLogger;
  model?: string;
  maxTokens?: number;
  now?: () => number;
}

export interface TeacherPolicyLogger {
  info: (message: string, payload?: Record<string, unknown>) => void;
  warn: (message: string, payload?: Record<string, unknown>) => void;
}

const NO_OP_LOGGER: TeacherPolicyLogger = {
  info() {
    return undefined;
  },
  warn() {
    return undefined;
  }
};

export class TeacherInvocationError extends Error {
  constructor(
    message: string,
    public readonly fallbackTriggerReason?:
      | PedagogicalDirective["comprehensionCheck"]["triggerReason"]
      | undefined,
    public readonly causeData?: unknown
  ) {
    super(message);
    this.name = "TeacherInvocationError";
  }
}

/**
 * Creates a DirectorClaudeClient backed by sugarlang's own gateway.
 * No dependency on sugaragent — all calls go through the gateway proxy.
 */
export function createGatewayTeacherClient(
  gateway: SugarlangLLMClient
): DirectorClaudeClient {
  return {
    async generateStructuredDirective(request): Promise<DirectorClaudeClientResult> {
      const response = await gateway.generate({
        model: request.model,
        systemPrompt: request.systemPrompt,
        userPrompt: request.userPrompt,
        maxTokens: request.maxTokens
      });

      return {
        text: response.text,
        requestId: response.requestId
      };
    }
  };
}

export class ClaudeTeacherPolicy implements TeacherPolicy {
  private readonly client: DirectorClaudeClient;
  private readonly telemetry: TelemetrySink;
  private readonly logger: TeacherPolicyLogger;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly now: () => number;

  constructor(options: ClaudeTeacherPolicyOptions) {
    this.client = options.client;
    this.telemetry = options.telemetry ?? createNoOpTelemetrySink();
    this.logger = options.logger ?? NO_OP_LOGGER;
    this.model = options.model ?? DEFAULT_DIRECTOR_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.now = options.now ?? (() => Date.now());
  }

  async invoke(
    context: TeacherContext
  ): Promise<PedagogicalDirective> {
    const prompt = buildTeacherPrompt(context);
    const shouldAppendCalibrationHint =
      context.calibrationActive || isInPostPlacementCalibration(context.learner);
    const userPrompt = shouldAppendCalibrationHint
      ? `${prompt.user}\n\n${buildPostPlacementCalibrationHint()}`
      : prompt.user;
    const startedAt = this.now();

    this.logger.info("Teacher prompt constructed.", {
      conversationId: context.conversationId,
      sceneId: context.scene.sceneId,
      npcDefinitionId: context.npc.npcDefinitionId ?? null,
      npcDisplayName: context.npc.displayName ?? null,
      learnerBand: context.learner.estimatedCefrBand,
      calibrationActive: shouldAppendCalibrationHint,
      model: this.model,
      systemPrompt: prompt.system,
      userPrompt
    });

    await emitTelemetry(
      this.telemetry,
      createTelemetryEvent("director.invocation-started", {
        conversationId: context.conversationId,
        sessionId: context.telemetryContext?.sessionId,
        turnId: context.telemetryContext?.turnId,
        timestamp: startedAt,
        sceneId: context.scene.sceneId,
        npcId: context.npc.npcDefinitionId,
        npcDisplayName: context.npc.displayName,
        directorContext: {
          calibrationActive: context.calibrationActive,
          citedQuestEssentialCount: context.activeQuestEssentialLemmas.length,
          pendingProvisionalCount: context.pendingProvisionalLemmas.length,
          learnerBand: context.learner.estimatedCefrBand
        },
        cacheHit: false,
        model: this.model,
        cacheMarkers: prompt.cacheMarkers,
        pendingProvisionalSnapshot: context.pendingProvisionalLemmas,
        probeFloorState: context.probeFloorState
      })
    );

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
      this.logger.warn("Teacher invocation failed.", {
        conversationId: context.conversationId,
        sceneId: context.scene.sceneId,
        npcDefinitionId: context.npc.npcDefinitionId ?? null,
        npcDisplayName: context.npc.displayName ?? null,
        model: this.model,
        reason: error instanceof Error ? error.message : "Claude request failed"
      });
      await emitTelemetry(
        this.telemetry,
        createTelemetryEvent("director.invocation-failed", {
          conversationId: context.conversationId,
          sessionId: context.telemetryContext?.sessionId,
          turnId: context.telemetryContext?.turnId,
          timestamp: this.now(),
          sceneId: context.scene.sceneId,
          npcId: context.npc.npcDefinitionId,
          npcDisplayName: context.npc.displayName,
          model: this.model,
          latencyMs: this.now() - startedAt,
          reason: error instanceof Error ? error.message : "Claude request failed"
        })
      );
      throw new TeacherInvocationError(
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
      this.logger.warn("Teacher response failed schema validation; applying repair.", {
        conversationId: context.conversationId,
        sceneId: context.scene.sceneId,
        npcDefinitionId: context.npc.npcDefinitionId ?? null,
        npcDisplayName: context.npc.displayName ?? null,
        model: this.model,
        requestId: response.requestId ?? null,
        errorCode: parseResult.error.code,
        errorMessage: parseResult.error.message,
        errorDetails: parseResult.error.details,
        partialResponse: parseResult.error.partial,
        rawResponseText: response.text
      });
      directive = repairDirective(parseResult.error.partial, context.prescription, context, {
        telemetry: this.telemetry
      });
      parseMode = "repaired";
    } else {
      this.logger.warn("Teacher response rejected before repair; falling back.", {
        conversationId: context.conversationId,
        sceneId: context.scene.sceneId,
        npcDefinitionId: context.npc.npcDefinitionId ?? null,
        npcDisplayName: context.npc.displayName ?? null,
        model: this.model,
        requestId: response.requestId ?? null,
        errorCode: parseResult.error.code,
        errorMessage: parseResult.error.message,
        errorDetails: parseResult.error.details,
        partialResponse: parseResult.error.partial,
        rawResponseText: response.text,
        activeQuestEssentialLemmaCount: context.activeQuestEssentialLemmas.length
      });
      throw new TeacherInvocationError(
        parseResult.error.message,
        parseResult.error.code === "hard_floor_violated"
          ? "director-deferred-override"
          : undefined,
        parseResult.error
      );
    }

    this.logger.info("Teacher response received.", {
      conversationId: context.conversationId,
      sceneId: context.scene.sceneId,
      npcDefinitionId: context.npc.npcDefinitionId ?? null,
      npcDisplayName: context.npc.displayName ?? null,
      model: this.model,
      requestId: response.requestId ?? null,
      rawResponseText: response.text,
      parseMode,
      directive
    });

    const endedAt = this.now();
    await emitTelemetry(
      this.telemetry,
      createTelemetryEvent("director.invocation-completed", {
        conversationId: context.conversationId,
        sessionId: context.telemetryContext?.sessionId,
        turnId: context.telemetryContext?.turnId,
        timestamp: endedAt,
        sceneId: context.scene.sceneId,
        npcId: context.npc.npcDefinitionId,
        npcDisplayName: context.npc.displayName,
        directive,
        model: this.model,
        latencyMs: endedAt - startedAt,
        requestId: response.requestId ?? null,
        parseMode,
        cacheHit: false,
        fallback: directive.isFallbackDirective,
        tokenCost: {
          inputTokens:
            response.inputTokens ??
            estimatePromptTokens(prompt.system) + estimatePromptTokens(userPrompt),
          outputTokens: response.outputTokens ?? estimatePromptTokens(response.text),
          cacheReadInputTokens: response.cacheReadInputTokens ?? null,
          cacheCreationInputTokens: response.cacheCreationInputTokens ?? null
        }
      })
    );

    return directive;
  }
}
