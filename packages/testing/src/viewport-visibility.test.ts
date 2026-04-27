/**
 * Studio viewport visibility regression tests.
 *
 * Verifies the single rule used by App to decide whether the shared center
 * viewport DOM is present. This specifically guards the Surfaces-workspace
 * regression where replacing the center panel detached the viewport without a
 * matching remount.
 */

import { describe, expect, it } from "vitest";
import { shouldShowSharedViewport } from "../../../apps/studio/src/viewport/viewportVisibility";

describe("Studio shared viewport visibility", () => {
  it("hides the shared viewport while Surfaces owns the center panel", () => {
    expect(
      shouldShowSharedViewport({
        phase: "active",
        activeProductMode: "build",
        activeBuildKind: "surfaces",
        activeDesignKind: "player",
        buildCenterPanelVisible: true,
        designCenterPanelVisible: false
      })
    ).toBe(false);
  });

  it("shows the shared viewport again for viewport-backed build workspaces", () => {
    expect(
      shouldShowSharedViewport({
        phase: "active",
        activeProductMode: "build",
        activeBuildKind: "layout",
        activeDesignKind: "player",
        buildCenterPanelVisible: false,
        designCenterPanelVisible: false
      })
    ).toBe(true);
  });

  it("keeps non-viewport design workspaces out of the shared viewport", () => {
    expect(
      shouldShowSharedViewport({
        phase: "active",
        activeProductMode: "design",
        activeBuildKind: "layout",
        activeDesignKind: "dialogues",
        buildCenterPanelVisible: false,
        designCenterPanelVisible: true
      })
    ).toBe(false);
  });
});
