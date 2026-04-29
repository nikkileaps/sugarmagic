import { useEffect, useMemo } from "react";
import {
  ActionIcon,
  Button,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip
} from "@mantine/core";
import type {
  CharacterAnimationDefinition,
  CharacterModelDefinition,
  PlayerAnimationSlot,
  PlayerDefinition,
  SemanticCommand
} from "@sugarmagic/domain";
import type {
  DesignPreviewState,
  DesignPreviewStore
} from "@sugarmagic/shell";
import { Inspector } from "@sugarmagic/ui";
import type { WorkspaceViewContribution } from "../workspace-view";
import { LayoutOrientationWidget } from "../build/layout/LayoutOrientationWidget";
import { useVanillaStoreSelector } from "../use-vanilla-store";

export interface PlayerWorkspaceViewProps {
  isActive: boolean;
  gameProjectId: string | null;
  playerDefinition: PlayerDefinition | null;
  characterModelDefinitions: CharacterModelDefinition[];
  characterAnimationDefinitions: CharacterAnimationDefinition[];
  designPreviewStore: DesignPreviewStore;
  onCommand: (command: SemanticCommand) => void;
  /**
   * Triggers a file-picker that imports a character model `.glb`
   * via IO into the project. Resolves to the new
   * `CharacterModelDefinition` so the inspector can bind it to
   * `playerDefinition.presentation.modelAssetDefinitionId`. Resolves
   * to `null` when the user cancels the picker.
   */
  onImportCharacterModelDefinition: () => Promise<CharacterModelDefinition | null>;
  /**
   * Triggers a file-picker that imports a character animation `.glb`
   * via IO into the project. Resolves to the new
   * `CharacterAnimationDefinition` so the inspector can bind it to a
   * specific animation slot (idle / walk / run). Resolves to `null`
   * when the user cancels the picker.
   */
  onImportCharacterAnimationDefinition: () => Promise<CharacterAnimationDefinition | null>;
}

const IDENTITY_QUATERNION: [number, number, number, number] = [0, 0, 0, 1];

