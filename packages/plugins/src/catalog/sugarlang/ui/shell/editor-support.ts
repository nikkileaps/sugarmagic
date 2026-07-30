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
  Scene,
  QuestDefinition,
  QuestNodeDefinition,
  RegionDocument
} from "@sugarmagic/domain";
import { compareCefrBands } from "../../runtime/classifier/cefr-band-utils";
import { MorphologyLoader } from "../../runtime/classifier/morphology-loader";
import { IndexedDBChunkCache } from "../../runtime/compile/chunk-cache";
import { IndexedDBCompileCache } from "../../runtime/compile/cache-indexeddb";
import { MultiWordExpressionExtractor } from "../../runtime/compile/multi-word-expression-extractor";
import { SUGARLANG_COMPILE_PIPELINE_VERSION } from "../../runtime/compile/content-hash";
import { SugarlangGatewayClient } from "../../runtime/llm/gateway-client";
import { SugarlangAuthoringCompileScheduler } from "../../runtime/compile/compile-scheduler";
import { IndexedDBVariantCache } from "../../runtime/compile/variant-cache";
import { IndexedDBIntentCache } from "../../runtime/compile/intent-cache";
import {
  LINE_INTENT_PROMPT_VERSION,
  LineIntentExtractor
} from "../../runtime/compile/line-intent-extractor";
import {
  SCENE_CONTEXT_PROMPT_VERSION,
  SceneContextExtractor
} from "../../runtime/compile/scene-context-extractor";
import { IndexedDBSceneContextCache } from "../../runtime/compile/scene-context-cache";
import { generateVariant, VARIANT_PROMPT_VERSION } from "../../runtime/compile/generate-variant";
import { GradedTextService } from "../../runtime/grading/graded-text-service";
import { buildItemViewContentHash } from "../../runtime/grading/sources/item-view-source";
import { getAllInventoryChunks } from "../../runtime/inventory/competency-inventory-loader";
import type { BakedLineVariant } from "../../runtime/contracts/baked-variant";
import { compileSugarlangScene } from "../../runtime/compile/compile-sugarlang-scene";
import { computeSceneContentHash } from "../../runtime/compile/content-hash";
import {
  collectSceneText,
  projectSceneContextSources,
  type SceneAuthoringContext
} from "../../runtime/compile/scene-traversal";
import {
  resolveSceneAuthoringContexts,
  resolveSugarlangGatewayBaseUrl,
  SugarlangGatewayLoreClient
} from "../../runtime/compile/lore-resolution";
import { getQuestionnaire } from "../../runtime/placement/placement-questionnaire-loader";
import { SUGARLANG_PLACEMENT_COMPLETED_EVENT } from "../../runtime/quest-integration/placement-completion";
import { CefrLexAtlasProvider } from "../../runtime/providers/impls/cefr-lex-atlas-provider";
import type {
  CEFRBand,
  CompiledSceneLexicon,
  PlacementQuestionnaire
} from "../../runtime/types";

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

export function isAssessmentObjectiveNode(node: QuestNodeDefinition | null | undefined): boolean {
  return node?.objectiveSubtype === "assessment";
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
  node: QuestNodeDefinition | null | undefined
): boolean {
  return isAssessmentObjectiveNode(node);
}

export function resolveStudioCompileWorkspaceId(gameProjectId: string | null): string {
  return `sugarlang-studio:${gameProjectId ?? "unknown-project"}`;
}

export function createSugarlangSceneContexts(
  gameProject: GameProject | null,
  regions: RegionDocument[],
  targetLanguage: string,
  activeScene: Scene | null
): Promise<SceneAuthoringContext[]> {
  if (!gameProject) {
    return Promise.resolve([]);
  }

  const proxyBaseUrl = resolveSugarlangGatewayBaseUrl();
  const loreClient = proxyBaseUrl
    ? new SugarlangGatewayLoreClient(proxyBaseUrl)
    : null;

  // activeScene is load-bearing: composed npcPresences are OVERLAY-ONLY
  // (composeRegionContents), so a null scene compiles a lexicon with zero
  // NPC bios, NPC lore pages, or NPC-bound dialogues.
  return resolveSceneAuthoringContexts(
    [...regions].map((region) => ({
        region,
        activeScene,
        targetLanguage,
        npcDefinitions: gameProject.npcDefinitions,
        dialogueDefinitions: gameProject.dialogueDefinitions,
        questDefinitions: gameProject.questDefinitions,
        itemDefinitions: gameProject.itemDefinitions,
        documentDefinitions: gameProject.documentDefinitions
      })),
    loreClient
  );
}

