/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/live-render-cache.ts
 *
 * Purpose: In-memory cache for live-rendered scripted-line variants. No IDB --
 *          live-render output is derivable state; it does not need persistence.
 *
 * Exports:
 *   - LiveRenderCacheKey
 *   - LiveRenderCacheEntry
 *   - LiveRenderCache
 *   - buildTeachablesKey
 *
 * Implements: Epic 086 Story 086.5 -- directed live render path (dormant stub)
 *
 * Status: active
 */

import type { CEFRBand } from "../contracts/learner-profile";
import type { SupportPosture } from "../contracts/pedagogy";
import type { VariantVerdict } from "../contracts/baked-variant";

export interface LiveRenderCacheKey {
  nodeId: string;
  dialogueDefinitionId: string;
  lang: string;
  band: CEFRBand;
  posture: SupportPosture;
  /** Stable key derived from constraint.targetVocab.introduce lemmaIds sorted and joined. */
  teachablesKey: string;
}

export interface LiveRenderCacheEntry {
  text: string;
  verdict: VariantVerdict;
  cachedAtMs: number;
}

/**
 * Builds a stable, order-independent key for the introduce (teachables) list.
 * Sorts lemmaIds before joining so a reordered list yields the same key.
 */
export function buildTeachablesKey(introduce: Array<{ lemmaId: string }>): string {
  const sorted = introduce.map((item) => item.lemmaId).sort();
  return sorted.join(",");
}

export class LiveRenderCache {
  private readonly store = new Map<string, LiveRenderCacheEntry>();

  private static buildKey(k: LiveRenderCacheKey): string {
    return `${k.nodeId}|${k.dialogueDefinitionId}|${k.lang}|${k.band}|${k.posture}|${k.teachablesKey}`;
  }

  get(k: LiveRenderCacheKey): LiveRenderCacheEntry | null {
    return this.store.get(LiveRenderCache.buildKey(k)) ?? null;
  }

  set(k: LiveRenderCacheKey, entry: LiveRenderCacheEntry): void {
    this.store.set(LiveRenderCache.buildKey(k), entry);
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}
