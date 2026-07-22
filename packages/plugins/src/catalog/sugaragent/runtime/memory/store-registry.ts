/**
 * packages/plugins/src/catalog/sugaragent/runtime/memory/store-registry.ts
 *
 * Purpose: a process-wide accessor that returns ONE NpcMemoryStore
 * per (userId, playthroughId). Both the end-of-conversation writer
 * (073.2, at dispose) and the memory middleware reader (073.3) must
 * share the same store instance so their operations serialize on one
 * promise chain (Plan 073 §D3) — an immediate re-talk's load then
 * orders behind the just-issued deterministic merge, even before the
 * IndexedDB write flushes.
 *
 * Identity defaults to the runtime-core registries
 * (`getActiveUserId` / `getActivePlaythroughId`), which the host
 * settles at boot. Returns `null` when identity isn't ready — callers
 * treat that as "memory unavailable this turn" and no-op.
 *
 * ## Reset on playthrough change (Plan 073 §D1)
 *
 * When the resolved playthroughId differs from the cached one (a New
 * Game minted a fresh id), a new store is constructed and its
 * `reset()` prunes the prior playthrough's rows. Sugarmagic keeps a
 * single save per user (the save store is keyed by userId), so there
 * is never a second concurrent playthrough whose memory this would
 * discard.
 *
 * Implements: Plan 073 §073.2
 *
 * Status: active
 */

import {
  getActivePlaythroughId,
  getActiveUserId
} from "@sugarmagic/runtime-core";
import { NpcMemoryStore, type NpcMemoryStoreOptions } from "./npc-memory-store";

let cached: { key: string; store: NpcMemoryStore } | null = null;

export interface ResolveNpcMemoryStoreOptions {
  /** Override the resolved userId (tests / explicit wiring). */
  userId?: string | null;
  /** Override the resolved playthroughId (tests / explicit wiring). */
  playthroughId?: string | null;
  /** Passthrough store construction options (backend, IDB factory). */
  storeOptions?: Omit<NpcMemoryStoreOptions, "userId" | "playthroughId">;
}

/**
 * The shared NpcMemoryStore for the active (userId, playthroughId),
 * or `null` when identity is not yet resolved.
 */
export function resolveNpcMemoryStore(
  options: ResolveNpcMemoryStoreOptions = {}
): NpcMemoryStore | null {
  const userId = options.userId ?? getActiveUserId();
  const playthroughId = options.playthroughId ?? getActivePlaythroughId();
  if (!userId || !playthroughId) return null;

  const key = `${userId}::${playthroughId}`;
  if (cached && cached.key === key) return cached.store;

  const store = new NpcMemoryStore({
    userId,
    playthroughId,
    ...(options.storeOptions ?? {})
  });
  // New playthrough detected on resolve: prune the prior playthrough's
  // rows for this user. Fire-and-forget — pruning must not block the
  // caller, and a failure just leaves orphaned rows (harmless; keying
  // already isolates the current playthrough's reads).
  void store.reset().catch(() => {});
  cached = { key, store };
  return store;
}

/** Test-only reset of the module cache. */
export function clearNpcMemoryStoreCacheForTests(): void {
  cached = null;
}
