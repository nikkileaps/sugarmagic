import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, Group, Menu, UnstyledButton } from "@mantine/core";
import { productModes } from "@sugarmagic/productmodes";
import type { SemanticCommand, RegionDocument } from "@sugarmagic/domain";
import {
  createAuthoringSession,
  applyCommand,
  undoSession,
  markSessionClean,
  switchActiveRegion,
  addRegionToSession,
  getActiveRegion,
  getAllRegions
} from "@sugarmagic/domain";
import {
  checkDirectoryHasProject,
  createProjectInDirectory,
  openProject,
  pickDirectory,
  saveProject,
  reloadProject
} from "@sugarmagic/io";
import {
  createShellStore,
  createProjectStore
} from "@sugarmagic/shell";
import { createRuntimeViewport, type RuntimeViewport } from "@sugarmagic/runtime-web";
import { useBuildProductModeView } from "@sugarmagic/workspaces";
import {
  CreateRegionDialog,
  ModeBar,
  ProjectManagerDialog,
  ShellFrame,
  StatusBar,
  ViewportFrame,
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

// --- Project lifecycle ---

function activateRegion(region: RegionDocument | undefined) {
  if (!region) return;
  shellStore.getState().setActiveRegionId(region.identity.id);
}

async function handleOpenProject() {
  try {
    const active = await openProject();
    const session = createAuthoringSession(active.gameProject, active.regions);
    projectStore.getState().setActive(active.handle, active.descriptor, session);
    activateRegion(active.regions[0]);
  } catch (e) {
    handleProjectError(e);
  }
}

async function handleCreateProject(input: { gameName: string; slug: string }) {
  try {
    const handle = await pickDirectory();
    const hasExisting = await checkDirectoryHasProject(handle);
    if (hasExisting && !window.confirm("This directory already contains a Sugarmagic project. Replace it?")) return;
    const active = await createProjectInDirectory(handle, input);
    const session = createAuthoringSession(active.gameProject, active.regions);
    projectStore.getState().setActive(active.handle, active.descriptor, session);
    activateRegion(active.regions[0]);
  } catch (e) {
    handleProjectError(e);
  }
}

function dispatchCommand(command: SemanticCommand) {
  const { session } = projectStore.getState();
  if (!session || !getActiveRegion(session)) return;
  projectStore.getState().updateSession(applyCommand(session, command));
}

async function handleSave() {
  const { handle, descriptor, session } = projectStore.getState();
  if (!handle || !descriptor || !session) return;
  await saveProject({ handle, descriptor, gameProject: session.gameProject, regions: getAllRegions(session) });
  projectStore.getState().updateSession(markSessionClean(session));
}

async function handleReload() {
  const { handle, descriptor, session } = projectStore.getState();
  if (!handle || !descriptor || !session) return;
  const reloaded = await reloadProject({
    handle, descriptor, gameProject: session.gameProject,
    regions: getAllRegions(session)
  });
  const newSession = createAuthoringSession(reloaded.gameProject, reloaded.regions);
  projectStore.getState().setActive(reloaded.handle, reloaded.descriptor, newSession);
  activateRegion(reloaded.regions[0]);
}

function handleRegionSelect(regionId: string) {
  const { session } = projectStore.getState();
  if (!session) return;
  projectStore.getState().updateSession(switchActiveRegion(session, regionId));
  shellStore.getState().setActiveRegionId(regionId);
}

// --- App ---

export function App() {
  const activeProductMode = useStore(shellStore, (s) => s.activeProductMode);
  const activeWorkspaceId = useStore(shellStore, (s) => s.activeWorkspaceId);
  const activeBuildKind = useStore(shellStore, (s) => s.activeBuildWorkspaceKind);
  const activeRegionId = useStore(shellStore, (s) => s.activeRegionId);
  const selectedIds = useStore(shellStore, (s) => s.selection.entityIds);

  const phase = useStore(projectStore, (s) => s.phase);
  const session = useStore(projectStore, (s) => s.session);

  const isDirty = session?.isDirty ?? false;
  const undoCount = session?.undoStack.length ?? 0;
  const isBuild = activeProductMode === "build";

  const regions = useMemo(() => {
    if (!session) return [];
    return getAllRegions(session).map((r) => ({ id: r.identity.id, displayName: r.displayName }));
  }, [session]);

  const [createRegionOpen, setCreateRegionOpen] = useState(false);

  function handleCreateRegion(input: { displayName: string; regionId: string }) {
    if (!session) return;
    const newRegion: RegionDocument = {
      identity: { id: input.regionId, schema: "RegionDocument", version: 1 },
      displayName: input.displayName,
      placement: { gridPosition: { x: 0, y: 0 }, placementPolicy: "world-grid" },
      scene: { placedAssets: [] },
      environment: { skyProfileId: null, fogEnabled: false },
      landscape: { enabled: false, channelIds: [] },
      markers: [],
      gameplayPlacements: []
    };
    projectStore.getState().updateSession(addRegionToSession(session, newRegion));
    shellStore.getState().setActiveRegionId(input.regionId);
    setCreateRegionOpen(false);
  }

  // --- Viewport lifecycle (tied to project phase) ---
  const viewportRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<RuntimeViewport | null>(null);

  useEffect(() => {
    if (!viewportRef.current || phase !== "active") return;
    const viewport = createRuntimeViewport();
    viewport.mount(viewportRef.current);
    runtimeRef.current = viewport;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) viewport.resize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(viewportRef.current);

    return () => {
      observer.disconnect();
      viewport.unmount();
      runtimeRef.current = null;
    };
  }, [phase]);

  // --- Sync viewport with active region ---
  const activeRegion = session ? getActiveRegion(session) : null;

  useEffect(() => {
    if (runtimeRef.current && activeRegion) runtimeRef.current.updateFromRegion(activeRegion);
  }, [activeRegion]);

  // --- Build workspace view (owns its own lifecycle) ---
  const buildView = useBuildProductModeView({
    activeBuildKind,
    activeRegionId,
    selectedIds,
    session,
    getViewport: () => runtimeRef.current,
    getViewportElement: () => viewportRef.current,
    regions,
    onSelectKind: (kind) => shellStore.getState().setActiveBuildWorkspaceKind(kind),
    onSelectRegion: handleRegionSelect,
    onCreateRegion: () => setCreateRegionOpen(true),
    onSelect: (ids) => shellStore.getState().setSelection(ids),
    onCommand: dispatchCommand
  });

  const handleUndo = useCallback(() => {
    const { session: s } = projectStore.getState();
    if (!s) return;
    projectStore.getState().updateSession(undoSession(s));
  }, []);

  const statusMessage = useMemo(() => {
    if (phase === "no-project") return "No project open";
    if (phase === "error") return "Error loading project";
    const dirty = isDirty ? " (unsaved)" : "";
    return `${activeProductMode} workspace ready${dirty}`;
  }, [phase, isDirty, activeProductMode]);

  return (
    <>
      <ProjectManagerDialog opened={phase === "no-project"} onOpen={handleOpenProject} onCreate={handleCreateProject} />
      <CreateRegionDialog opened={createRegionOpen} onClose={() => setCreateRegionOpen(false)} onCreate={handleCreateRegion} />

      <ShellFrame
        headerPanel={
          <Group h={44} px="md" align="center" gap={0} wrap="nowrap">
            <Text fw={700} size="sm" c="var(--sm-color-text)" mr="md">Sugarmagic</Text>
            {phase === "active" && (
              <Menu position="bottom-start" offset={4}>
                <Menu.Target>
                  <UnstyledButton px="md" py={6} styles={{ root: { fontSize: "var(--sm-font-size-lg)", color: "var(--sm-accent-blue)", background: "var(--sm-active-bg)", borderRadius: "var(--sm-radius-sm)", marginRight: "var(--sm-space-lg)", "&:hover": { background: "var(--sm-active-bg-hover)" } } }}>
                    📁 Game
                  </UnstyledButton>
                </Menu.Target>
                <Menu.Dropdown styles={{ dropdown: { background: "var(--sm-color-surface1)", border: "1px solid var(--sm-panel-border)", minWidth: 200, padding: "var(--sm-space-xs) 0" } }}>
                  <Menu.Item onClick={handleSave} disabled={!isDirty} rightSection={<Text size="xs" c="var(--sm-color-overlay0)">⌘S</Text>} styles={{ item: { fontSize: "var(--sm-font-size-lg)", color: "var(--sm-color-text)", padding: "10px 16px", "&:hover": { background: "var(--sm-active-bg)" }, "&[data-disabled]": { color: "var(--sm-color-overlay0)" } } }}>💾 Save Game</Menu.Item>
                  <Menu.Item onClick={handleUndo} disabled={undoCount === 0} rightSection={<Text size="xs" c="var(--sm-color-overlay0)">⌘Z</Text>} styles={{ item: { fontSize: "var(--sm-font-size-lg)", color: "var(--sm-color-text)", padding: "10px 16px", "&:hover": { background: "var(--sm-active-bg)" }, "&[data-disabled]": { color: "var(--sm-color-overlay0)" } } }}>↩ Undo</Menu.Item>
                  <Menu.Divider styles={{ divider: { borderColor: "var(--sm-panel-border)" } }} />
                  <Menu.Item onClick={handleReload} styles={{ item: { fontSize: "var(--sm-font-size-lg)", color: "var(--sm-color-text)", padding: "10px 16px", "&:hover": { background: "var(--sm-active-bg)" } } }}>🔄 Reload Project</Menu.Item>
                </Menu.Dropdown>
              </Menu>
            )}
            <ModeBar items={modeBarItems} activeId={activeProductMode} onSelect={(id) => shellStore.getState().setActiveProductMode(id as typeof activeProductMode)} />
          </Group>
        }
        subHeaderPanel={isBuild && phase === "active" ? buildView.subHeaderPanel : undefined}
        leftPanel={isBuild ? buildView.leftPanel : null}
        rightPanel={isBuild ? buildView.rightPanel : undefined}
        bottomPanel={
          <StatusBar message={statusMessage} severity={phase === "error" ? "error" : "info"} trailing={activeWorkspaceId ?? undefined} />
        }
        centerPanel={
          <ViewportFrame>
            {phase === "active" ? (
              <>
                <div ref={viewportRef} style={{ position: "absolute", inset: 0 }} />
                {isBuild && buildView.viewportOverlay}
              </>
            ) : (
              <Text size="sm" c="var(--sm-color-overlay0)">Open or create a project to begin.</Text>
            )}
          </ViewportFrame>
        }
      />
    </>
  );
}
