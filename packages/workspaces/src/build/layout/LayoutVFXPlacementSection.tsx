/**
 * Layout VFX placement inspector section.
 *
 * Region-scoped VFX spawns live on `RegionDocument.vfx` and bind to reusable
 * VFX definitions authored in Library > VFX.
 */

import { useMemo, useState } from "react";
import {
  ActionIcon,
  Button,
  Group,
  NumberInput,
  Select,
  Stack,
  Text
} from "@mantine/core";
import {
  createRegionVFXSpawn,
  createRegionVFXState,
  type RegionDocument,
  type SemanticCommand,
  type VFXDefinition,
  type VFXSpawn
} from "@sugarmagic/domain";
import { PanelSection } from "@sugarmagic/ui";

export interface LayoutVFXPlacementSectionProps {
  region: RegionDocument;
  vfxDefinitions: VFXDefinition[];
  onCommand: (command: SemanticCommand) => void;
}

export function LayoutVFXPlacementSection({
  region,
  vfxDefinitions,
  onCommand
}: LayoutVFXPlacementSectionProps) {
  const regionVFX = region.vfx ?? createRegionVFXState();
  const [selectedSpawnId, setSelectedSpawnId] = useState<string | null>(null);
  const selectedSpawn =
    regionVFX.spawns.find((spawn) => spawn.spawnId === selectedSpawnId) ??
    null;
  const vfxOptions = useMemo(
    () =>
      vfxDefinitions.map((definition) => ({
        value: definition.definitionId,
        label: definition.displayName
      })),
    [vfxDefinitions]
  );

  function createSpawn() {
    const spawn = createRegionVFXSpawn({
      vfxDefinitionId: vfxDefinitions[0]?.definitionId ?? "",
      position: { x: 0, y: 0.2, z: 0 }
    });
    onCommand({
      kind: "CreateRegionVFXSpawn",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: { subjectKind: "region-vfx", subjectId: spawn.spawnId },
      payload: { spawn }
    });
    setSelectedSpawnId(spawn.spawnId);
  }

  function updateSpawn(spawn: VFXSpawn, patch: Partial<VFXSpawn>) {
    onCommand({
      kind: "UpdateRegionVFXSpawn",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: { subjectKind: "region-vfx", subjectId: spawn.spawnId },
      payload: { spawnId: spawn.spawnId, patch }
    });
  }

  function deleteSpawn(spawn: VFXSpawn) {
    onCommand({
      kind: "DeleteRegionVFXSpawn",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: { subjectKind: "region-vfx", subjectId: spawn.spawnId },
      payload: { spawnId: spawn.spawnId }
    });
    setSelectedSpawnId(null);
  }

  return (
    <PanelSection title="Ambient VFX">
      <Stack gap="sm">
        <Button
          size="xs"
          variant="light"
          disabled={vfxDefinitions.length === 0}
          onClick={createSpawn}
        >
          Add VFX Spawn
        </Button>
        {regionVFX.spawns.length === 0 ? (
          <Text size="xs" c="var(--sm-color-overlay0)">
            Add region-scoped emitters for torches, ambience, and other fixed
            world effects.
          </Text>
        ) : null}
        {regionVFX.spawns.map((spawn, index) => (
          <Group key={spawn.spawnId} gap="xs" justify="space-between">
            <Button
              size="xs"
              variant={selectedSpawn?.spawnId === spawn.spawnId ? "light" : "subtle"}
              onClick={() => setSelectedSpawnId(spawn.spawnId)}
            >
              VFX Spawn {index + 1}
            </Button>
            <ActionIcon
              size="sm"
              variant="subtle"
              color="red"
              aria-label="Remove VFX spawn"
              onClick={() => deleteSpawn(spawn)}
            >
              x
            </ActionIcon>
          </Group>
        ))}
        {selectedSpawn ? (
          <Stack gap="sm">
            <Select
              label="VFX Definition"
              size="xs"
              searchable
              data={vfxOptions}
              value={selectedSpawn.vfxDefinitionId || null}
              onChange={(value) =>
                updateSpawn(selectedSpawn, { vfxDefinitionId: value ?? "" })
              }
            />
            <Group gap="xs" grow>
              {(["x", "y", "z"] as const).map((axis) => (
                <NumberInput
                  key={axis}
                  label={`Position ${axis.toUpperCase()}`}
                  size="xs"
                  value={selectedSpawn.position[axis]}
                  onChange={(value) => {
                    if (typeof value !== "number") return;
                    updateSpawn(selectedSpawn, {
                      position: { ...selectedSpawn.position, [axis]: value }
                    });
                  }}
                />
              ))}
            </Group>
          </Stack>
        ) : null}
      </Stack>
    </PanelSection>
  );
}
