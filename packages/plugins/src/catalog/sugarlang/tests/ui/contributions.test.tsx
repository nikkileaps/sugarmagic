/**
 * packages/plugins/src/catalog/sugarlang/tests/ui/contributions.test.tsx
 *
 * Purpose: Verifies the Sugarlang shell contribution registry.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../ui/shell/contributions.
 *   - Guards Epic 12 contribution discovery without coupling tests to Studio internals.
 *
 * Implements: Epic 12 Story 12.6
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { sugarlangShellContributionDefinition } from "../../ui/shell/contributions";

describe("sugarlang shell contributions", () => {
  it("registers the Sugarlang workspace and all editor sections", () => {
    expect(sugarlangShellContributionDefinition.designWorkspaces).toEqual([
      expect.objectContaining({
        workspaceKind: "sugarlang",
        label: "Sugarlang"
      })
    ]);
    expect(
      sugarlangShellContributionDefinition.designSections?.map(
        (section) => section.sectionId
      )
    ).toEqual([
      "sugarlang-role",
      "scene-density",
      "placement-event-hint",
      "compile-status",
      "placement-question-bank"
    ]);
  });
});
