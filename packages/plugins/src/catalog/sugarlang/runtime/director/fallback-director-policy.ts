/**
 * packages/plugins/src/catalog/sugarlang/runtime/director/fallback-director-policy.ts
 *
 * Purpose: Reserves the deterministic fallback Director policy.
 *
 * Exports:
 *   - FallbackDirectorPolicy
 *
 * Relationships:
 *   - Implements the DirectorPolicy contract from runtime/contracts/providers.ts.
 *   - Will be consumed when Claude output is unavailable or invalid in Epic 9.
 *
 * Implements: Proposal 001 §3. Director
 *
 * Status: skeleton (no implementation yet; see Epic 9)
 */

import type {
  DirectorContext,
  DirectorPolicy,
  PedagogicalDirective
} from "../types";

export class FallbackDirectorPolicy implements DirectorPolicy {
  async invoke(
    _context: DirectorContext
  ): Promise<PedagogicalDirective> {
    throw new Error("TODO: Epic 9");
  }
}
