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
import { compileSugarlangScene } from "./compile-sugarlang-scene";
import { type SceneAuthoringContext } from "./scene-traversal";
import type { SugarlangCompileCache } from "./sugarlang-compile-cache";

export interface SugarlangAuthoringCompileSchedulerOptions {
  getScenes: () => SceneAuthoringContext[];
  atlas: LexicalAtlasProvider;
  morphology: MorphologyLoader;
  cache: SugarlangCompileCache;
  debounceMs?: number;
  onLog?: (message: string, detail?: Record<string, unknown>) => void;
}

export class SugarlangAuthoringCompileScheduler {
  private readonly pendingSceneIds = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;
  private readonly onLog?: SugarlangAuthoringCompileSchedulerOptions["onLog"];

  constructor(private readonly options: SugarlangAuthoringCompileSchedulerOptions) {
    this.debounceMs = options.debounceMs ?? 250;
    this.onLog = options.onLog;
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

  async flush(): Promise<CompiledSceneLexicon[]> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const requested = [...this.pendingSceneIds].sort((left, right) =>
      left.localeCompare(right)
    );
    this.pendingSceneIds.clear();
    const scenes = this.options
      .getScenes()
      .filter((scene) => requested.includes(scene.sceneId))
      .sort((left, right) => left.sceneId.localeCompare(right.sceneId));

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
    }

    return compiled;
  }

  start(): void {
    this.onLog?.("scheduler-started");
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pendingSceneIds.clear();
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
