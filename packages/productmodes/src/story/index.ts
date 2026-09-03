import type { ProductModeDescriptor } from "../product-mode";

/**
 * The narrative side of a project: Episodes and the Scenes they hold,
 * the quests each Scene contains, and the dialogue those quests use.
 *
 * Separate from Design because Design authors DEFINITIONS that exist
 * independent of the story -- an NPC, an item, a spell -- while this mode
 * authors the story itself and what happens where (epic #226).
 */
export const storyProductMode: ProductModeDescriptor = {
  id: "story",
  label: "Story",
  summary: "Author episodes, scenes, the quests in them, and their dialogue.",
  workspaceKinds: [
    "structure",
    "episode-graph",
    "composer",
    "quests",
    "dialogues"
  ],
  commandSurfaceId: "story-command-surface",
  panelLayoutId: "story-panel-layout"
};
