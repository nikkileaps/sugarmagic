/**
 * packages/workspaces/src/design/NPCWorkspaceView.tsx
 *
 * Purpose: Renders the Design > NPCs workspace, including the NPC inspector.
 *
 * Exports:
 *   - NPCWorkspaceViewProps
 *   - useNPCWorkspaceView
 *
 * Relationships:
 *   - Owns canonical NPC authoring controls and viewport binding.
 *   - Accepts plugin-owned inspector sections that extend the NPC inspector without duplicating NPC state ownership.
 *
 * Implements: NPC authoring workspace / Epic 12 plugin inspector section seam
 *
 * Status: active
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ActionIcon,
  Box,
  Button,
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
  CharacterAnimationDefinition,
  CharacterModelDefinition,
  NPCAnimationSlot,
  NPCDefinition,
  NPCInteractionMode,
  SemanticCommand
} from "@sugarmagic/domain";
import type {
  DesignPreviewState,
  DesignPreviewStore
} from "@sugarmagic/shell";
import { createDefaultNPCDefinition } from "@sugarmagic/domain";
import { InlineAssetField, Inspector } from "@sugarmagic/ui";
import type { WorkspaceViewContribution } from "../workspace-view";
import { useVanillaStoreSelector } from "../use-vanilla-store";
import { CharacterPreview, type CharacterPreviewSlot } from "./CharacterPreview";

export interface NPCWorkspaceViewProps {
  isActive: boolean;
  gameProjectId: string | null;
  npcDefinitions: NPCDefinition[];
  interactionModeOptions: Array<{
    value: NPCInteractionMode;
    label: string;
    description?: string;
  }>;
  characterModelDefinitions: CharacterModelDefinition[];
  characterAnimationDefinitions: CharacterAnimationDefinition[];
  /** path → blob URL map for resolving model + animation glbs. */
  assetSources: Record<string, string>;
  designPreviewStore: DesignPreviewStore;
  onCommand: (command: SemanticCommand) => void;
  /**
   * Triggers a file-picker that imports a character model `.glb`
   * via IO into the project. Resolves to the new
   * `CharacterModelDefinition` so the inspector can bind it to
   * the selected NPC's `presentation.modelAssetDefinitionId`.
   * Resolves to `null` when the user cancels.
   */
  onImportCharacterModelDefinition: () => Promise<CharacterModelDefinition | null>;
  /**
   * Triggers a file-picker that imports a character animation `.glb`
   * via IO into the project. Resolves to the new
   * `CharacterAnimationDefinition` so the inspector can bind it to a
   * specific animation slot (idle / walk / run) on the selected NPC.
   * Resolves to `null` when the user cancels.
   */
  onImportCharacterAnimationDefinition: () => Promise<CharacterAnimationDefinition | null>;
  renderInspectorSections?: (context: {
    selectedNPC: NPCDefinition | null;
    updateNPC: (definition: NPCDefinition) => void;
  }) => ReactNode;
}

const NPC_ANIMATION_SLOT_LABELS: Record<NPCAnimationSlot, string> = {
  idle: "Idle",
  walk: "Walk",
  run: "Run"
};

