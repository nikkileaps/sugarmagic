/**
 * packages/plugins/src/catalog/sugarlang/runtime/director/claude-director-policy.ts
 *
 * Purpose: Reserves the Claude-backed structured-output Director policy.
 *
 * Exports:
 *   - ClaudeDirectorPolicy
 *
 * Relationships:
 *   - Implements the DirectorPolicy contract from runtime/contracts/providers.ts.
 *   - Will be consumed by SugarLangDirector once Epic 9 lands.
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

export class ClaudeDirectorPolicy implements DirectorPolicy {
  async invoke(
    _context: DirectorContext
  ): Promise<PedagogicalDirective> {
    throw new Error("TODO: Epic 9");
  }
}
