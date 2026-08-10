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
import type { SceneContextModel } from "../../runtime/contracts/scene-context";
import { compareCefrBands } from "../../runtime/cefr";
import { CEFR_BAND_ORDER as SCENE_BANDS } from "../../runtime/learner";
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
import { planSceneTeaching } from "../../runtime/compile/scene-teach-plan";
import {
  getSugarlangTeachPlan,
  seedSugarlangTeachPlan,
  serializeTeachPlans,
  type SugarlangTeachPlanDocument
} from "../../runtime/compile/teach-plan-state";
import {
  ClaudeTeacherPolicy,
  createGatewayTeacherClient
} from "../../runtime/teacher/policies/llm-teacher-policy";
import { generateVariant, VARIANT_PROMPT_VERSION } from "../../runtime/compile/generate-variant";
import { GradedTextService } from "../../runtime/grading/graded-text-service";
import { buildItemViewContentHash } from "../../runtime/grading/sources/item-view-source";
import { buildDialogueNodeContentHash } from "../../runtime/grading/sources/dialogue-node-source";
import { getAllInventoryExponents } from "../../runtime/inventory/competency-inventory-loader";
import type { BakedLineVariant } from "../../runtime/contracts/baked-variant";
import {
  DIALOGUE_VARIANT_BANDS,
  ITEM_VARIANT_BANDS
} from "../../runtime/contracts/baked-variant";
import {
  postureForBand,
  TARGET_LANGUAGE_RATIO_BY_POSTURE
} from "../../runtime/teacher/band-envelope";
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
  SceneVocabularyModel,
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

/**
 * What went wrong during a rebuild, as things the AUTHOR can act on.
 *
 * WHY THIS EXISTS. A rebuild used to report success unconditionally: it caught
 * nothing, and a missing gateway merely `console.warn`ed and left every pass
 * undefined. So "Sugarlang lexicons rebuilt successfully" printed while NOTHING
 * was built -- which is precisely the failure that presents later as "the
 * Teacher made a boring choice" and sends someone debugging the wrong layer.
 *
 * A rebuild that builds nothing is not a successful rebuild.
 */
export interface SugarlangRebuildProblem {
  /** Which pass. */
  pass: "gateway" | "scene-context" | "teach-plan";
  /** One line, addressed to the author, saying what is now not built. */
  message: string;
  /** What to do about it, when there is a useful answer. */
  detail?: string;
}

export interface SugarlangRebuildResult {
  status: SugarlangCompileStatusSummary;
  /** Empty means the rebuild genuinely built everything it was asked to. */
  problems: SugarlangRebuildProblem[];
}

export interface SugarlangRebuildProgress {
  completedScenes: number;
  totalScenes: number;
  currentSceneId: string | null;
}

const atlas = new CefrLexAtlasProvider();
const morphology = new MorphologyLoader();
// 090.9: was a local copy named SCENE_BANDS, one of six.

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

/**
 * A derived artifact the bake produces, on its way to the project's `assets/`.
 *
 * `json` rather than bytes because every artifact here is JSON and the caller
 * is the piece that knows how to make a file; keeping the encoding on that
 * side means this module needs nothing from the platform.
 */
export interface SugarlangArtifact {
  relativeAssetPath: string;
  json: unknown;
}

/** Bumped when an artifact file's shape changes in a way a reader must notice. */
export const SUGARLANG_ARTIFACT_SCHEMA_VERSION = 1;

/**
 * STABLE, not content-hashed. The deploy stamps every `assetSources` URL with
 * the deployed sha (Plan 060, `github-workflow.ts`), so cache-busting is
 * already handled -- and a stable name means the declared path list never
 * changes, so writing an artifact never touches the project session.
 */
export const SUGARLANG_SCENE_CONTEXT_ASSET_PATH =
  "assets/sugarlang/scene-contexts.json";

/** Stable, same reasoning as the scene-context path above. */
export const SUGARLANG_VARIANT_ASSET_PATH = "assets/sugarlang/variants.json";

/** Every path this plugin declares, for the project's asset collector. */
export const SUGARLANG_ARTIFACT_ASSET_PATHS: readonly string[] = [
  SUGARLANG_SCENE_CONTEXT_ASSET_PATH,
  SUGARLANG_VARIANT_ASSET_PATH
];

