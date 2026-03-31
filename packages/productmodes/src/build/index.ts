import type { ProductModeDescriptor } from "../product-mode";

export const buildProductMode: ProductModeDescriptor = {
  id: "build",
  label: "Build",
  summary: "Author the world as a place through region, landscape, and placement workflows.",
  workspaceKinds: [
    "RegionWorkspace",
    "LandscapeWorkspace",
    "MaterialAssignmentWorkspace"
  ],
  commandSurfaceId: "build-command-surface",
  panelLayoutId: "build-panel-layout"
};
