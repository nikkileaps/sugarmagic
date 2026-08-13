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
 * The search returns several candidates and they are considered
 * highest-scoring first. Anything below the project's relevance
 * threshold was already dropped by the vector store, so an empty result
 * means nothing was relevant enough and the NPC gets no world context
 * -- an unrelated page presented as the current state of the world is
 * worse than none, and it would stay pinned for the whole quest stage.
 *
 * ## Another character's page is not the world
 *
 * A candidate that describes a different character is not world context:
 * handed one, an NPC reads it as a description of itself and speaks as
 * that character. What this NPC knows about them is what its OWN page
 * says under `## Relationships`, so that text is used instead. When its
 * page says nothing about them, the candidate is dropped and the next
 * one is considered.
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
import {
  OPENAI_VECTOR_STORE_PAGE_ID_ATTRIBUTE,
  OPENAI_VECTOR_STORE_TITLE_ATTRIBUTE,
  type LorePageResolver,
  type ResolvedLorePage,
  type VectorStoreProvider
} from "../clients";
// Pure, browser-safe classifier shared with the gateway's ingest.
import {
  findRelationshipEntry,
  isCharacterPage,
  isRelationshipsSection,
  parseRelationshipEntries,
  type LoreRelationshipEntry
} from "../../../../deployment/gateway/lore-designation";
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
  /** Title of the lore page the text came from; null when the chunk has none. */
  worldContextTitle: string | null;
  /** True when the chosen page is the speaking NPC's own lore page. */
  worldContextIsOwnPage: boolean;
}

/**
 * Published to `execution.annotations` every turn (from the memoized
 * value). GenerateStage reads `worldContext`; PlanStage reads
 * `hasContext` to set `hasQuestWorldContext`.
 */
export interface QuestContextAnnotation {
  hasContext: boolean;
  worldContext: string | null;
  /**
   * Title of the lore page the text came from, so the prompt can say whose
   * page it is. Null when the chunk carries no title attribute.
   */
  worldContextTitle: string | null;
  /**
   * True when the chosen page is the speaking NPC's own lore page. Prompts
   * that tell the NPC the block is about someone else must not say that when
   * it is in fact about them.
   */
  worldContextIsOwnPage: boolean;
}

export interface QuestContextMiddlewareOptions {
  /**
   * The lore search backend (gateway-routed). When null/absent the
   * middleware degrades to a no-op (no quest context emitted), which
   * is correct when the gateway is not configured.
   */
  vectorStoreProvider?: VectorStoreProvider | null;
  /**
   * Fetches whole lore pages, to tell which search results describe a
   * character and to read the speaker's `## Relationships`. Absent means no
   * page can be classified, so results are used as they were before #171.
   */
  lorePageResolver?: LorePageResolver | null;
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
  title: string | null;
  isOwnPage: boolean;
  /** How many other-character pages were passed over to get here. */
  droppedCharacterPages: number;
}

function noWorldContext(): WorldContextResolution {
  return {
    text: null,
    score: null,
    title: null,
    isOwnPage: false,
    droppedCharacterPages: 0
  };
}