/**
 * Sweeps every baked variant out of the browser cache into one artifact
 * (Plan 092.2).
 *
 * A SWEEP RATHER THAN A PER-CLICK APPEND, deliberately. Variants have no bulk
 * bake -- they come from popover clicks one node at a time (docs/backlog/007:
 * "bulk variant baking has never existed in production") -- so there is no
 * moment when "all the variants" exist except by reading the cache. Sweeping
 * also picks up HAND-EDITED variants for free, which matters because those are
 * authored content and losing them would be losing work, not losing a cache
 * (ADR 005 rule 6).
 *
 * Rewriting the whole file on each change is affordable at this size and has
 * the property that matters: the file is never a partial view of the cache.
 */
export async function collectVariantArtifact(
  workspaceId: string
): Promise<SugarlangArtifact | null> {
  const cache = new IndexedDBVariantCache({ workspaceId });
  let metas: Awaited<ReturnType<typeof cache.listEntries>>;
  try {
    metas = await cache.listEntries();
  } catch {
    return null;
  }
  if (metas.length === 0) {
    return null;
  }

  // MACHINE DRAFTS ARE PRUNED; HAND-WRITTEN ONES ARE NOT.
  //
  // The variant key includes `variantPromptVersion`, so bumping that constant
  // makes every older entry unreachable -- the lookup misses and the game
  // renders authored English. `docs/backlog/007` calls that "correct for
  // machine drafts, indefensible for authored text", and it is: a regenerated
  // draft costs a gateway call, a hand correction costs work nobody can
  // repeat.
  //
  // So a stale DRAFT is dropped, and a stale HAND EDIT is kept even though the
  // runtime cannot currently serve it. Keeping it means the author's writing
  // stays in the project and is still there when 007 makes it reachable again;
  // it also leaves the orphaning visible in the file rather than silently
  // absent. Measured on wordlark: 126 entries, 24 current drafts, 4 hand
  // edits, ALL of them already orphaned by prompt-version bumps.
  const entries = [];
  for (const meta of metas) {
    const entry = await cache.get({
      lang: meta.lang,
      band: meta.band,
      contentHash: meta.contentHash,
      variantPromptVersion: meta.variantPromptVersion
    });
    if (!entry) {
      continue;
    }
    const isHandWritten = entry.variant.generatedByModel === "manual";
    const isCurrentDraft =
      meta.variantPromptVersion === VARIANT_PROMPT_VERSION;
    if (isHandWritten || isCurrentDraft) {
      entries.push(entry);
    }
  }
  if (entries.length === 0) {
    return null;
  }

  return {
    relativeAssetPath: SUGARLANG_VARIANT_ASSET_PATH,
    json: {
      schemaVersion: SUGARLANG_ARTIFACT_SCHEMA_VERSION,
      promptVersion: VARIANT_PROMPT_VERSION,
      variants: entries
    }
  };
}

/**
 * Puts the variant artifact back into the browser cache, so clearing browser
 * storage costs a reload rather than every variant ever generated -- including
 * the hand-written ones, which cannot be regenerated at all.
 *
 * Each entry restores under its OWN key, so a line edited since the bake stays
 * a miss instead of answering with text about the old wording.
 */
export async function restoreVariantsFromArtifact(
  workspaceId: string,
  readAssetFile: (relativeAssetPath: string) => Promise<Blob | null>
): Promise<number> {
  let parsed: unknown;
  try {
    const blob = await readAssetFile(SUGARLANG_VARIANT_ASSET_PATH);
    if (!blob) {
      return 0;
    }
    parsed = JSON.parse(await blob.text());
  } catch {
    return 0;
  }

  const variants = (parsed as { variants?: unknown })?.variants;
  if (!Array.isArray(variants)) {
    return 0;
  }

  const cache = new IndexedDBVariantCache({ workspaceId });
  let restored = 0;
  for (const entry of variants as Array<{ key?: unknown; variant?: unknown }>) {
    const key = entry?.key as
      | { lang?: string; band?: CEFRBand; contentHash?: string; variantPromptVersion?: string }
      | undefined;
    if (!key?.lang || !key?.band || !key?.contentHash || !entry?.variant) {
      continue;
    }
    await cache.set({
      key: {
        lang: key.lang,
        band: key.band,
        contentHash: key.contentHash,
        variantPromptVersion: key.variantPromptVersion ?? VARIANT_PROMPT_VERSION
      },
      variant: entry.variant as BakedLineVariant
    });
    restored += 1;
  }
  return restored;
}

