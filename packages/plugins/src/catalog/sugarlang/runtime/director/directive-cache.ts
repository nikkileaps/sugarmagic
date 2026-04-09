/**
 * packages/plugins/src/catalog/sugarlang/runtime/director/directive-cache.ts
 *
 * Purpose: Reserves the active-directive cache manager used by the Director middleware.
 *
 * Exports:
 *   - DirectiveCache
 *
 * Relationships:
 *   - Depends on the PedagogicalDirective contract type.
 *   - Will be consumed by the Director middleware in Epic 9 and Epic 10.
 *
 * Implements: Proposal 001 §3. Director / §End-to-End Turn Flow
 *
 * Status: skeleton (no implementation yet; see Epic 9)
 */

import type { PedagogicalDirective } from "../types";

export class DirectiveCache {
  getCurrent(): PedagogicalDirective | null {
    throw new Error("TODO: Epic 9");
  }

  setCurrent(_directive: PedagogicalDirective): void {
    throw new Error("TODO: Epic 9");
  }

  clear(): void {
    throw new Error("TODO: Epic 9");
  }
}
