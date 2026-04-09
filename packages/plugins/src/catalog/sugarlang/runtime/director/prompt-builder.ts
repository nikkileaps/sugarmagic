/**
 * packages/plugins/src/catalog/sugarlang/runtime/director/prompt-builder.ts
 *
 * Purpose: Reserves the context-to-prompt assembly function for the Director.
 *
 * Exports:
 *   - buildDirectorPrompt
 *
 * Relationships:
 *   - Depends on the DirectorContext provider contract.
 *   - Will be consumed by ClaudeDirectorPolicy once Epic 9 lands.
 *
 * Implements: Proposal 001 §3. Director
 *
 * Status: skeleton (no implementation yet; see Epic 9)
 */

import type { DirectorContext } from "../types";

export function buildDirectorPrompt(_context: DirectorContext): string {
  throw new Error("TODO: Epic 9");
}
