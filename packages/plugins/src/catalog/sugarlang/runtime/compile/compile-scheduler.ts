/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/compile-scheduler.ts
 *
 * Purpose: Schedules background and lazy scene compilation against the shared compiler.
 *
 * Exports:
 *   - SugarlangAuthoringCompileSchedulerOptions
 *   - SugarlangAuthoringCompileScheduler
 *   - RuntimeCompileSchedulerOptions
 *   - RuntimeCompileScheduler
 *
 * Relationships:
 *   - Depends on the compile entry point and cache interface.
 *   - Is consumed by Studio-side warm-cache flows and runtime lazy compile flows.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 *
 * Status: active
 */

import type { RuntimeCompileProfile } from "@sugarmagic/runtime-core/materials";
import type { SceneVocabularyModel } from "../types";
import type { MorphologyLoader } from "../classifier/morphology-loader";
import type { LexicalAtlasProvider } from "../types";
import {
  createNoOpTelemetrySink,
  createTelemetryEvent,
  emitTelemetry,
  type TelemetrySink
} from "../telemetry/telemetry";
import { compileSugarlangScene } from "./compile-sugarlang-scene";
import { collectSceneText, type SceneAuthoringContext } from "./scene-traversal";
import type { SugarlangChunkCache } from "./chunk-cache";
import type { MultiWordExpressionExtractionResult } from "./multi-word-expression-extractor";
import type { SugarlangCompileCache } from "./sugarlang-compile-cache";
import type { SceneContextExtractionResult } from "./scene-context-extractor";
import type { SugarlangSceneContextCache } from "./scene-context-cache";
import type { DialogueDefinition } from "@sugarmagic/domain";

export interface SugarlangAuthoringChunkPipelineOptions {
  cache: SugarlangChunkCache;
  extractSceneChunks: (
    scene: SceneAuthoringContext,
    contentHash: string
  ) => Promise<MultiWordExpressionExtractionResult>;
  promptVersion: string;
  debounceMs?: number;
  telemetry?: TelemetrySink;
}

/**
 * The scene-context build pass: what each scene's authored content is ABOUT.
 *
 * Deliberately has NO `debounceMs`. The other passes carry one and it is dead --
 * `notifySceneChanged` and `scheduleDialogue` have zero callers repo-wide, and
 * the only real entry point sets `debounceMs: 0` and flushes synchronously. A
 * fourth unused timer would be three too many; see docs/backlog/007, which owns
 * removing the rest.
 */
export interface SugarlangAuthoringSceneContextPassOptions {
  cache: SugarlangSceneContextCache;
  extractSceneContext: (
    scene: SceneAuthoringContext,
    contentHash: string
  ) => Promise<SceneContextExtractionResult>;
  promptVersion: string;
  /**
   * Language concepts are written in. NOT the target language: concepts are
   * English, so one extraction serves every target language.
   */
  supportLanguage: string;
}

export interface SugarlangAuthoringCompileSchedulerOptions {
  getScenes: () => SceneAuthoringContext[];
  getDialogues?: () => DialogueDefinition[];
  atlas: LexicalAtlasProvider;
  morphology: MorphologyLoader;
  cache: SugarlangCompileCache;
  debounceMs?: number;
  chunkPipeline?: SugarlangAuthoringChunkPipelineOptions;
  /**
   * STUDIO ONLY. Never wired on the runtime path: `ensureScene` runs in the
   * deployed game, and extraction is a gateway call -- a player's machine must
   * not do authoring work. The runtime receives models by seeding.
   */
  sceneContextPass?: SugarlangAuthoringSceneContextPassOptions;
  onLog?: (message: string, detail?: Record<string, unknown>) => void;
}


export class SugarlangAuthoringCompileScheduler {
  private readonly pendingRegionIds = new Set<string>();
  private readonly pendingChunkRegionIds = new Set<string>();
  private readonly pendingSceneContextRegionIds = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chunkTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;
  private readonly chunkDebounceMs: number;
  private readonly onLog?: SugarlangAuthoringCompileSchedulerOptions["onLog"];
  private readonly chunkPipeline: SugarlangAuthoringChunkPipelineOptions | null;
  private readonly sceneContextPass: SugarlangAuthoringSceneContextPassOptions | null;
  private readonly telemetry: TelemetrySink;

  constructor(private readonly options: SugarlangAuthoringCompileSchedulerOptions) {
    this.debounceMs = options.debounceMs ?? 250;
    this.chunkPipeline = options.chunkPipeline ?? null;
    this.sceneContextPass = options.sceneContextPass ?? null;
    this.chunkDebounceMs = this.chunkPipeline?.debounceMs ?? 5000;
    this.onLog = options.onLog;
    this.telemetry = this.chunkPipeline?.telemetry ?? createNoOpTelemetrySink();
  }

