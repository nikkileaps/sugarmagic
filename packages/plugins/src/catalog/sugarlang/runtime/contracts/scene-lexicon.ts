/**
 * packages/plugins/src/catalog/sugarlang/runtime/contracts/scene-lexicon.ts
 *
 * Purpose: Declares the compiled scene-lexicon types produced by the sugarlang compiler.
 *
 * Exports:
 *   - SourceLocation
 *   - SceneAuthorWarning
 *   - SceneLemmaInfo
 *   - CompiledSceneLexicon
 *
 * Relationships:
 *   - Depends on lexical-prescription types for lemma references.
 *   - Is consumed by the compiler, budgeter, and director stubs.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 *
 * Status: skeleton (no implementation yet; see Epic 3)
 */

import type { LemmaRef } from "./lexical-prescription";

export interface SourceLocation {
  sourceKind: string;
  sourceId: string;
  line?: number;
}

export interface SceneAuthorWarning {
  warningId: string;
  message: string;
}

export interface SceneLemmaInfo {
  lemmaRef: LemmaRef;
  cefrBand: string;
  isSceneAnchor: boolean;
  sourceLocations: SourceLocation[];
}

export interface CompiledSceneLexicon {
  sceneId: string;
  language: string;
  contentHash: string;
  lemmas: SceneLemmaInfo[];
  warnings: SceneAuthorWarning[];
}
