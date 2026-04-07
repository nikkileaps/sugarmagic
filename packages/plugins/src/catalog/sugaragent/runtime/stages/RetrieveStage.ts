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
  RetrievedEvidenceItem,
  RetrieveResult,
  TurnStage,
  TurnStageResult,
  TurnStageContext
} from "../types";

function mergeEvidencePacks(
  ...packs: RetrievedEvidenceItem[][]
): RetrievedEvidenceItem[] {
  const merged: RetrievedEvidenceItem[] = [];
  const seen = new Set<string>();

  for (const pack of packs) {
    for (const item of pack) {
      const dedupeKey = [
        item.fileId,
        item.filename,
        String(item.attributes.page_id ?? ""),
        item.text
      ].join("::");
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      merged.push(item);
    }
  }

  return merged;
}

function buildCurrentLocationEvidence(
  execution: ConversationExecutionContext
): RetrieveResult["evidencePack"][number] | null {
  const currentLocation = execution.runtimeContext?.here;
  if (!currentLocation?.regionDisplayName && !currentLocation?.area?.displayName) {
    return null;
  }

  const locationSegments: string[] = [];
  if (currentLocation.area?.displayName) {
    locationSegments.push(`The current area is ${currentLocation.area.displayName}.`);
  }
  if (currentLocation.parentArea?.displayName) {
    locationSegments.push(`It is within ${currentLocation.parentArea.displayName}.`);
  }
  const npcPlayerRelation = execution.runtimeContext?.npcPlayerRelation;
  const npcBehavior = execution.runtimeContext?.npcBehavior ?? null;
  const npcMovement = npcBehavior?.movement ?? null;
  const npcCurrentTask = npcBehavior?.task ?? null;
  const npcCurrentActivity = npcBehavior?.activity ?? null;
  const npcCurrentGoal = npcBehavior?.goal ?? null;
  if (npcPlayerRelation) {
    locationSegments.push(
      npcPlayerRelation.sameArea
        ? "The player and NPC are in the same area right now."
        : `The player and NPC are ${npcPlayerRelation.proximityBand} to one another.`
    );
  }
  if (npcCurrentTask?.displayName) {
    locationSegments.push(`The NPC's current task is ${npcCurrentTask.displayName}.`);
  }
  if (npcCurrentTask?.description) {
    locationSegments.push(`Task context: ${npcCurrentTask.description}.`);
  }
  if (npcCurrentActivity?.activity) {
    locationSegments.push(`The NPC's current activity is ${npcCurrentActivity.activity}.`);
  }
  if (npcCurrentGoal?.goal) {
    locationSegments.push(`The NPC's current goal is ${npcCurrentGoal.goal}.`);
  }
  if (npcMovement?.targetAreaDisplayName) {
    locationSegments.push(
      `The NPC movement status is ${npcMovement.status} toward ${npcMovement.targetAreaDisplayName}.`
    );
  }
  if (currentLocation.sceneDisplayName) {
    locationSegments.push(
      `The current scene is ${currentLocation.sceneDisplayName} in ${currentLocation.regionDisplayName}.`
    );
  } else if (currentLocation.regionDisplayName) {
    locationSegments.push(`The current region is ${currentLocation.regionDisplayName}.`);
  }

  return {
    fileId: "runtime:blackboard:current-location",
    filename: "runtime.current-location",
    score: 1,
    text: locationSegments.join(" "),
    attributes: {
      source: "runtime-blackboard",
      region_id: currentLocation.regionId,
      scene_id: currentLocation.sceneId,
      area_id: currentLocation.area?.areaId ?? null,
      parent_area_id: currentLocation.parentArea?.areaId ?? null,
      movement_status: npcMovement?.status ?? null,
      current_task_display_name: npcCurrentTask?.displayName ?? null,
      current_activity: npcCurrentActivity?.activity ?? null,
      current_goal: npcCurrentGoal?.goal ?? null,
      page_id:
        currentLocation.area?.lorePageId ??
        currentLocation.parentArea?.lorePageId ??
        currentLocation.regionLorePageId
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
    if (currentLocation?.area?.displayName) {
      segments.push(`Current area: ${currentLocation.area.displayName}`);
    }
    if (currentLocation?.parentArea?.displayName) {
      segments.push(`Containing area: ${currentLocation.parentArea.displayName}`);
    }
    if (currentLocation?.regionDisplayName) {
      segments.push(`Current location: ${currentLocation.regionDisplayName}`);
    }
    if (currentLocation?.sceneDisplayName) {
      segments.push(`Current scene: ${currentLocation.sceneDisplayName}`);
    }
    if (execution.runtimeContext?.npcPlayerRelation?.proximityBand) {
      segments.push(
        `Player proximity to NPC: ${execution.runtimeContext.npcPlayerRelation.proximityBand}`
      );
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
    const npcPlayerRelation = input.execution.runtimeContext?.npcPlayerRelation ?? null;
    const npcBehavior = input.execution.runtimeContext?.npcBehavior ?? null;
    const npcMovement = npcBehavior?.movement ?? null;
    const npcCurrentTask = npcBehavior?.task ?? null;
    const npcCurrentActivity = npcBehavior?.activity ?? null;
    const npcCurrentGoal = npcBehavior?.goal ?? null;
    const activeQuestDisplayName =
      input.execution.runtimeContext?.trackedQuest?.displayName ??
      input.execution.selection.activeQuest?.displayName ??
      null;
    const npcLorePageId =
      typeof input.execution.selection.lorePageId === "string" &&
      input.execution.selection.lorePageId.trim().length > 0
        ? input.execution.selection.lorePageId.trim()
        : null;
    const rawLocationLorePageId =
      runtimeCurrentLocation?.area?.lorePageId ??
      runtimeCurrentLocation?.parentArea?.lorePageId ??
      runtimeCurrentLocation?.regionLorePageId ??
      null;
    const currentLocationLorePageId =
      typeof rawLocationLorePageId === "string" && rawLocationLorePageId.trim().length > 0
        ? rawLocationLorePageId.trim()
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
    let pinnedNpcLoreEvidence = false;
    const targetedLorePageId =
      input.interpret.interpretation.contextAnchor === "current_location" &&
      currentLocationLorePageId
        ? currentLocationLorePageId
        : npcLorePageId;
    const shouldPinNpcLore =
      !skipRetrieval &&
      npcLorePageId !== null &&
      npcLorePageId !== targetedLorePageId;
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
        const reservedNpcLoreResults = shouldPinNpcLore ? 1 : 0;
        const primaryMaxResults = Math.max(
          1,
          context.config.maxEvidenceResults - reservedNpcLoreResults
        );

        const searchLore = (filters?: OpenAIVectorStoreFilter) =>
          this.vectorStoreProvider!.searchLore({
            vectorStoreId: context.config.openAiVectorStoreId,
            query: searchQuery,
            maxResults: filters ? primaryMaxResults : context.config.maxEvidenceResults,
            filters
          });

        evidencePack = await searchLore(retrievalFilters);
        if (evidencePack.length === 0 && retrievalFilters) {
          evidencePack = await searchLore();
          broadenedBeyondLorePage = true;
        }

        if (shouldPinNpcLore && npcLorePageId) {
          const npcLoreEvidence = await this.vectorStoreProvider.searchLore({
            vectorStoreId: context.config.openAiVectorStoreId,
            query: searchQuery,
            maxResults: 1,
            filters: {
              type: "eq",
              key: OPENAI_VECTOR_STORE_PAGE_ID_ATTRIBUTE,
              value: npcLorePageId
            }
          });
          pinnedNpcLoreEvidence = npcLoreEvidence.length > 0;
          evidencePack = mergeEvidencePacks(evidencePack, npcLoreEvidence).slice(
            0,
            context.config.maxEvidenceResults
          );
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
          currentAreaDisplayName: runtimeCurrentLocation?.area?.displayName ?? null,
          currentParentAreaDisplayName:
            runtimeCurrentLocation?.parentArea?.displayName ?? null,
          proximityBand: npcPlayerRelation?.proximityBand ?? null,
          movementStatus: npcMovement?.status ?? null,
          currentTaskDisplayName: npcCurrentTask?.displayName ?? null,
          currentTaskDescription: npcCurrentTask?.description ?? null,
          currentActivity: npcCurrentActivity?.activity ?? null,
          currentGoal: npcCurrentGoal?.goal ?? null,
          sameArea: npcPlayerRelation?.sameArea ?? null,
          sameParentArea: npcPlayerRelation?.sameParentArea ?? null,
          currentLocationLorePageId,
          targetedLorePageId,
          currentLocationDisplayName:
            runtimeCurrentLocation?.area?.displayName ??
            runtimeCurrentLocation?.regionDisplayName ??
            null,
          retrievalFilters,
          broadenedBeyondLorePage,
          pinnedNpcLoreEvidence,
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
