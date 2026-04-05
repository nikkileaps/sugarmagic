import type { ConversationExecutionContext } from "@sugarmagic/runtime-core";
import {
  OPENAI_VECTOR_STORE_PAGE_ID_ATTRIBUTE,
  type EmbeddingsProvider,
  type OpenAIVectorStoreFilter,
  type VectorStoreProvider
} from "../clients";
import { createDiagnostics } from "./diagnostics";
import { normalizeRetrievedEvidenceText, summarizeEvidence } from "./helpers";
import type {
  InterpretResult,
  RetrieveResult,
  TurnStage,
  TurnStageResult,
  TurnStageContext
} from "../types";

/**
 * Retrieve gathers grounded world context for the turn.
 * It resolves the evidence pack that later stages use for planning,
 * realization, and repair without inventing new facts.
 *
 * Stage instances may only hold immutable service dependencies.
 * All runtime/session/turn data must remain in:
 * - provider state
 * - execution context
 * - stage input/output
 */
export interface RetrieveStageInput {
  execution: ConversationExecutionContext;
  interpret: InterpretResult;
}

export class RetrieveStage implements TurnStage<RetrieveStageInput, RetrieveResult> {
  readonly stageId = "Retrieve";

  constructor(
    private readonly embeddingsProvider: EmbeddingsProvider | null,
    private readonly vectorStoreProvider: VectorStoreProvider | null
  ) {}

  async execute(
    input: RetrieveStageInput,
    context: TurnStageContext
  ): Promise<TurnStageResult<RetrieveResult>> {
    const startedAt = Date.now();
    const activeQuest = input.execution.selection.activeQuest;
    const lorePageId =
      typeof input.execution.selection.lorePageId === "string" &&
      input.execution.selection.lorePageId.trim().length > 0
        ? input.execution.selection.lorePageId.trim()
        : null;
    const skipRetrieval = input.interpret.turnRouting.path === "social_fast";
    const searchQuery =
      input.interpret.interpretation.intent === "quest_guidance" && activeQuest?.displayName
        ? `${input.interpret.searchQuery}\nActive quest: ${activeQuest.displayName}`
        : input.interpret.searchQuery;

    let semanticQueryFingerprint: number[] | null = null;
    let usedEmbeddings = false;
    let vectorSearchPerformed = false;
    let evidencePack: RetrieveResult["evidencePack"] = [];
    let fallbackReason: string | null = null;
    let status: TurnStageResult<RetrieveResult>["status"] = "ok";
    const canUseProxyDefaults = context.config.proxyBaseUrl.trim().length > 0;
    let broadenedBeyondLorePage = false;
    const retrievalFilters: OpenAIVectorStoreFilter | undefined =
      !skipRetrieval && lorePageId
        ? {
            type: "eq",
            key: OPENAI_VECTOR_STORE_PAGE_ID_ATTRIBUTE,
            value: lorePageId
          }
        : undefined;

    if (
      !skipRetrieval &&
      this.embeddingsProvider &&
      (context.config.openAiEmbeddingModel.trim() || canUseProxyDefaults)
    ) {
      try {
        semanticQueryFingerprint = await this.embeddingsProvider.embedQuery(
          searchQuery,
          context.config.openAiEmbeddingModel
        );
        usedEmbeddings = true;
      } catch {
        status = "degraded";
        fallbackReason = "embedding-unavailable";
        semanticQueryFingerprint = null;
      }
    }

    if (
      !skipRetrieval &&
      this.vectorStoreProvider &&
      (context.config.openAiVectorStoreId.trim() || canUseProxyDefaults)
    ) {
      try {
        evidencePack = await this.vectorStoreProvider.searchLore({
          vectorStoreId: context.config.openAiVectorStoreId,
          query: searchQuery,
          maxResults: context.config.maxEvidenceResults,
          filters: retrievalFilters
        });
        if (evidencePack.length === 0 && retrievalFilters) {
          evidencePack = await this.vectorStoreProvider.searchLore({
            vectorStoreId: context.config.openAiVectorStoreId,
            query: searchQuery,
            maxResults: context.config.maxEvidenceResults
          });
          broadenedBeyondLorePage = true;
        }
        vectorSearchPerformed = true;
      } catch {
        status = "degraded";
        fallbackReason = fallbackReason ?? "vector-search-unavailable";
        evidencePack = [];
      }
    }

    evidencePack = evidencePack.map((item) => ({
      ...item,
      text: normalizeRetrievedEvidenceText(item.text)
    }));

    const output: RetrieveResult = {
      evidencePack,
      usedEmbeddings,
      vectorSearchPerformed,
      semanticQueryFingerprint
    };

    return {
      output,
      diagnostics: createDiagnostics(
        this.stageId,
        startedAt,
        status,
        {
          turnPath: input.interpret.turnRouting.path,
          queryType: input.interpret.queryType,
          skippedRetrieval: skipRetrieval,
          evidencePackSummary: summarizeEvidence(evidencePack),
          evidenceCount: evidencePack.length,
          lorePageId,
          retrievalFilters,
          broadenedBeyondLorePage,
          usedEmbeddings,
          vectorSearchPerformed,
          semanticQueryDimensions: semanticQueryFingerprint?.length ?? 0
        },
        fallbackReason
      ),
      status
    };
  }
}
