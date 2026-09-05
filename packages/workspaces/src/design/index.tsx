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
  AnimationLibraryDefinition,
  AssetDefinition,
  CharacterAnimationDefinition,
  CharacterModelDefinition,
  DocumentDefinition,
  DialogueDefinition,
  DialogueNodeDefinition,
  ItemDefinition,
  HUDDefinition,
  MenuDefinition,
  MechanicsDefinition,
  NPCDefinition,
  NPCInteractionMode,
  CreditsDefinition,
  PlayerDefinition,
  GameProject,
  QuestDefinition,
  QuestNodeDefinition,
  RegionDocument,
  Episode,
  SoundCueDefinition,
  SpellDefinition,
  UITheme,
  SemanticCommand
} from "@sugarmagic/domain";
import { BuildSubNav, type BuildWorkspaceKindItem } from "@sugarmagic/ui";
import type {
  DesignPreviewStore,
  DesignWorkspaceKind
} from "@sugarmagic/shell";
import type { WorkspaceNavigationTarget } from "../workspace-view";
import { useDialogueWorkspaceView } from "./DialogueWorkspaceView";
import { useDocumentWorkspaceView } from "./DocumentWorkspaceView";
import { useItemWorkspaceView } from "./ItemWorkspaceView";
import { useMechanicsWorkspaceView } from "./MechanicsWorkspaceView";
import { useNPCWorkspaceView } from "./NPCWorkspaceView";
import { usePlayerWorkspaceView } from "./PlayerWorkspaceView";
import type { CharacterWizardServices } from "./character-wizard/CharacterWizard";
import { useQuestWorkspaceView } from "./QuestWorkspaceView";
import { useWorldFlagWorkspaceView } from "./WorldFlagWorkspaceView";
import { useSpellWorkspaceView } from "./SpellWorkspaceView";
import { useGameUIWorkspaceView } from "./game-ui";

/**
 * The Design tab strip. Every id here must also be in
 * `CORE_DESIGN_WORKSPACE_KINDS` (packages/shell), or App.tsx treats the kind as
 * unavailable and bounces the selection back to "player" -- a tab that renders
 * the wrong workspace rather than failing. `DesignWorkspaceKind` widens to
 * `string`, so the compiler cannot catch the mismatch; a test does.
 */
export const designWorkspaceKinds: BuildWorkspaceKindItem[] = [
  { id: "player", label: "Player", icon: "🧙" },
  { id: "npcs", label: "NPCs", icon: "👤" },
  { id: "spells", label: "Spells", icon: "✨" },
  { id: "items", label: "Items", icon: "📦" },
  { id: "documents", label: "Documents", icon: "📚" },
  { id: "world-flags", label: "World Flags", icon: "🚩" },
  { id: "mechanics", label: "Mechanics", icon: "🎲" },
  { id: "game-ui", label: "Game UI", icon: "🖥️" }
];