  scheduleScene(regionId: string): void {
    this.pendingRegionIds.add(regionId);
    this.armTimer();
  }

  scheduleScenes(regionIds: Iterable<string>): void {
    for (const regionId of regionIds) {
      this.pendingRegionIds.add(regionId);
    }
    this.armTimer();
  }

  rebuildAll(): void {
    this.scheduleScenes(this.options.getScenes().map((scene) => scene.regionId));
    if (this.sceneContextPass) {
      for (const scene of this.options.getScenes()) {
        this.pendingSceneContextRegionIds.add(scene.regionId);
      }
    }
  }

  private armTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      void this.flush();
    }, this.debounceMs);
  }

  private armChunkTimer(): void {
    if (!this.chunkPipeline || this.pendingChunkRegionIds.size === 0) {
      return;
    }

    if (this.chunkTimer) {
      clearTimeout(this.chunkTimer);
    }

    this.chunkTimer = setTimeout(() => {
      void this.flushChunks();
    }, this.chunkDebounceMs);
  }

  private getRequestedScenes(requestedRegionIds: string[]): SceneAuthoringContext[] {
    const requested = new Set(requestedRegionIds);
    return this.options
      .getScenes()
      .filter((scene) => requested.has(scene.regionId))
      .sort((left, right) => left.regionId.localeCompare(right.regionId));
  }

  private async writeChunksIntoCompileCache(
    regionId: string,
    contentHash: string,
    chunks: NonNullable<SceneVocabularyModel["chunks"]>
  ): Promise<void> {
    for (const profile of ["runtime-preview", "authoring-preview"] as const) {
      const existing = await this.options.cache.get(regionId, contentHash, profile);
      if (!existing) {
        continue;
      }

      await this.options.cache.set({
        ...existing,
        chunks: [...chunks]
      });
    }
  }

  async flush(): Promise<SceneVocabularyModel[]> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const requested = [...this.pendingRegionIds].sort((left, right) => left.localeCompare(right));
    this.pendingRegionIds.clear();
    const scenes = this.getRequestedScenes(requested);

    const compiled: SceneVocabularyModel[] = [];
    for (const scene of scenes) {
      for (const profile of ["runtime-preview", "authoring-preview"] as const) {
        const lexicon = compileSugarlangScene(
          scene,
          this.options.atlas,
          this.options.morphology,
          profile
        );
        await this.options.cache.set(lexicon);
        compiled.push(lexicon);
      }

      this.onLog?.("compiled-scene", {
        regionId: scene.regionId,
        profiles: ["runtime-preview", "authoring-preview"]
      });

      if (this.chunkPipeline) {
        this.pendingChunkRegionIds.add(scene.regionId);
      }
    }

    this.armChunkTimer();
    return compiled;
  }

  /**
   * Builds a SceneContextModel per pending scene -- what its content is ABOUT.
   *
   * Studio only. Cache-hit skips the gateway; a content change between the call
   * starting and returning discards the result rather than writing a model that
   * describes text the author has already replaced.
   */
  async flushSceneContext(): Promise<void> {
    if (!this.sceneContextPass) {
      return;
    }

    const requested = [...this.pendingSceneContextRegionIds].sort((left, right) =>
      left.localeCompare(right)
    );
    this.pendingSceneContextRegionIds.clear();
    const scenes = this.getRequestedScenes(requested);

    for (const scene of scenes) {
      const contentHash = compileSugarlangScene(
        scene,
        this.options.atlas,
        this.options.morphology,
        "runtime-preview"
      ).contentHash;

      const cacheKey = {
        contentHash,
        supportLanguage: this.sceneContextPass.supportLanguage,
        promptVersion: this.sceneContextPass.promptVersion
      };

      const cached = await this.sceneContextPass.cache.get(cacheKey);
      if (cached) {
        this.onLog?.("scene-context-cache-hit", {
          regionId: scene.regionId,
          conceptCount: cached.model.concepts.length
        });
        continue;
      }

      const result = await this.sceneContextPass.extractSceneContext(
        scene,
        contentHash
      );
      if (result.failure) {
        // Fail-soft: a scene with no context model is a worse build, not a
        // broken one. The extractor already degraded to authored prose.
        this.onLog?.("scene-context-extraction-failed", {
          regionId: scene.regionId,
          reason: result.failure.message
        });
        continue;
      }

      const latestScene = this.options
        .getScenes()
        .find((entry) => entry.regionId === scene.regionId);
      if (!latestScene) {
        continue;
      }

      const latestHash = compileSugarlangScene(
        latestScene,
        this.options.atlas,
        this.options.morphology,
        "runtime-preview"
      ).contentHash;
      if (latestHash !== contentHash) {
        this.onLog?.("scene-context-stale-discarded", {
          regionId: scene.regionId,
          contentHash
        });
        continue;
      }

      await this.sceneContextPass.cache.set({
        key: cacheKey,
        regionId: scene.regionId,
        model: result.model
      });
      this.onLog?.("scene-context-built", {
        regionId: scene.regionId,
        conceptCount: result.model.concepts.length
      });
    }
  }

  async flushChunks(): Promise<void> {
    if (!this.chunkPipeline) {
      return;
    }

    if (this.chunkTimer) {
      clearTimeout(this.chunkTimer);
      this.chunkTimer = null;
    }

    const requested = [...this.pendingChunkRegionIds].sort((left, right) =>
      left.localeCompare(right)
    );
    this.pendingChunkRegionIds.clear();
    const scenes = this.getRequestedScenes(requested);

    for (const scene of scenes) {
      const runtimeLexicon = compileSugarlangScene(
        scene,
        this.options.atlas,
        this.options.morphology,
        "runtime-preview"
      );
      const contentHash = runtimeLexicon.contentHash;
      const cacheKey = {
        contentHash,
        lang: scene.targetLanguage,
        extractorPromptVersion: this.chunkPipeline.promptVersion
      };
      const cached = await this.chunkPipeline.cache.get(cacheKey);
      if (cached) {
        await this.writeChunksIntoCompileCache(scene.regionId, contentHash, cached.chunks);
        this.onLog?.("chunk-cache-hit", {
          regionId: scene.regionId,
          chunkCount: cached.chunks.length
        });
        continue;
      }

      const extraction = await this.chunkPipeline.extractSceneChunks(
        scene,
        contentHash
      );
      if (extraction.failure) {
        this.onLog?.("chunk-extraction-failed", {
          regionId: scene.regionId,
          reason: extraction.failure.message
        });
        continue;
      }

      const latestScene = this.options
        .getScenes()
        .find((entry) => entry.regionId === scene.regionId);
      if (!latestScene) {
        continue;
      }

      const latestHash = compileSugarlangScene(
        latestScene,
        this.options.atlas,
        this.options.morphology,
        "runtime-preview"
      ).contentHash;
      if (latestHash !== contentHash) {
        await emitTelemetry(
          this.telemetry,
          createTelemetryEvent("chunk.extraction-stale-discarded", {
            timestamp: Date.now(),
            regionId: scene.regionId,
            contentHash,
            reason: "scene-content-changed-before-writeback"
          })
        );
        this.onLog?.("chunk-stale-discarded", {
          regionId: scene.regionId,
          contentHash
        });
        continue;
      }

      await this.chunkPipeline.cache.set({
        key: cacheKey,
        regionId: scene.regionId,
        chunks: extraction.chunks,
        extractedAtMs: Date.now(),
        extractedByModel: extraction.model
      });
      await this.writeChunksIntoCompileCache(
        scene.regionId,
        contentHash,
        extraction.chunks
      );
      this.onLog?.("chunk-extracted", {
        regionId: scene.regionId,
        contentHash,
        chunkCount: extraction.chunks.length,
        textBlobCount: collectSceneText(scene).length
      });
    }
  }


  start(): void {
    this.onLog?.("scheduler-started");
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.chunkTimer) {
      clearTimeout(this.chunkTimer);
      this.chunkTimer = null;
    }
    this.pendingRegionIds.clear();
    this.pendingChunkRegionIds.clear();
    this.onLog?.("scheduler-stopped");
  }
}

