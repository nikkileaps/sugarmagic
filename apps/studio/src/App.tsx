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
  getAllRegions,
  getAllAssetDefinitions,
  getAllDialogueDefinitions,
  getAllDocumentDefinitions,
  getAllEnvironmentDefinitions,
  getAllItemDefinitions,
  getAllNPCDefinitions,
  getAllQuestDefinitions,
  getAllSpellDefinitions,
  getPlayerDefinition,
  addAssetDefinitionToSession,
  addEnvironmentDefinitionToSession,
  updateAssetDefinitionInSession,
  removeAssetDefinitionFromSession,
  assetDefinitionHasSceneReferences,
  createDefaultEnvironmentDefinition,
  createDefaultRegionLandscapeState
} from "@sugarmagic/domain";
import {
  checkDirectoryHasProject,
  createProjectInDirectory,
  openProject,
  pickDirectory,
  readBlobFile,
  saveProject,
  reloadProject,
  importSourceAsset
} from "@sugarmagic/io";
import {
  createShellStore,
  createProjectStore,
  createPreviewStore,
  type AuthoringContextSnapshot
} from "@sugarmagic/shell";
import {
  useBuildProductModeView,
  useDesignProductModeView,
  type ItemWorkspaceViewport,
  type NPCWorkspaceViewport,
  type WorkspaceViewport,
  type PlayerWorkspaceViewport
} from "@sugarmagic/workspaces";
import {
  ActionStripe,
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
import { createAuthoringViewport } from "./viewport/authoringViewport";
import { createItemViewport } from "./viewport/itemViewport";
import { createNPCViewport } from "./viewport/npcViewport";
import { createPlayerViewport } from "./viewport/playerViewport";

function revokeAssetSources(assetSources: Record<string, string>) {
  for (const url of Object.values(assetSources)) {
    URL.revokeObjectURL(url);
  }
}

async function createAssetSourceMap(
  handle: FileSystemDirectoryHandle,
  assetDefinitions: ReturnType<typeof getAllAssetDefinitions>
): Promise<Record<string, string>> {
  const nextSources: Record<string, string> = {};

  for (const definition of assetDefinitions) {
    const pathSegments = definition.source.relativeAssetPath
      .split("/")
      .filter(Boolean);
    const blob = await readBlobFile(handle, ...pathSegments);
    if (!blob) continue;
    nextSources[definition.source.relativeAssetPath] = URL.createObjectURL(blob);
  }

  return nextSources;
}

const shellStore = createShellStore("build");
const projectStore = createProjectStore();
const previewStore = createPreviewStore();

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

function activateDefaultEnvironment(environmentId: string | null | undefined) {
  shellStore.getState().setActiveEnvironmentId(environmentId ?? null);
}

async function handleOpenProject() {
  try {
    const active = await openProject();
    const session = createAuthoringSession(
      active.gameProject,
      active.regions,
      active.contentLibrary
    );
    projectStore.getState().setActive(active.handle, active.descriptor, session);
    activateRegion(active.regions[0]);
    activateDefaultEnvironment(
      session.contentLibrary.environmentDefinitions[0]?.definitionId
    );
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
    const session = createAuthoringSession(
      active.gameProject,
      active.regions,
      active.contentLibrary
    );
    projectStore.getState().setActive(active.handle, active.descriptor, session);
    activateRegion(active.regions[0]);
    activateDefaultEnvironment(
      session.contentLibrary.environmentDefinitions[0]?.definitionId
    );
  } catch (e) {
    handleProjectError(e);
  }
}

function dispatchCommand(command: SemanticCommand) {
  const { session } = projectStore.getState();
  if (!session) return;
  if (command.target.aggregateKind === "region-document" && !getActiveRegion(session)) {
    return;
  }
  projectStore.getState().updateSession(applyCommand(session, command));
}

async function handleSave() {
  const { handle, descriptor, session } = projectStore.getState();
  if (!handle || !descriptor || !session) return;
  await saveProject({
    handle,
    descriptor,
    gameProject: session.gameProject,
    contentLibrary: session.contentLibrary,
    regions: getAllRegions(session)
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
    contentLibrary: session.contentLibrary,
    regions: getAllRegions(session)
  });
  const newSession = createAuthoringSession(
    reloaded.gameProject,
    reloaded.regions,
    reloaded.contentLibrary
  );
  projectStore.getState().setActive(reloaded.handle, reloaded.descriptor, newSession);
  activateRegion(reloaded.regions[0]);
  activateDefaultEnvironment(
    newSession.contentLibrary.environmentDefinitions[0]?.definitionId
  );
}

function handleRegionSelect(regionId: string) {
  const { session } = projectStore.getState();
  if (!session) return;
  projectStore.getState().updateSession(switchActiveRegion(session, regionId));
  shellStore.getState().setActiveRegionId(regionId);
}

// --- Preview ---

function handleStartPreview(assetSources: Record<string, string>) {
  const { session } = projectStore.getState();
  if (!session) return;

  const shell = shellStore.getState();

  // Snapshot authoring context
  const snapshot: AuthoringContextSnapshot = {
    activeProductMode: shell.activeProductMode,
    activeBuildWorkspaceKind: shell.activeBuildWorkspaceKind,
    activeDesignWorkspaceKind: shell.activeDesignWorkspaceKind,
    activeRegionId: shell.activeRegionId,
    activeEnvironmentId: shell.activeEnvironmentId,
    activeWorkspaceId: shell.activeWorkspaceId,
    selectedEntityIds: shell.selection.entityIds
  };

  // Open preview window
  const previewWindow = window.open(
    "/preview.html",
    "sugarmagic-preview",
    "width=1280,height=720"
  );
  if (!previewWindow) {
    window.alert("Could not open preview window. Check your popup blocker.");
    return;
  }

  previewStore.getState().startPreview(snapshot, previewWindow);

  // Wait for preview ready, then send boot data
  const capturedSession = session;
  const capturedWindow = previewWindow;
  function onMessage(event: MessageEvent) {
    if (event.data?.type === "PREVIEW_READY") {
      window.removeEventListener("message", onMessage);
      const regions = getAllRegions(capturedSession);
      capturedWindow.postMessage(
        {
          type: "PREVIEW_BOOT",
          regions,
          activeRegionId: capturedSession.activeRegionId,
          activeEnvironmentId: snapshot.activeEnvironmentId,
          contentLibrary: capturedSession.contentLibrary,
          playerDefinition: capturedSession.gameProject.playerDefinition,
          spellDefinitions: capturedSession.gameProject.spellDefinitions,
          itemDefinitions: capturedSession.gameProject.itemDefinitions,
          documentDefinitions: capturedSession.gameProject.documentDefinitions,
          npcDefinitions: capturedSession.gameProject.npcDefinitions,
          dialogueDefinitions: capturedSession.gameProject.dialogueDefinitions,
          questDefinitions: capturedSession.gameProject.questDefinitions,
          assetSources
        },
        "*"
      );
    }
  }
  window.addEventListener("message", onMessage);

  // Handle preview window closing externally
  const checkClosed = setInterval(() => {
    if (previewWindow.closed) {
      clearInterval(checkClosed);
      handleStopPreview();
    }
  }, 500);
}

function handleStopPreview() {
  const snapshot = previewStore.getState().stopPreview();
  if (!snapshot) return;

  // Restore authoring context
  const shell = shellStore.getState();
  shell.setActiveProductMode(snapshot.activeProductMode);
  if (snapshot.activeProductMode === "build") {
    shell.setActiveBuildWorkspaceKind(snapshot.activeBuildWorkspaceKind);
  }
  if (snapshot.activeProductMode === "design") {
    shell.setActiveDesignWorkspaceKind(snapshot.activeDesignWorkspaceKind);
  }
  if (snapshot.activeRegionId) {
    shell.setActiveRegionId(snapshot.activeRegionId);
  }
  shell.setActiveEnvironmentId(snapshot.activeEnvironmentId ?? null);
  shell.setSelection(snapshot.selectedEntityIds);
}

// --- App ---

export function App() {
  const activeProductMode = useStore(shellStore, (s) => s.activeProductMode);
  const activeWorkspaceId = useStore(shellStore, (s) => s.activeWorkspaceId);
  const activeBuildKind = useStore(shellStore, (s) => s.activeBuildWorkspaceKind);
  const activeDesignKind = useStore(shellStore, (s) => s.activeDesignWorkspaceKind);
  const activeRegionId = useStore(shellStore, (s) => s.activeRegionId);
  const activeEnvironmentId = useStore(shellStore, (s) => s.activeEnvironmentId);
  const selectedIds = useStore(shellStore, (s) => s.selection.entityIds);

  const phase = useStore(projectStore, (s) => s.phase);
  const projectHandle = useStore(projectStore, (s) => s.handle);
  const session = useStore(projectStore, (s) => s.session);

  const isDirty = session?.isDirty ?? false;
  const undoCount = session?.undoStack.length ?? 0;
  const isBuild = activeProductMode === "build";
  const isDesign = activeProductMode === "design";
  const isPreviewRunning = useStore(previewStore, (s) => s.isPreviewRunning);

  const regions = useMemo(() => {
    if (!session) return [];
    return getAllRegions(session).map((r) => ({ id: r.identity.id, displayName: r.displayName }));
  }, [session]);

  const [createRegionOpen, setCreateRegionOpen] = useState(false);
  const [assetSources, setAssetSources] = useState<Record<string, string>>({});
  const [viewportReadyVersion, setViewportReadyVersion] = useState(0);

  function handleCreateRegion(input: { displayName: string; regionId: string }) {
    if (!session) return;
    const newRegion: RegionDocument = {
      identity: { id: input.regionId, schema: "RegionDocument", version: 1 },
      displayName: input.displayName,
      placement: { gridPosition: { x: 0, y: 0 }, placementPolicy: "world-grid" },
      scene: {
        folders: [],
        placedAssets: [],
        playerPresence: null,
        npcPresences: [],
        itemPresences: []
      },
      environmentBinding: {
        defaultEnvironmentId:
          session.contentLibrary.environmentDefinitions[0]?.definitionId ?? null
      },
      landscape: createDefaultRegionLandscapeState(),
      markers: [],
      gameplayPlacements: []
    };
    projectStore.getState().updateSession(addRegionToSession(session, newRegion));
    shellStore.getState().setActiveRegionId(input.regionId);
    setCreateRegionOpen(false);
  }

  const assetDefinitions = useMemo(() => {
    if (!session) return [];
    return getAllAssetDefinitions(session);
  }, [session]);

  const environmentDefinitions = useMemo(() => {
    if (!session) return [];
    return getAllEnvironmentDefinitions(session);
  }, [session]);

  const playerDefinition = useMemo(() => {
    if (!session) return null;
    return getPlayerDefinition(session);
  }, [session]);

  const npcDefinitions = useMemo(() => {
    if (!session) return [];
    return getAllNPCDefinitions(session);
  }, [session]);

  const itemDefinitions = useMemo(() => {
    if (!session) return [];
    return getAllItemDefinitions(session);
  }, [session]);

  const spellDefinitions = useMemo(() => {
    if (!session) return [];
    return getAllSpellDefinitions(session);
  }, [session]);

  const documentDefinitions = useMemo(() => {
    if (!session) return [];
    return getAllDocumentDefinitions(session);
  }, [session]);

  const dialogueDefinitions = useMemo(() => {
    if (!session) return [];
    return getAllDialogueDefinitions(session);
  }, [session]);

  const questDefinitions = useMemo(() => {
    if (!session) return [];
    return getAllQuestDefinitions(session);
  }, [session]);

  const environmentViewportOverrideId =
    activeBuildKind === "environment"
      ? activeEnvironmentId ?? environmentDefinitions[0]?.definitionId ?? null
      : null;

  useEffect(() => {
    if (!session) return;
    if (activeEnvironmentId) return;
    const firstEnvironmentId =
      session.contentLibrary.environmentDefinitions[0]?.definitionId ?? null;
    if (!firstEnvironmentId) return;
    shellStore.getState().setActiveEnvironmentId(firstEnvironmentId);
  }, [activeEnvironmentId, session]);

  useEffect(() => {
    let disposed = false;
    let generatedSources: Record<string, string> = {};

    if (!projectHandle || assetDefinitions.length === 0) {
      void Promise.resolve().then(() => {
        if (!disposed) {
          setAssetSources({});
        }
      });
      return undefined;
    }

    void createAssetSourceMap(projectHandle, assetDefinitions).then(
      (nextSources) => {
        if (disposed) {
          revokeAssetSources(nextSources);
          return;
        }
        generatedSources = nextSources;
        setAssetSources(nextSources);
      }
    );

    return () => {
      disposed = true;
      revokeAssetSources(generatedSources);
    };
  }, [assetDefinitions, projectHandle]);

  const handleImportAsset = useCallback(async () => {
    const { handle, descriptor, session: currentSession } = projectStore.getState();
    if (!handle || !descriptor || !currentSession) return null;

    const result = await importSourceAsset({
      projectHandle: handle,
      descriptor
    });
    projectStore
      .getState()
      .updateSession(addAssetDefinitionToSession(currentSession, result.assetDefinition));
    return result.assetDefinition;
  }, []);

  const handleUpdateAssetDefinition = useCallback(
    (definitionId: string, displayName: string) => {
      const { session: currentSession } = projectStore.getState();
      if (!currentSession) return;
      projectStore
        .getState()
        .updateSession(
          updateAssetDefinitionInSession(currentSession, definitionId, {
            displayName
          })
        );
    },
    []
  );

  const handleRemoveAssetDefinition = useCallback((definitionId: string) => {
    const { session: currentSession } = projectStore.getState();
    if (!currentSession) return;
    if (assetDefinitionHasSceneReferences(currentSession, definitionId)) {
      window.alert("Remove all placed instances before deleting this asset from the project.");
      return;
    }

    if (!window.confirm("Remove this asset definition from the project?")) {
      return;
    }

    projectStore
      .getState()
      .updateSession(removeAssetDefinitionFromSession(currentSession, definitionId));
  }, []);

  const handleCreateEnvironment = useCallback(() => {
    const { session: currentSession } = projectStore.getState();
    if (!currentSession) return;

    const nextIndex =
      currentSession.contentLibrary.environmentDefinitions.length + 1;
    const environmentDefinition = createDefaultEnvironmentDefinition(
      currentSession.gameProject.identity.id,
      {
        displayName: `Environment ${nextIndex}`
      }
    );

    const nextSession = addEnvironmentDefinitionToSession(
      currentSession,
      environmentDefinition
    );
    projectStore.getState().updateSession(nextSession);
    shellStore
      .getState()
      .setActiveEnvironmentId(environmentDefinition.definitionId);
  }, []);

  // --- Viewport lifecycle (tied to project phase) ---
  const viewportRef = useRef<HTMLDivElement>(null);
  const buildViewportRef = useRef<WorkspaceViewport | null>(null);
  const playerViewportRef = useRef<PlayerWorkspaceViewport | null>(null);
  const itemViewportRef = useRef<ItemWorkspaceViewport | null>(null);
  const npcViewportRef = useRef<NPCWorkspaceViewport | null>(null);

  useEffect(() => {
    if (phase !== "active") return;
    if (
      activeProductMode === "design" &&
      (
        activeDesignKind === "dialogues" ||
        activeDesignKind === "quests" ||
        activeDesignKind === "documents" ||
        activeDesignKind === "spells"
      )
    ) {
      buildViewportRef.current = null;
      playerViewportRef.current = null;
      itemViewportRef.current = null;
      npcViewportRef.current = null;
      const readyFrame = window.requestAnimationFrame(() => {
        setViewportReadyVersion((version) => version + 1);
      });
      return () => {
        window.cancelAnimationFrame(readyFrame);
      };
    }
    if (!viewportRef.current) return;
    const viewport =
      activeProductMode === "design"
        ? activeDesignKind === "npcs"
          ? createNPCViewport()
          : activeDesignKind === "items"
            ? createItemViewport()
          : createPlayerViewport()
        : createAuthoringViewport();
    viewport.mount(viewportRef.current);
    if (activeProductMode === "design") {
      if (activeDesignKind === "npcs") {
        npcViewportRef.current = viewport as NPCWorkspaceViewport;
        playerViewportRef.current = null;
        itemViewportRef.current = null;
      } else if (activeDesignKind === "items") {
        itemViewportRef.current = viewport as ItemWorkspaceViewport;
        playerViewportRef.current = null;
        npcViewportRef.current = null;
      } else {
        playerViewportRef.current = viewport as PlayerWorkspaceViewport;
        itemViewportRef.current = null;
        npcViewportRef.current = null;
      }
      buildViewportRef.current = null;
    } else {
      buildViewportRef.current = viewport as WorkspaceViewport;
      playerViewportRef.current = null;
      npcViewportRef.current = null;
    }
    const readyFrame = window.requestAnimationFrame(() => {
      setViewportReadyVersion((version) => version + 1);
    });

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) viewport.resize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(viewportRef.current);

    return () => {
      window.cancelAnimationFrame(readyFrame);
      observer.disconnect();
      viewport.unmount();
      buildViewportRef.current = null;
      playerViewportRef.current = null;
      itemViewportRef.current = null;
      npcViewportRef.current = null;
    };
  }, [activeDesignKind, activeProductMode, phase]);

  // --- Sync viewport with active region ---
  const activeRegion = session ? getActiveRegion(session) : null;

  useEffect(() => {
    if (isBuild && buildViewportRef.current && activeRegion && session?.contentLibrary) {
      buildViewportRef.current.updateFromRegion({
        region: activeRegion,
        contentLibrary: session.contentLibrary,
        playerDefinition: session.gameProject.playerDefinition,
        itemDefinitions: session.gameProject.itemDefinitions,
        npcDefinitions: session.gameProject.npcDefinitions,
        assetSources,
        environmentOverrideId: environmentViewportOverrideId
      });
    }
  }, [
    activeRegion,
    assetSources,
    environmentViewportOverrideId,
    isBuild,
    session?.contentLibrary,
    session?.gameProject.itemDefinitions,
    session?.gameProject.npcDefinitions,
    session?.gameProject.playerDefinition
  ]);

  // --- Build workspace view (owns its own lifecycle) ---
  const buildView = useBuildProductModeView({
    activeBuildKind,
    viewportReadyVersion,
    activeRegionId,
    activeEnvironmentId,
    selectedIds,
    session,
    assetDefinitions,
    documentDefinitions,
    environmentDefinitions,
    getViewport: () => buildViewportRef.current,
    getViewportElement: () => viewportRef.current,
    regions,
    onSelectKind: (kind) => shellStore.getState().setActiveBuildWorkspaceKind(kind),
    onSelectRegion: handleRegionSelect,
    onCreateRegion: () => setCreateRegionOpen(true),
    onSelectEnvironment: (environmentId) =>
      shellStore.getState().setActiveEnvironmentId(environmentId),
    onCreateEnvironment: handleCreateEnvironment,
    onSelect: (ids) => shellStore.getState().setSelection(ids),
    onCommand: dispatchCommand,
    onImportAsset: handleImportAsset,
    onUpdateAssetDefinition: handleUpdateAssetDefinition,
    onRemoveAssetDefinition: handleRemoveAssetDefinition
  });

  const designView = useDesignProductModeView({
    activeDesignKind,
    viewportReadyVersion,
    gameProjectId: session?.gameProject.identity.id ?? null,
    playerDefinition,
    spellDefinitions,
    itemDefinitions,
    documentDefinitions,
    npcDefinitions,
    dialogueDefinitions,
    questDefinitions,
    contentLibrary: session?.contentLibrary ?? null,
    assetDefinitions,
    assetSources,
    getPlayerViewport: () => playerViewportRef.current,
    getItemViewport: () => itemViewportRef.current,
    getNPCViewport: () => npcViewportRef.current,
    getViewportElement: () => viewportRef.current,
    onSelectKind: (kind) => shellStore.getState().setActiveDesignWorkspaceKind(kind),
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
            {phase === "active" && (
              <ActionStripe
                isPreviewRunning={isPreviewRunning}
                onStartPreview={() => handleStartPreview(assetSources)}
                onStopPreview={handleStopPreview}
                previewDisabled={!session}
              />
            )}
          </Group>
        }
        subHeaderPanel={
          phase === "active"
            ? isBuild
              ? buildView.subHeaderPanel
              : isDesign
                ? designView.subHeaderPanel
                : undefined
            : undefined
        }
        leftPanel={
          isBuild ? buildView.leftPanel : isDesign ? designView.leftPanel : null
        }
        rightPanel={
          isBuild ? buildView.rightPanel : isDesign ? designView.rightPanel : undefined
        }
        bottomPanel={
          <StatusBar message={statusMessage} severity={phase === "error" ? "error" : "info"} trailing={activeWorkspaceId ?? undefined} />
        }
        centerPanel={
          phase === "active" && isDesign && designView.centerPanel ? (
            designView.centerPanel
          ) : (
            <ViewportFrame>
              {phase === "active" ? (
                <>
                  <div ref={viewportRef} style={{ position: "absolute", inset: 0 }} />
                  {isBuild && buildView.viewportOverlay}
                  {isDesign && designView.viewportOverlay}
                </>
              ) : (
                <Text size="sm" c="var(--sm-color-overlay0)">Open or create a project to begin.</Text>
              )}
            </ViewportFrame>
          )
        }
      />
    </>
  );
}
