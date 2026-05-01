/**
 * packages/workspaces/src/design/index.tsx
 *
 * Purpose: Builds the Design product-mode workspace contribution set.
 *
 * Exports:
 *   - DesignProductModeViewProps
 *   - DesignProductModeViewResult
 *   - useDesignProductModeView
 *
 * Relationships:
 *   - Composes the player, NPC, spell, item, document, dialogue, and quest workspaces.
 *   - Accepts plugin-owned inspector section renderers so Studio can mount shell contributions without hardcoding plugin behavior.
 *
 * Implements: Studio design workspace host / Epic 12 editor contribution seam
 *
 * Status: active
 */

import type { ReactNode } from "react";
import type {
  AssetDefinition,
  CharacterAnimationDefinition,
  CharacterModelDefinition,
  DocumentDefinition,
  DialogueDefinition,
  ItemDefinition,
  HUDDefinition,
  MenuDefinition,
  NPCDefinition,
  NPCInteractionMode,
  PlayerDefinition,
  QuestDefinition,
  QuestNodeDefinition,
  RegionDocument,
  SpellDefinition,
  UITheme,
  SemanticCommand
} from "@sugarmagic/domain";
import { BuildSubNav, type BuildWorkspaceKindItem } from "@sugarmagic/ui";
import type { DesignPreviewStore, DesignWorkspaceKind } from "@sugarmagic/shell";
import type { WorkspaceNavigationTarget } from "../workspace-view";
import { useDialogueWorkspaceView } from "./DialogueWorkspaceView";
import { useDocumentWorkspaceView } from "./DocumentWorkspaceView";
import { useItemWorkspaceView } from "./ItemWorkspaceView";
import { useNPCWorkspaceView } from "./NPCWorkspaceView";
import { usePlayerWorkspaceView } from "./PlayerWorkspaceView";
import { useQuestWorkspaceView } from "./QuestWorkspaceView";
import { useSpellWorkspaceView } from "./SpellWorkspaceView";
import { useGameUIWorkspaceView } from "./game-ui";

const designWorkspaceKinds: BuildWorkspaceKindItem[] = [
  { id: "player", label: "Player", icon: "🧙" },
  { id: "npcs", label: "NPCs", icon: "👤" },
  { id: "spells", label: "Spells", icon: "✨" },
  { id: "items", label: "Items", icon: "📦" },
  { id: "documents", label: "Documents", icon: "📚" },
  { id: "dialogues", label: "Dialogues", icon: "💬" },
  { id: "quests", label: "Quests", icon: "📜" },
  { id: "game-ui", label: "Game UI", icon: "🖥️" }
];

