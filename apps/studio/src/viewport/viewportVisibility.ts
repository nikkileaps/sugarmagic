/**
 * Studio viewport visibility rules.
 *
 * Owns the single rule deciding whether the shared center viewport DOM should
 * be present for the current Studio workspace selection. App uses this both
 * for React layout and viewport lifecycle so center-panel swaps cannot orphan
 * an already-mounted render view on a detached DOM node.
 */

import type { BuildWorkspaceKind, DesignWorkspaceKind } from "@sugarmagic/shell";
import { designWorkspaceRequiresViewport } from "@sugarmagic/shell";
import type { ProductModeId } from "@sugarmagic/productmodes";

export interface SharedViewportVisibilityOptions {
  phase: "no-project" | "loading" | "active" | "error";
  activeProductMode: ProductModeId;
  activeBuildKind: BuildWorkspaceKind;
  activeDesignKind: DesignWorkspaceKind;
  buildCenterPanelVisible: boolean;
  designCenterPanelVisible: boolean;
  activeStoryKind: string;
}

export function shouldShowSharedViewport(
  options: SharedViewportVisibilityOptions
): boolean {
  if (options.phase !== "active") {
    return false;
  }

  if (options.activeProductMode === "render") {
    return false;
  }

  if (options.activeProductMode === "design") {
    return (
      designWorkspaceRequiresViewport(options.activeDesignKind) &&
      !options.designCenterPanelVisible
    );
  }

  if (options.activeProductMode === "build") {
    return !options.buildCenterPanelVisible;
  }

  // The scene composer stages a Scene in the world, so it needs the same
  // viewport Build uses. Story's other workspaces are panels.
  if (options.activeProductMode === "story") {
    return options.activeStoryKind === "composer";
  }

  return false;
}