/** A chunk attribute, or null when it is absent or not a non-empty string. */
function readStringAttribute(
  item: RetrievedEvidenceItem,
  key: string
): string | null {
  const value = item.attributes[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Results that carry text, best-scoring first. */
function rankCandidates(items: RetrievedEvidenceItem[]): RetrievedEvidenceItem[] {
  return items
    .filter((item) => item.text.trim().length > 0)
    .sort((left, right) => right.score - left.score);
}

function truncate(raw: string, options: QuestContextMiddlewareOptions): string {
  const max = options.maxWorldContextChars ?? DEFAULT_MAX_WORLD_CONTEXT_CHARS;
  const trimmed = raw.trim();
  return trimmed.length > max
    ? trimmed.slice(0, max).trimEnd() + "..."
    : trimmed;
}

/**
 * The lore pages behind a set of search results, by page id. Empty when there
 * is no resolver or the fetch fails: the caller then cannot tell a character
 * page from a place, and keeps the best result as it always did.
 */
async function fetchCandidatePages(
  pageIds: string[],
  options: QuestContextMiddlewareOptions
): Promise<Map<string, ResolvedLorePage>> {
  const resolver = options.lorePageResolver ?? null;
  if (!resolver || pageIds.length === 0) return new Map();
  try {
    const pages = await resolver.resolvePages(pageIds);
    return new Map(pages.map((page) => [page.pageId, page]));
  } catch (error) {
    options.logger?.logPluginEvent("quest-context-page-fetch-failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    return new Map();
  }
}

/** The `## Relationships` bullets on a page, or none when it has no such section. */
function readRelationships(
  page: ResolvedLorePage | undefined
): LoreRelationshipEntry[] {
  const section = page?.sections.find(isRelationshipsSection);
  return section ? parseRelationshipEntries(section.content) : [];
}

/**
 * Search lore for something that describes the world around this quest
 * objective, and choose what the NPC is allowed to be told.
 *
 * Candidates are considered best-scoring first. The vector store has already
 * dropped everything below the project's relevance threshold, so an empty
 * result means nothing was relevant enough and the NPC gets no world context.
 *
 * A page that describes another character is not world context. What this NPC
 * knows about that character is what their OWN page says in `## Relationships`,
 * so that is what gets injected; when their page says nothing about them, the
 * candidate is dropped and the next one is considered (#171).
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

    const candidates = rankCandidates(results);
    if (candidates.length === 0) return noWorldContext();

    const ownPageId =
      typeof execution.selection.lorePageId === "string"
        ? execution.selection.lorePageId.trim()
        : "";
    const candidatePageIds = candidates
      .map((item) => readStringAttribute(item, OPENAI_VECTOR_STORE_PAGE_ID_ATTRIBUTE))
      .filter((id): id is string => id !== null);
    const pages = await fetchCandidatePages(
      Array.from(new Set([...candidatePageIds, ownPageId].filter(Boolean))),
      options
    );
    const ownPage = ownPageId ? pages.get(ownPageId) : undefined;
    const relationships = readRelationships(ownPage);
    let droppedCharacterPages = 0;

    for (const candidate of candidates) {
      const pageId = readStringAttribute(
        candidate,
        OPENAI_VECTOR_STORE_PAGE_ID_ATTRIBUTE
      );
      const title = readStringAttribute(
        candidate,
        OPENAI_VECTOR_STORE_TITLE_ATTRIBUTE
      );

      if (ownPageId && pageId === ownPageId) {
        return {
          text: truncate(candidate.text, options),
          score: candidate.score,
          title,
          isOwnPage: true,
          droppedCharacterPages
        };
      }

      const page = pageId ? pages.get(pageId) : undefined;
      if (page && isCharacterPage(page.sections)) {
        const entry = findRelationshipEntry(relationships, {
          pageId,
          title: title ?? page.title
        });
        if (entry && entry.description.trim().length > 0) {
          // Their own words about that character, so the block is about
          // somebody else without ever being that somebody else's page.
          return {
            text: truncate(
              `What you know of ${entry.name}: ${entry.description}`,
              options
            ),
            score: candidate.score,
            title: ownPage?.title ?? null,
            isOwnPage: true,
            droppedCharacterPages
          };
        }
        droppedCharacterPages += 1;
        continue;
      }

      return {
        text: truncate(candidate.text, options),
        score: candidate.score,
        title,
        isOwnPage: false,
        droppedCharacterPages
      };
    }

    return { ...noWorldContext(), droppedCharacterPages };
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
          worldContextScore: resolution.score,
          worldContextTitle: resolution.title,
          worldContextIsOwnPage: resolution.isOwnPage
        };
        execution.state[QUEST_CONTEXT_STATE_KEY] = memoized;
        options.logger?.logPluginEvent("quest-context-resolved", {
          questId,
          stageId,
          hasContext: resolution.text !== null,
          score: resolution.score,
          sourceTitle: resolution.title,
          fromOwnPage: resolution.isOwnPage,
          droppedCharacterPages: resolution.droppedCharacterPages
        });
      }

      const annotation: QuestContextAnnotation = {
        hasContext: memoized.worldContext !== null,
        worldContext: memoized.worldContext,
        worldContextTitle: memoized.worldContextTitle,
        worldContextIsOwnPage: memoized.worldContextIsOwnPage
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
          worldContextTitle: memoized.worldContextTitle,
          worldContextIsOwnPage: memoized.worldContextIsOwnPage,
          goalSurfacedCount: execution.runtimeContext?.goalSurfacedCount ?? null
        });
      }

      return execution;
    }
  };
}
