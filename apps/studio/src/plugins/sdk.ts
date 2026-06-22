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
  /**
   * Persist the current in-memory session to disk RIGHT NOW, including
   * regenerating any managed files (terraform / deploy.sh / etc.) under
   * the deployment plan. Overwrites managed files without prompting.
   *
   * Used by plugin-driven sagas that need to flush in-memory dispatches
   * to disk before a follow-on host action sees the new state (Story 45.8
   * Cut New Major Version is the first consumer: it bumps `majorVersion`
   * via a domain command and then needs `project.sgrmagic` on disk to
   * reflect that BEFORE the host runs `git add` + `git commit`).
   *
   * Returns `{ ok: true }` on success; `{ ok: false, reason }` when the
   * save couldn't proceed (e.g., mechanics validation failed, file
   * system error). Callers are responsible for rollback when ok=false.
   */
  requestSave: () => Promise<{ ok: boolean; reason?: string }>;
}

export interface StudioPluginWorkspaceDefinition {
  pluginId: string;
  workspaceKind: string;
  createWorkspaceView: (
    props: PluginWorkspaceViewProps
  ) => PluginWorkspaceViewContribution;
}
