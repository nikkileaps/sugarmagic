import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip
} from "@mantine/core";
import type {
  AssetDefinition,
  ContentLibrarySnapshot,
  PlayerAnimationSlot,
  PlayerDefinition,
  SemanticCommand
} from "@sugarmagic/domain";
import { Inspector } from "@sugarmagic/ui";
import type { WorkspaceViewContribution } from "../workspace-view";
import type { PlayerWorkspaceViewport } from "../viewport";
import { LayoutOrientationWidget } from "../build/layout/LayoutOrientationWidget";
import { createPlayerCameraController } from "./player-camera-controller";

export interface PlayerWorkspaceViewProps {
  isActive: boolean;
  viewportReadyVersion: number;
  gameProjectId: string | null;
  playerDefinition: PlayerDefinition | null;
  contentLibrary: ContentLibrarySnapshot | null;
  assetDefinitions: AssetDefinition[];
  assetSources: Record<string, string>;
  getViewport: () => PlayerWorkspaceViewport | null;
  getViewportElement: () => HTMLElement | null;
  onCommand: (command: SemanticCommand) => void;
}

function toAssetOptions(assetDefinitions: AssetDefinition[]) {
  return assetDefinitions.map((definition) => ({
    value: definition.definitionId,
    label: definition.displayName
  }));
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
    viewportReadyVersion,
    gameProjectId,
    playerDefinition,
    contentLibrary,
    assetDefinitions,
    assetSources,
    getViewport,
    getViewportElement,
    onCommand
  } = props;

  const [activeAnimationSlot, setActiveAnimationSlot] =
    useState<PlayerAnimationSlot | null>("idle");
  const [isAnimationPlaying, setIsAnimationPlaying] = useState(true);
  const [cameraQuaternion, setCameraQuaternion] =
    useState<[number, number, number, number]>([0, 0, 0, 1]);
  const cameraControllerRef = useRef(createPlayerCameraController());
  const getViewportRef = useRef(getViewport);
  const getViewportElementRef = useRef(getViewportElement);

  useEffect(() => {
    getViewportRef.current = getViewport;
    getViewportElementRef.current = getViewportElement;
  }, [getViewport, getViewportElement]);

  const assetOptions = useMemo(() => toAssetOptions(assetDefinitions), [assetDefinitions]);
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

  useEffect(() => {
    if (!isActive || !playerDefinition) return;

    const viewport = getViewportRef.current();
    const viewportElement = getViewportElementRef.current();
    if (!viewport || !viewportElement) return;
    const cameraController = cameraControllerRef.current;

    const targetY = Math.max(
      playerDefinition.physicalProfile.eyeHeight * 0.7,
      playerDefinition.physicalProfile.height * 0.5
    );

    cameraController.attach(
      viewport.camera,
      viewportElement,
      viewport.subscribeFrame,
      targetY
    );

    return () => {
      cameraController.detach();
    };
  }, [isActive, viewportReadyVersion, playerDefinition]);

  useEffect(() => {
    if (!isActive || !playerDefinition) return;
    cameraControllerRef.current.updateTarget(
      Math.max(
        playerDefinition.physicalProfile.eyeHeight * 0.7,
        playerDefinition.physicalProfile.height * 0.5
      )
    );
  }, [isActive, playerDefinition]);

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
    if (!isActive || !playerDefinition || !contentLibrary) return;
    const viewport = getViewportRef.current();
    if (!viewport) return;

    viewport.updateFromPlayer({
      playerDefinition,
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
    playerDefinition
  ]);

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
            setActiveAnimationSlot(
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
                Model
              </Text>
              <Select
                label="Model Asset"
                size="xs"
                clearable
                data={assetOptions}
                value={playerDefinition.presentation.modelAssetDefinitionId}
                onChange={(value) =>
                  updatePlayerDefinition({
                    ...playerDefinition,
                    presentation: {
                      ...playerDefinition.presentation,
                      modelAssetDefinitionId: value
                    }
                  })
                }
              />
            </Stack>

            <Stack gap="xs">
              <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
                Animation Slots
              </Text>
              {(["idle", "walk", "run"] as PlayerAnimationSlot[]).map((slot) => (
                <Select
                  key={slot}
                  label={slot[0]!.toUpperCase() + slot.slice(1)}
                  size="xs"
                  clearable
                  data={assetOptions}
                  value={playerDefinition.presentation.animationAssetBindings[slot]}
                  onChange={(value) =>
                    updatePlayerDefinition({
                      ...playerDefinition,
                      presentation: {
                        ...playerDefinition.presentation,
                        animationAssetBindings: {
                          ...playerDefinition.presentation.animationAssetBindings,
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
            No player definition is loaded.
          </Text>
        )}
      </Inspector>
    ),
    viewportOverlay: isActive ? previewOverlay : null
  };
}
