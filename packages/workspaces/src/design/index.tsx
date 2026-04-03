import type { ReactNode } from "react";
import type {
  AssetDefinition,
  ContentLibrarySnapshot,
  PlayerDefinition,
  SemanticCommand
} from "@sugarmagic/domain";
import { BuildSubNav, type BuildWorkspaceKindItem } from "@sugarmagic/ui";
import type { DesignWorkspaceKind } from "@sugarmagic/shell";
import type { PlayerWorkspaceViewport } from "../viewport";
import { usePlayerWorkspaceView } from "./PlayerWorkspaceView";

const designWorkspaceKinds: BuildWorkspaceKindItem[] = [
  { id: "player", label: "Player", icon: "🧙" }
];

export interface DesignProductModeViewProps {
  activeDesignKind: DesignWorkspaceKind;
  viewportReadyVersion: number;
  playerDefinition: PlayerDefinition | null;
  contentLibrary: ContentLibrarySnapshot | null;
  assetDefinitions: AssetDefinition[];
  assetSources: Record<string, string>;
  getViewport: () => PlayerWorkspaceViewport | null;
  getViewportElement: () => HTMLElement | null;
  onSelectKind: (kind: DesignWorkspaceKind) => void;
  onCommand: (command: SemanticCommand) => void;
}

export interface DesignProductModeViewResult {
  subHeaderPanel: ReactNode;
  leftPanel: ReactNode | null;
  rightPanel: ReactNode;
  viewportOverlay: ReactNode;
}

export function useDesignProductModeView(
  props: DesignProductModeViewProps
): DesignProductModeViewResult {
  const {
    activeDesignKind,
    viewportReadyVersion,
    playerDefinition,
    contentLibrary,
    assetDefinitions,
    assetSources,
    getViewport,
    getViewportElement,
    onSelectKind,
    onCommand
  } = props;

  const playerView = usePlayerWorkspaceView({
    isActive: activeDesignKind === "player",
    viewportReadyVersion,
    playerDefinition,
    contentLibrary,
    assetDefinitions,
    assetSources,
    getViewport,
    getViewportElement,
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
    leftPanel: playerView.leftPanel,
    rightPanel: playerView.rightPanel,
    viewportOverlay: playerView.viewportOverlay
  };
}
