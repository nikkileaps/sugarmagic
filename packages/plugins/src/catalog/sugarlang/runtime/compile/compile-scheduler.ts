/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/compile-scheduler.ts
 *
 * Purpose: Reserves the authoring-time compile scheduler used to keep scene lexicons warm in Studio.
 *
 * Exports:
 *   - SugarlangAuthoringCompileScheduler
 *
 * Relationships:
 *   - Depends on the compile entry point and cache interfaces.
 *   - Will be consumed by Studio-side preview flows once Epic 6 lands.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 *
 * Status: skeleton (no implementation yet; see Epic 6)
 */

export class SugarlangAuthoringCompileScheduler {
  start(): void {
    throw new Error("TODO: Epic 6");
  }

  stop(): void {
    throw new Error("TODO: Epic 6");
  }
}
