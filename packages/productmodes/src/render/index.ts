import type { ProductModeDescriptor } from "../product-mode";

export const renderProductMode: ProductModeDescriptor = {
  id: "render",
  label: "Render",
  summary: "Author presentation, VFX, and polish-oriented runtime-facing output.",
  workspaceKinds: ["VfxWorkspace", "PresentationWorkspace"],
  commandSurfaceId: "render-command-surface",
  panelLayoutId: "render-panel-layout"
};
