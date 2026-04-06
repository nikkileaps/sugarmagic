import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Box,
  Group,
  Menu,
  NumberInput,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  Tooltip
} from "@mantine/core";
import type {
  AssetDefinition,
  ContentLibrarySnapshot,
  NPCAnimationSlot,
  NPCDefinition,
  NPCInteractionMode,
  SemanticCommand
} from "@sugarmagic/domain";
import { createDefaultNPCDefinition } from "@sugarmagic/domain";
import { Inspector } from "@sugarmagic/ui";
import type { WorkspaceViewContribution } from "../workspace-view";
import type { NPCWorkspaceViewport } from "../viewport";
import { LayoutOrientationWidget } from "../build/layout/LayoutOrientationWidget";
import { createNPCCameraController } from "./npc-camera-controller";

export interface NPCWorkspaceViewProps {
  isActive: boolean;
  viewportReadyVersion: number;
  gameProjectId: string | null;
  npcDefinitions: NPCDefinition[];
  interactionModeOptions: Array<{
    value: NPCInteractionMode;
    label: string;
    description?: string;
  }>;
  contentLibrary: ContentLibrarySnapshot | null;
  assetDefinitions: AssetDefinition[];
  assetSources: Record<string, string>;
  getViewport: () => NPCWorkspaceViewport | null;
  getViewportElement: () => HTMLElement | null;
  onCommand: (command: SemanticCommand) => void;
}

function toAssetOptions(assetDefinitions: AssetDefinition[]) {
  return assetDefinitions.map((definition) => ({
    value: definition.definitionId,
    label: definition.displayName
  }));
}

function boundAnimationSlotOptions(npcDefinition: NPCDefinition | null) {
  if (!npcDefinition) return [];

  const labels: Record<NPCAnimationSlot, string> = {
    idle: "Idle",
    walk: "Walk",
    run: "Run"
  };

  return (Object.entries(
    npcDefinition.presentation.animationAssetBindings
  ) as Array<[NPCAnimationSlot, string | null]>)
    .filter(([, definitionId]) => Boolean(definitionId))
    .map(([slot]) => ({
      value: slot,
      label: labels[slot]
    }));
}

