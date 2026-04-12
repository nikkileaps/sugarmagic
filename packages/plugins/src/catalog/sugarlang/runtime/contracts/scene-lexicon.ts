/**
 * packages/plugins/src/catalog/sugarlang/runtime/contracts/scene-lexicon.ts
 *
 * Purpose: Declares the compiled scene-lexicon types produced by the sugarlang compiler.
 *
 * Exports:
 *   - CompileCacheKey
 *   - SceneAuthorWarningSeverity
 *   - SourceLocation
 *   - SceneAuthorWarning
 *   - SceneLemmaInfo
 *   - QuestEssentialLemma
 *   - LexicalChunk
 *   - CompiledSceneLexicon
 *
 * Relationships:
 *   - Depends on runtime compile-profile and learner-profile types.
 *   - Is consumed by the compiler, budgeter, and director stubs.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 *
 * Status: active
 */

import type { RuntimeCompileProfile } from "@sugarmagic/runtime-core/materials";
import type { CEFRBand } from "./learner-profile";

/**
 * Canonical cache-key shape for compiled scene lexicons.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 */
export type CompileCacheKey = string;

/**
 * Diagnostic severity emitted by the scene compiler.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 */
export type SceneAuthorWarningSeverity = "info" | "warning" | "error";

/**
 * Source location for a compiled lemma or warning.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 */
export interface SourceLocation {
  file: string;
  lineStart: number;
  lineEnd: number;
  snippet: string;
}

/**
 * Author-facing diagnostic emitted during scene lexicon compilation.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 */
export interface SceneAuthorWarning {
  severity: SceneAuthorWarningSeverity;
  message: string;
  sceneId: string;
  lemmaId?: string;
  suggestion?: string;
}

/**
 * Per-lemma scene artifact entry used by the Budgeter and Director.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 */
export interface SceneLemmaInfo {
  lemmaId: string;
  cefrPriorBand: CEFRBand;
  frequencyRank: number | null;
  partsOfSpeech: string[];
  isQuestCritical: boolean;
  /** Accumulated scene relevance weight. Higher values mean the lemma appears
   *  more often and/or in higher-weight sources (dialogue, quest objectives, NPC lore).
   *  Used by the budgeter to prioritize contextually relevant vocabulary. */
  sceneWeight: number;
  /** NPC definition IDs whose lore/bio contributed to this lemma's scene weight.
   *  Used by the budgeter to boost words from the NPC the player is currently
   *  talking to over words from other NPCs in the scene. */
  npcSourceIds: string[];
}

/**
 * Quest-objective lemma that bypasses the normal envelope ceiling.
 *
 * Implements: Proposal 001 §Quest-Essential Lemma Exemption
 */
export interface QuestEssentialLemma {
  lemmaId: string;
  lang: string;
  cefrBand: CEFRBand;
  sourceQuestId: string;
  sourceObjectiveNodeId: string;
  sourceObjectiveDisplayName: string;
}

/**
 * Multi-word communicative chunk extracted asynchronously from scene content.
 *
 * Implements: Proposal 001 §Lexical Chunk Awareness
 */
export interface LexicalChunk {
  chunkId: string;
  normalizedForm: string;
  surfaceForms: string[];
  cefrBand: CEFRBand;
  constituentLemmas: string[];
  extractedByModel: string;
  extractedAtMs: number;
  extractorPromptVersion: string;
  source: "llm-extracted";
}

/**
 * Canonical compiled artifact for one scene under one compile profile.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 */
export interface CompiledSceneLexicon {
  sceneId: string;
  contentHash: string;
  pipelineVersion: string;
  atlasVersion: string;
  profile: RuntimeCompileProfile;
  lemmas: Record<string, SceneLemmaInfo>;
  properNouns: string[];
  anchors: string[];
  questEssentialLemmas: QuestEssentialLemma[];
  sources?: Record<string, SourceLocation[]>;
  diagnostics?: SceneAuthorWarning[];
  /**
   * Optional chunk layer populated asynchronously by Epic 14.
   * Absent means the classifier should run in lemma-only mode.
   */
  chunks?: LexicalChunk[];
}
