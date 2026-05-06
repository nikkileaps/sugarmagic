/**
 * Runtime VFX system.
 *
 * Runtime-core owns particle lifecycle and simulation. Render targets consume
 * emitter snapshots and are responsible only for turning those snapshots into
 * platform-specific draw calls.
 */

export * from "./types";
export * from "./VFXEmitter";
export * from "./VFXManager";
export * from "./VFXDispatcher";
