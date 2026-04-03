import type { ReactNode } from "react";
import type {
  AssetDefinition,
  ContentLibrarySnapshot,
  DialogueDefinition,
  NPCDefinition,
  PlayerDefinition,
  SemanticCommand
} from "@sugarmagic/domain";
import { BuildSubNav, type BuildWorkspaceKindItem } from "@sugarmagic/ui";
import type { DesignWorkspaceKind } from "@sugarmagic/shell";
import type {
  NPCWorkspaceViewport,
  PlayerWorkspaceViewport
} from "../viewport";
import { useDialogueWorkspaceView } from "./DialogueWorkspaceView";
import { useNPCWorkspaceView } from "./NPCWorkspaceView";
import { usePlayerWorkspaceView } from "./PlayerWorkspaceView";

const designWorkspaceKinds: BuildWorkspaceKindItem[] = [
  { id: "player", label: "Player", icon: "🧙" },
  { id: "npcs", label: "NPCs", icon: "👤" },
  { id: "dialogues", label: "Dialogues", icon: "💬" }
];

export interface DesignProductModeViewProps {
  activeDesignKind: DesignWorkspaceKind;
  viewportReadyVersion: number;
  gameProjectId: string | null;
  playerDefinition: PlayerDefinition | null;
  npcDefinitions: NPCDefinition[];
  dialogueDefinitions: DialogueDefinition[];
  contentLibrary: ContentLibrarySnapshot | null;
  assetDefinitions: AssetDefinition[];
  assetSources: Record<string, string>;
  getPlayerViewport: () => PlayerWorkspaceViewport | null;
  getNPCViewport: () => NPCWorkspaceViewport | null;
  getViewportElement: () => HTMLElement | null;
  onSelectKind: (kind: DesignWorkspaceKind) => void;
  onCommand: (command: SemanticCommand) => void;
}

export interface DesignProductModeViewResult {
  subHeaderPanel: ReactNode;
  leftPanel: ReactNode | null;
  rightPanel: ReactNode;
  centerPanel?: ReactNode;
  viewportOverlay: ReactNode;
}

export function useDesignProductModeView(
  props: DesignProductModeViewProps
): DesignProductModeViewResult {
  const {
    activeDesignKind,
    viewportReadyVersion,
    gameProjectId,
    playerDefinition,
    npcDefinitions,
    dialogueDefinitions,
    contentLibrary,
    assetDefinitions,
    assetSources,
    getPlayerViewport,
    getNPCViewport,
    getViewportElement,
    onSelectKind,
    onCommand
  } = props;

  const playerView = usePlayerWorkspaceView({
    isActive: activeDesignKind === "player",
    viewportReadyVersion,
    gameProjectId,
    playerDefinition,
    contentLibrary,
    assetDefinitions,
    assetSources,
    getViewport: getPlayerViewport,
    getViewportElement,
    onCommand
  });

  const npcView = useNPCWorkspaceView({
    isActive: activeDesignKind === "npcs",
    viewportReadyVersion,
    gameProjectId,
    npcDefinitions,
    contentLibrary,
    assetDefinitions,
    assetSources,
    getViewport: getNPCViewport,
    getViewportElement,
    onCommand
  });

  const dialogueView = useDialogueWorkspaceView({
    isActive: activeDesignKind === "dialogues",
    gameProjectId,
    dialogueDefinitions,
    npcDefinitions,
    onCommand
  });

  return {
    subHeaderPanel: (
      <BuildSubNav
        workspaceKinds={designWorkspaceKinds}
        activeKindId={activeDesignKind}
        onSelectKind={(id) => onSelectKind(id as DesignWorkspaceKind)}
      />
    ),
    leftPanel:
      activeDesignKind === "dialogues"
        ? dialogueView.leftPanel
        : activeDesignKind === "npcs"
          ? npcView.leftPanel
          : playerView.leftPanel,
    rightPanel:
      activeDesignKind === "dialogues"
        ? dialogueView.rightPanel
        : activeDesignKind === "npcs"
          ? npcView.rightPanel
          : playerView.rightPanel,
    centerPanel:
      activeDesignKind === "dialogues" ? dialogueView.centerPanel : undefined,
    viewportOverlay:
      activeDesignKind === "dialogues"
        ? dialogueView.viewportOverlay
        : activeDesignKind === "npcs"
          ? npcView.viewportOverlay
          : playerView.viewportOverlay
  };
}
