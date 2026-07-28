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
import type { SugarlangIntentCache, LineIntentCacheEntry } from "./intent-cache";
import { buildIntentContentHash } from "./intent-cache";
import type { ExtractIntentResult } from "./extract-intent";
import type { DialogueDefinition } from "@sugarmagic/domain";
import type { CEFRBand } from "../contracts/learner-profile";
import type { SugarlangVariantCache } from "./variant-cache";
import type { GenerateVariantInput, GenerateVariantResult } from "./generate-variant";
import type { BakedLineVariant } from "../contracts/baked-variant";

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

export interface SugarlangAuthoringIntentPipelineOptions {
  cache: SugarlangIntentCache;
  extractNodeIntent: (
    dialogueDefinitionId: string,
    node: { nodeId: string; text: string; intent?: import("@sugarmagic/domain").DialogueLineIntent },
    contentHash: string
  ) => Promise<ExtractIntentResult>;
  promptVersion: string;
  debounceMs?: number;
  telemetry?: TelemetrySink;
}

export interface SugarlangAuthoringVariantPipelineOptions {
  cache: SugarlangVariantCache;
  generateVariant: (input: GenerateVariantInput) => Promise<GenerateVariantResult>;
  promptVersion: string;
  /** Which bands to bake; default ["B1","B2","C1","C2"] */
  bands?: CEFRBand[];
  /** Which languages to bake for */
  languages: string[];
  debounceMs?: number;
  onVariantBaked?: (variant: BakedLineVariant) => void;
}

export interface SugarlangAuthoringCompileSchedulerOptions {
  getScenes: () => SceneAuthoringContext[];
  getDialogues?: () => DialogueDefinition[];
  atlas: LexicalAtlasProvider;
  morphology: MorphologyLoader;
  cache: SugarlangCompileCache;
  debounceMs?: number;
  chunkPipeline?: SugarlangAuthoringChunkPipelineOptions;
  intentPipeline?: SugarlangAuthoringIntentPipelineOptions;
  variantPipeline?: SugarlangAuthoringVariantPipelineOptions;
  onLog?: (message: string, detail?: Record<string, unknown>) => void;
}

const DEFAULT_VARIANT_BANDS: CEFRBand[] = ["B1", "B2", "C1", "C2"];

export class SugarlangAuthoringCompileScheduler {
  private readonly pendingSceneIds = new Set<string>();
  private readonly pendingChunkSceneIds = new Set<string>();
  private readonly pendingIntentDialogueIds = new Set<string>();
  private readonly pendingVariantDialogueIds = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chunkTimer: ReturnType<typeof setTimeout> | null = null;
  private intentTimer: ReturnType<typeof setTimeout> | null = null;
  private variantTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;
  private readonly chunkDebounceMs: number;
  private readonly intentDebounceMs: number;
  private readonly variantDebounceMs: number;
  private readonly onLog?: SugarlangAuthoringCompileSchedulerOptions["onLog"];
  private readonly chunkPipeline: SugarlangAuthoringChunkPipelineOptions | null;
  private readonly intentPipeline: SugarlangAuthoringIntentPipelineOptions | null;
  private readonly variantPipeline: SugarlangAuthoringVariantPipelineOptions | null;
  private readonly telemetry: TelemetrySink;

