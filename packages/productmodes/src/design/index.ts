import type { ProductModeDescriptor } from "../product-mode";

export const designProductMode: ProductModeDescriptor = {
  id: "design",
  label: "Design",
  summary: "Author game meaning, progression, dialogue, and systemic content.",
  workspaceKinds: ["player", "npcs", "items", "dialogues", "quests"],
  commandSurfaceId: "design-command-surface",
  panelLayoutId: "design-panel-layout"
};
