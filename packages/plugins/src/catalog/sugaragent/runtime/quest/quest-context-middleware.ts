/**
 * packages/plugins/src/catalog/sugaragent/runtime/quest/quest-context-middleware.ts
 *
 * Purpose: sugaragent's quest-context CONTEXT-stage middleware (Plan
 * 077 D3). While a quest is active, resolves quest-relevant world lore
 * ONCE per quest-state (keyed on questId + stageId), memoizes it in
 * `execution.state`, and republishes it as an annotation that
 * GenerateStage splices into the UNCACHED user half (077.1 / D7) as
 * world-framed context for the NPC.
 *
 * ## Why this is the right seam (not per-turn Retrieve)
 *
 * RetrieveStage folds the quest name into its search only when the
 * player's text signals quest intent. If Mim never says "baggage",
 * nothing quest-relevant surfaces -- that is the gap D3 closes.
 * Loading once at conversation start (memoized per quest-state) also
 * keeps per-turn cost delta zero (D7).
 *
 * ## D2 prompt invariant (enforced here)
 *
 * The objective's displayName / description are the player's PRIVATE
 * goal and must NEVER enter the model's prompt verbatim. This
 * middleware uses them ONLY to seed the retrieval query (a string
 * never shown to the model). What enters the prompt is ONLY the
 * downstream world-lore text returned by the lore search.
 *
 * ## Invalidation vs memory
 *
 * Memory: load once, never re-load (the digest must be byte-stable).
 * Quest context: re-resolve whenever questId or stageId changes (the
 * quest advanced; different world facts apply). Memo key is
 * `questId::stageId`.
 *
 * Implements: Plan 077 §077.2 (D3)
 *
 * Status: active
 */

import type {
  ConversationExecutionContext,
  ConversationMiddleware
} from "@sugarmagic/runtime-core";
import type { SugarAgentLogger } from "../logger";
import type { VectorStoreProvider } from "../clients";

export const QUEST_CONTEXT_MIDDLEWARE_ID = "sugaragent.questContext";
export const QUEST_CONTEXT_STATE_KEY = "sugaragent.questContext";
export const QUEST_CONTEXT_ANNOTATION_KEY = "sugaragent.questContext";

const DEFAULT_MAX_WORLD_CONTEXT_CHARS = 400;

/**
 * Per-quest-state memo stored in `execution.state`. Cleared and
 * recomputed whenever questId or stageId changes.
 */
export interface MemoizedQuestContext {
  questId: string;
  stageId: string;
  worldContext: string | null;
}

/**
 * Published to `execution.annotations` every turn (from the memoized
 * value). GenerateStage reads `worldContext`; PlanStage reads
 * `hasContext` to set `hasQuestWorldContext`.
 */
export interface QuestContextAnnotation {
  hasContext: boolean;
  worldContext: string | null;
}

export interface QuestContextMiddlewareOptions {
  /**
   * The lore search backend (gateway-routed). When null/absent the
   * middleware degrades to a no-op (no quest context emitted), which
   * is correct when the gateway is not configured.
   */
  vectorStoreProvider?: VectorStoreProvider | null;
  logger?: SugarAgentLogger;
  /**
   * Hard cap on the world-context text spliced into the user message.
   * Keeps the uncached user half bounded. Defaults to 400 chars.
   */
  maxWorldContextChars?: number;
}

function isAgentSelection(
  selection: ConversationExecutionContext["selection"]
): boolean {
  return (
    selection.conversationKind === "free-form" &&
    typeof selection.npcDefinitionId === "string" &&
    selection.npcDefinitionId.length > 0
  );
}

/**
 * Build a retrieval query from the active quest objectives. The query
 * is PRIVATE -- used only to seed the vector search, never put in the
 * prompt (D2 prompt invariant).
 */
function buildRetrievalQuery(
  execution: ConversationExecutionContext
): string | null {
  const objectives = execution.runtimeContext?.activeQuestObjectives?.objectives;
  if (!objectives || objectives.length === 0) return null;
  const primary = objectives[0]!;
  const parts = [primary.description, primary.displayName].filter(
    (s): s is string => typeof s === "string" && s.trim().length > 0
  );
  if (parts.length === 0) return null;
  return parts.join(" ");
}

async function resolveWorldContext(
  execution: ConversationExecutionContext,
  options: QuestContextMiddlewareOptions
): Promise<string | null> {
  const vectorStoreProvider = options.vectorStoreProvider ?? null;
  if (!vectorStoreProvider) return null;

  const query = buildRetrievalQuery(execution);
  if (!query) return null;

  try {
    const results = await vectorStoreProvider.searchLore({
      vectorStoreId: "",
      query,
      maxResults: 2
    });
    if (results.length === 0) return null;

    const raw = results[0]!.text.trim();
    if (!raw) return null;

    const max = options.maxWorldContextChars ?? DEFAULT_MAX_WORLD_CONTEXT_CHARS;
    return raw.length > max ? raw.slice(0, max).trimEnd() + "..." : raw;
  } catch (error) {
    options.logger?.logPluginEvent("quest-context-resolve-failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

/**
 * The context-stage quest-context middleware. Priority 15 places it
 * after the blackboard middleware (priority -100, which populates
 * runtimeContext.activeQuestObjectives) and after the memory
 * middleware (priority 10).
 */
export function createQuestContextMiddleware(
  options: QuestContextMiddlewareOptions = {}
): ConversationMiddleware {
  return {
    middlewareId: QUEST_CONTEXT_MIDDLEWARE_ID,
    displayName: "SugarAgent Quest Context",
    priority: 15,
    stage: "context",
    async prepare(execution) {
      if (!isAgentSelection(execution.selection)) return execution;

      const trackedQuest = execution.runtimeContext?.trackedQuest ?? null;
      if (!trackedQuest) {
        delete execution.annotations[QUEST_CONTEXT_ANNOTATION_KEY];
        return execution;
      }

      const questId = trackedQuest.questId;
      const stageId =
        execution.runtimeContext?.activeQuestStage?.stageId ?? "";

      const existing = execution.state[QUEST_CONTEXT_STATE_KEY] as
        | MemoizedQuestContext
        | undefined;

      let memoized: MemoizedQuestContext;
      if (
        existing &&
        existing.questId === questId &&
        existing.stageId === stageId
      ) {
        memoized = existing;
      } else {
        const worldContext = await resolveWorldContext(execution, options);
        memoized = { questId, stageId, worldContext };
        execution.state[QUEST_CONTEXT_STATE_KEY] = memoized;
        options.logger?.logPluginEvent("quest-context-resolved", {
          questId,
          stageId,
          hasContext: worldContext !== null
        });
      }

      const annotation: QuestContextAnnotation = {
        hasContext: memoized.worldContext !== null,
        worldContext: memoized.worldContext
      };
      execution.annotations[QUEST_CONTEXT_ANNOTATION_KEY] = annotation;

      return execution;
    }
  };
}
