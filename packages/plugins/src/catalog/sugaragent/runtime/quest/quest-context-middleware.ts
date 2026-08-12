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
 * ## Which result gets used
 *
 * The search returns several candidates and the highest-scoring one
 * becomes the world context. Anything below the project's relevance
 * threshold was already dropped by the vector store, so an empty result
 * means nothing was relevant enough and the NPC gets no world context
 * -- an unrelated page presented as the current state of the world is
 * worse than none, and it would stay pinned for the whole quest stage.
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
import type { RetrievedEvidenceItem } from "../types";
import { recordQuestContextSnapshot } from "./quest-context-debug";

export const QUEST_CONTEXT_MIDDLEWARE_ID = "sugaragent.questContext";
export const QUEST_CONTEXT_STATE_KEY = "sugaragent.questContext";
export const QUEST_CONTEXT_ANNOTATION_KEY = "sugaragent.questContext";

const DEFAULT_MAX_WORLD_CONTEXT_CHARS = 400;

/**
 * How many lore results to consider before picking one. Only a single
 * item is ever used, but asking for several leaves room for the vector
 * store to have dropped some below the relevance threshold.
 */
const WORLD_CONTEXT_CANDIDATE_COUNT = 5;

/**
 * Per-quest-state memo stored in `execution.state`. Cleared and
 * recomputed whenever questId or stageId changes.
 */
export interface MemoizedQuestContext {
  questId: string;
  stageId: string;
  worldContext: string | null;
  /** Similarity score of the chosen result; null when nothing was chosen. */
  worldContextScore: number | null;
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

/** What one resolution attempt produced. `text` is null when nothing was usable. */
interface WorldContextResolution {
  text: string | null;
  score: number | null;
}

function noWorldContext(): WorldContextResolution {
  return { text: null, score: null };
}

/** Highest-scoring result that has text, or null when there is none. */
function pickBest(items: RetrievedEvidenceItem[]): RetrievedEvidenceItem | null {
  let best: RetrievedEvidenceItem | null = null;
  for (const item of items) {
    if (item.text.trim().length === 0) continue;
    if (!best || item.score > best.score) best = item;
  }
  return best;
}

/**
 * Search lore for something that describes the world around this quest
 * objective and keep the best result. The vector store has already
 * dropped anything below the project's relevance threshold, so an empty
 * result means nothing was relevant enough -- and the NPC gets no world
 * context, which beats presenting an unrelated page as the current
 * state of the world.
 */
async function resolveWorldContext(
  execution: ConversationExecutionContext,
  options: QuestContextMiddlewareOptions
): Promise<WorldContextResolution> {
  const vectorStoreProvider = options.vectorStoreProvider ?? null;
  if (!vectorStoreProvider) return noWorldContext();

  const query = buildRetrievalQuery(execution);
  if (!query) return noWorldContext();

  try {
    const results = await vectorStoreProvider.searchLore({
      vectorStoreId: "",
      query,
      maxResults: WORLD_CONTEXT_CANDIDATE_COUNT
    });

    const best = pickBest(results);
    if (!best) return noWorldContext();

    const raw = best.text.trim();
    const max = options.maxWorldContextChars ?? DEFAULT_MAX_WORLD_CONTEXT_CHARS;
    const text = raw.length > max ? raw.slice(0, max).trimEnd() + "..." : raw;
    return { text, score: best.score };
  } catch (error) {
    options.logger?.logPluginEvent("quest-context-resolve-failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    return noWorldContext();
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
        const resolution = await resolveWorldContext(execution, options);
        memoized = {
          questId,
          stageId,
          worldContext: resolution.text,
          worldContextScore: resolution.score
        };
        execution.state[QUEST_CONTEXT_STATE_KEY] = memoized;
        options.logger?.logPluginEvent("quest-context-resolved", {
          questId,
          stageId,
          hasContext: resolution.text !== null,
          score: resolution.score
        });
      }

      const annotation: QuestContextAnnotation = {
        hasContext: memoized.worldContext !== null,
        worldContext: memoized.worldContext
      };
      execution.annotations[QUEST_CONTEXT_ANNOTATION_KEY] = annotation;

      // Dev handle snapshot -- no-op in prod (the handle is not installed
      // unless questAwareNpcsEnabled was true at plugin init).
      const npcDefinitionId = execution.selection.npcDefinitionId ?? "";
      if (typeof npcDefinitionId === "string" && npcDefinitionId) {
        recordQuestContextSnapshot({
          npcDefinitionId,
          questId,
          stageId,
          worldContext: memoized.worldContext,
          worldContextScore: memoized.worldContextScore,
          goalSurfacedCount: execution.runtimeContext?.goalSurfacedCount ?? null
        });
      }

      return execution;
    }
  };
}
