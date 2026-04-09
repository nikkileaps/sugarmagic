/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/scene-traversal.ts
 *
 * Purpose: Reserves the authored-content traversal used to collect scene text for compilation.
 *
 * Exports:
 *   - collectSceneText
 *
 * Relationships:
 *   - Will be consumed by compileSugarlangScene once Epic 6 lands.
 *   - Sits upstream of lexical chunk extraction and compile hashing.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 *
 * Status: skeleton (no implementation yet; see Epic 6)
 */

export function collectSceneText(_scene: unknown): string[] {
  throw new Error("TODO: Epic 6");
}