export interface DesignProductModeViewProps {
  activeDesignKind: DesignWorkspaceKind;
  gameProjectId: string | null;
  /** The whole project, for the world flag registry's reference walk. */
  gameProject: GameProject | null;
  regions: RegionDocument[];
  /** Picker source for the quest story actions (unlockEpisode
   *  picks an Episode, advanceToNextScene picks a Scene). */
  episodes: Episode[];
  /** Cue picker source for the quest playCue action. */
  soundCueDefinitions: SoundCueDefinition[];
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
  /** Plan 059 §059.2 — credits editor lives in Game UI. */
  creditsDefinition: CreditsDefinition;
  onUpdateCredits: (credits: CreditsDefinition) => void;
  /** Plan 059 §059.6 — live credits roll preview. */
  renderCreditsPreview: () => ReactNode;
  mechanics: MechanicsDefinition;
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
  animationLibraryDefinitions: AnimationLibraryDefinition[];
  assetSources: Record<string, string>;
  designPreviewStore: DesignPreviewStore;
  onSelectKind: (kind: DesignWorkspaceKind) => void;
  onCommand: (command: SemanticCommand) => void;
  onImportCharacterModelDefinition: () => Promise<CharacterModelDefinition | null>;
  /** Plan 062 §062.6 — Studio-side Character Wizard services;
   *  omitted/null hides the rig-wizard launcher. */
  characterWizardServices?: CharacterWizardServices | null;
  onImportAsset: () => Promise<AssetDefinition | null>;
  onGenerateItemThumbnail: (item: ItemDefinition) => Promise<string | null>;
  onAppendDocumentPage: (
    documentDefinitionId: string,
    pageIndex: number
  ) => Promise<string | null>;
  renderGameUIPreview: (options: {
    initialVisibleMenuKey: string | null;
  }) => ReactNode;
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
  renderDialogueInspectorSections?: (context: {
    selectedDialogue: DialogueDefinition | null;
    selectedDialogueNode: DialogueNodeDefinition | null;
    updateDialogueNode: (node: DialogueNodeDefinition) => void;
  }) => ReactNode;
  renderItemInspectorSections?: (context: {
    selectedItem: ItemDefinition | null;
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
    gameProject,
    regions,
    episodes,
    soundCueDefinitions,
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
    creditsDefinition,
    onUpdateCredits,
    renderCreditsPreview,
    mechanics,
    extraWorkspaceItems,
    npcInteractionOptions,
    assetDefinitions,
    characterModelDefinitions,
    characterAnimationDefinitions,
    animationLibraryDefinitions,
    assetSources,
    designPreviewStore,
    onSelectKind,
    onCommand,
    onImportCharacterModelDefinition,
    characterWizardServices,
    onImportAsset,
    onGenerateItemThumbnail,
    onAppendDocumentPage,
    renderGameUIPreview,
    navigationTarget,
    onConsumeNavigationTarget,
    onNavigateToTarget,
    renderNPCInspectorSections,
    renderQuestInspectorSections,
    renderDialogueInspectorSections,
    renderItemInspectorSections
  } = props;

  const playerView = usePlayerWorkspaceView({
    isActive: activeDesignKind === "player",
    gameProjectId,
    playerDefinition,
    characterModelDefinitions,
    characterAnimationDefinitions,
    animationLibraryDefinitions,
    assetSources,
    designPreviewStore,
    onCommand,
    onImportCharacterModelDefinition,
    characterWizardServices: characterWizardServices ?? null
  });

  const npcView = useNPCWorkspaceView({
    isActive: activeDesignKind === "npcs",
    gameProjectId,
    npcDefinitions,
    interactionModeOptions: npcInteractionOptions,
    characterModelDefinitions,
    characterAnimationDefinitions,
    animationLibraryDefinitions,
    assetSources,
    designPreviewStore,
    onCommand,
    onImportCharacterModelDefinition,
    characterWizardServices: characterWizardServices ?? null,
    renderInspectorSections: renderNPCInspectorSections
  });

  const worldFlagView = useWorldFlagWorkspaceView({
    isActive: activeDesignKind === "world-flags",
    gameProjectId,
    gameProject,
    regions,
    onCommand,
    onNavigateToTarget
  });

  const itemView = useItemWorkspaceView({
    isActive: activeDesignKind === "items",
    gameProjectId,
    itemDefinitions,
    documentDefinitions,
    mechanics,
    assetDefinitions,
    assetSources,
    designPreviewStore,
    onCommand,
    onImportAsset,
    onGenerateItemThumbnail,
    renderInspectorSections: renderItemInspectorSections
  });

  const spellView = useSpellWorkspaceView({
    isActive: activeDesignKind === "spells",
    gameProjectId,
    spellDefinitions,
    mechanics,
    assetDefinitions,
    onCommand
  });

  const documentView = useDocumentWorkspaceView({
    isActive: activeDesignKind === "documents",
    gameProjectId,
    documentDefinitions,
    assetSources,
    onCommand,
    onAppendDocumentPage
  });

  const gameUIView = useGameUIWorkspaceView({
    isActive: activeDesignKind === "game-ui",
    gameProjectId,
    menuDefinitions,
    hudDefinition,
    uiTheme,
    creditsDefinition,
    onUpdateCredits,
    onCommand,
    renderPreview: renderGameUIPreview,
    renderCreditsPreview
  });

  const mechanicsView = useMechanicsWorkspaceView({
    gameProjectId,
    mechanics,
    spellDefinitions,
    itemDefinitions,
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
      activeDesignKind === "world-flags"
        ? worldFlagView.leftPanel
        : activeDesignKind === "mechanics"
          ? mechanicsView.leftPanel
          : activeDesignKind === "game-ui"
            ? gameUIView.leftPanel
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
      activeDesignKind === "world-flags"
        ? worldFlagView.rightPanel
        : activeDesignKind === "mechanics"
          ? mechanicsView.rightPanel
          : activeDesignKind === "game-ui"
            ? gameUIView.rightPanel
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
 activeDesignKind === "mechanics"
          ? mechanicsView.centerPanel
          : activeDesignKind === "game-ui"
            ? gameUIView.centerPanel
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
      activeDesignKind === "world-flags"
        ? worldFlagView.viewportOverlay
        : activeDesignKind === "mechanics"
          ? mechanicsView.viewportOverlay
          : activeDesignKind === "game-ui"
            ? gameUIView.viewportOverlay
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
export {
  CharacterWizard,
  type CharacterWizardServices,
  type CharacterWizardProps,
  type WizardGenerated,
  type WizardLandmarks
} from "./character-wizard/CharacterWizard";
export {
  AnimationPanel,
  type AnimationPanelProps
} from "./animation-panel/AnimationPanel";
export {
  WeightWorkbench,
  type WeightWorkbenchProps
} from "./weight-workbench/WeightWorkbench";
export { DialogueNodeCard } from "./DialogueNodeCard";
export {
  addGroup,
  frameAround,
  groupOfNode,
  membershipChanged,
  placeNodeInGroup,
  resolveMembership,
  shiftGroupMembers,
  toAbsolutePosition,
  toEditorGroups
} from "./node-group-layout";
export {
  DIALOGUE_NODE_KIND,
  applyDialogueNodeMoves,
  canDeleteDialogueNodes,
  choiceColor,
  choicePortName,
  connectDialogueNodes,
  deleteDialogueNodes,
  dialogueEdgeId,
  dialogueToEditorEdges,
  dialogueToEditorNodes,
  disconnectDialogueEdges,
  parseDialogueEdgeId,
  type DialogueNodePayload
} from "./dialogue-graph";
export {
  QUEST_NODE_KIND,
  applyNodeMoves,
  connectNodes,
  deleteNodes,
  disconnectEdges,
  failEdgeId,
  findNode,
  parseEdgeId,
  prerequisiteEdgeId,
  questStageToEditorEdges,
  questStageToEditorNodes
} from "./quest-graph";