/**
 * Sweeps every scene context out of the browser cache into one artifact
 * (Plan 092.2).
 *
 * A SWEEP, NOT A CAPTURE DURING EXTRACTION. The first version of this
 * collected models as the extractor produced them, which looked right and was
 * wrong: `compile-scheduler.ts` skips extraction entirely on a cache hit
 * (`if (cached) { ...; continue; }`), so a project that had been baked before
 * -- which is every real project -- produced no models and therefore no file.
 * It would only ever have worked on a first-ever bake.
 *
 * Sweeping is also not the thing the plan warned against. That warning is
 * about looking models up BY KEY (`{contentHash, supportLanguage,
 * promptVersion}`), which misses for any scene edited since the last Rebuild
 * (docs/backlog/013). `listEntries` asks for whatever is there and cannot
 * miss.
 */
export async function collectSceneContextArtifact(
  workspaceId: string,
  currentHashes?: Map<string, string>
): Promise<SugarlangArtifact | null> {
  const cache = new IndexedDBSceneContextCache({ workspaceId });
  let metas: Awaited<ReturnType<typeof cache.listEntries>>;
  try {
    metas = await cache.listEntries();
  } catch {
    return null;
  }
  if (metas.length === 0) {
    return null;
  }

  // CURRENT ONLY, or the file grows forever. The cache keeps every extraction
  // it has ever made -- one per edit of a scene, plus one per prompt version
  // -- and none of the old ones can ever be hit again, because the key
  // includes the content hash and the prompt version. Measured on the wordlark
  // project before this filter: 7 models, of which 2 were current, and 5 were
  // superseded editions of two scenes.
  //
  // A stale entry is harmless in the cache and NOT harmless in the artifact:
  // the artifact ships, so dead editions would be downloaded by every player
  // and would accumulate for the life of the project.
  //
  // Without `currentHashes` this cannot tell current from stale, so it keeps
  // everything -- a bigger file beats a file missing the model in use.
  const isCurrent = (meta: (typeof metas)[number]): boolean => {
    if (!currentHashes) return true;
    const current = currentHashes.get(meta.sceneId);
    return (
      current === undefined ||
      (current === meta.contentHash &&
        meta.promptVersion === SCENE_CONTEXT_PROMPT_VERSION)
    );
  };

  const models: SceneContextModel[] = [];
  for (const meta of metas.filter(isCurrent)) {
    const entry = await cache.get({
      contentHash: meta.contentHash,
      supportLanguage: meta.supportLanguage,
      promptVersion: meta.promptVersion
    });
    if (entry) {
      models.push(entry.model);
    }
  }
  if (models.length === 0) {
    return null;
  }

  return {
    relativeAssetPath: SUGARLANG_SCENE_CONTEXT_ASSET_PATH,
    json: {
      schemaVersion: SUGARLANG_ARTIFACT_SCHEMA_VERSION,
      promptVersion: SCENE_CONTEXT_PROMPT_VERSION,
      sceneContextModels: models
    }
  };
}

/**
 * Puts the scene-context artifact back into the browser cache (Plan 092.2).
 *
 * This is what makes the browser copy a CACHE rather than the only copy. The
 * file in `assets/` is durable, so after clearing browser storage a rebuild
 * restores from it instead of calling the gateway again -- extraction is paid
 * work, and paying twice for an unchanged scene is the waste this prevents.
 *
 * The cache key is rebuilt from each model, which carries its own
 * `contentHash`, `promptVersion` and `supportLanguage`. So a model whose scene
 * has since been edited restores under its OLD hash and is simply never hit --
 * stale entries cannot masquerade as current ones.
 *
 * Returns how many were restored; 0 covers both "no file yet" and "file held
 * nothing", which are the same thing to a caller.
 */
