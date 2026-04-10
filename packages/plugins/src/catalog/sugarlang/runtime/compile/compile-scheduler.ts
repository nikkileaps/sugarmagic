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
import type { CompiledSceneLexicon } from "../types";
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
import type { ExtractChunksResult } from "./extract-chunks";
import type { SugarlangCompileCache } from "./sugarlang-compile-cache";

export interface SugarlangAuthoringChunkPipelineOptions {
  cache: SugarlangChunkCache;
  extractSceneChunks: (
    scene: SceneAuthoringContext,
    contentHash: string
  ) => Promise<ExtractChunksResult>;
  promptVersion: string;
  debounceMs?: number;
  telemetry?: TelemetrySink;
  emitLifecycleEvent?: (
    eventName: "sugarlang.scene-chunks-updated",
    payload: {
      sceneId: string;
      contentHash: string;
      chunkCount: number;
    }
  ) => void;
}

export interface SugarlangAuthoringCompileSchedulerOptions {
  getScenes: () => SceneAuthoringContext[];
  atlas: LexicalAtlasProvider;
  morphology: MorphologyLoader;
  cache: SugarlangCompileCache;
  debounceMs?: number;
  chunkPipeline?: SugarlangAuthoringChunkPipelineOptions;
  onLog?: (message: string, detail?: Record<string, unknown>) => void;
}

export class SugarlangAuthoringCompileScheduler {
  private readonly pendingSceneIds = new Set<string>();
  private readonly pendingChunkSceneIds = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chunkTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;
  private readonly chunkDebounceMs: number;
  private readonly onLog?: SugarlangAuthoringCompileSchedulerOptions["onLog"];
  private readonly chunkPipeline: SugarlangAuthoringChunkPipelineOptions | null;
  private readonly telemetry: TelemetrySink;

  constructor(private readonly options: SugarlangAuthoringCompileSchedulerOptions) {
    this.debounceMs = options.debounceMs ?? 250;
    this.chunkPipeline = options.chunkPipeline ?? null;
    this.chunkDebounceMs = this.chunkPipeline?.debounceMs ?? 5000;
    this.onLog = options.onLog;
    this.telemetry = this.chunkPipeline?.telemetry ?? createNoOpTelemetrySink();
  }

  scheduleScene(sceneId: string): void {
    this.pendingSceneIds.add(sceneId);
    this.armTimer();
  }

  scheduleScenes(sceneIds: Iterable<string>): void {
    for (const sceneId of sceneIds) {
      this.pendingSceneIds.add(sceneId);
    }
    this.armTimer();
  }

  rebuildAll(): void {
    this.scheduleScenes(this.options.getScenes().map((scene) => scene.sceneId));
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
    if (!this.chunkPipeline || this.pendingChunkSceneIds.size === 0) {
      return;
    }

    if (this.chunkTimer) {
      clearTimeout(this.chunkTimer);
    }

    this.chunkTimer = setTimeout(() => {
      void this.flushChunks();
    }, this.chunkDebounceMs);
  }

  private getRequestedScenes(requestedSceneIds: string[]): SceneAuthoringContext[] {
    const requested = new Set(requestedSceneIds);
    return this.options
      .getScenes()
      .filter((scene) => requested.has(scene.sceneId))
      .sort((left, right) => left.sceneId.localeCompare(right.sceneId));
  }

  private async writeChunksIntoCompileCache(
    sceneId: string,
    contentHash: string,
    chunks: NonNullable<CompiledSceneLexicon["chunks"]>
  ): Promise<void> {
    for (const profile of ["runtime-preview", "authoring-preview"] as const) {
      const existing = await this.options.cache.get(sceneId, contentHash, profile);
      if (!existing) {
        continue;
      }

      await this.options.cache.set({
        ...existing,
        chunks: [...chunks]
      });
    }
  }

  async flush(): Promise<CompiledSceneLexicon[]> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const requested = [...this.pendingSceneIds].sort((left, right) => left.localeCompare(right));
    this.pendingSceneIds.clear();
    const scenes = this.getRequestedScenes(requested);

