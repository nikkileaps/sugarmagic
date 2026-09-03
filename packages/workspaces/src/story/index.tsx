/**
 * packages/workspaces/src/story/index.tsx
 *
 * Purpose: the Story product mode -- the narrative side of a project.
 *
 * Three workspaces: `structure` (the Episodes a project has and the
 * Scenes each holds), `quests` (the quests those Scenes contain), and
 * `dialogues`. Quests and dialogue moved here from Design in epic #226:
 * Design keeps the definitions that exist independent of a story -- an
 * NPC, an item, a spell -- while the story itself lives here.
 *
 * The quest and dialogue workspaces are the SAME views Design rendered.
 * They moved modes, not implementations.
 *
 * Exports:
 *   - storyWorkspaceKinds
 *   - useStoryProductModeView
 *
 * Status: active
 */

import type { ReactNode } from "react";
import { BuildSubNav, type BuildWorkspaceKindItem } from "@sugarmagic/ui";
import type { Episode } from "@sugarmagic/domain";
import { EpisodeGraphView } from "./EpisodeGraphView";
import { useDialogueWorkspaceView } from "../design/DialogueWorkspaceView";
import { useQuestWorkspaceView } from "../design/QuestWorkspaceView";

export const storyWorkspaceKinds: BuildWorkspaceKindItem[] = [
  { id: "structure", label: "Structure", icon: "🗂️" },
  { id: "episode-graph", label: "Episode Graph", icon: "🕸️" },
  { id: "composer", label: "Composer", icon: "🎬" },
  { id: "quests", label: "Quests", icon: "📜" },
  { id: "dialogues", label: "Dialogues", icon: "💬" }
];

export interface StoryProductModeViewProps {
  activeStoryKind: string;
  onSelectKind: (kind: string) => void;
  /**
   * The Episodes-and-Scenes editing surface, rendered by the app: it
   * shares the runtime's transition-card styling constants, which this
   * package may not import.
   */
  structurePanel: ReactNode;
  /** The composer's side panel: Scene picker plus what the region owns.
   *  Rendered by the app for the same reason the structure panel is. */
  composerPanel: ReactNode;
  /** The Episode whose quests the graph draws: the one holding the Scene
   *  the author is working in. Null before a project is open. */
  graphEpisode: Episode | null;
  quests: Parameters<typeof useQuestWorkspaceView>[0];
  dialogues: Parameters<typeof useDialogueWorkspaceView>[0];
}

export interface StoryProductModeViewResult {
  subHeaderPanel: ReactNode;
  leftPanel: ReactNode | null;
  rightPanel: ReactNode;
  centerPanel?: ReactNode;
}

export function useStoryProductModeView(
  props: StoryProductModeViewProps
): StoryProductModeViewResult {
  const {
    activeStoryKind,
    onSelectKind,
    structurePanel,
    composerPanel,
    graphEpisode,
    quests,
    dialogues
  } = props;

  const questView = useQuestWorkspaceView({
    ...quests,
    isActive: activeStoryKind === "quests"
  });
  const dialogueView = useDialogueWorkspaceView({
    ...dialogues,
    isActive: activeStoryKind === "dialogues"
  });

  return {
    subHeaderPanel: (
      <BuildSubNav
        workspaceKinds={storyWorkspaceKinds}
        activeKindId={activeStoryKind}
        onSelectKind={onSelectKind}
      />
    ),
    leftPanel:
      activeStoryKind === "composer"
        ? composerPanel
        : activeStoryKind === "quests"
          ? questView.leftPanel
          : activeStoryKind === "dialogues"
            ? dialogueView.leftPanel
            : null,
    rightPanel:
      activeStoryKind === "quests"
        ? questView.rightPanel
        : activeStoryKind === "dialogues"
          ? dialogueView.rightPanel
          : null,
    centerPanel:
      activeStoryKind === "quests"
        ? questView.centerPanel
        : activeStoryKind === "dialogues"
          ? dialogueView.centerPanel
          : activeStoryKind === "composer"
            ? // The composer stages the Scene in the shared viewport,
              // which App renders when no centerPanel claims the space.
              undefined
            : activeStoryKind === "episode-graph"
              ? // Read-only: how this Episode's quests connect, drawn from
                // their start conditions. Quests are edited in Quests.
                <EpisodeGraphView episode={graphEpisode} />
              : // Structure is master-detail in one surface: the Episode
                // and Scene lists and the editor for whichever is selected.
                structurePanel
  };
}
