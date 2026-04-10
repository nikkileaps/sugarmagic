/**
 * packages/plugins/src/catalog/sugarlang/ui/shell/editor-support.ts
 *
 * Purpose: Provides shared editor-side helpers for Sugarlang Studio contributions.
 *
 * Exports:
 *   - Studio compile/cache helper types and functions
 *   - NPC role and quest placement helper functions
 *   - Placement question-bank and scene-density helper functions
 *
 * Relationships:
 *   - Depends on the canonical Sugarlang runtime compiler, cache, and placement loaders.
 *   - Is consumed by the Epic 12 shell contribution components.
 *
 * Implements: Epic 12 editor UX contributions on top of Epic 4, Epic 6, and Epic 11 runtime seams
 *
 * Status: active
 */

import type {
  GameProject,
  NPCDefinition,
  QuestDefinition,
  QuestNodeDefinition,
  RegionDocument
} from "@sugarmagic/domain";
import { compareCefrBands } from "../../runtime/classifier/cefr-band-utils";
import { MorphologyLoader } from "../../runtime/classifier/morphology-loader";
import { IndexedDBChunkCache } from "../../runtime/compile/chunk-cache";
import { IndexedDBCompileCache } from "../../runtime/compile/cache-indexeddb";
import { SugarlangAuthoringCompileScheduler } from "../../runtime/compile/compile-scheduler";
import { compileSugarlangScene } from "../../runtime/compile/compile-sugarlang-scene";
import { computeSceneContentHash } from "../../runtime/compile/content-hash";
import {
  collectSceneText,
  createSceneAuthoringContext,
  type SceneAuthoringContext
} from "../../runtime/compile/scene-traversal";
import { getQuestionnaire } from "../../runtime/placement/placement-questionnaire-loader";
import { SUGARLANG_PLACEMENT_COMPLETED_EVENT } from "../../runtime/quest-integration/placement-completion";
import { CefrLexAtlasProvider } from "../../runtime/providers/impls/cefr-lex-atlas-provider";
import type {
  CEFRBand,
  CompiledSceneLexicon,
  PlacementQuestionnaire
} from "../../runtime/types";

export type SugarlangNpcRole = "" | "placement";

export interface SceneBandCount {
  band: CEFRBand;
  count: number;
  percent: number;
}

export interface SceneDensitySummary {
  totalLemmas: number;
  bandCounts: SceneBandCount[];
}

export interface SugarlangCompileStatusSummary {
  totalScenes: number;
  cachedScenes: number;
  staleScenes: number;
  missingScenes: number;
  chunkCachedScenes: number;
}

export interface SugarlangRebuildProgress {
  completedScenes: number;
  totalScenes: number;
  currentSceneId: string | null;
}