    const compiled: CompiledSceneLexicon[] = [];
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
        sceneId: scene.sceneId,
        profiles: ["runtime-preview", "authoring-preview"]
      });

      if (this.chunkPipeline) {
        this.pendingChunkSceneIds.add(scene.sceneId);
      }
    }

    this.armChunkTimer();
    return compiled;
  }

  async flushChunks(): Promise<void> {
    if (!this.chunkPipeline) {
      return;
    }

    if (this.chunkTimer) {
      clearTimeout(this.chunkTimer);
      this.chunkTimer = null;
    }

    const requested = [...this.pendingChunkSceneIds].sort((left, right) =>
      left.localeCompare(right)
    );
    this.pendingChunkSceneIds.clear();
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
        await this.writeChunksIntoCompileCache(scene.sceneId, contentHash, cached.chunks);
        this.chunkPipeline.emitLifecycleEvent?.("sugarlang.scene-chunks-updated", {
          sceneId: scene.sceneId,
          contentHash,
          chunkCount: cached.chunks.length
        });
        this.onLog?.("chunk-cache-hit", {
          sceneId: scene.sceneId,
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
          sceneId: scene.sceneId,
          reason: extraction.failure.message
        });
        continue;
      }

      const latestScene = this.options
        .getScenes()
        .find((entry) => entry.sceneId === scene.sceneId);
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
            sceneId: scene.sceneId,
            contentHash,
            reason: "scene-content-changed-before-writeback"
          })
        );
        this.onLog?.("chunk-stale-discarded", {
          sceneId: scene.sceneId,
          contentHash
        });
        continue;
      }

      await this.chunkPipeline.cache.set({
        key: cacheKey,
        sceneId: scene.sceneId,
        chunks: extraction.chunks,
        extractedAtMs: Date.now(),
        extractedByModel: extraction.model
      });
      await this.writeChunksIntoCompileCache(
        scene.sceneId,
        contentHash,
        extraction.chunks
      );
      this.chunkPipeline.emitLifecycleEvent?.("sugarlang.scene-chunks-updated", {
        sceneId: scene.sceneId,
        contentHash,
        chunkCount: extraction.chunks.length
      });
      this.onLog?.("chunk-extracted", {
        sceneId: scene.sceneId,
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
    this.pendingSceneIds.clear();
    this.pendingChunkSceneIds.clear();
    this.onLog?.("scheduler-stopped");
  }
}

export interface RuntimeCompileSchedulerOptions {
  getScene: (sceneId: string) => SceneAuthoringContext | null;
  atlas: LexicalAtlasProvider;
  morphology: MorphologyLoader;
  cache: SugarlangCompileCache;
  profile: Extract<RuntimeCompileProfile, "runtime-preview" | "published-target">;
}

export class RuntimeCompileScheduler {
  constructor(private readonly options: RuntimeCompileSchedulerOptions) {}

  async ensureScene(sceneId: string): Promise<CompiledSceneLexicon> {
    const scene = this.options.getScene(sceneId);
    if (!scene) {
      throw new Error(`Unknown sugarlang scene "${sceneId}".`);
    }

    const lexicon = compileSugarlangScene(
      scene,
      this.options.atlas,
      this.options.morphology,
      this.options.profile
    );
    const cached = await this.options.cache.get(
      sceneId,
      lexicon.contentHash,
      this.options.profile
    );
    if (cached) {
      return cached;
    }

    await this.options.cache.set(lexicon);
    return lexicon;
  }

  async prime(sceneIds: Iterable<string>): Promise<CompiledSceneLexicon[]> {
    const compiled: CompiledSceneLexicon[] = [];
    for (const sceneId of [...sceneIds].sort((left, right) =>
      left.localeCompare(right)
    )) {
      compiled.push(await this.ensureScene(sceneId));
    }
    return compiled;
  }
}