export interface DesignProductModeViewProps {
  activeDesignKind: DesignWorkspaceKind;
  gameProjectId: string | null;
  regions: RegionDocument[];
  playerDefinition: PlayerDefinition | null;
  spellDefinitions: SpellDefinition[];
  itemDefinitions: ItemDefinition[];
  documentDefinitions: DocumentDefinition[];
  npcDefinitions: NPCDefinition[];
  dialogueDefinitions: DialogueDefinition[];
  questDefinitions: QuestDefinition[];
  menuDefinitions: MenuDefinition[];
  hudDefinition: HUDDefinition | null;
  uiTheme: UITheme;
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
  assetDefinitions: AssetDefinition[];
  characterModelDefinitions: CharacterModelDefinition[];
  characterAnimationDefinitions: CharacterAnimationDefinition[];
  assetSources: Record<string, string>;
  designPreviewStore: DesignPreviewStore;
  onSelectKind: (kind: DesignWorkspaceKind) => void;
  onCommand: (command: SemanticCommand) => void;
  onImportCharacterModelDefinition: () => Promise<CharacterModelDefinition | null>;
  onImportCharacterAnimationDefinition: () => Promise<CharacterAnimationDefinition | null>;
  onImportAsset: () => Promise<AssetDefinition | null>;
  onGenerateItemThumbnail: (item: ItemDefinition) => Promise<string | null>;
  renderGameUIPreview: (options: { initialVisibleMenuKey: string | null }) => ReactNode;
  navigationTarget?: WorkspaceNavigationTarget | null;
  onConsumeNavigationTarget?: () => void;
  onNavigateToTarget?: (target: WorkspaceNavigationTarget) => void;
  renderNPCInspectorSections?: (context: {
    selectedNPC: NPCDefinition | null;
    updateNPC: (definition: NPCDefinition) => void;
  }) => ReactNode;
  renderQuestInspectorSections?: (context: {
    selectedQuest: QuestDefinition | null;
    updateQuest: (definition: QuestDefinition) => void;
    selectedQuestNode: QuestNodeDefinition | null;
  }) => ReactNode;
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
    gameProjectId,
    regions,
    playerDefinition,
    spellDefinitions,
    itemDefinitions,
    documentDefinitions,
    npcDefinitions,
    dialogueDefinitions,
    questDefinitions,
    menuDefinitions,
    hudDefinition,
    uiTheme,
    extraWorkspaceItems,
    npcInteractionOptions,
    assetDefinitions,
    characterModelDefinitions,
    characterAnimationDefinitions,
    assetSources,
    designPreviewStore,
    onSelectKind,
    onCommand,
    onImportCharacterModelDefinition,
    onImportCharacterAnimationDefinition,
    onImportAsset,
    onGenerateItemThumbnail,
    renderGameUIPreview,
    navigationTarget,
    onConsumeNavigationTarget,
    onNavigateToTarget,
    renderNPCInspectorSections,
    renderQuestInspectorSections
  } = props;

  const playerView = usePlayerWorkspaceView({
    isActive: activeDesignKind === "player",
    gameProjectId,
    playerDefinition,
    characterModelDefinitions,
    characterAnimationDefinitions,
    assetSources,
    designPreviewStore,
    onCommand,
    onImportCharacterModelDefinition,
    onImportCharacterAnimationDefinition
  });

  const npcView = useNPCWorkspaceView({
    isActive: activeDesignKind === "npcs",
    gameProjectId,
    npcDefinitions,
    interactionModeOptions: npcInteractionOptions,
    characterModelDefinitions,
    characterAnimationDefinitions,
    assetSources,
    designPreviewStore,
    onCommand,
    onImportCharacterModelDefinition,
    onImportCharacterAnimationDefinition,
    renderInspectorSections: renderNPCInspectorSections
  });

  const itemView = useItemWorkspaceView({
    isActive: activeDesignKind === "items",
    gameProjectId,
    itemDefinitions,
    documentDefinitions,
    assetDefinitions,
    assetSources,
    designPreviewStore,
    onCommand,
    onImportAsset,
    onGenerateItemThumbnail
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
    regions,
    dialogueDefinitions,
    itemDefinitions,
    npcDefinitions,
    spellDefinitions,
    onCommand,
    navigationTarget,
    onConsumeNavigationTarget,
    onNavigateToTarget,
    renderInspectorSections: renderQuestInspectorSections
  });

  const gameUIView = useGameUIWorkspaceView({
    isActive: activeDesignKind === "game-ui",
    gameProjectId,
    menuDefinitions,
    hudDefinition,
    uiTheme,
    onCommand,
    renderPreview: renderGameUIPreview
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
        : activeDesignKind === "game-ui"
          ? gameUIView.leftPanel
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
        : activeDesignKind === "game-ui"
          ? gameUIView.rightPanel
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
        : activeDesignKind === "game-ui"
          ? gameUIView.centerPanel
        : activeDesignKind === "quests"
          ? questView.centerPanel
          : activeDesignKind === "spells"
            ? spellView.centerPanel
          : activeDesignKind === "documents"
            ? documentView.centerPanel
          : activeDesignKind === "player"
            ? playerView.centerPanel
          : activeDesignKind === "npcs"
            ? npcView.centerPanel
          : undefined,
    viewportOverlay:
      activeDesignKind === "dialogues"
        ? dialogueView.viewportOverlay
        : activeDesignKind === "game-ui"
          ? gameUIView.viewportOverlay
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

export {
  createPlayerCameraController,
  type PlayerCameraController
} from "./player-camera-controller";
export {
  createNPCCameraController,
  type NPCCameraController
} from "./npc-camera-controller";
export {
  createItemCameraController,
  type ItemCameraController
} from "./item-camera-controller";
