import { useCallback, useEffect, useMemo, useRef } from "react";
import { Text, Stack, Group, Menu, UnstyledButton } from "@mantine/core";
import { productModes } from "@sugarmagic/productmodes";
import type { SemanticCommand, RegionDocument } from "@sugarmagic/domain";
import {
  createAuthoringSession,
  applyCommand,
  undoSession,
  markSessionClean
} from "@sugarmagic/domain";
import {
  checkDirectoryHasProject,
  createProjectInDirectory,
  openProject,
  pickDirectory,
  saveProject,
  reloadProject
} from "@sugarmagic/io";
import { createShellModel, createShellStore, createProjectStore } from "@sugarmagic/shell";
import { createRuntimeViewport } from "@sugarmagic/runtime-web";
import {
  ModeBar,
  PanelSection,
  ProjectManagerDialog,
  ShellFrame,
  StatusBar,
  TransformInspector,
  ViewportFrame,
  WorkspaceHeader,
  shellIcons,
  type ModeBarItem
} from "@sugarmagic/ui";
import { useStore } from "zustand";

const shellStore = createShellStore("build");
const projectStore = createProjectStore();

const modeBarItems: ModeBarItem[] = productModes.map((mode) => ({
  id: mode.id,
  label: mode.label,
  icon: shellIcons[mode.id as keyof typeof shellIcons] ?? ""
}));

// --- Error handling ---

function handleProjectError(e: unknown) {
  if (e instanceof DOMException && e.name === "AbortError") return;
  window.alert(`An error occurred: ${e}`);
  projectStore.getState().reset();
}

// --- Project lifecycle handlers ---

async function handleOpenProject() {
  try {
    const active = await openProject();
    const session = createAuthoringSession(active.gameProject, active.regions);
    projectStore.getState().setActive(active.handle, active.descriptor, session);
    activateWorkspaceForRegion(active.regions[0]);
  } catch (e) {
    handleProjectError(e);
  }
}

async function handleCreateProject(input: { gameName: string; slug: string }) {
  try {
    const handle = await pickDirectory();

    const hasExisting = await checkDirectoryHasProject(handle);
    if (hasExisting) {
      const confirmed = window.confirm(
        "This directory already contains a Sugarmagic project. Replace it?"
      );
      if (!confirmed) return;
    }

    const active = await createProjectInDirectory(handle, input);
    const session = createAuthoringSession(active.gameProject, active.regions);
    projectStore.getState().setActive(active.handle, active.descriptor, session);
    activateWorkspaceForRegion(active.regions[0]);
  } catch (e) {
    handleProjectError(e);
  }
}

function activateWorkspaceForRegion(region: RegionDocument | undefined) {
  if (!region) return;
  shellStore.getState().setActiveWorkspace(`build:region:${region.identity.id}`);
  shellStore.getState().setSelection([]);
}

// --- Command execution ---

function dispatchCommand(command: SemanticCommand) {
  const { session } = projectStore.getState();
  if (!session?.activeRegion) return;

  const updated = applyCommand(session, command);
  projectStore.getState().updateSession(updated);
}

function handleMoveAsset(
  instanceId: string,
  axis: 0 | 1 | 2,
  value: number
) {
  const { session } = projectStore.getState();
  if (!session?.activeRegion) return;

  const asset = session.activeRegion.scene.placedAssets.find(
    (a: { instanceId: string }) => a.instanceId === instanceId
  );
  if (!asset) return;

  const newPosition: [number, number, number] = [...asset.transform.position];
  newPosition[axis] = value;

  dispatchCommand({
    kind: "MovePlacedAsset",
    target: {
      aggregateKind: "region-document",
      aggregateId: session.activeRegion.identity.id
    },
    subject: { subjectKind: "placed-asset", subjectId: instanceId },
    payload: { instanceId, position: newPosition }
  });
}

// --- Save / Reload ---

async function handleSave() {
  const { handle, descriptor, session } = projectStore.getState();
  if (!handle || !descriptor || !session?.activeRegion) return;

  await saveProject({
    handle,
    descriptor,
    gameProject: session.gameProject,
    regions: [session.activeRegion]
  });
  projectStore.getState().updateSession(markSessionClean(session));
}

