/**
 * packages/plugins/src/catalog/sugarlang/ui/shell/contributions.ts
 *
 * Purpose: Declares the empty shell contribution set reserved for sugarlang Studio UI surfaces.
 *
 * Exports:
 *   - sugarlangShellContributionDefinition
 *
 * Relationships:
 *   - Depends on the plugin shell contribution definition type.
 *   - Is consumed by manifest.ts as the shell contribution surface for Epic 1.
 *
 * Implements: Proposal 001 §Plugin contribution surface
 *
 * Status: skeleton (no implementation yet; see Epic 12)
 */

import type { PluginShellContributionDefinition } from "../../../../shell";

export const sugarlangShellContributionDefinition: PluginShellContributionDefinition =
  {
    projectSettings: [],
    designWorkspaces: [],
    designSections: [],
    npcInteractionOptions: []
  };
