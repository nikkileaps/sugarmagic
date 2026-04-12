/**
 * packages/runtime-core/src/debug-hud/index.ts
 *
 * Purpose: Exposes the Preview-only runtime debug HUD UI module.
 *
 * Exports:
 *   - createRuntimeDebugHud
 *   - RuntimeDebugHud
 *
 * Relationships:
 *   - Depends on runtime-core plugin/debug contracts and gameplay-session snapshots.
 *   - Is instantiated only by the web host in Preview mode.
 *
 * Status: active
 */

export * from "./DebugHud";