  constructor(private readonly options: SugarlangAuthoringCompileSchedulerOptions) {
    this.debounceMs = options.debounceMs ?? 250;
    this.chunkPipeline = options.chunkPipeline ?? null;
    this.intentPipeline = options.intentPipeline ?? null;
    this.variantPipeline = options.variantPipeline ?? null;
    this.chunkDebounceMs = this.chunkPipeline?.debounceMs ?? 5000;
    this.intentDebounceMs = this.intentPipeline?.debounceMs ?? 5000;
    this.variantDebounceMs = this.variantPipeline?.debounceMs ?? 10000;
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
    if (this.intentPipeline && this.options.getDialogues) {
      for (const dialogue of this.options.getDialogues()) {
        this.pendingIntentDialogueIds.add(dialogue.definitionId);
      }
    }
    if (this.variantPipeline && this.options.getDialogues) {
      for (const dialogue of this.options.getDialogues()) {
        this.pendingVariantDialogueIds.add(dialogue.definitionId);
      }
      this.armVariantTimer();
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

  private armIntentTimer(): void {
    if (!this.intentPipeline || this.pendingIntentDialogueIds.size === 0) {
      return;
    }

    if (this.intentTimer) {
      clearTimeout(this.intentTimer);
    }

    this.intentTimer = setTimeout(() => {
      void this.flushIntents();
    }, this.intentDebounceMs);
  }

  private armVariantTimer(): void {
    if (!this.variantPipeline || this.pendingVariantDialogueIds.size === 0) {
      return;
    }

    if (this.variantTimer) {
      clearTimeout(this.variantTimer);
    }

    this.variantTimer = setTimeout(() => {
      void this.flushVariants();
    }, this.variantDebounceMs);
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
    this.armIntentTimer();
    // Variant pipeline arms when dialogues are explicitly scheduled (via rebuildAll or
    // scheduleDialogue). Flush here only arms if pendingVariantDialogueIds is non-empty.
    this.armVariantTimer();
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

  async flushIntents(): Promise<void> {
    if (!this.intentPipeline || !this.options.getDialogues) {
      return;
    }

    if (this.intentTimer) {
      clearTimeout(this.intentTimer);
      this.intentTimer = null;
    }

    const requestedIds = [...this.pendingIntentDialogueIds].sort((left, right) =>
      left.localeCompare(right)
    );
    this.pendingIntentDialogueIds.clear();

    const allDialogues = this.options.getDialogues();
    const requestedSet = new Set(requestedIds);
    const dialogues = allDialogues
      .filter((d) => requestedSet.has(d.definitionId))
      .sort((left, right) => left.definitionId.localeCompare(right.definitionId));

    for (const dialogue of dialogues) {
      for (const node of dialogue.nodes) {
        const contentHash = buildIntentContentHash(node.nodeId, node.text, node.intent);

        const cacheKey = {
          contentHash,
          intentPromptVersion: this.intentPipeline.promptVersion
        };
        const cached = await this.intentPipeline.cache.get(cacheKey);
        if (cached) {
          this.onLog?.("intent-cache-hit", {
            dialogueDefinitionId: dialogue.definitionId,
            nodeId: node.nodeId
          });
          continue;
        }

        const result = await this.intentPipeline.extractNodeIntent(
          dialogue.definitionId,
          {
            nodeId: node.nodeId,
            text: node.text,
            intent: node.intent
          },
          contentHash
        );

        if (result.failure) {
          this.onLog?.("intent-extraction-failed", {
            dialogueDefinitionId: dialogue.definitionId,
            nodeId: node.nodeId,
            reason: result.failure.message
          });
        }

        const entry: LineIntentCacheEntry = {
          key: cacheKey,
          nodeId: node.nodeId,
          dialogueDefinitionId: dialogue.definitionId,
          artifact: result.artifact
        };
        await this.intentPipeline.cache.set(entry);

        this.onLog?.("intent-extracted", {
          dialogueDefinitionId: dialogue.definitionId,
          nodeId: node.nodeId,
          derived: result.artifact.derived,
          reviewFlag: result.artifact.reviewFlag
        });
      }
    }
  }

  async flushVariants(): Promise<void> {
    if (!this.variantPipeline || !this.options.getDialogues) {
      return;
    }

    if (this.variantTimer) {
      clearTimeout(this.variantTimer);
      this.variantTimer = null;
    }

    const requestedIds = [...this.pendingVariantDialogueIds].sort((left, right) =>
      left.localeCompare(right)
    );
    this.pendingVariantDialogueIds.clear();

    const allDialogues = this.options.getDialogues();
    const requestedSet = new Set(requestedIds);
    const dialogues = allDialogues
      .filter((d) => requestedSet.has(d.definitionId))
      .sort((left, right) => left.definitionId.localeCompare(right.definitionId));

    const bands = this.variantPipeline.bands ?? DEFAULT_VARIANT_BANDS;
    const languages = this.variantPipeline.languages;

    for (const dialogue of dialogues) {
      for (const node of dialogue.nodes) {
        // Intent excluded from variant contentHash: intent is embedded in the LLM
        // prompt and the runtime lookup (buildVariantContentHash) has no access to
        // the authored intent. Using {} here aligns bake and runtime key computation.
        const contentHash = [
          node.nodeId,
          node.text,
          JSON.stringify({})
        ].join("|");

        for (const lang of languages) {
          for (const band of bands) {
            const cacheKey = {
              lang,
              band,
              contentHash,
              variantPromptVersion: this.variantPipeline.promptVersion
            };

            const cached = await this.variantPipeline.cache.get(cacheKey);
            if (cached) {
              this.onLog?.("variant-cache-hit", {
                dialogueDefinitionId: dialogue.definitionId,
                nodeId: node.nodeId,
                lang,
                band
              });
              continue;
            }

            const result = await this.variantPipeline.generateVariant({
              authoredText: node.text,
              targetLang: lang,
              band,
              intent: null,
              contentHash,
              dialogueDefinitionId: dialogue.definitionId,
              nodeId: node.nodeId
            });

            if (!result.variant) {
              this.onLog?.("variant-generation-failed", {
                dialogueDefinitionId: dialogue.definitionId,
                nodeId: node.nodeId,
                lang,
                band,
                reason: result.failure?.message
              });
              continue;
            }

            await this.variantPipeline.cache.set({
              key: cacheKey,
              variant: result.variant
            });

            this.variantPipeline.onVariantBaked?.(result.variant);

            this.onLog?.("variant-baked", {
              dialogueDefinitionId: dialogue.definitionId,
              nodeId: node.nodeId,
              lang,
              band,
              reviewFlag: result.variant.reviewFlag
            });
          }
        }
      }
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
    if (this.intentTimer) {
      clearTimeout(this.intentTimer);
      this.intentTimer = null;
    }
    if (this.variantTimer) {
      clearTimeout(this.variantTimer);
      this.variantTimer = null;
    }
    this.pendingSceneIds.clear();
    this.pendingChunkSceneIds.clear();
    this.pendingIntentDialogueIds.clear();
    this.pendingVariantDialogueIds.clear();
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
