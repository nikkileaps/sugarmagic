import type { ReactNode } from "react";
import type {
  AssetDefinition,
  ContentLibrarySnapshot,
  DocumentDefinition,
  DialogueDefinition,
  ItemDefinition,
  NPCDefinition,
  NPCInteractionMode,
  PlayerDefinition,
  QuestDefinition,
  SpellDefinition,
  SemanticCommand
} from "@sugarmagic/domain";
import { BuildSubNav, type BuildWorkspaceKindItem } from "@sugarmagic/ui";
import type { DesignWorkspaceKind } from "@sugarmagic/shell";
import type {
  ItemWorkspaceViewport,
  NPCWorkspaceViewport,
  PlayerWorkspaceViewport
} from "../viewport";
import { useDialogueWorkspaceView } from "./DialogueWorkspaceView";
import { useDocumentWorkspaceView } from "./DocumentWorkspaceView";
import { useItemWorkspaceView } from "./ItemWorkspaceView";
import { useNPCWorkspaceView } from "./NPCWorkspaceView";
import { usePlayerWorkspaceView } from "./PlayerWorkspaceView";
import { useQuestWorkspaceView } from "./QuestWorkspaceView";
import { useSpellWorkspaceView } from "./SpellWorkspaceView";

const designWorkspaceKinds: BuildWorkspaceKindItem[] = [
  { id: "player", label: "Player", icon: "🧙" },
  { id: "npcs", label: "NPCs", icon: "👤" },
  { id: "spells", label: "Spells", icon: "✨" },
  { id: "items", label: "Items", icon: "📦" },
  { id: "documents", label: "Documents", icon: "📚" },
  { id: "dialogues", label: "Dialogues", icon: "💬" },
  { id: "quests", label: "Quests", icon: "📜" }
];

export interface DesignProductModeViewProps {
  activeDesignKind: DesignWorkspaceKind;
  viewportReadyVersion: number;
  gameProjectId: string | null;
  playerDefinition: PlayerDefinition | null;
  spellDefinitions: SpellDefinition[];
  itemDefinitions: ItemDefinition[];
  documentDefinitions: DocumentDefinition[];
  npcDefinitions: NPCDefinition[];
  dialogueDefinitions: DialogueDefinition[];
  questDefinitions: QuestDefinition[];
  extraWorkspaceItems: Array<{
    workspaceKind: string;
    label: string;
    icon: string;
  }>;
  npcInteractionOptions: Array<{
    value: NPCInteractionMode;
    label: string;
    description?: string;
  }>;
  contentLibrary: ContentLibrarySnapshot | null;
  assetDefinitions: AssetDefinition[];
  assetSources: Record<string, string>;
  getPlayerViewport: () => PlayerWorkspaceViewport | null;
  getItemViewport: () => ItemWorkspaceViewport | null;
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
    spellDefinitions,
    itemDefinitions,
    documentDefinitions,
    npcDefinitions,
    dialogueDefinitions,
    questDefinitions,
    extraWorkspaceItems,
    npcInteractionOptions,
    contentLibrary,
    assetDefinitions,
    assetSources,
    getPlayerViewport,
    getItemViewport,
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
    interactionModeOptions: npcInteractionOptions,
    contentLibrary,
    assetDefinitions,
    assetSources,
    getViewport: getNPCViewport,
    getViewportElement,
    onCommand
  });

  const itemView = useItemWorkspaceView({
    isActive: activeDesignKind === "items",
    viewportReadyVersion,
    gameProjectId,
    itemDefinitions,
    documentDefinitions,
    contentLibrary,
    assetDefinitions,
    assetSources,
    getViewport: getItemViewport,
    getViewportElement,
    onCommand
  });

  const spellView = useSpellWorkspaceView({
    isActive: activeDesignKind === "spells",
    gameProjectId,
    spellDefinitions,
    assetDefinitions,
    onCommand
  });

  const documentView = useDocumentWorkspaceView({
    isActive: activeDesignKind === "documents",
    gameProjectId,
    documentDefinitions,
    onCommand
  });

  const dialogueView = useDialogueWorkspaceView({
    isActive: activeDesignKind === "dialogues",
    gameProjectId,
    dialogueDefinitions,
    itemDefinitions,
    npcDefinitions,
    spellDefinitions,
    onCommand
  });

  const questView = useQuestWorkspaceView({
    isActive: activeDesignKind === "quests",
    gameProjectId,
    questDefinitions,
    dialogueDefinitions,
    itemDefinitions,
    npcDefinitions,
    spellDefinitions,
    onCommand
  });

  const allWorkspaceKinds: BuildWorkspaceKindItem[] = [
    ...designWorkspaceKinds,
    ...extraWorkspaceItems.map((workspace) => ({
      id: workspace.workspaceKind,
      label: workspace.label,
      icon: workspace.icon
    }))
  ];

  return {
    subHeaderPanel: (
      <BuildSubNav
        workspaceKinds={allWorkspaceKinds}
        activeKindId={activeDesignKind}
        onSelectKind={(id) => onSelectKind(id as DesignWorkspaceKind)}
      />
    ),
    leftPanel:
      activeDesignKind === "dialogues"
        ? dialogueView.leftPanel
        : activeDesignKind === "quests"
          ? questView.leftPanel
          : activeDesignKind === "npcs"
            ? npcView.leftPanel
            : activeDesignKind === "spells"
              ? spellView.leftPanel
            : activeDesignKind === "items"
              ? itemView.leftPanel
              : activeDesignKind === "documents"
                ? documentView.leftPanel
            : playerView.leftPanel,
    rightPanel:
      activeDesignKind === "dialogues"
        ? dialogueView.rightPanel
        : activeDesignKind === "quests"
          ? questView.rightPanel
          : activeDesignKind === "npcs"
            ? npcView.rightPanel
            : activeDesignKind === "spells"
              ? spellView.rightPanel
            : activeDesignKind === "items"
              ? itemView.rightPanel
              : activeDesignKind === "documents"
                ? documentView.rightPanel
            : playerView.rightPanel,
    centerPanel:
      activeDesignKind === "dialogues"
        ? dialogueView.centerPanel
        : activeDesignKind === "quests"
          ? questView.centerPanel
          : activeDesignKind === "spells"
            ? spellView.centerPanel
          : activeDesignKind === "documents"
            ? documentView.centerPanel
          : undefined,
    viewportOverlay:
      activeDesignKind === "dialogues"
        ? dialogueView.viewportOverlay
        : activeDesignKind === "quests"
          ? questView.viewportOverlay
          : activeDesignKind === "spells"
            ? spellView.viewportOverlay
          : activeDesignKind === "documents"
            ? documentView.viewportOverlay
          : activeDesignKind === "npcs"
            ? npcView.viewportOverlay
            : activeDesignKind === "items"
              ? itemView.viewportOverlay
            : playerView.viewportOverlay
  };
}