function parseTagList(value: string): string[] {
  return value
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function boundAnimationSlotOptions(playerDefinition: PlayerDefinition | null) {
  if (!playerDefinition) return [];

  const labels: Record<PlayerAnimationSlot, string> = {
    idle: "Idle",
    walk: "Walk",
    run: "Run"
  };

  return (Object.entries(
    playerDefinition.presentation.animationAssetBindings
  ) as Array<[PlayerAnimationSlot, string | null]>)
    .filter(([, definitionId]) => Boolean(definitionId))
    .map(([slot]) => ({
      value: slot,
      label: labels[slot]
    }));
}

export function usePlayerWorkspaceView(
  props: PlayerWorkspaceViewProps
): WorkspaceViewContribution {
  const {
    isActive,
    gameProjectId,
    playerDefinition,
    characterModelDefinitions,
    characterAnimationDefinitions,
    designPreviewStore,
    onCommand,
    onImportCharacterModelDefinition,
    onImportCharacterAnimationDefinition
  } = props;

  const activeAnimationSlot = useVanillaStoreSelector(
    designPreviewStore,
    (state: DesignPreviewState) =>
      state.activeAnimationSlot as PlayerAnimationSlot | null
  );
  const isAnimationPlaying = useVanillaStoreSelector(
    designPreviewStore,
    (state: DesignPreviewState) => state.isAnimationPlaying
  );
  const cameraQuaternion = useVanillaStoreSelector(
    designPreviewStore,
    (state: DesignPreviewState) =>
      state.cameraFraming?.quaternion ?? IDENTITY_QUATERNION
  );

  useEffect(() => {
    if (!isActive || !playerDefinition) return;
    designPreviewStore.getState().beginPreview(playerDefinition.definitionId);
    return () => {
      designPreviewStore.getState().endPreview();
    };
  }, [designPreviewStore, isActive, playerDefinition]);

  const boundCharacterModel = useMemo(() => {
    if (!playerDefinition?.presentation.modelAssetDefinitionId) return null;
    return (
      characterModelDefinitions.find(
        (definition) =>
          definition.definitionId ===
          playerDefinition.presentation.modelAssetDefinitionId
      ) ?? null
    );
  }, [characterModelDefinitions, playerDefinition]);
  const animationSlotOptions = useMemo(
    () => boundAnimationSlotOptions(playerDefinition),
    [playerDefinition]
  );
  const effectiveAnimationSlot = useMemo(() => {
    if (!playerDefinition) return null;
    if (
      activeAnimationSlot &&
      playerDefinition.presentation.animationAssetBindings[activeAnimationSlot]
    ) {
      return activeAnimationSlot;
    }

    return (animationSlotOptions[0]?.value as PlayerAnimationSlot | undefined) ?? null;
  }, [activeAnimationSlot, animationSlotOptions, playerDefinition]);

  function updatePlayerDefinition(nextDefinition: PlayerDefinition) {
    if (!gameProjectId) return;
    onCommand({
      kind: "UpdatePlayerDefinition",
      target: {
        aggregateKind: "game-project",
        aggregateId: gameProjectId
      },
      subject: {
        subjectKind: "player-definition",
        subjectId: nextDefinition.definitionId
      },
      payload: {
        definition: nextDefinition
      }
    });
  }

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
            designPreviewStore.getState().setAnimationSlot(
              value && value !== "__none__"
                ? (value as PlayerAnimationSlot)
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
            color="blue"
            onClick={() =>
              designPreviewStore
                .getState()
                .setAnimationPlaying(!isAnimationPlaying)
            }
            aria-label={isAnimationPlaying ? "Pause preview" : "Play preview"}
          >
            {isAnimationPlaying ? "❚❚" : "▶"}
          </ActionIcon>
        </Tooltip>
      </Group>
      <LayoutOrientationWidget quaternion={cameraQuaternion} />
    </>
  );

  return {
    leftPanel: null,
    rightPanel: (
      <Inspector
        selectionLabel={playerDefinition?.displayName ?? "Player"}
        selectionIcon="🧙"
      >
        {playerDefinition ? (
          <Stack gap="lg">
            <Stack gap="xs">
              <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
                Identity
              </Text>
              <TextInput
                label="Name"
                size="xs"
                value={playerDefinition.displayName}
                onChange={(event) =>
                  updatePlayerDefinition({
                    ...playerDefinition,
                    displayName: event.currentTarget.value
                  })
                }
              />
            </Stack>

            <Stack gap="xs">
              <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
                Physical
              </Text>
              <NumberInput
                label="Height (m)"
                size="xs"
                min={0.5}
                max={4}
                step={0.05}
                value={playerDefinition.physicalProfile.height}
                onChange={(value) => {
                  if (typeof value !== "number") return;
                  updatePlayerDefinition({
                    ...playerDefinition,
                    physicalProfile: {
                      ...playerDefinition.physicalProfile,
                      height: value
                    }
                  });
                }}
              />
              <NumberInput
                label="Radius (m)"
                size="xs"
                min={0.1}
                max={1}
                step={0.01}
                value={playerDefinition.physicalProfile.radius}
                onChange={(value) => {
                  if (typeof value !== "number") return;
                  updatePlayerDefinition({
                    ...playerDefinition,
                    physicalProfile: {
                      ...playerDefinition.physicalProfile,
                      radius: value
                    }
                  });
                }}
              />
              <NumberInput
                label="Eye Height (m)"
                size="xs"
                min={0.2}
                max={3}
                step={0.05}
                value={playerDefinition.physicalProfile.eyeHeight}
                onChange={(value) => {
                  if (typeof value !== "number") return;
                  updatePlayerDefinition({
                    ...playerDefinition,
                    physicalProfile: {
                      ...playerDefinition.physicalProfile,
                      eyeHeight: value
                    }
                  });
                }}
              />
            </Stack>

            <Stack gap="xs">
              <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
                Movement
              </Text>
              <NumberInput
                label="Walk Speed"
                size="xs"
                min={0.1}
                max={20}
                step={0.1}
                value={playerDefinition.movementProfile.walkSpeed}
                onChange={(value) => {
                  if (typeof value !== "number") return;
                  updatePlayerDefinition({
                    ...playerDefinition,
                    movementProfile: {
                      ...playerDefinition.movementProfile,
                      walkSpeed: value
                    }
                  });
                }}
              />
              <NumberInput
                label="Run Speed"
                size="xs"
                min={0.1}
                max={30}
                step={0.1}
                value={playerDefinition.movementProfile.runSpeed}
                onChange={(value) => {
                  if (typeof value !== "number") return;
                  updatePlayerDefinition({
                    ...playerDefinition,
                    movementProfile: {
                      ...playerDefinition.movementProfile,
                      runSpeed: value
                    }
                  });
                }}
              />
              <NumberInput
                label="Acceleration"
                size="xs"
                min={0.1}
                max={50}
                step={0.1}
                value={playerDefinition.movementProfile.acceleration}
                onChange={(value) => {
                  if (typeof value !== "number") return;
                  updatePlayerDefinition({
                    ...playerDefinition,
                    movementProfile: {
                      ...playerDefinition.movementProfile,
                      acceleration: value
                    }
                  });
                }}
              />
            </Stack>

            <Stack gap="xs">
              <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
                Caster
              </Text>
              <NumberInput
                label="Initial Battery (%)"
                size="xs"
                min={0}
                max={100}
                step={1}
                value={playerDefinition.casterProfile.initialBattery}
                onChange={(value) => {
                  if (typeof value !== "number") return;
                  updatePlayerDefinition({
                    ...playerDefinition,
                    casterProfile: {
                      ...playerDefinition.casterProfile,
                      initialBattery: value
                    }
                  });
                }}
              />
              <NumberInput
                label="Recharge Rate (% / min)"
                size="xs"
                min={0}
                max={10}
                step={0.05}
                value={playerDefinition.casterProfile.rechargeRate}
                onChange={(value) => {
                  if (typeof value !== "number") return;
                  updatePlayerDefinition({
                    ...playerDefinition,
                    casterProfile: {
                      ...playerDefinition.casterProfile,
                      rechargeRate: value
                    }
                  });
                }}
              />
              <NumberInput
                label="Initial Resonance (%)"
                size="xs"
                min={0}
                max={100}
                step={1}
                value={playerDefinition.casterProfile.initialResonance}
                onChange={(value) => {
                  if (typeof value !== "number") return;
                  updatePlayerDefinition({
                    ...playerDefinition,
                    casterProfile: {
                      ...playerDefinition.casterProfile,
                      initialResonance: value
                    }
                  });
                }}
              />
              <TextInput
                label="Allowed Tags"
                size="xs"
                description="Comma-separated spell tags"
                value={playerDefinition.casterProfile.allowedSpellTags.join(", ")}
                onChange={(event) =>
                  updatePlayerDefinition({
                    ...playerDefinition,
                    casterProfile: {
                      ...playerDefinition.casterProfile,
                      allowedSpellTags: parseTagList(event.currentTarget.value)
                    }
                  })
                }
              />
              <TextInput
                label="Blocked Tags"
                size="xs"
                description="Comma-separated spell tags"
                value={playerDefinition.casterProfile.blockedSpellTags.join(", ")}
                onChange={(event) =>
                  updatePlayerDefinition({
                    ...playerDefinition,
                    casterProfile: {
                      ...playerDefinition.casterProfile,
                      blockedSpellTags: parseTagList(event.currentTarget.value)
                    }
                  })
                }
              />
            </Stack>

            <Stack gap="xs">
              <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
                Model
              </Text>
              {boundCharacterModel ? (
                <Stack gap={4}>
                  <Text size="xs">{boundCharacterModel.displayName}</Text>
                  <Text size="xs" c="var(--sm-color-overlay0)">
                    {boundCharacterModel.source.relativeAssetPath}
                  </Text>
                  <Group gap="xs">
                    <Button
                      size="compact-xs"
                      variant="light"
                      onClick={async () => {
                        const next = await onImportCharacterModelDefinition();
                        if (!next) return;
                        updatePlayerDefinition({
                          ...playerDefinition,
                          presentation: {
                            ...playerDefinition.presentation,
                            modelAssetDefinitionId: next.definitionId
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
                        updatePlayerDefinition({
                          ...playerDefinition,
                          presentation: {
                            ...playerDefinition.presentation,
                            modelAssetDefinitionId: null
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
                  {playerDefinition.presentation.modelAssetDefinitionId ? (
                    <Text size="xs" c="red">
                      Bound model is missing from the project — re-import.
                    </Text>
                  ) : (
                    <Text size="xs" c="var(--sm-color-overlay0)">
                      No model bound. The player will render as a capsule.
                    </Text>
                  )}
                  <Button
                    size="xs"
                    variant="light"
                    onClick={async () => {
                      const next = await onImportCharacterModelDefinition();
                      if (!next) return;
                      updatePlayerDefinition({
                        ...playerDefinition,
                        presentation: {
                          ...playerDefinition.presentation,
                          modelAssetDefinitionId: next.definitionId
                        }
                      });
                    }}
                  >
                    Import Character Model…
                  </Button>
                </Stack>
              )}
            </Stack>

            <Stack gap="xs">
              <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
                Animation Slots
              </Text>
              {(["idle", "walk", "run"] as PlayerAnimationSlot[]).map((slot) => {
                const boundId =
                  playerDefinition.presentation.animationAssetBindings[slot];
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
                              updatePlayerDefinition({
                                ...playerDefinition,
                                presentation: {
                                  ...playerDefinition.presentation,
                                  animationAssetBindings: {
                                    ...playerDefinition.presentation.animationAssetBindings,
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
                              updatePlayerDefinition({
                                ...playerDefinition,
                                presentation: {
                                  ...playerDefinition.presentation,
                                  animationAssetBindings: {
                                    ...playerDefinition.presentation.animationAssetBindings,
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
                            updatePlayerDefinition({
                              ...playerDefinition,
                              presentation: {
                                ...playerDefinition.presentation,
                                animationAssetBindings: {
                                  ...playerDefinition.presentation.animationAssetBindings,
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
          </Stack>
        ) : (
          <Text size="xs" c="var(--sm-color-overlay0)">
            No player definition is loaded.
          </Text>
        )}
      </Inspector>
    ),
    viewportOverlay: isActive ? previewOverlay : null
  };
}