export async function restoreSceneContextsFromArtifact(
  workspaceId: string,
  readAssetFile: (relativeAssetPath: string) => Promise<Blob | null>
): Promise<number> {
  let parsed: unknown;
  try {
    const blob = await readAssetFile(SUGARLANG_SCENE_CONTEXT_ASSET_PATH);
    if (!blob) {
      return 0;
    }
    parsed = JSON.parse(await blob.text());
  } catch {
    // A missing or unreadable artifact is a legal quiet state: the project may
    // simply never have been baked. Rebuilding is always available.
    return 0;
  }

  const models = (parsed as { sceneContextModels?: unknown })?.sceneContextModels;
  if (!Array.isArray(models)) {
    return 0;
  }

  const cache = new IndexedDBSceneContextCache({ workspaceId });
  let restored = 0;
  for (const model of models as SceneContextModel[]) {
    if (!model?.sceneId || !model?.contentHash) {
      continue;
    }
    await cache.set({
      key: {
        contentHash: model.contentHash,
        supportLanguage: model.supportLanguage,
        promptVersion: model.promptVersion
      },
      sceneId: model.sceneId,
      model
    });
    restored += 1;
  }
  return restored;
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
) : Promise<SceneVocabularyModel | null> {
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
  lexicon: SceneVocabularyModel | null,
  // 090.2c: bands are atlas facts now, not stored on the scene artifact, so the
  // caller supplies the lookup. Undefined means "atlas unavailable" and every
  // band reads zero rather than silently mis-binning lemmas into one band.
  getBand?: (lemmaId: string) => CEFRBand | undefined
): SceneDensitySummary {
  const totalLemmas = lexicon ? lexicon.lemmaIds.length : 0;

  return {
    totalLemmas,
    bandCounts: SCENE_BANDS.map((band) => {
      const count =
        lexicon && getBand
          ? lexicon.lemmaIds.filter((lemmaId) => getBand(lemmaId) === band).length
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

/**
 * Current content hash per scene. Exported so the teach-plan hydrator can tell
 * a stored plan from a stale one -- a plan derives from a scene's concepts, and
 * nothing else about it notices when that scene is edited.
 */
export async function readCurrentSceneContentHashes(
  gameProject: GameProject | null,
  regions: RegionDocument[],
  targetLanguage: string,
  activeScene: Scene | null
): Promise<Map<string, string>> {
  if (!targetLanguage || targetLanguage.trim().length === 0) {
    // Studio tolerates a null language; hashing needs the atlas for that
    // language, so there is nothing to compare against yet.
    return new Map();
  }
  return computeCurrentSceneHashes(
    await createSugarlangSceneContexts(
      gameProject,
      regions,
      targetLanguage,
      activeScene
    )
  );
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
  // STUDIO TOLERATES A NULL LANGUAGE. A freshly installed plugin has none, and
  // the author needs the Build panel to open so they can go and set one.
  //
  // Without this, `computeCurrentSceneHashes` -> `atlas.getAtlasVersion("")`
  // throws `Missing sugarlang cefrlex data for language ""`, and the Build
  // panel's status read is a `.then()` with no `.catch` -- so merely OPENING the
  // panel on an unconfigured project produced an unhandled rejection.
  if (!targetLanguage || targetLanguage.trim().length === 0) {
    return {
      totalScenes: 0,
      cachedScenes: 0,
      staleScenes: 0,
      missingScenes: 0,
      chunkCachedScenes: 0
    };
  }

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

/**
 * Asks the Teacher what each scene's lines should teach, at every baked band,
 * and files the answer under the dialogues reachable from that scene.
 *
 * ONE CALL PER (SCENE, BAND). Not per line -- the build-time situation is
 * scene-level, so a per-line call would ask an identical question and pay a
 * gateway round-trip for an identical answer. A 50-node scene across 6 bands is
 * 6 calls.
 *
 * This pass does NOT bake variants. Baking is per node and expensive, and it
 * stays where it already is (on demand, from the variants popover). This pass
 * only makes the SLATE available for whenever a bake happens.
 *
 * Silent when there is no gateway: without one there is no Teacher to ask, and
 * the outer function has already warned loudly about the gateway being absent.
 */
async function runTeachPlanPass(args: {
  scenes: SceneAuthoringContext[];
  gatewayClient: SugarlangGatewayClient | null;
  sceneContextCache: IndexedDBSceneContextCache | null;
  targetLanguage: string;
  problems: SugarlangRebuildProblem[];
}): Promise<SugarlangTeachPlanDocument | null> {
  const { scenes, gatewayClient, sceneContextCache, targetLanguage, problems } =
    args;
  // No gateway is already reported by the caller as one gateway-level problem;
  // repeating it per scene would bury the real message under noise.
  if (!gatewayClient || !sceneContextCache) return null;

  const teacher = new ClaudeTeacherPolicy({
    client: createGatewayTeacherClient(gatewayClient)
  });
  const currentHashes = computeCurrentSceneHashes(scenes);
  const seeds: Parameters<typeof seedSugarlangTeachPlan>[0] = [];
  const planned: Parameters<typeof serializeTeachPlans>[0]["scenes"] = [];

  for (const scene of scenes) {
    const contentHash = currentHashes.get(scene.sceneId);
    // Read back what the scene-context pass just wrote. A miss is not fatal:
    // planSceneTeaching still asks, from a situation whose facts are all
    // unavailable, which is a weak directive rather than a wrong one.
    const cached = contentHash
      ? await sceneContextCache
          .get({
            contentHash,
            supportLanguage: scene.supportLanguage,
            promptVersion: SCENE_CONTEXT_PROMPT_VERSION
          })
          .catch(() => null)
      : null;

    const plan = await planSceneTeaching({
      sceneId: scene.sceneId,
      sceneContext: cached?.model ?? null,
      bands: DIALOGUE_VARIANT_BANDS,
      targetLanguage,
      supportLanguage: scene.supportLanguage,
      teacher,
      atlas,
      onLog: (message: string, detail?: Record<string, unknown>) =>
        console.info(`[sugarlang build] ${message}`, detail ?? {})
    });

    const fromSceneContext = cached?.model != null;

    // A plan built from no scene context is the quiet failure this whole story
    // is downstream of: the bake still runs, the line still renders, and it
    // teaches nothing the scene is about.
    if (!fromSceneContext) {
      problems.push({
        pass: "scene-context",
        message: `Scene "${scene.sceneId}" has no built context, so its lines were planned with nothing to teach.`,
        detail:
          "Its concepts are missing or stale. Rebuild again; if it persists, the scene-context pass is failing for this scene."
      });
    }

    const failedBands = DIALOGUE_VARIANT_BANDS.filter(
      (band) => !plan.byBand.has(band)
    );
    if (failedBands.length > 0) {
      problems.push({
        pass: "teach-plan",
        message: `Scene "${scene.sceneId}": the Teacher failed for ${failedBands.join(", ")}.`,
        detail:
          "Lines baked at those bands will be graded for level but will not be steered toward any vocabulary."
      });
    }

    // Fan the scene's answer out to every dialogue reachable from it, because
    // the consumer (the variants popover) holds a dialogue id and no scene.
    for (const dialogue of scene.dialogues) {
      for (const [band, { directive, slate }] of plan.byBand) {
        seeds.push({
          dialogueDefinitionId: dialogue.definitionId,
          lang: targetLanguage,
          band,
          entry: { slate, posture: directive.supportPosture, fromSceneContext }
        });
      }
    }

    // Stored per SCENE -- one entry per (scene, band) rather than one per
    // (dialogue, band), because the Teacher answered per scene and duplicating
    // it across a scene's dialogues would bloat the project document for no
    // information gain. The dialogue index below is what makes per-dialogue
    // reads work after hydration.
    planned.push({
      sceneId: scene.sceneId,
      contentHash: contentHash ?? null,
      fromSceneContext,
      dialogueDefinitionIds: scene.dialogues.map((d) => d.definitionId),
      bands: [...plan.byBand].map(([band, { directive, slate }]) => ({
        band,
        slate,
        posture: directive.supportPosture
      }))
    });
  }

  seedSugarlangTeachPlan(seeds);
  console.info("[sugarlang build] teach-plan-seeded", {
    entries: seeds.length,
    scenes: scenes.length
  });

  return serializeTeachPlans({ lang: targetLanguage, scenes: planned });
}

export async function rebuildSugarlangCompileCache(
  gameProject: GameProject | null,
  regions: RegionDocument[],
  targetLanguage: string,
  activeScene: Scene | null,
  workspaceId: string,
  onProgress?: (progress: SugarlangRebuildProgress) => void,
  options?: {
    chunkExtractionEnabled?: boolean;
    /**
     * Receives the teach plan so the caller can persist it into the project's
     * sugarlang config slot. Omitted means the plan lives only in memory for
     * this session, which is a valid (if forgetful) mode.
     */
    onTeachPlanDocument?: (document: SugarlangTeachPlanDocument) => void;
    /**
     * Receives the derived artifacts the runtime cannot rebuild, so the caller
     * can write them into the project's `assets/` (Plan 092.2, ADR 005 rule 3).
     * Handed out for the same reason as the teach plan: this module has no way
     * to reach the disk, and should not grow one.
     *
     * Omitted means the bake's output stays in this browser -- which is the
     * state the whole epic exists to end, so callers that CAN write should.
     */
    onArtifacts?: (artifacts: SugarlangArtifact[]) => Promise<void> | void;
  }
): Promise<SugarlangRebuildResult> {
  // VALIDATE BEFORE DESTROYING ANYTHING (nikki, 2026-07-31).
  //
  // `cache.invalidate()` below wipes the compile cache, and until this guard
  // existed a project with no target language got as far as that wipe and THEN
  // threw -- `atlas.getAtlasVersion("")` raises `Missing sugarlang cefrlex data
  // for language ""`. So pressing Rebuild on an unconfigured project destroyed
  // the cache and failed, which is the worst possible order.
  //
  // A null language in STUDIO is normal, not an error: the plugin was just
  // installed and nobody has opened the Language panel yet. So this is a refusal
  // with an explanation, not a crash -- Studio has to stay usable so the author
  // can go and set one.
  if (!targetLanguage || targetLanguage.trim().length === 0) {
    return {
      status: await readSugarlangCompileStatus(
        gameProject,
        regions,
        targetLanguage,
        activeScene,
        workspaceId
      ),
      problems: [
        {
          pass: "gateway",
          message: "No target language set, so nothing was built.",
          detail:
            "Set one in the Sugarlang workspace's Language panel, then rebuild. Nothing was changed or invalidated."
        }
      ]
    };
  }

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

  const problems: SugarlangRebuildProblem[] = [];

  // Say so loudly when a pass cannot run. Without a gateway the scene-context
  // pass is simply absent, which is indistinguishable from "ran and found
  // nothing" -- the HUD shows "(not built)" either way.
  //
  // This used to be console-only, so the button still said "rebuilt
  // successfully". It now reaches the author.
  if (!gatewayClient) {
    console.warn(
      "[sugarlang build] scene-context and chunk passes SKIPPED: no gateway base URL resolved. " +
        "Scene context can never be built until the sugarlang gateway URL is set."
    );
    problems.push({
      pass: "gateway",
      message:
        "Build incomplete: no sugarlang gateway URL, so scene concepts, chunks and teaching plans were NOT built.",
      detail:
        "NPCs will still talk, but they will not teach what your scenes are about. Set the sugarlang gateway URL and rebuild."
    });
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
            return await new SceneContextExtractor({
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

  // TEACH PLAN PASS -- runs LAST, because it reads what the scene-context pass
  // just wrote. Cheap by construction: ONE Teacher call per (scene, band), not
  // per line, because the build-time situation is scene-level. It does NOT bake
  // variants; baking is per-node and stays where it is.
  const teachPlanDocument = await runTeachPlanPass({
    scenes,
    gatewayClient,
    sceneContextCache: gatewayClient
      ? new IndexedDBSceneContextCache({ workspaceId })
      : null,
    targetLanguage,
    problems
  });

  // Handed OUT rather than written here. This module has no command channel and
  // should not grow one -- persisting into the project is a Studio command, and
  // the caller is the piece that already holds the dispatcher.
  if (teachPlanDocument) {
    options?.onTeachPlanDocument?.(teachPlanDocument);
  }

  // Same reason, one step further out: this module cannot reach the disk
  // either. The caller writes these into the project's `assets/`, which is how
  // they reach a deployed game (Plan 092.2).
  //
  // Swept from the caches rather than collected during the passes: a cache hit
  // skips its pass entirely, so an already-baked project would otherwise hand
  // out nothing at all.
  if (options?.onArtifacts) {
    const artifacts = (
      await Promise.all([
        // Current hashes so superseded editions are left in the cache rather
        // than shipped: the cache keeps every extraction ever made, and only
        // the ones matching today's content can ever be used.
        collectSceneContextArtifact(
          workspaceId,
          await readCurrentSceneContentHashes(
            gameProject,
            regions,
            targetLanguage,
            activeScene
          )
        ),
        collectVariantArtifact(workspaceId)
      ])
    ).filter((artifact): artifact is SugarlangArtifact => artifact !== null);
    if (artifacts.length > 0) {
      await options.onArtifacts(artifacts);
    }
  }

  return {
    status: await readSugarlangCompileStatus(
      gameProject,
      regions,
      targetLanguage,
      activeScene,
      workspaceId
    ),
    problems
  };
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

// 090.11: the baked band set lives in the baked-variant contract now -- it was
// spelled independently here and in two Studio panels, so turning A1/A2 on in
// one place left the others showing the old four.
const DISPLAY_BANDS = DIALOGUE_VARIANT_BANDS;

/**
 * MERGED 2026-07-31. This was the THIRD byte-identical copy of the variant
 * cache key's content leg (bake source, scripted middleware, here). The Studio
 * popover writes variants under it and the runtime reads them under it, so a
 * drift between any two copies is a silent, total cache miss. See the rule at
 * the definition.
 */
const buildVariantContentHash = buildDialogueNodeContentHash;

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
      let inventoryExponents: import("../../runtime/contracts/competency-inventory").Exponent[] = [];
      try {
        inventoryExponents = getAllInventoryExponents(targetLanguage);
      } catch {
        // No inventory for this language -- generation proceeds without chunk context
      }
      const result: Partial<Record<CEFRBand, BakedLineVariant>> = {};
      await Promise.all(
        DISPLAY_BANDS.map(async (band) => {
          try {
            // 090.11: the Teacher's answer for this dialogue's scene, if the
            // rebuild pass has run this session. Absent means no slate and the
            // band's own posture -- exactly what this call did before slates
            // existed, which is why a missing plan degrades safely rather than
            // blocking the bake.
            const plan = getSugarlangTeachPlan(dialogueDefinitionId, targetLanguage, band);
            const generated = await generateVariant(
              {
                authoredText: nodeText,
                targetLang: targetLanguage,
                band,
                intent: null,
                contentHash,
                dialogueDefinitionId,
                nodeId,
                ...(plan ? { teach: plan.slate, posture: plan.posture } : {})
              },
              { llmClient, atlas, inventoryExponents }
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
        ITEM_VARIANT_BANDS.map(async (band) => {
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
      let inventoryExponents: import("../../runtime/contracts/competency-inventory").Exponent[] = [];
      try {
        inventoryExponents = getAllInventoryExponents(targetLanguage);
      } catch {
        // No inventory for this language -- generation proceeds without chunk context
      }
      const service = new GradedTextService({ llmClient, atlas, inventoryExponents });
      const result: Partial<Record<CEFRBand, BakedLineVariant>> = {};
      await Promise.all(
        ITEM_VARIANT_BANDS.map(async (band) => {
          try {
            // POSTURE REACHES THE GENERATOR, not just the verifier. Without it
            // `adapt` falls to DEFAULT_POSTURE (`target-dominant`, ~85% target
            // language), so a beginner item would be WRITTEN almost entirely in
            // the target language and then MEASURED against the anchored
            // envelope it was never shown. That is the failure the dialogue bake
            // hit in play and 090.11 fixed there (generate-variant.ts:134); this
            // is the same fix on the item path, and it is the prerequisite that
            // makes A1/A2 bakeable -- see ITEM_VARIANT_BANDS.
            const posture = postureForBand(band);
            const graded = await service.adapt({
              sourceText: text,
              targetLang: targetLanguage,
              band,
              posture,
              directedRatio: TARGET_LANGUAGE_RATIO_BY_POSTURE[posture],
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
