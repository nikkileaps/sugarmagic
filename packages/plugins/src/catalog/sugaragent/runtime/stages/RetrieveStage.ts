import type { ConversationExecutionContext } from "@sugarmagic/runtime-core";
import {
  OPENAI_VECTOR_STORE_PAGE_ID_ATTRIBUTE,
  type OpenAIVectorStoreFilter,
  type VectorStoreProvider
} from "../clients";
import { createDiagnostics } from "./diagnostics";
import { normalizeRetrievedEvidenceText, summarizeEvidence } from "./helpers";
import {
  type RetrievalScoreEntry,
  recordRetrievalSnapshot
} from "./retrieval-debug";
import type {
  InterpretResult,
  RetrievedEvidenceItem,
  RetrieveResult,
  TurnStage,
  TurnStageResult,
  TurnStageContext
} from "../types";

function mergeLoreContexts(
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
): RetrieveResult["loreContext"][number] | null {
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
  /**
   * Plan 072.6 (D1) — true when the NPC's persona card loaded (072.3). The
   * card already carries the NPC's own page, so evidence retrieval EXCLUDES
   * the own page and surfaces OTHER world lore. When false (degraded), the
   * legacy own-page-preferred targeting is kept.
   */
  personaLoaded: boolean;
}

// DEFERRED SEAM (071.3): if client-side re-ranking or local embeddings are added
// (e.g. a Plan 019 re-rank stage), restore an EmbeddingsProvider here and wire
// the fingerprint into the retrieval decision. For now, the gateway embeds
// server-side from the raw text query; no browser-side embed call is needed.
export class RetrieveStage implements TurnStage<RetrieveStageInput, RetrieveResult> {
  readonly stageId = "Retrieve";

  constructor(
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

    let loreSearchPerformed = false;
    let loreContext: RetrieveResult["loreContext"] = [];
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
    // Plan 072.6 (D1) — when the persona card loaded, the NPC's own page is
    // already in the system prompt, so exclude it from evidence and pull OTHER
    // world lore. Applies only when the primary target IS the own page
    // (non-location-anchored); location-anchored retrieval is unchanged.
    const excludeOwnPage =
      input.personaLoaded &&
      !skipRetrieval &&
      npcLorePageId !== null &&
      targetedLorePageId === npcLorePageId;
    let ownPageExcluded = false;
    const retrievalFilters: OpenAIVectorStoreFilter | undefined =
      !skipRetrieval && !excludeOwnPage && targetedLorePageId
        ? {
            type: "eq",
            key: OPENAI_VECTOR_STORE_PAGE_ID_ATTRIBUTE,
            value: targetedLorePageId
          }
        : undefined;

    if (!skipRetrieval && this.vectorStoreProvider && canUseProxyDefaults) {
      try {
        if (excludeOwnPage && npcLorePageId) {
          // Broad search, then drop own-page results client-side. The
          // server-side `ne` filter is NOT used: it is unverified against the
          // live OpenAI vector-store /search schema (072.6 probe-first). Request
          // headroom so dropping the own page still leaves up to
          // maxLoreResults items of OTHER lore.
          const requested = Math.min(8, context.config.maxLoreResults + 3);
          const broad = await this.vectorStoreProvider.searchLore({
            vectorStoreId: "",
            query: searchQuery,
            maxResults: requested,
            filters: undefined
          });
          loreContext = broad
            .filter(
              (item) =>
                item.attributes[OPENAI_VECTOR_STORE_PAGE_ID_ATTRIBUTE] !==
                npcLorePageId
            )
            .slice(0, context.config.maxLoreResults);
          ownPageExcluded = true;
          loreSearchPerformed = true;
        } else {
          const reservedNpcLoreResults = shouldPinNpcLore ? 1 : 0;
          const primaryMaxResults = Math.max(
            1,
            context.config.maxLoreResults - reservedNpcLoreResults
          );

          const searchLore = (filters?: OpenAIVectorStoreFilter) =>
            this.vectorStoreProvider!.searchLore({
              // Empty vectorStoreId → gateway defaults it server-side.
              vectorStoreId: "",
              query: searchQuery,
              maxResults: filters ? primaryMaxResults : context.config.maxLoreResults,
              filters
            });

          loreContext = await searchLore(retrievalFilters);
          if (loreContext.length === 0 && retrievalFilters) {
            loreContext = await searchLore();
            broadenedBeyondLorePage = true;
          }

          if (shouldPinNpcLore && npcLorePageId) {
            const npcLoreEvidence = await this.vectorStoreProvider.searchLore({
              vectorStoreId: "",
              query: searchQuery,
              maxResults: 1,
              filters: {
                type: "eq",
                key: OPENAI_VECTOR_STORE_PAGE_ID_ATTRIBUTE,
                value: npcLorePageId
              }
            });
            pinnedNpcLoreEvidence = npcLoreEvidence.length > 0;
            loreContext = mergeLoreContexts(loreContext, npcLoreEvidence).slice(
              0,
              context.config.maxLoreResults
            );
          }
          loreSearchPerformed = true;
        }
      } catch {
        status = "degraded";
        fallbackReason = fallbackReason ?? "vector-search-unavailable";
        loreContext = [];
      }
    }

    loreContext = loreContext.map((item) => ({
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
      loreContext = [runtimeCurrentLocationEvidence, ...loreContext];
    }

    // Plan 078.1 -- tag each chunk by how it entered loreContext so scores
    // are distinguishable in diagnostics and the __sugaragentRetrieval handle.
    const loreScores: RetrievalScoreEntry[] = loreContext.map((item) => {
      let source: RetrievalScoreEntry["source"];
      if (item.fileId === "runtime:blackboard:current-location") {
        source = "synthetic-location";
      } else if (
        shouldPinNpcLore &&
        item.attributes[OPENAI_VECTOR_STORE_PAGE_ID_ATTRIBUTE] === npcLorePageId
      ) {
        source = "pinned";
      } else {
        source = "retrieved";
      }
      return {
        score: item.score,
        source,
        pageId:
          (item.attributes[OPENAI_VECTOR_STORE_PAGE_ID_ATTRIBUTE] as string | null) ??
          null,
        fileId: item.fileId
      };
    });

    recordRetrievalSnapshot({
      npcDefinitionId: context.selection.npcDefinitionId ?? "unknown",
      loreScores,
      loreSearchPerformed,
      broadenedBeyondLorePage,
      ownPageExcluded
    });

    const output: RetrieveResult = {
      loreContext,
      loreSearchPerformed
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
          loreContextSummary: summarizeEvidence(loreContext, {
            maxItems: context.config.maxLoreResults,
            perItemChars: context.config.maxLoreCharsPerItem
          }),
          loreContextCount: loreContext.length,
          loreScores,
          // Plan 072.6 — retrieval rebalance observability.
          personaLoaded: input.personaLoaded,
          ownPageExcluded,
          loreCharsPerItem: context.config.maxLoreCharsPerItem,
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
          loreSearchPerformed
        },
        fallbackReason
      ),
      status
    };
  }
}
