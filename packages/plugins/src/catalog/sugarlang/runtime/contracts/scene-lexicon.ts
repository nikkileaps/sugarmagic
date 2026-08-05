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
 *   - SceneVocabularyModel
 *
 * Relationships:
 *   - Depends on runtime compile-profile and learner-profile types.
 *   - Is consumed by the compiler, budgeter, and teacher stubs.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 *
 * Status: active
 */

import type { RuntimeCompileProfile } from "@sugarmagic/runtime-core/materials";
import type { CEFRBand } from "../cefr";

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
 * Per-lemma scene artifact entry used by the Budgeter and Teacher.
 *
 * 090.2c DELETED `cefrPriorBand`, `frequencyRank` and `partsOfSpeech` from this
 * type. All three were verbatim copies of atlas data written by
 * `createSceneLemmaInfo(entry: AtlasLemmaEntry)` -- the atlas already owns them,
 * and a second stored copy is the one-source-of-truth rule broken in the small.
 * Readers look them up by `lemmaId` instead.
 *
 * WHAT IS STILL HERE, AND WHEN IT GOES (090.10)
 *   `sceneWeight` and `npcSourceIds` exist ONLY to rank candidates inside the
 *   budgeter (scoring.ts). The model hands ranking to the Teacher, so they die
 *   when `prescribe()` does -- and not before, because the budgeter is still on
 *   the live path (`sugar-lang-context-middleware.ts` calls
 *   `services.budgeter.prescribe`). `SceneVocabularyModel.anchors` is in the
 *   same position.
 *
 *   REVISIT TRIGGER: when 090.10 deletes `prescribe()`, this whole type goes
 *   with it. `lemmas: Record<string, SceneLemmaInfo>` collapses to
 *   `lemmaIds: string[]` and the artifact becomes an INDEX INTO the atlas rather
 *   than a subset OF it -- which is when it earns the name
 *   `SceneVocabularyModel`. Do not attempt that collapse earlier: three of these
 *   fields have a live consumer until then.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 *   + Plan 090 story 090.2c
 */
// 090.2d: `SceneLemmaInfo` DELETED. Of its five fields, three were verbatim
// atlas copies (removed in 090.2c), and `sceneWeight` / `npcSourceIds` existed
// only for budgeter ranking. `isQuestCritical` turned out to be written by the
// compiler and read by nothing at all. What survives is the lemma id, so the
// record collapses to a list of them -- an INDEX INTO the atlas rather than a
// subset OF it, which is the point at which the name stops lying.

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
  /**
   * Routing record, NOT a model id. The gateway resolves the model server-side
   * from `purpose` and its response carries no model name, so a compile-time
   * caller cannot know which model ran -- this reads "gateway-resolved". The
   * ground truth is the gateway's own `sugaragent.generate` log line.
   */
  extractedByModel: string;
  extractedAtMs: number;
  extractorPromptVersion: string;
  source: "llm-extracted";
}

/**
 * NPC voice-channel metadata extracted from the "Voice" lore section at compile time.
 * interjections are exempt from the A1 envelope rule via the "voice-interjection" exemption kind.
 * hasGestureTags drives textConventions.preserveActionTags in the teacher contribution.
 *
 * Implements: Plan 083 story 083.3
 */
export interface VoiceChannelSpec {
  /** Normalized (NFC, lowercase) interjection tokens whitelisted from envelope enforcement. */
  interjections: string[];
  /** True when the Voice section's exemplar lines contain *...* gesture-tag spans. */
  hasGestureTags: boolean;
}

/**
 * Canonical compiled artifact for one scene under one compile profile.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 */
export interface SceneVocabularyModel {
  sceneId: string;
  contentHash: string;
  pipelineVersion: string;
  atlasVersion: string;
  profile: RuntimeCompileProfile;
  /** 090.2d: was `lemmas: Record<string, SceneLemmaInfo>`. */
  lemmaIds: string[];
  properNouns: string[];
  questEssentialLemmas: QuestEssentialLemma[];
  sources?: Record<string, SourceLocation[]>;
  diagnostics?: SceneAuthorWarning[];
  /**
   * Optional chunk layer populated asynchronously by Epic 14.
   * Absent means the classifier should run in lemma-only mode.
   */
  chunks?: LexicalChunk[];
  /**
   * Per-NPC voice-channel specs keyed by NPCDefinition.definitionId.
   * Populated at compile time from "Voice" lore page sections. Absent when no NPC
   * in the scene has a Voice section.
   */
  npcVoiceSpecs?: Record<string, VoiceChannelSpec>;
}