export async function compileAuthoringSceneLexicon(
  gameProject: GameProject | null,
  activeRegion: RegionDocument | null,
  regions: RegionDocument[],
  targetLanguage: string,
  activeScene: Scene | null
) : Promise<CompiledSceneLexicon | null> {
  if (!gameProject || !activeRegion) {
    return null;
  }

  const context = (await createSugarlangSceneContexts(
    gameProject,
    regions,
    targetLanguage,
    activeScene
  )).find(
    (scene) => scene.sceneId === activeRegion.identity.id
  );
  if (!context) {
    return null;
  }

  return compileSugarlangScene(context, atlas, morphology, "authoring-preview");
}

export function summarizeSceneDensity(
  lexicon: CompiledSceneLexicon | null,
  // 090.2c: bands are atlas facts now, not stored on the scene artifact, so the
  // caller supplies the lookup. Undefined means "atlas unavailable" and every
  // band reads zero rather than silently mis-binning lemmas into one band.
  getBand?: (lemmaId: string) => CEFRBand | undefined
): SceneDensitySummary {
  const totalLemmas = lexicon ? Object.keys(lexicon.lemmas).length : 0;

  return {
    totalLemmas,
    bandCounts: SCENE_BANDS.map((band) => {
      const count =
        lexicon && getBand
          ? Object.values(lexicon.lemmas).filter(
              (lemma) => getBand(lemma.lemmaId) === band
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
  activeScene: Scene | null,
  workspaceId: string
): Promise<SugarlangCompileStatusSummary> {
  const scenes = await createSugarlangSceneContexts(
    gameProject,
    regions,
    targetLanguage,
    activeScene
  );
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
  activeScene: Scene | null,
  workspaceId: string,
  onProgress?: (progress: SugarlangRebuildProgress) => void,
  options?: { chunkExtractionEnabled?: boolean }
): Promise<SugarlangCompileStatusSummary> {
  const scenes = await createSugarlangSceneContexts(
    gameProject,
    regions,
    targetLanguage,
    activeScene
  );
  const cache = new IndexedDBCompileCache({ workspaceId });
  let completedScenes = 0;

  onProgress?.({
    completedScenes,
    totalScenes: scenes.length,
    currentSceneId: null
  });

  await cache.invalidate();

  const chunkExtractionEnabled = options?.chunkExtractionEnabled ?? true;
  const proxyBaseUrl = resolveSugarlangGatewayBaseUrl();
  const gatewayAvailable = proxyBaseUrl.trim().length > 0;
  const gatewayClient = gatewayAvailable
    ? new SugarlangGatewayClient(proxyBaseUrl)
    : null;

  // Say so loudly when a pass cannot run. Without a gateway the scene-context
  // pass is simply absent, which is indistinguishable from "ran and found
  // nothing" -- the HUD shows "(not built)" either way.
  if (!gatewayClient) {
    console.warn(
      "[sugarlang build] scene-context and chunk passes SKIPPED: no gateway base URL resolved. " +
        "Scene context can never be built until the sugarlang gateway URL is set."
    );
  }

  const dialogueDefinitions = gameProject?.dialogueDefinitions ?? [];
  const scheduler = new SugarlangAuthoringCompileScheduler({
    getScenes: () => scenes,
    getDialogues: () => dialogueDefinitions,
    atlas,
    morphology,
    cache,
    debounceMs: 0,
    chunkPipeline:
      chunkExtractionEnabled && gatewayClient
        ? {
            cache: new IndexedDBChunkCache({ workspaceId }),
            extractSceneChunks: async (scene, contentHash) => {
              const blobs = collectSceneText(scene);
              return new MultiWordExpressionExtractor({
                atlas,
                llmClient: gatewayClient
              }).extract({
                sceneText: blobs,
                lang: scene.targetLanguage,
                promptVersion: SUGARLANG_COMPILE_PIPELINE_VERSION,
                sceneId: scene.sceneId,
                contentHash
              });
            },
            promptVersion: SUGARLANG_COMPILE_PIPELINE_VERSION
          }
        : undefined,
    intentPipeline: gatewayClient
      ? {
          cache: new IndexedDBIntentCache({ workspaceId }),
          extractNodeIntent: async (dialogueDefinitionId, node, contentHash) => {
            return new LineIntentExtractor({
              llmClient: gatewayClient
            }).extract({
              nodeId: node.nodeId,
              nodeText: node.text,
              authoredIntent: node.intent,
              contentHash,
              dialogueDefinitionId,
              promptVersion: LINE_INTENT_PROMPT_VERSION
            });
          },
          promptVersion: LINE_INTENT_PROMPT_VERSION
        }
      : undefined,
    // STUDIO ONLY, deliberately. The runtime's lazy path (`ensureScene`) runs in
    // the deployed game, and this is a gateway call -- a player's machine must
    // not do authoring work. The runtime receives models by seeding.
    sceneContextPass: gatewayClient
      ? {
          cache: new IndexedDBSceneContextCache({ workspaceId }),
          extractSceneContext: async (scene, contentHash) => {
            return new SceneContextExtractor({
              llmClient: gatewayClient
            }).extract({
              sources: projectSceneContextSources(scene),
              // Support language, NOT target: concepts are English, so one
              // extraction serves every target language.
              supportLanguage: scene.supportLanguage,
              sceneId: scene.sceneId,
              contentHash
            });
          },
          promptVersion: SCENE_CONTEXT_PROMPT_VERSION,
          supportLanguage: scenes[0]?.supportLanguage ?? "en"
        }
      : undefined,
    onLog(message, detail) {
      // Every pass logs through here, and only "compiled-scene" drives the
      // progress bar. The rest used to be dropped on the floor, which meant a
      // pass that silently did nothing looked identical to one that worked --
      // exactly the state that cost an hour on 2026-07-29. Console is the
      // cheapest honest surface until the Build panel grows a real readout.
      if (message !== "compiled-scene") {
        console.info(`[sugarlang build] ${message}`, detail ?? {});
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
  await scheduler.flushChunks();
  await scheduler.flushIntents();
  await scheduler.flushSceneContext();
  scheduler.stop();

  return readSugarlangCompileStatus(
    gameProject,
    regions,
    targetLanguage,
    activeScene,
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

// --- Variant authoring client (086.3) ---

const DISPLAY_BANDS: CEFRBand[] = ["B1", "B2", "C1", "C2"];

function buildVariantContentHash(nodeId: string, nodeText: string): string {
  return [nodeId, nodeText, JSON.stringify({})].join("|");
}

export interface VariantAuthoringClient {
  /** Returns null when the gateway URL is not configured. */
  gatewayAvailable: boolean;
  getVariantsForNode(
    nodeId: string,
    nodeText: string,
    targetLanguage: string,
    workspaceId: string
  ): Promise<Partial<Record<CEFRBand, BakedLineVariant>>>;
  /**
   * Grade one item interaction-view field at every display band.
   *
   * Goes straight to GradedTextService rather than through `generateVariant`:
   * that wrapper exists to stamp DIALOGUE identity, which an item does not
   * have. Both paths share the grading and the cache -- only the source and the
   * content-hash seed differ.
   */
  generateVariantsForItemView(
    itemDefinitionId: string,
    field: "title" | "body",
    text: string,
    targetLanguage: string,
    workspaceId: string
  ): Promise<Partial<Record<CEFRBand, BakedLineVariant>>>;
  getVariantsForItemView(
    itemDefinitionId: string,
    field: "title" | "body",
    text: string,
    targetLanguage: string,
    workspaceId: string
  ): Promise<Partial<Record<CEFRBand, BakedLineVariant>>>;
  generateVariantsForNode(
    nodeId: string,
    nodeText: string,
    dialogueDefinitionId: string,
    targetLanguage: string,
    workspaceId: string
  ): Promise<Partial<Record<CEFRBand, BakedLineVariant>>>;
  saveVariant(
    nodeId: string,
    nodeText: string,
    band: CEFRBand,
    text: string,
    dialogueDefinitionId: string,
    targetLanguage: string,
    workspaceId: string
  ): Promise<void>;
}

export function createVariantAuthoringClient(): VariantAuthoringClient {
  // Read directly from Vite's import.meta.env -- resolveSugarlangGatewayBaseUrl()
  // reads globalThis which is never populated in the browser Vite context.
  const metaEnv = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  const proxyBaseUrl = (
    metaEnv["VITE_SUGARMAGIC_SUGARLANG_PROXY_BASE_URL"] ||
    metaEnv["VITE_SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL"] ||
    ""
  ).trim();
  const gatewayAvailable = proxyBaseUrl.length > 0;
  const llmClient = gatewayAvailable ? new SugarlangGatewayClient(proxyBaseUrl) : null;

  function getCache(workspaceId: string): IndexedDBVariantCache {
    return new IndexedDBVariantCache({ workspaceId });
  }

  return {
    gatewayAvailable,
    async getVariantsForNode(nodeId, nodeText, targetLanguage, workspaceId) {
      const cache = getCache(workspaceId);
      const contentHash = buildVariantContentHash(nodeId, nodeText);
      const result: Partial<Record<CEFRBand, BakedLineVariant>> = {};
      for (const band of DISPLAY_BANDS) {
        try {
          const entry = await cache.get({ lang: targetLanguage, band, contentHash, variantPromptVersion: VARIANT_PROMPT_VERSION });
          if (entry) result[band] = entry.variant;
        } catch {
          // IDB failure -- skip this band
        }
      }
      return result;
    },
    async generateVariantsForNode(nodeId, nodeText, dialogueDefinitionId, targetLanguage, workspaceId) {
      if (!llmClient) return {};
      const cache = getCache(workspaceId);
      const contentHash = buildVariantContentHash(nodeId, nodeText);
      let inventoryChunks: import("../../runtime/contracts/competency-inventory").InventoryChunk[] = [];
      try {
        inventoryChunks = getAllInventoryChunks(targetLanguage);
      } catch {
        // No inventory for this language -- generation proceeds without chunk context
      }
      const result: Partial<Record<CEFRBand, BakedLineVariant>> = {};
      await Promise.all(
        DISPLAY_BANDS.map(async (band) => {
          try {
            const generated = await generateVariant(
              { authoredText: nodeText, targetLang: targetLanguage, band, intent: null, contentHash, dialogueDefinitionId, nodeId },
              { llmClient, atlas, inventoryChunks }
            );
            if (generated.variant) {
              await cache.set({ key: { lang: targetLanguage, band, contentHash, variantPromptVersion: VARIANT_PROMPT_VERSION }, variant: generated.variant });
              result[band] = generated.variant;
            }
          } catch {
            // Individual band failure is non-fatal
          }
        })
      );
      return result;
    },
    async getVariantsForItemView(itemDefinitionId, field, text, targetLanguage, workspaceId) {
      const cache = getCache(workspaceId);
      const contentHash = buildItemViewContentHash(itemDefinitionId, field, text);
      const result: Partial<Record<CEFRBand, BakedLineVariant>> = {};
      await Promise.all(
        DISPLAY_BANDS.map(async (band) => {
          const entry = await cache.get({
            lang: targetLanguage,
            band,
            contentHash,
            variantPromptVersion: VARIANT_PROMPT_VERSION
          });
          if (entry) result[band] = entry.variant;
        })
      );
      return result;
    },
    async generateVariantsForItemView(itemDefinitionId, field, text, targetLanguage, workspaceId) {
      if (!llmClient) return {};
      const cache = getCache(workspaceId);
      const contentHash = buildItemViewContentHash(itemDefinitionId, field, text);
      let inventoryChunks: import("../../runtime/contracts/competency-inventory").InventoryChunk[] = [];
      try {
        inventoryChunks = getAllInventoryChunks(targetLanguage);
      } catch {
        // No inventory for this language -- generation proceeds without chunk context
      }
      const service = new GradedTextService({ llmClient, atlas, inventoryChunks });
      const result: Partial<Record<CEFRBand, BakedLineVariant>> = {};
      await Promise.all(
        DISPLAY_BANDS.map(async (band) => {
          try {
            const graded = await service.adapt({
              sourceText: text,
              targetLang: targetLanguage,
              band,
              guidance: { register: field === "title" ? "item name" : "item description" }
            });
            if (graded.text === null || graded.verdict === null) return;
            const variant: BakedLineVariant = {
              source: { kind: "item-view", itemDefinitionId, field },
              lang: targetLanguage,
              band,
              text: graded.text,
              verdict: graded.verdict,
              reviewFlag: !graded.verdict.overallPasses,
              generatedAtMs: Date.now(),
              generatedByModel: graded.generatedByModel,
              contentHash,
              promptVersion: graded.promptVersion
            };
            await cache.set({
              key: { lang: targetLanguage, band, contentHash, variantPromptVersion: VARIANT_PROMPT_VERSION },
              variant
            });
            result[band] = variant;
          } catch {
            // Individual band failure is non-fatal
          }
        })
      );
      return result;
    },
    async saveVariant(nodeId, nodeText, band, text, dialogueDefinitionId, targetLanguage, workspaceId) {
      const cache = getCache(workspaceId);
      const contentHash = buildVariantContentHash(nodeId, nodeText);
      const now = Date.now();
      const variant: BakedLineVariant = {
        source: { kind: "dialogue-node", dialogueDefinitionId, nodeId },
        lang: targetLanguage, band, text,
        verdict: { envelopePasses: true, ratioPasses: true, voiceRetentionScore: 1, fidelityPasses: true, overallPasses: true },
        reviewFlag: false,
        generatedAtMs: now, generatedByModel: "manual", contentHash, promptVersion: VARIANT_PROMPT_VERSION
      };
      await cache.set({ key: { lang: targetLanguage, band, contentHash, variantPromptVersion: VARIANT_PROMPT_VERSION }, variant });
    }
  };
}
