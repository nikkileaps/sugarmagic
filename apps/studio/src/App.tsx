import { useMemo } from "react";
import { Text, Stack, Group } from "@mantine/core";
import { productModes } from "@sugarmagic/productmodes";
import { createRuntimeBootModel } from "@sugarmagic/runtime-core";
import { createBrowserRuntimeAdapter } from "@sugarmagic/runtime-web";
import { createShellModel, createShellStore } from "@sugarmagic/shell";
import {
  ModeBar,
  PanelSection,
  ShellFrame,
  StatusBar,
  ViewportFrame,
  WorkspaceHeader,
  shellIcons,
  type ModeBarItem
} from "@sugarmagic/ui";
import { useStore } from "zustand";

const shellStore = createShellStore("build");

shellStore.getState().setActiveWorkspace("build:region:bootstrap");
shellStore.getState().setSelection(["region-root"]);

const boot = createRuntimeBootModel({
  hostKind: "studio",
  compileProfile: "authoring-preview",
  contentSource: "authored-game-root"
});

const adapter = createBrowserRuntimeAdapter({
  hostKind: "studio",
  compileProfile: "authoring-preview",
  contentSource: "authored-game-root"
});

const modeBarItems: ModeBarItem[] = productModes.map((mode) => ({
  id: mode.id,
  label: mode.label,
  icon: shellIcons[mode.id as keyof typeof shellIcons] ?? ""
}));

export function App() {
  const activeProductMode = useStore(
    shellStore,
    (state) => state.activeProductMode
  );
  const activeWorkspaceId = useStore(
    shellStore,
    (state) => state.activeWorkspaceId
  );
  const selectionCount = useStore(
    shellStore,
    (state) => state.selection.entityIds.length
  );
  const panels = useStore(shellStore, (state) => state.panels);

  const shell = useMemo(
    () =>
      createShellModel({
        title: "Sugarmagic Studio",
        workspaceId: activeWorkspaceId ?? "build:region:bootstrap",
        workspaceKind: "RegionWorkspace",
        subjectId: "bootstrap-region",
        productModeId: activeProductMode
      }),
    [activeProductMode, activeWorkspaceId]
  );

  return (
    <ShellFrame
      header={
        <>
          <Group px="md" h={40} align="center" justify="space-between">
            <Group gap="sm" align="center">
              <Text fw={700} size="sm" c="var(--sm-color-text)">
                Sugarmagic
              </Text>
              <Text size="xs" c="var(--sm-color-overlay0)">
                Studio
              </Text>
            </Group>
          </Group>
          <ModeBar
            items={modeBarItems}
            activeId={activeProductMode}
            onSelect={(id) =>
              shellStore.getState().setActiveProductMode(id as typeof activeProductMode)
            }
          />
        </>
      }
      navbar={
        <Stack gap={0} h="100%">
          <WorkspaceHeader
            icon={shellIcons.regions}
            label={shell.workspaceHost.subjectId ?? "No subject"}
            subtitle={shell.workspaceHost.workspaceKind ?? undefined}
          />

          {panels.structure && (
            <PanelSection title="Structure" icon={shellIcons.regions}>
              <Stack gap="xs">
                <Text size="xs" c="var(--sm-color-overlay2)">
                  {shellIcons.regions} bootstrap-region
                </Text>
                <Text size="xs" c="var(--sm-color-overlay0)" pl="md">
                  {selectionCount} selected
                </Text>
              </Stack>
            </PanelSection>
          )}

          {panels.inspector && (
            <PanelSection title="Inspector" icon={shellIcons.inspections}>
              <Stack gap="xs">
                <DetailRow label="Host" value={boot.hostKind} />
                <DetailRow label="Profile" value={boot.compileProfile} />
                <DetailRow label="Runtime" value={boot.runtimeFamily} />
                <DetailRow label="Assets" value={adapter.assetResolution} />
              </Stack>
            </PanelSection>
          )}
        </Stack>
      }
      footer={
        <StatusBar
          message={shell.statusSurface.message}
          severity={shell.statusSurface.severity}
          trailing={activeWorkspaceId ?? undefined}
        />
      }
    >
      <ViewportFrame>
        <Text size="sm" c="var(--sm-color-overlay0)">
          Viewport — {shell.viewportHost.cameraScope} camera
        </Text>
      </ViewportFrame>
    </ShellFrame>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Group gap="xs" wrap="nowrap">
      <Text size="xs" c="var(--sm-color-overlay0)" w={60}>
        {label}
      </Text>
      <Text size="xs" c="var(--sm-color-subtext)" truncate>
        {value}
      </Text>
    </Group>
  );
}