const atlas = new CefrLexAtlasProvider();
const morphology = new MorphologyLoader();
const SCENE_BANDS: CEFRBand[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

function normalizedSugarlangMetadata(
  npc: NPCDefinition
): Record<string, unknown> {
  return typeof npc.metadata === "object" && npc.metadata !== null
    ? { ...npc.metadata }
    : {};
}

export function getSugarlangNpcRole(npc: NPCDefinition | null | undefined): SugarlangNpcRole {
  const value = npc?.metadata?.sugarlangRole;
  return value === "placement" ? "placement" : "";
}

export function setSugarlangNpcRole(
  npc: NPCDefinition,
  role: SugarlangNpcRole
): NPCDefinition {
  const metadata = normalizedSugarlangMetadata(npc);
  if (!role) {
    delete metadata.sugarlangRole;
    const { metadata: _previousMetadata, ...rest } = npc;
    return {
      ...rest,
      ...(Object.keys(metadata).length > 0 ? { metadata } : {})
    };
  }

  return {
    ...npc,
    metadata: {
      ...metadata,
      sugarlangRole: role
    }
  };
}

export function isPlacementNpc(npc: NPCDefinition | null | undefined): boolean {
  return getSugarlangNpcRole(npc) === "placement";
}

export function applyPlacementEventSuggestion(
  quest: QuestDefinition,
  nodeId: string
): QuestDefinition {
  return {
    ...quest,
    stageDefinitions: quest.stageDefinitions.map((stage) => ({
      ...stage,
      nodeDefinitions: stage.nodeDefinitions.map((node) =>
        node.nodeId === nodeId
          ? {
              ...node,
              eventName: SUGARLANG_PLACEMENT_COMPLETED_EVENT
            }
          : node
      )
    }))
  };
}

export function shouldSuggestPlacementEvent(
  node: QuestNodeDefinition | null | undefined,
  npcDefinitions: NPCDefinition[]
): boolean {
  if (!node || node.targetId == null) {
    return false;
  }

  const npc = npcDefinitions.find((entry) => entry.definitionId === node.targetId) ?? null;
  return isPlacementNpc(npc);
}

export function resolveStudioCompileWorkspaceId(gameProjectId: string | null): string {
  return `sugarlang-studio:${gameProjectId ?? "unknown-project"}`;
}

export function createSugarlangSceneContexts(
  gameProject: GameProject | null,
  regions: RegionDocument[],
  targetLanguage: string
): SceneAuthoringContext[] {
  if (!gameProject) {
    return [];
  }

  return [...regions]
    .map((region) =>
      createSceneAuthoringContext({
        region,
        targetLanguage,
        npcDefinitions: gameProject.npcDefinitions,
        dialogueDefinitions: gameProject.dialogueDefinitions,
        questDefinitions: gameProject.questDefinitions,
        itemDefinitions: gameProject.itemDefinitions,
        documentDefinitions: gameProject.documentDefinitions
      })
    )
    .sort((left, right) => left.sceneId.localeCompare(right.sceneId));
}

export function compileAuthoringSceneLexicon(
  gameProject: GameProject | null,
  activeRegion: RegionDocument | null,
  regions: RegionDocument[],
  targetLanguage: string
): CompiledSceneLexicon | null {
  if (!gameProject || !activeRegion) {
    return null;
  }

  const context = createSugarlangSceneContexts(gameProject, regions, targetLanguage).find(
    (scene) => scene.sceneId === activeRegion.identity.id
  );
  if (!context) {
    return null;
  }

  return compileSugarlangScene(context, atlas, morphology, "authoring-preview");
}

export function summarizeSceneDensity(
  lexicon: CompiledSceneLexicon | null
): SceneDensitySummary {
  const totalLemmas = lexicon ? Object.keys(lexicon.lemmas).length : 0;

  return {
    totalLemmas,
    bandCounts: SCENE_BANDS.map((band) => {
      const count = lexicon
        ? Object.values(lexicon.lemmas).filter(
            (lemma) => lemma.cefrPriorBand === band
          ).length
        : 0;

      return {
        band,
        count,
        percent: totalLemmas > 0 ? count / totalLemmas : 0
      };
    }).sort((left, right) => compareCefrBands(left.band, right.band))
  };
}

async function collectAuthoringCacheEntries(
  workspaceId: string
): Promise<
  Array<{
    sceneId: string;
    contentHash: string;
  }>
> {
  const cache = new IndexedDBCompileCache({ workspaceId });
  const entries = await cache.listEntries();

  return entries
    .filter((entry) => entry.profile === "authoring-preview")
    .map((entry) => ({
      sceneId: entry.sceneId,
      contentHash: entry.contentHash
    }));
}

async function collectChunkCacheEntries(
  workspaceId: string
): Promise<
  Array<{
    contentHash: string;
  }>
> {
  const cache = new IndexedDBChunkCache({ workspaceId });
  const entries = await cache.listEntries();

  return entries.map((entry) => ({
    contentHash: entry.contentHash
  }));
}

function computeCurrentSceneHashes(
  scenes: SceneAuthoringContext[]
): Map<string, string> {
  return new Map(
    scenes.map((scene) => [
      scene.sceneId,
      computeSceneContentHash(
        collectSceneText(scene),
        atlas.getAtlasVersion(scene.targetLanguage)
      )
    ])
  );
}

export async function readSugarlangCompileStatus(
  gameProject: GameProject | null,
  regions: RegionDocument[],
  targetLanguage: string,
  workspaceId: string
): Promise<SugarlangCompileStatusSummary> {
  const scenes = createSugarlangSceneContexts(gameProject, regions, targetLanguage);
  const currentHashes = computeCurrentSceneHashes(scenes);
  const entries = await collectAuthoringCacheEntries(workspaceId);
  const chunkEntries = await collectChunkCacheEntries(workspaceId);
  const chunkHashes = new Set(chunkEntries.map((entry) => entry.contentHash));

  let cachedScenes = 0;
  let staleScenes = 0;
  let missingScenes = 0;
  let chunkCachedScenes = 0;

  for (const scene of scenes) {
    const currentHash = currentHashes.get(scene.sceneId);
    const sceneEntries = entries.filter((entry) => entry.sceneId === scene.sceneId);
    if (!currentHash || sceneEntries.length === 0) {
      missingScenes += 1;
      continue;
    }
    if (sceneEntries.some((entry) => entry.contentHash === currentHash)) {
      cachedScenes += 1;
      if (currentHash && chunkHashes.has(currentHash)) {
        chunkCachedScenes += 1;
      }
      continue;
    }
    staleScenes += 1;
  }

  return {
    totalScenes: scenes.length,
    cachedScenes,
    staleScenes,
    missingScenes,
    chunkCachedScenes
  };
}

export async function rebuildSugarlangCompileCache(
  gameProject: GameProject | null,
  regions: RegionDocument[],
  targetLanguage: string,
  workspaceId: string,
  onProgress?: (progress: SugarlangRebuildProgress) => void
): Promise<SugarlangCompileStatusSummary> {
  const scenes = createSugarlangSceneContexts(gameProject, regions, targetLanguage);
  const cache = new IndexedDBCompileCache({ workspaceId });
  let completedScenes = 0;

  onProgress?.({
    completedScenes,
    totalScenes: scenes.length,
    currentSceneId: null
  });

  await cache.invalidate();

  const scheduler = new SugarlangAuthoringCompileScheduler({
    getScenes: () => scenes,
    atlas,
    morphology,
    cache,
    debounceMs: 0,
    onLog(message, detail) {
      if (message !== "compiled-scene") {
        return;
      }

      completedScenes += 1;
      onProgress?.({
        completedScenes,
        totalScenes: scenes.length,
        currentSceneId:
          typeof detail?.sceneId === "string" ? detail.sceneId : null
      });
    }
  });

  scheduler.rebuildAll();
  await scheduler.flush();
  scheduler.stop();

  return readSugarlangCompileStatus(
    gameProject,
    regions,
    targetLanguage,
    workspaceId
  );
}

export function loadPlacementQuestionBank(
  targetLanguage: string
): PlacementQuestionnaire | null {
  try {
    return getQuestionnaire(targetLanguage);
  } catch {
    return null;
  }
}
