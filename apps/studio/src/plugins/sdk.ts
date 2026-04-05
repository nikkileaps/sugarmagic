import type { ReactNode } from "react";
import type {
  GameProject,
  PluginConfigurationRecord,
  SemanticCommand
} from "@sugarmagic/domain";

export interface PluginWorkspaceViewContribution {
  leftPanel: ReactNode;
  rightPanel: ReactNode;
  centerPanel?: ReactNode;
  viewportOverlay: ReactNode;
}

export interface PluginWorkspaceViewProps {
  gameProjectId: string | null;
  gameProject: GameProject | null;
  pluginConfigurations: PluginConfigurationRecord[];
  onCommand: (command: SemanticCommand) => void;
}

export interface StudioPluginWorkspaceDefinition {
  pluginId: string;
  workspaceKind: string;
  createWorkspaceView: (
    props: PluginWorkspaceViewProps
  ) => PluginWorkspaceViewContribution;
}