export function useNPCWorkspaceView(
  props: NPCWorkspaceViewProps
): WorkspaceViewContribution {
  const {
    isActive,
    viewportReadyVersion,
    gameProjectId,
    npcDefinitions,
    interactionModeOptions,
    contentLibrary,
    assetDefinitions,
    assetSources,
    getViewport,
    getViewportElement,
    onCommand
  } = props;

  const [selectedNpcId, setSelectedNpcId] = useState<string | null>(
    npcDefinitions[0]?.definitionId ?? null
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    definitionId: string;
  } | null>(null);
  const [activeAnimationSlot, setActiveAnimationSlot] =
    useState<NPCAnimationSlot | null>("idle");
  const [isAnimationPlaying, setIsAnimationPlaying] = useState(true);
  const [cameraQuaternion, setCameraQuaternion] =
    useState<[number, number, number, number]>([0, 0, 0, 1]);
  const cameraControllerRef = useRef(createNPCCameraController());
  const getViewportRef = useRef(getViewport);
  const getViewportElementRef = useRef(getViewportElement);

  useEffect(() => {
    getViewportRef.current = getViewport;
    getViewportElementRef.current = getViewportElement;
  }, [getViewport, getViewportElement]);

  const effectiveSelectedNpcId = useMemo(() => {
    if (npcDefinitions.length === 0) return null;
    if (
      selectedNpcId &&
      npcDefinitions.some((definition) => definition.definitionId === selectedNpcId)
    ) {
      return selectedNpcId;
    }
    return npcDefinitions[0]!.definitionId;
  }, [npcDefinitions, selectedNpcId]);

  const selectedNPC = useMemo(
    () =>
      npcDefinitions.find(
        (definition) => definition.definitionId === effectiveSelectedNpcId
      ) ?? null,
    [effectiveSelectedNpcId, npcDefinitions]
  );
  const filteredNPCs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return npcDefinitions;
    return npcDefinitions.filter((definition) =>
      definition.displayName.toLowerCase().includes(query)
    );
  }, [npcDefinitions, searchQuery]);
  const assetOptions = useMemo(() => toAssetOptions(assetDefinitions), [assetDefinitions]);
  const animationSlotOptions = useMemo(
    () => boundAnimationSlotOptions(selectedNPC),
    [selectedNPC]
  );
  const effectiveAnimationSlot = useMemo(() => {
    if (!selectedNPC) return null;
    if (
      activeAnimationSlot &&
      selectedNPC.presentation.animationAssetBindings[activeAnimationSlot]
    ) {
      return activeAnimationSlot;
    }

    return (animationSlotOptions[0]?.value as NPCAnimationSlot | undefined) ?? null;
  }, [activeAnimationSlot, animationSlotOptions, selectedNPC]);

  const availableInteractionModes = useMemo(
    () => new Set(interactionModeOptions.map((option) => option.value)),
    [interactionModeOptions]
  );

  function createNPC() {
    if (!gameProjectId) return;
    const nextDefinition = createDefaultNPCDefinition({
      displayName: `NPC ${npcDefinitions.length + 1}`
    });
    onCommand({
      kind: "CreateNPCDefinition",
      target: {
        aggregateKind: "game-project",
        aggregateId: gameProjectId
      },
      subject: {
        subjectKind: "npc-definition",
        subjectId: nextDefinition.definitionId
      },
      payload: {
        definition: nextDefinition
      }
    });
    setSelectedNpcId(nextDefinition.definitionId);
  }

  const updateNPC = useCallback((nextDefinition: NPCDefinition) => {
    if (!gameProjectId) return;
    onCommand({
      kind: "UpdateNPCDefinition",
      target: {
        aggregateKind: "game-project",
        aggregateId: gameProjectId
      },
      subject: {
        subjectKind: "npc-definition",
        subjectId: nextDefinition.definitionId
      },
      payload: {
        definition: nextDefinition
      }
    });
  }, [gameProjectId, onCommand]);

  useEffect(() => {
    if (!selectedNPC) return;
    if (availableInteractionModes.has(selectedNPC.interactionMode)) {
      return;
    }
    updateNPC({
      ...selectedNPC,
      interactionMode: "scripted"
    });
  }, [availableInteractionModes, selectedNPC, updateNPC]);

  function deleteNPC(definitionId: string) {
    if (!gameProjectId) return;
    onCommand({
      kind: "DeleteNPCDefinition",
      target: {
        aggregateKind: "game-project",
        aggregateId: gameProjectId
      },
      subject: {
        subjectKind: "npc-definition",
        subjectId: definitionId
      },
      payload: {
        definitionId
      }
    });
    setContextMenu(null);
    if (effectiveSelectedNpcId === definitionId) {
      const remaining = npcDefinitions.filter(
        (definition) => definition.definitionId !== definitionId
      );
      setSelectedNpcId(remaining[0]?.definitionId ?? null);
    }
  }

  useEffect(() => {
    if (!isActive || !selectedNPC) return;

    const viewport = getViewportRef.current();
    const viewportElement = getViewportElementRef.current();
    if (!viewport || !viewportElement) return;

    const targetY = Math.max(selectedNPC.presentation.modelHeight * 0.55, 0.85);
    const cameraController = cameraControllerRef.current;
    cameraController.attach(
      viewport.camera,
      viewportElement,
      viewport.subscribeFrame,
      targetY
    );

    return () => {
      cameraController.detach();
    };
  }, [isActive, viewportReadyVersion, selectedNPC]);

  useEffect(() => {
    if (!isActive || !selectedNPC) return;
    cameraControllerRef.current.updateTarget(
      Math.max(selectedNPC.presentation.modelHeight * 0.55, 0.85)
    );
  }, [isActive, selectedNPC]);

  useEffect(() => {
    if (!isActive) return;

    const viewport = getViewportRef.current();
    if (!viewport) return;

    const syncOrientation = () => {
      const current = viewport.camera.quaternion;
      setCameraQuaternion([current.x, current.y, current.z, current.w]);
    };

    syncOrientation();
    return viewport.subscribeFrame(syncOrientation);
  }, [isActive, viewportReadyVersion]);

  useEffect(() => {
    if (!isActive || !selectedNPC || !contentLibrary) return;
    const viewport = getViewportRef.current();
    if (!viewport) return;

    viewport.updateFromNPC({
      npcDefinition: selectedNPC,
      contentLibrary,
      assetSources,
      activeAnimationSlot: effectiveAnimationSlot,
      isAnimationPlaying
    });
  }, [
    assetSources,
    contentLibrary,
    effectiveAnimationSlot,
    isActive,
    isAnimationPlaying,
    selectedNPC
  ]);

  const previewOverlay = (
    <>
      <Group
        gap="xs"
        wrap="nowrap"
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          zIndex: 10,
          padding: 8,
          borderRadius: 8,
          border: "1px solid var(--sm-panel-border)",
          background: "color-mix(in srgb, var(--sm-viewport-bg) 88%, black 12%)"
        }}
      >
        <Select
          size="xs"
          w={140}
          data={[
            { value: "__none__", label: "Static" },
            ...animationSlotOptions
          ]}
          value={effectiveAnimationSlot ?? "__none__"}
          onChange={(value) =>
            setActiveAnimationSlot(
              value && value !== "__none__"
                ? (value as NPCAnimationSlot)
                : null
            )
          }
          styles={{
            input: {
              background: "var(--sm-color-base)",
              borderColor: "var(--sm-panel-border)",
              color: "var(--sm-color-text)"
            },
            dropdown: {
              background: "var(--sm-color-surface1)",
              borderColor: "var(--sm-panel-border)"
            }
          }}
        />
        <Tooltip label={isAnimationPlaying ? "Pause preview" : "Play preview"}>
          <ActionIcon
            variant="subtle"
            color="green"
            onClick={() => setIsAnimationPlaying((value) => !value)}
            aria-label={isAnimationPlaying ? "Pause preview" : "Play preview"}
          >
            {isAnimationPlaying ? "❚❚" : "▶"}
          </ActionIcon>
        </Tooltip>
      </Group>
      <LayoutOrientationWidget quaternion={cameraQuaternion} />
    </>
  );

  const leftPanel = (
    <Stack gap={0} h="100%" style={{ minHeight: 0 }} onClick={() => setContextMenu(null)}>
      <Group
        justify="space-between"
        px="md"
        py="sm"
        style={{
          borderBottom: "1px solid var(--sm-panel-border)",
          color: "var(--sm-color-subtext)"
        }}
      >
        <Text size="xs" fw={600} tt="uppercase">
          NPCs
        </Text>
        <Tooltip label="Add NPC">
          <ActionIcon variant="subtle" size="sm" onClick={createNPC} aria-label="Add NPC">
            +
          </ActionIcon>
        </Tooltip>
      </Group>
      <Box p="sm" style={{ borderBottom: "1px solid var(--sm-panel-border)" }}>
        <TextInput
          size="xs"
          placeholder="Search NPCs..."
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.currentTarget.value)}
        />
      </Box>
      <ScrollArea style={{ flex: 1, minHeight: 0 }}>
        <Stack gap={4} p="xs">
          {filteredNPCs.map((definition) => {
            const isSelected = effectiveSelectedNpcId === definition.definitionId;
            return (
              <Box
                key={definition.definitionId}
                px="sm"
                py="xs"
                style={{
                  borderRadius: 8,
                  cursor: "pointer",
                  background: isSelected ? "var(--sm-active-bg)" : "transparent",
                  color: isSelected
                    ? "var(--sm-accent-blue)"
                    : "var(--sm-color-text)"
                }}
                onClick={() => setSelectedNpcId(definition.definitionId)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setSelectedNpcId(definition.definitionId);
                  setContextMenu({
                    x: event.clientX,
                    y: event.clientY,
                    definitionId: definition.definitionId
                  });
                }}
              >
                <Text size="sm" fw={500} truncate>
                  {definition.displayName}
                </Text>
              </Box>
            );
          })}
          {filteredNPCs.length === 0 && (
            <Text size="xs" c="var(--sm-color-overlay0)" p="md" ta="center">
              No NPCs yet.
            </Text>
          )}
        </Stack>
      </ScrollArea>
      <Menu
        opened={Boolean(contextMenu)}
        onChange={(opened) => {
          if (!opened) setContextMenu(null);
        }}
        withinPortal
        closeOnItemClick
        closeOnClickOutside
        position="bottom-start"
        offset={4}
        shadow="md"
      >
        <Menu.Target>
          <Box
            style={{
              position: "fixed",
              left: contextMenu?.x ?? -9999,
              top: contextMenu?.y ?? -9999,
              width: 1,
              height: 1
            }}
          />
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item
            color="red"
            onClick={() => {
              if (!contextMenu) return;
              deleteNPC(contextMenu.definitionId);
            }}
          >
            Delete
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Stack>
  );

  return {
    leftPanel,
    rightPanel: (
      <Inspector
        selectionLabel={selectedNPC?.displayName ?? "NPC"}
        selectionIcon="👤"
      >
        {selectedNPC ? (
          <Stack gap="lg">
            <Stack gap="xs">
              <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
                Identity
              </Text>
              <Select
                label="Interaction Mode"
                size="xs"
                description={
                  interactionModeOptions.find(
                    (option) => option.value === selectedNPC.interactionMode
                  )?.description
                }
                data={interactionModeOptions.map((option) => ({
                  value: option.value,
                  label: option.label
                }))}
                value={
                  availableInteractionModes.has(selectedNPC.interactionMode)
                    ? selectedNPC.interactionMode
                    : "scripted"
                }
                onChange={(value) => {
                  if (
                    value !== "scripted" &&
                    value !== "agent" &&
                    value !== "guided"
                  ) {
                    return;
                  }
                  updateNPC({
                    ...selectedNPC,
                    interactionMode: value
                  });
                }}
              />
              <TextInput
                label="Display Name"
                size="xs"
                value={selectedNPC.displayName}
                onChange={(event) =>
                  updateNPC({
                    ...selectedNPC,
                    displayName: event.currentTarget.value
                  })
                }
              />
              <Textarea
                label="Description"
                size="xs"
                minRows={3}
                autosize
                value={selectedNPC.description ?? ""}
                onChange={(event) =>
                  updateNPC({
                    ...selectedNPC,
                    description: event.currentTarget.value.trim().length > 0
                      ? event.currentTarget.value
                      : undefined
                  })
                }
              />
            </Stack>

            <Stack gap="xs">
              <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
                Lore Binding
              </Text>
              <TextInput
                label="Lore Page ID"
                size="xs"
                description="Canonical lore wiki page id for this NPC, for example root.characters.station_manager."
                placeholder="root.characters.station_manager"
                value={selectedNPC.lorePageId ?? ""}
                onChange={(event) =>
                  updateNPC({
                    ...selectedNPC,
                    lorePageId:
                      event.currentTarget.value.trim().length > 0
                        ? event.currentTarget.value.trim()
                        : null
                  })
                }
              />
            </Stack>

            <Stack gap="xs">
              <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
                Model
              </Text>
              <Select
                label="Model Asset"
                size="xs"
                clearable
                data={assetOptions}
                value={selectedNPC.presentation.modelAssetDefinitionId}
                onChange={(value) =>
                  updateNPC({
                    ...selectedNPC,
                    presentation: {
                      ...selectedNPC.presentation,
                      modelAssetDefinitionId: value
                    }
                  })
                }
              />
              <NumberInput
                label="Model Height"
                size="xs"
                min={0.5}
                max={4}
                step={0.05}
                value={selectedNPC.presentation.modelHeight}
                onChange={(value) => {
                  if (typeof value !== "number") return;
                  updateNPC({
                    ...selectedNPC,
                    presentation: {
                      ...selectedNPC.presentation,
                      modelHeight: value
                    }
                  });
                }}
              />
            </Stack>

            <Stack gap="xs">
              <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
                Animation Slots
              </Text>
              {(["idle", "walk", "run"] as NPCAnimationSlot[]).map((slot) => (
                <Select
                  key={slot}
                  label={slot[0]!.toUpperCase() + slot.slice(1)}
                  size="xs"
                  clearable
                  data={assetOptions}
                  value={selectedNPC.presentation.animationAssetBindings[slot]}
                  onChange={(value) =>
                    updateNPC({
                      ...selectedNPC,
                      presentation: {
                        ...selectedNPC.presentation,
                        animationAssetBindings: {
                          ...selectedNPC.presentation.animationAssetBindings,
                          [slot]: value
                        }
                      }
                    })
                  }
                />
              ))}
            </Stack>
          </Stack>
        ) : (
          <Text size="xs" c="var(--sm-color-overlay0)">
            No NPC selected.
          </Text>
        )}
      </Inspector>
    ),
    viewportOverlay: isActive && selectedNPC ? previewOverlay : null
  };
}