async function handleReload() {
  const { handle, descriptor, session } = projectStore.getState();
  if (!handle || !descriptor || !session) return;

  const reloaded = await reloadProject({
    handle,
    descriptor,
    gameProject: session.gameProject,
    regions: session.activeRegion ? [session.activeRegion] : []
  });
  const newSession = createAuthoringSession(reloaded.gameProject, reloaded.regions);
  projectStore.getState().setActive(reloaded.handle, reloaded.descriptor, newSession);
  activateWorkspaceForRegion(reloaded.regions[0]);
}

// --- App component ---

export function App() {
  const activeProductMode = useStore(shellStore, (s) => s.activeProductMode);
  const activeWorkspaceId = useStore(shellStore, (s) => s.activeWorkspaceId);
  const selectedIds = useStore(shellStore, (s) => s.selection.entityIds);

  const phase = useStore(projectStore, (s) => s.phase);
  const session = useStore(projectStore, (s) => s.session);

  const activeRegion = session?.activeRegion ?? null;
  const isDirty = session?.isDirty ?? false;
  const undoCount = session?.undoStack.length ?? 0;

  const shell = useMemo(
    () =>
      createShellModel({
        title: "Sugarmagic Studio",
        workspaceId: activeWorkspaceId ?? "none",
        workspaceKind: "RegionWorkspace",
        subjectId: activeRegion?.identity.id ?? "none",
        productModeId: activeProductMode
      }),
    [activeProductMode, activeWorkspaceId, activeRegion?.identity.id]
  );

  const selectedAsset = useMemo(() => {
    if (!activeRegion || selectedIds.length !== 1) return null;
    return (
      activeRegion.scene.placedAssets.find(
        (a: { instanceId: string }) => a.instanceId === selectedIds[0]
      ) ?? null
    );
  }, [activeRegion, selectedIds]);

  // --- Three.js viewport ---
  const viewportRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<ReturnType<typeof createRuntimeViewport> | null>(null);

  useEffect(() => {
    if (!viewportRef.current || phase !== "active") return;
    const viewport = createRuntimeViewport();
    viewport.mount(viewportRef.current);
    runtimeRef.current = viewport;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        viewport.resize(entry.contentRect.width, entry.contentRect.height);
      }
    });
    observer.observe(viewportRef.current);

    return () => {
      observer.disconnect();
      viewport.unmount();
      runtimeRef.current = null;
    };
  }, [phase]);

  useEffect(() => {
    if (runtimeRef.current && activeRegion) {
      runtimeRef.current.updateFromRegion(activeRegion);
    }
  }, [activeRegion]);

  const handleUndo = useCallback(() => {
    const { session: s } = projectStore.getState();
    if (!s) return;
    projectStore.getState().updateSession(undoSession(s));
  }, []);

  const statusMessage = useMemo(() => {
    if (phase === "no-project") return "No project open";
    if (phase === "error") return "Error loading project";
    const dirty = isDirty ? " (unsaved)" : "";
    return `${shell.statusSurface.message}${dirty}`;
  }, [phase, isDirty, shell.statusSurface.message]);

  return (
    <>
      <ProjectManagerDialog
        opened={phase === "no-project"}
        onOpen={handleOpenProject}
        onCreate={handleCreateProject}
      />

      <ShellFrame
        headerPanel={
          <Group h={44} px="md" align="center" gap={0} wrap="nowrap">
            <Text fw={700} size="sm" c="var(--sm-color-text)" mr="md">
              Sugarmagic
            </Text>

            {phase === "active" && (
              <Menu position="bottom-start" offset={4}>
                <Menu.Target>
                  <UnstyledButton
                    px="md"
                    py={6}
                    styles={{
                      root: {
                        fontSize: "var(--sm-font-size-lg)",
                        color: "var(--sm-accent-blue)",
                        background: "var(--sm-active-bg)",
                        borderRadius: "var(--sm-radius-sm)",
                        marginRight: "var(--sm-space-lg)",
                        "&:hover": {
                          background: "var(--sm-active-bg-hover)"
                        }
                      }
                    }}
                  >
                    📁 Game
                  </UnstyledButton>
                </Menu.Target>
                <Menu.Dropdown
                  styles={{
                    dropdown: {
                      background: "var(--sm-color-surface1)",
                      border: "1px solid var(--sm-panel-border)",
                      minWidth: 200,
                      padding: "var(--sm-space-xs) 0"
                    }
                  }}
                >
                  <Menu.Item
                    onClick={handleSave}
                    disabled={!isDirty}
                    rightSection={
                      <Text size="xs" c="var(--sm-color-overlay0)">⌘S</Text>
                    }
                    styles={{
                      item: {
                        fontSize: "var(--sm-font-size-lg)",
                        color: "var(--sm-color-text)",
                        padding: "10px 16px",
                        "&:hover": { background: "var(--sm-active-bg)" },
                        "&[data-disabled]": { color: "var(--sm-color-overlay0)" }
                      }
                    }}
                  >
                    💾 Save Game
                  </Menu.Item>
                  <Menu.Item
                    onClick={handleUndo}
                    disabled={undoCount === 0}
                    rightSection={
                      <Text size="xs" c="var(--sm-color-overlay0)">⌘Z</Text>
                    }
                    styles={{
                      item: {
                        fontSize: "var(--sm-font-size-lg)",
                        color: "var(--sm-color-text)",
                        padding: "10px 16px",
                        "&:hover": { background: "var(--sm-active-bg)" },
                        "&[data-disabled]": { color: "var(--sm-color-overlay0)" }
                      }
                    }}
                  >
                    ↩ Undo
                  </Menu.Item>
                  <Menu.Divider styles={{ divider: { borderColor: "var(--sm-panel-border)" } }} />
                  <Menu.Item
                    onClick={handleReload}
                    styles={{
                      item: {
                        fontSize: "var(--sm-font-size-lg)",
                        color: "var(--sm-color-text)",
                        padding: "10px 16px",
                        "&:hover": { background: "var(--sm-active-bg)" }
                      }
                    }}
                  >
                    🔄 Reload Project
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            )}

            <ModeBar
              items={modeBarItems}
              activeId={activeProductMode}
              onSelect={(id) =>
                shellStore
                  .getState()
                  .setActiveProductMode(id as typeof activeProductMode)
              }
            />
          </Group>
        }
        leftPanel={
          <Stack gap={0} h="100%">
            <WorkspaceHeader
              icon={shellIcons.regions}
              label={activeRegion?.displayName ?? "No region"}
              subtitle={activeRegion ? "RegionWorkspace" : undefined}
            />

            {activeRegion && (
              <PanelSection title="Structure" icon={shellIcons.regions}>
                <Stack gap="xs">
                  {activeRegion.scene.placedAssets.map((asset: { instanceId: string }) => {
                    const isSelected = selectedIds.includes(asset.instanceId);
                    return (
                      <Text
                        key={asset.instanceId}
                        size="xs"
                        c={
                          isSelected
                            ? "var(--sm-accent-blue)"
                            : "var(--sm-color-overlay2)"
                        }
                        fw={isSelected ? 600 : 400}
                        onClick={() =>
                          shellStore
                            .getState()
                            .setSelection([asset.instanceId])
                        }
                        style={{ cursor: "pointer" }}
                      >
                        📦 {asset.instanceId}
                      </Text>
                    );
                  })}
                </Stack>
              </PanelSection>
            )}

            {selectedAsset && (
              <PanelSection title="Inspector" icon={shellIcons.inspections}>
                <TransformInspector
                  label="Position"
                  position={selectedAsset.transform.position}
                  onMove={(axis, value) =>
                    handleMoveAsset(selectedAsset.instanceId, axis, value)
                  }
                />
              </PanelSection>
            )}
          </Stack>
        }
        bottomPanel={
          <StatusBar
            message={statusMessage}
            severity={phase === "error" ? "error" : "info"}
            trailing={activeWorkspaceId ?? undefined}
          />
        }
        centerPanel={
          <ViewportFrame>
            {phase === "active" ? (
              <div
                ref={viewportRef}
                style={{
                  position: "absolute",
                  inset: 0
                }}
              />
            ) : (
              <Text size="sm" c="var(--sm-color-overlay0)">
                Open or create a project to begin.
              </Text>
            )}
          </ViewportFrame>
        }
      />
    </>
  );
}