export interface RuntimeCompileSchedulerOptions {
  getScene: (regionId: string) => SceneAuthoringContext | null;
  atlas: LexicalAtlasProvider;
  morphology: MorphologyLoader;
  cache: SugarlangCompileCache;
  profile: Extract<RuntimeCompileProfile, "runtime-preview" | "published-target">;
}

export class RuntimeCompileScheduler {
  constructor(private readonly options: RuntimeCompileSchedulerOptions) {}

  async ensureScene(regionId: string): Promise<SceneVocabularyModel> {
    const scene = this.options.getScene(regionId);
    if (!scene) {
      throw new Error(`Unknown sugarlang scene "${regionId}".`);
    }

    const lexicon = compileSugarlangScene(
      scene,
      this.options.atlas,
      this.options.morphology,
      this.options.profile
    );
    const cached = await this.options.cache.get(
      regionId,
      lexicon.contentHash,
      this.options.profile
    );
    if (cached) {
      return cached;
    }

    await this.options.cache.set(lexicon);
    return lexicon;
  }

  async prime(regionIds: Iterable<string>): Promise<SceneVocabularyModel[]> {
    const compiled: SceneVocabularyModel[] = [];
    for (const regionId of [...regionIds].sort((left, right) =>
      left.localeCompare(right)
    )) {
      compiled.push(await this.ensureScene(regionId));
    }
    return compiled;
  }
}
