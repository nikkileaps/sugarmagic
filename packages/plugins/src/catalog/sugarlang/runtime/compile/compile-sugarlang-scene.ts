/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/compile-sugarlang-scene.ts
 *
 * Purpose: Reserves the single scene-compilation entry point for sugarlang lexicons.
 *
 * Exports:
 *   - compileSugarlangScene
 *
 * Relationships:
 *   - Depends on the compiled scene-lexicon and provider contract types.
 *   - Will be consumed by preview, publish, and runtime profile flows in Epic 6.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 *
 * Status: skeleton (no implementation yet; see Epic 6)
 */

import type { RuntimeCompileProfile } from "@sugarmagic/runtime-core/materials";
import type { CompiledSceneLexicon, LexicalAtlasProvider } from "../types";

export function compileSugarlangScene(
  _scene: unknown,
  _atlas: LexicalAtlasProvider,
  _profile: RuntimeCompileProfile
): CompiledSceneLexicon {
  throw new Error("TODO: Epic 6");
}
