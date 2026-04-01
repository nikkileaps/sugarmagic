/**
 * BuildProductModeView: the Build-specific host.
 *
 * Owns: Build sub-nav, workspace kind dispatch.
 * Delegates to: LayoutWorkspaceView, EnvironmentWorkspaceView, etc.
 * Does NOT redefine the shell — returns panel contributions.
 */

import { Stack, Text } from "@mantine/core";
import type { SemanticCommand } from "@sugarmagic/domain";
import { getActiveRegion, type AuthoringSession } from "@sugarmagic/domain";
import type { RuntimeViewport } from "@sugarmagic/runtime-web";
import {
  BuildSubNav,
  type BuildWorkspaceKindItem
} from "@sugarmagic/ui";
import type { BuildWorkspaceKind } from "@sugarmagic/shell";
import type { WorkspaceViewContribution } from "../workspace-view";
import { useLayoutWorkspaceView } from "./layout/LayoutWorkspaceView";
import { useEnvironmentWorkspaceView } from "./environment";
import { useAssetsWorkspaceView } from "./assets";

const buildWorkspaceKinds: BuildWorkspaceKindItem[] = [
  { id: "layout", label: "Layout", icon: "🏗️" },
  { id: "environment", label: "Environment", icon: "🌅" },
  { id: "assets", label: "Assets", icon: "📦" }
];

export interface BuildProductModeViewProps {
  activeBuildKind: BuildWorkspaceKind;
  activeRegionId: string | null;
  selectedIds: string[];
  session: AuthoringSession | null;
  getViewport: () => RuntimeViewport | null;
  getViewportElement: () => HTMLElement | null;
  regions: { id: string; displayName: string }[];
  onSelectKind: (kind: BuildWorkspaceKind) => void;
  onSelectRegion: (regionId: string) => void;
  onCreateRegion: () => void;
  onSelect: (ids: string[]) => void;
  onCommand: (command: SemanticCommand) => void;
}

export interface BuildProductModeViewResult {
  subHeaderPanel: React.ReactNode;
  leftPanel: React.ReactNode;
  rightPanel: React.ReactNode;
  viewportOverlay: React.ReactNode;
}

export function useBuildProductModeView(
  props: BuildProductModeViewProps
): BuildProductModeViewResult {
  const {
    activeBuildKind,
    activeRegionId,
    selectedIds,
    session,
    getViewport,
    getViewportElement,
    regions,
    onSelectKind,
    onSelectRegion,
    onCreateRegion,
    onSelect,
    onCommand
  } = props;

  const activeRegion = session ? getActiveRegion(session) : null;

  // Each workspace view hook is always called (rules of hooks),
  // but only the active one's contribution is used.
  const layoutView = useLayoutWorkspaceView({
    getViewport: activeBuildKind === "layout" ? getViewport : () => null,
    getViewportElement: activeBuildKind === "layout" ? getViewportElement : () => null,
    selectedIds,
    onSelect,
    onCommand,
    getSelectedId: () => selectedIds[0] ?? null,
    getRegion: () => (session ? getActiveRegion(session) : null)
  });

  const environmentView = useEnvironmentWorkspaceView();
  const assetsView = useAssetsWorkspaceView();

  const activeView: WorkspaceViewContribution =
    activeBuildKind === "layout"
      ? layoutView
      : activeBuildKind === "environment"
        ? environmentView
        : assetsView;

  return {
    subHeaderPanel: (
      <BuildSubNav
        workspaceKinds={buildWorkspaceKinds}
        activeKindId={activeBuildKind}
        onSelectKind={(id) => onSelectKind(id as BuildWorkspaceKind)}
        regions={regions}
        activeRegionId={activeRegionId}
        onSelectRegion={onSelectRegion}
        onCreateRegion={onCreateRegion}
      />
    ),

    leftPanel: (
      <Stack gap={0} h="100%">
        {!activeRegion && (
          <Stack gap="sm" align="center" p="xl" mt="xl">
            <Text size="sm" c="var(--sm-color-overlay0)" ta="center">
              No region selected.
            </Text>
            <Text size="xs" c="var(--sm-color-overlay0)" ta="center">
              Use the region selector above to create or select a region.
            </Text>
          </Stack>
        )}
        {activeView.leftPanel}
      </Stack>
    ),

    rightPanel: activeView.rightPanel,
    viewportOverlay: activeView.viewportOverlay
  };
}