export function useNPCWorkspaceView(
  props: NPCWorkspaceViewProps
): WorkspaceViewContribution {
  const {
    isActive,
    gameProjectId,
    npcDefinitions,
    interactionModeOptions,
    characterModelDefinitions,
    characterAnimationDefinitions,
    assetSources,
    designPreviewStore,
    onCommand,
    onImportCharacterModelDefinition,
    onImportCharacterAnimationDefinition,
    renderInspectorSections
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
  const activeAnimationSlot = useVanillaStoreSelector(
    designPreviewStore,
    (state: DesignPreviewState) =>
      state.activeAnimationSlot as NPCAnimationSlot | null
  );
  const isAnimationPlaying = useVanillaStoreSelector(
    designPreviewStore,
    (state: DesignPreviewState) => state.isAnimationPlaying
  );

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

  useEffect(() => {
    if (!isActive || !selectedNPC) return;
    designPreviewStore.getState().beginPreview(selectedNPC.definitionId);
    return () => {
      designPreviewStore.getState().endPreview();
    };
  }, [designPreviewStore, isActive, selectedNPC]);
  const filteredNPCs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return npcDefinitions;
    return npcDefinitions.filter((definition) =>
      definition.displayName.toLowerCase().includes(query)
    );
  }, [npcDefinitions, searchQuery]);
  const boundCharacterModel = useMemo(() => {
    if (!selectedNPC?.presentation.modelAssetDefinitionId) return null;
    return (
      characterModelDefinitions.find(
        (definition) =>
          definition.definitionId ===
          selectedNPC.presentation.modelAssetDefinitionId
      ) ?? null
    );
  }, [characterModelDefinitions, selectedNPC]);
  // Preview slot list — one entry per NPC animation slot, with each
  // slot's resolved CharacterAnimationDefinition attached so the
  // CharacterPreview component can pre-load and cheaply swap clips.
  const previewSlots = useMemo<CharacterPreviewSlot[]>(() => {
    if (!selectedNPC) return [];
    return (Object.keys(NPC_ANIMATION_SLOT_LABELS) as NPCAnimationSlot[]).map(
      (slot) => {
        const bindingId =
          selectedNPC.presentation.animationAssetBindings[slot] ?? null;
        const animation = bindingId
          ? characterAnimationDefinitions.find(
              (definition) => definition.definitionId === bindingId
            ) ?? null
          : null;
        return {
          value: slot,
          label: NPC_ANIMATION_SLOT_LABELS[slot],
          animation
        };
      }
    );
  }, [selectedNPC, characterAnimationDefinitions]);

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

  const centerPanel = (
    <CharacterPreview
      model={boundCharacterModel}
      targetHeight={selectedNPC?.presentation.modelHeight ?? 1.7}
      slots={previewSlots}
      activeSlot={activeAnimationSlot}
      onChangeActiveSlot={(slot) =>
        designPreviewStore
          .getState()
          .setAnimationSlot(slot ? (slot as NPCAnimationSlot) : null)
      }
      isPlaying={isAnimationPlaying}
      onChangePlaying={(playing) =>
        designPreviewStore.getState().setAnimationPlaying(playing)
      }
      assetSources={assetSources}
    />
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
                  if (value !== "scripted" && value !== "agent") {
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
              <InlineAssetField
                label="Model"
                value={boundCharacterModel?.source.relativeAssetPath ?? null}
                hasBoundId={Boolean(selectedNPC.presentation.modelAssetDefinitionId)}
                onImport={async () => {
                  const next = await onImportCharacterModelDefinition();
                  return next?.definitionId ?? null;
                }}
                onChange={(definitionId) =>
                  updateNPC({
                    ...selectedNPC,
                    presentation: {
                      ...selectedNPC.presentation,
                      modelAssetDefinitionId: definitionId
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
              {(["idle", "walk", "run"] as NPCAnimationSlot[]).map((slot) => {
                const boundId =
                  selectedNPC.presentation.animationAssetBindings[slot];
                const bound = boundId
                  ? characterAnimationDefinitions.find(
                      (definition) => definition.definitionId === boundId
                    ) ?? null
                  : null;
                const slotLabel = slot[0]!.toUpperCase() + slot.slice(1);
                return (
                  <Stack key={slot} gap={4}>
                    <Text size="xs" fw={500}>
                      {slotLabel}
                    </Text>
                    {bound ? (
                      <Stack gap={4}>
                        <Text size="xs">{bound.displayName}</Text>
                        <Text size="xs" c="var(--sm-color-overlay0)">
                          {bound.source.relativeAssetPath}
                        </Text>
                        <Group gap="xs">
                          <Button
                            size="compact-xs"
                            variant="light"
                            onClick={async () => {
                              const next = await onImportCharacterAnimationDefinition();
                              if (!next) return;
                              updateNPC({
                                ...selectedNPC,
                                presentation: {
                                  ...selectedNPC.presentation,
                                  animationAssetBindings: {
                                    ...selectedNPC.presentation.animationAssetBindings,
                                    [slot]: next.definitionId
                                  }
                                }
                              });
                            }}
                          >
                            Replace…
                          </Button>
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            color="red"
                            onClick={() =>
                              updateNPC({
                                ...selectedNPC,
                                presentation: {
                                  ...selectedNPC.presentation,
                                  animationAssetBindings: {
                                    ...selectedNPC.presentation.animationAssetBindings,
                                    [slot]: null
                                  }
                                }
                              })
                            }
                          >
                            Clear
                          </Button>
                        </Group>
                      </Stack>
                    ) : (
                      <Stack gap={4}>
                        {boundId ? (
                          <Text size="xs" c="red">
                            Bound animation is missing from the project — re-import.
                          </Text>
                        ) : null}
                        <Button
                          size="xs"
                          variant="light"
                          onClick={async () => {
                            const next = await onImportCharacterAnimationDefinition();
                            if (!next) return;
                            updateNPC({
                              ...selectedNPC,
                              presentation: {
                                ...selectedNPC.presentation,
                                animationAssetBindings: {
                                  ...selectedNPC.presentation.animationAssetBindings,
                                  [slot]: next.definitionId
                                }
                              }
                            });
                          }}
                        >
                          Import Animation…
                        </Button>
                      </Stack>
                    )}
                  </Stack>
                );
              })}
            </Stack>

            {renderInspectorSections?.({
              selectedNPC,
              updateNPC
            }) ?? null}
          </Stack>
        ) : (
          <Text size="xs" c="var(--sm-color-overlay0)">
            No NPC selected.
          </Text>
        )}
      </Inspector>
    ),
    centerPanel: isActive && selectedNPC ? centerPanel : null,
    viewportOverlay: null
  };
}
