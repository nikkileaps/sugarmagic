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

function buildCurrentLocationEvidence(
  execution: ConversationExecutionContext
): RetrieveResult["evidencePack"][number] | null {
  const currentLocation = execution.runtimeContext?.here;
  if (!currentLocation?.regionDisplayName) {
    return null;
  }

  const locationText = currentLocation.sceneDisplayName
    ? `The current location is ${currentLocation.sceneDisplayName} in ${currentLocation.regionDisplayName}.`
    : `The current location is ${currentLocation.regionDisplayName}.`;

  return {
    fileId: "runtime:blackboard:current-location",
    filename: "runtime.current-location",
    score: 1,
    text: locationText,
    attributes: {
      source: "runtime-blackboard",
      region_id: currentLocation.regionId,
      scene_id: currentLocation.sceneId,
      page_id: currentLocation.regionLorePageId
    }
  };
}

function resolveEffectiveSearchQuery(
  interpret: InterpretResult,
  execution: ConversationExecutionContext,
  activeQuestDisplayName: string | null
): string {
  const segments: string[] = [interpret.searchQuery];

  if (
    interpret.interpretation.contextAnchor === "current_location" ||
    interpret.interpretation.facet === "location"
  ) {
    const currentLocation = execution.runtimeContext?.here;
    if (currentLocation?.regionDisplayName) {
      segments.push(`Current location: ${currentLocation.regionDisplayName}`);
    }
    if (currentLocation?.sceneDisplayName) {
      segments.push(`Current scene: ${currentLocation.sceneDisplayName}`);
    }
  }

  if (interpret.interpretation.intent === "quest_guidance" && activeQuestDisplayName) {
    segments.push(`Active quest: ${activeQuestDisplayName}`);
  }

  return segments.filter(Boolean).join("\n");
}

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
    const runtimeCurrentLocation = input.execution.runtimeContext?.here ?? null;
    const activeQuestDisplayName =
      input.execution.runtimeContext?.trackedQuest?.displayName ??
      input.execution.selection.activeQuest?.displayName ??
      null;
    const npcLorePageId =
      typeof input.execution.selection.lorePageId === "string" &&
      input.execution.selection.lorePageId.trim().length > 0
        ? input.execution.selection.lorePageId.trim()
        : null;
    const currentLocationLorePageId =
      typeof runtimeCurrentLocation?.regionLorePageId === "string" &&
      runtimeCurrentLocation.regionLorePageId.trim().length > 0
        ? runtimeCurrentLocation.regionLorePageId.trim()
        : null;
    const skipRetrieval = input.interpret.turnRouting.path === "social_fast";
    const searchQuery = resolveEffectiveSearchQuery(
      input.interpret,
      input.execution,
      activeQuestDisplayName
    );

    let semanticQueryFingerprint: number[] | null = null;
    let usedEmbeddings = false;
    let vectorSearchPerformed = false;
    let evidencePack: RetrieveResult["evidencePack"] = [];
    let fallbackReason: string | null = null;
    let status: TurnStageResult<RetrieveResult>["status"] = "ok";
    const canUseProxyDefaults = context.config.proxyBaseUrl.trim().length > 0;
    let broadenedBeyondLorePage = false;
    const targetedLorePageId =
      input.interpret.interpretation.contextAnchor === "current_location" &&
      currentLocationLorePageId
        ? currentLocationLorePageId
        : npcLorePageId;
    const retrievalFilters: OpenAIVectorStoreFilter | undefined =
      !skipRetrieval && targetedLorePageId
        ? {
            type: "eq",
            key: OPENAI_VECTOR_STORE_PAGE_ID_ATTRIBUTE,
            value: targetedLorePageId
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
    const runtimeCurrentLocationEvidence = buildCurrentLocationEvidence(input.execution);
    if (
      runtimeCurrentLocationEvidence &&
      (
        input.interpret.interpretation.contextAnchor === "current_location" ||
        input.interpret.interpretation.facet === "location"
      )
    ) {
      evidencePack = [runtimeCurrentLocationEvidence, ...evidencePack];
    }

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
          npcLorePageId,
          currentLocationLorePageId,
          targetedLorePageId,
          currentLocationDisplayName: runtimeCurrentLocation?.regionDisplayName ?? null,
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
