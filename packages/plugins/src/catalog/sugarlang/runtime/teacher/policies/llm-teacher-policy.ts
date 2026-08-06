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
import { traceDirectiveSize } from "../directive-size";
import { noteTurnFact } from "@sugarmagic/runtime-core";
import { buildPostPlacementCalibrationHint, isInPostPlacementCalibration } from "../calibration-mode";
import { traceTeacherCall } from "../teacher-trace";
import {
  buildTeacherPrompt,
  summarizeDueListPressure,
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
import { EMPTY_NPC_CONTEXT } from "../../situation";
import { computePacingSignals } from "../../learner";
import { resolveQuestEssentialLemmaRefs } from "../quest-essential";
import { competencyIdForCardKey } from "../../inventory/card-display-name";

// NO DEFAULT MODEL ON PURPOSE (2026-07-28). This used to be
// `DEFAULT_TEACHER_MODEL = "claude-sonnet-4-6"`, which was inert: the gateway
// client never forwarded it, so the Teacher silently ran on the sugaragent
// DIALOGUE model. The model is now resolved server-side from
// `purpose: "teacher"` -> SUGARMAGIC_SUGARLANG_TEACHER_MODEL. A local constant
// here would just re-create a lie that reads as configuration.
const DEFAULT_MAX_TOKENS = 900;

export interface TeacherClaudeClientResult {
  text: string;
  requestId?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadInputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
}

export interface TeacherClaudeClientRequest {
  /** null => the gateway resolves the model from `purpose: "teacher"`. */
  model: string | null;
  systemPrompt: string;
  /** System content as cacheable blocks. Preferred over `systemPrompt`. */
  systemBlocks?: Array<{ text: string; cache?: boolean }>;
  userPrompt: string;
  maxTokens: number;
  cacheMarkers: string[];
}

export interface TeacherClaudeClient {
  generateStructuredDirective: (
    request: TeacherClaudeClientRequest
  ) => Promise<TeacherClaudeClientResult>;
}

export interface ClaudeTeacherPolicyOptions {
  client: TeacherClaudeClient;
  telemetry?: TelemetrySink;
  logger?: TeacherPolicyLogger;
  /** Escape hatch for tooling/tests. Leave unset in production: the gateway
   *  resolves the model from `purpose: "teacher"` so model choice is a
   *  deploy-time decision, not a client-side one (Plan 073.2). */
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
 * Creates a TeacherClaudeClient backed by sugarlang's own gateway.
 * No dependency on sugaragent — all calls go through the gateway proxy.
 */
/**
 * Due items the Teacher was shown and did not choose this turn.
 *
 * Ids only. Whether the pile is a problem is an aggregate question, and
 * carrying the whole card here would put learner state in a telemetry payload
 * that already names the item.
 */
function passedOverDueItems(
  context: TeacherContext,
  directive: PedagogicalDirective
): string[] {
  const due = context.learnerProgress?.dueItemIds ?? [];
  if (due.length === 0) return [];

  const lang = context.lang.targetLanguage;
  const chosenLemmas = new Set<string>();
  const chosenCompetencies = new Set<string>();
  for (const ref of [
    ...directive.targetVocab.introduce,
    ...directive.targetVocab.reinforce
  ]) {
    if (ref.kind === "competency") chosenCompetencies.add(ref.competencyId);
    else chosenLemmas.add(ref.lemmaId);
  }

  // A due id is a CARD key, so a competency card is `exponent:<exponentId>` and
  // has to be resolved back to its competency before it can be compared with
  // what the Teacher chose. Comparing the two id spaces directly matches
  // nothing, so every competency reads as passed over even when it was picked.
  return due.filter((itemId) => {
    const competencyId = competencyIdForCardKey(itemId, lang);
    return competencyId === null
      ? !chosenLemmas.has(itemId)
      : !chosenCompetencies.has(competencyId);
  });
}

export function createGatewayTeacherClient(
  gateway: SugarlangLLMClient
): TeacherClaudeClient {
  return {
    async generateStructuredDirective(request): Promise<TeacherClaudeClientResult> {
      const response = await gateway.generate({
        // Server-side model routing. Without this the gateway falls through to
        // the sugaragent dialogue model — which is exactly the bug this fixes.
        purpose: "teacher",
        ...(request.model === null ? {} : { model: request.model }),
        systemPrompt: request.systemPrompt,
        ...(request.systemBlocks ? { systemBlocks: request.systemBlocks } : {}),
        userPrompt: request.userPrompt,
        maxTokens: request.maxTokens
      });

      return {
        text: response.text,
        requestId: response.requestId,
        inputTokens: response.inputTokens ?? null,
        outputTokens: response.outputTokens ?? null,
        cacheReadInputTokens: response.cacheReadInputTokens ?? null,
        cacheCreationInputTokens: response.cacheCreationInputTokens ?? null
      };
    }
  };
}

export class ClaudeTeacherPolicy implements TeacherPolicy {
  private readonly client: TeacherClaudeClient;
  private readonly telemetry: TelemetrySink;
  private readonly logger: TeacherPolicyLogger;
  private readonly model: string | null;
  private readonly maxTokens: number;
  private readonly now: () => number;

  constructor(options: ClaudeTeacherPolicyOptions) {
    this.client = options.client;
    this.telemetry = options.telemetry ?? createNoOpTelemetrySink();
    this.logger = options.logger ?? NO_OP_LOGGER;
    // null unless a caller explicitly overrides; the gateway picks otherwise.
    this.model = options.model ?? null;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.now = options.now ?? (() => Date.now());
  }

  async invoke(
    context: TeacherContext
  ): Promise<PedagogicalDirective> {
    const sceneId = context.situation?.sceneId ?? "unknown-scene";
    const npc = context.situation?.npc ?? EMPTY_NPC_CONTEXT;
    // 090.4: derived, not carried -- see learner/pacing-signals.ts.
    const { pendingProvisionalLemmas, probeFloorState } = computePacingSignals(
      context.learner,
      context.situation?.turnsSinceLastProbe ?? 0
    );
    const prompt = buildTeacherPrompt(context);
    const shouldAppendCalibrationHint =
      context.calibrationActive || isInPostPlacementCalibration(context.learner);
    const userPrompt = shouldAppendCalibrationHint
      ? `${prompt.user}\n\n${buildPostPlacementCalibrationHint()}`
      : prompt.user;
    const startedAt = this.now();

    this.logger.info("Teacher prompt constructed.", {
      conversationId: context.conversationId,
      sceneId,
      npcDefinitionId: npc.npcDefinitionId ?? null,
      npcDisplayName: npc.displayName ?? null,
      learnerBand: context.learner.estimatedCefrBand,
      calibrationActive: shouldAppendCalibrationHint,
      model: this.model,
      systemPrompt: prompt.system,
      userPrompt
    });

    await emitTelemetry(
      this.telemetry,
      createTelemetryEvent("teacher.invocation-started", {
        conversationId: context.conversationId,
        sessionId: context.telemetryContext?.sessionId,
        turnId: context.telemetryContext?.turnId,
        timestamp: startedAt,
        sceneId,
        npcId: npc.npcDefinitionId,
        npcDisplayName: npc.displayName,
        teacherContext: {
          calibrationActive: context.calibrationActive,
          citedQuestEssentialCount: resolveQuestEssentialLemmaRefs(
            context.situation,
            context.atlas,
            context.lang
          ).length,
          pendingProvisionalCount: pendingProvisionalLemmas.length,
          learnerBand: context.learner.estimatedCefrBand,
          // Whether competencies are being squeezed out of the shared top-N
          // due list by the far larger pool of word cards. If competenciesCut
          // is routinely above zero, the answer is a short line of their own
          // rather than a shared cap.
          dueListPressure: summarizeDueListPressure(context)
        },
        cacheHit: false,
        model: this.model,
        cacheMarkers: prompt.cacheMarkers,
        pendingProvisionalSnapshot: pendingProvisionalLemmas,
        probeFloorState
      })
    );

    let response: TeacherClaudeClientResult;
    try {
      response = await this.client.generateStructuredDirective({
        model: this.model,
        systemPrompt: prompt.system,
        systemBlocks: prompt.systemBlocks,
        userPrompt,
        maxTokens: this.maxTokens,
        cacheMarkers: prompt.cacheMarkers
      });
      // Spike (sugarmagic-latency-cex). The Teacher is the largest single cost
      // in a turn and nothing has ever confirmed its prompt cache actually
      // hits: the telemetry that would have said so has been 404ing. A cache
      // read of 0 on a repeat call means 222.9's caching is not working in
      // production, which would be most of the explanation.
      noteTurnFact("teacherIn", response.inputTokens ?? -1);
      noteTurnFact("teacherCacheRead", response.cacheReadInputTokens ?? -1);
      noteTurnFact("teacherCacheWrite", response.cacheCreationInputTokens ?? -1);
      noteTurnFact("teacherOut", response.outputTokens ?? -1);
      // bkg: which FIELDS those output tokens are in. Measure before cutting.
      traceDirectiveSize(response.text, response.outputTokens ?? null);
    } catch (error) {
      this.logger.warn("Teacher invocation failed.", {
        conversationId: context.conversationId,
        sceneId: sceneId,
        npcDefinitionId: npc.npcDefinitionId ?? null,
        npcDisplayName: npc.displayName ?? null,
        model: this.model,
        reason: error instanceof Error ? error.message : "Claude request failed"
      });
      await emitTelemetry(
        this.telemetry,
        createTelemetryEvent("teacher.invocation-failed", {
          conversationId: context.conversationId,
          sessionId: context.telemetryContext?.sessionId,
          turnId: context.telemetryContext?.turnId,
          timestamp: this.now(),
          sceneId: sceneId,
          npcId: npc.npcDefinitionId,
          npcDisplayName: npc.displayName,
          model: this.model,
          latencyMs: this.now() - startedAt,
          reason: error instanceof Error ? error.message : "Claude request failed"
        })
      );
      // Trace BEFORE throwing. A failed call that prints nothing looks exactly
      // like a call that never happened, and the fallback directive that
      // follows would then appear to come from nowhere.
      traceTeacherCall({
        context,
        systemPrompt: prompt.system,
        userPrompt,
        errorText: error instanceof Error ? error.message : "Claude request failed"
      });
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
        sceneId: sceneId,
        npcDefinitionId: npc.npcDefinitionId ?? null,
        npcDisplayName: npc.displayName ?? null,
        model: this.model,
        requestId: response.requestId ?? null,
        errorCode: parseResult.error.code,
        errorMessage: parseResult.error.message,
        errorDetails: parseResult.error.details,
        partialResponse: parseResult.error.partial,
        rawResponseText: response.text
      });
      // Spike: teacherOut brushes the 900-token cap (867 observed). If the
      // model is being cut off mid-JSON, every such directive is a local
      // reconstruction of a truncated slate -- worth knowing how often.
      noteTurnFact("teacherParse", "repaired");
      directive = repairDirective(parseResult.error.partial, context, {
        telemetry: this.telemetry
      });
      parseMode = "repaired";
    } else {
      this.logger.warn("Teacher response rejected before repair; falling back.", {
        conversationId: context.conversationId,
        sceneId: sceneId,
        npcDefinitionId: npc.npcDefinitionId ?? null,
        npcDisplayName: npc.displayName ?? null,
        model: this.model,
        requestId: response.requestId ?? null,
        errorCode: parseResult.error.code,
        errorMessage: parseResult.error.message,
        errorDetails: parseResult.error.details,
        partialResponse: parseResult.error.partial,
        rawResponseText: response.text,
        activeQuestEssentialLemmaCount: resolveQuestEssentialLemmaRefs(
          context.situation,
          context.atlas,
          context.lang
        ).length
      });
      traceTeacherCall({
        context,
        systemPrompt: prompt.system,
        userPrompt,
        errorText: `parse failed: ${parseResult.error.message}`
      });
      throw new TeacherInvocationError(
        parseResult.error.message,
        parseResult.error.code === "hard_floor_violated"
          ? "teacher-deferred-override"
          : undefined,
        parseResult.error
      );
    }

    // The prose bound (prompt-builder) is PROMPT guidance, not schema-enforced:
    // rejecting a directive over an over-long rationale would spend a whole
    // re-plan on a debugging note. So record whether the model obeys it.
    noteTurnFact("teacherRationaleChars", directive.rationale?.length ?? -1);
    noteTurnFact("teacherCitedSignals", directive.citedSignals?.length ?? -1);

    this.logger.info("Teacher response received.", {
      conversationId: context.conversationId,
      sceneId: sceneId,
      npcDefinitionId: npc.npcDefinitionId ?? null,
      npcDisplayName: npc.displayName ?? null,
      model: this.model,
      requestId: response.requestId ?? null,
      // What the call cost, and whether the cached prefix was reused. Without
      // this a cache hit and a miss look identical from the outside, which is
      // the state 222.9 found things in.
      //   cacheRead > 0    the cached prefix was reused
      //   cacheWrite > 0   the entry was (re)written -- first call, or the
      //                    prompt constants or curriculum changed
      //   both 0           the gateway is not applying the breakpoints at all
      cacheReadTokens: response.cacheReadInputTokens ?? 0,
      cacheWriteTokens: response.cacheCreationInputTokens ?? 0,
      inputTokens: response.inputTokens ?? null,
      outputTokens: response.outputTokens ?? null,
      rawResponseText: response.text,
      parseMode,
      directive
    });

    const endedAt = this.now();
    await emitTelemetry(
      this.telemetry,
      createTelemetryEvent("teacher.invocation-completed", {
        conversationId: context.conversationId,
        sessionId: context.telemetryContext?.sessionId,
        turnId: context.telemetryContext?.turnId,
        timestamp: endedAt,
        sceneId: sceneId,
        npcId: npc.npcDefinitionId,
        npcDisplayName: npc.displayName,
        directive,
        model: this.model,
        latencyMs: endedAt - startedAt,
        requestId: response.requestId ?? null,
        parseMode,
        cacheHit: false,
        fallback: directive.isFallbackDirective,
        // The other half of the stranded-item question. `mostOverdue` on
        // `learner.progress-derived` says how long something has been due;
        // this says it was on offer THIS turn and was not taken. Counting the
        // same id across turns is what turns "due for three weeks" into "due
        // for three weeks and passed over forty times".
        //
        // Passing over a due item is correct when the moment does not afford
        // it, so this is a measurement and never a rule.
        dueItemsPassedOver: passedOverDueItems(context, directive),
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

    // Console trace: situation + full prompt + directive, for the browser
    // console. Placed on the success path AFTER the directive exists so all
    // three are real; the throw paths above trace separately.
    traceTeacherCall({
      context,
      systemPrompt: prompt.system,
      userPrompt,
      directive
    });

    return directive;
  }
}
