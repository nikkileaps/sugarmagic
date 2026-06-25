import type { ProductModeDescriptor } from "../product-mode";

// Story 46.1 — top-level Publish productmode.
//
// Studio core ships this mode plus a single baseline `package` workspace
// (one button: produces a self-contained playable artifact via the
// `targets/web/` Vite build with no gateway URL configured). Plugins
// like SugarDeploy contribute additional workspaces into the same
// productmode (Provision / Release / Deploy) for hosted publish flows.
//
// `workspaceKinds` lists the kinds Studio core itself contributes;
// plugin-contributed workspaces append to this list at render time
// via the existing plugin shell-contribution mechanism.
export const publishProductMode: ProductModeDescriptor = {
  id: "publish",
  label: "Publish",
  summary:
    "Package and ship the game. Local artifact out of the box; hosted publish via SugarDeploy and other publish plugins.",
  workspaceKinds: ["package"],
  commandSurfaceId: "publish-command-surface",
  panelLayoutId: "publish-panel-layout"
};
