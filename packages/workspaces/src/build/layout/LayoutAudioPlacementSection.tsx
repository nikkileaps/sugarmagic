/**
 * Layout audio placement inspector section.
 *
 * Layout owns region application sites for sound: emitters and ambience zones
 * live on `RegionDocument.audio` and bind to reusable cues authored in
 * Build > Audio. This keeps cue definitions and scene placement separate.
 */

import { useMemo, useState } from "react";
import {
  ActionIcon,
  Button,
  Group,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput
} from "@mantine/core";
import {
  createRegionAmbienceZone,
  createRegionSoundEmitter,
  type RegionAmbienceZone,
  type RegionDocument,
  type RegionSoundEmitter,
  type SemanticCommand,
  type SoundCueDefinition
} from "@sugarmagic/domain";
import { PanelSection } from "@sugarmagic/ui";

type AudioSelection =
  | { kind: "emitter"; id: string }
  | { kind: "zone"; id: string };

export interface LayoutAudioPlacementSectionProps {
  region: RegionDocument;
  soundCueDefinitions: SoundCueDefinition[];
  onCommand: (command: SemanticCommand) => void;
}

function updateTuple(
  tuple: [number, number, number],
  index: 0 | 1 | 2,
  value: string | number
): [number, number, number] {
  const next = [...tuple] as [number, number, number];
  next[index] = typeof value === "number" ? value : tuple[index];
  return next;
}

export function LayoutAudioPlacementSection({
  region,
  soundCueDefinitions,
  onCommand
}: LayoutAudioPlacementSectionProps) {
  const regionAudio = region.audio ?? { emitters: [], ambienceZones: [] };
  const [selection, setSelection] = useState<AudioSelection | null>(null);
  const selectedEmitter =
    selection?.kind === "emitter"
      ? (regionAudio.emitters.find(
          (emitter) => emitter.emitterId === selection.id
        ) ?? null)
      : null;
  const selectedZone =
    selection?.kind === "zone"
      ? (regionAudio.ambienceZones.find(
          (zone) => zone.zoneId === selection.id
        ) ?? null)
      : null;
  const cueOptions = useMemo(
    () =>
      soundCueDefinitions.map((definition) => ({
        value: definition.definitionId,
        label: definition.displayName
      })),
    [soundCueDefinitions]
  );

  function createEmitter() {
    const emitter = createRegionSoundEmitter({
      displayName: `Emitter ${regionAudio.emitters.length + 1}`,
      cueDefinitionId: soundCueDefinitions[0]?.definitionId ?? null
    });
    onCommand({
      kind: "CreateRegionSoundEmitter",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: { subjectKind: "region-audio", subjectId: emitter.emitterId },
      payload: { emitter }
    });
    setSelection({ kind: "emitter", id: emitter.emitterId });
  }

  function createZone() {
    const zone = createRegionAmbienceZone({
      displayName: `Ambience Zone ${regionAudio.ambienceZones.length + 1}`,
      cueDefinitionId: soundCueDefinitions[0]?.definitionId ?? null
    });
    onCommand({
      kind: "CreateRegionAmbienceZone",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: { subjectKind: "region-audio", subjectId: zone.zoneId },
      payload: { zone }
    });
    setSelection({ kind: "zone", id: zone.zoneId });
  }

  function updateEmitter(
    emitter: RegionSoundEmitter,
    patch: Partial<RegionSoundEmitter>
  ) {
    onCommand({
      kind: "UpdateRegionSoundEmitter",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: { subjectKind: "region-audio", subjectId: emitter.emitterId },
      payload: { emitterId: emitter.emitterId, patch }
    });
  }

  function updateZone(
    zone: RegionAmbienceZone,
    patch: Partial<RegionAmbienceZone>
  ) {
    onCommand({
      kind: "UpdateRegionAmbienceZone",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: { subjectKind: "region-audio", subjectId: zone.zoneId },
      payload: { zoneId: zone.zoneId, patch }
    });
  }

  function deleteEmitter(emitter: RegionSoundEmitter) {
    onCommand({
      kind: "DeleteRegionSoundEmitter",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: { subjectKind: "region-audio", subjectId: emitter.emitterId },
      payload: { emitterId: emitter.emitterId }
    });
    setSelection(null);
  }

  function deleteZone(zone: RegionAmbienceZone) {
    onCommand({
      kind: "DeleteRegionAmbienceZone",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: { subjectKind: "region-audio", subjectId: zone.zoneId },
      payload: { zoneId: zone.zoneId }
    });
    setSelection(null);
  }

  return (
    <PanelSection title="Audio Placement">
      <Stack gap="sm">
        <Group gap="xs">
          <Button size="xs" variant="light" onClick={createEmitter}>
            Add Emitter
          </Button>
          <Button size="xs" variant="light" onClick={createZone}>
            Add Ambience Zone
          </Button>
        </Group>
        {regionAudio.emitters.length === 0 &&
        regionAudio.ambienceZones.length === 0 ? (
          <Text size="xs" c="var(--sm-color-overlay0)">
            Place emitters or ambience zones here, then bind them to cues from
            Build &gt; Audio.
          </Text>
        ) : null}
        {regionAudio.emitters.map((emitter) => (
          <Group key={emitter.emitterId} gap="xs" justify="space-between">
            <Button
              size="xs"
              variant={
                selectedEmitter?.emitterId === emitter.emitterId
                  ? "light"
                  : "subtle"
              }
              onClick={() =>
                setSelection({ kind: "emitter", id: emitter.emitterId })
              }
            >
              {emitter.displayName}
            </Button>
            <ActionIcon
              size="sm"
              variant="subtle"
              color="red"
              aria-label={`Remove ${emitter.displayName}`}
              onClick={() => deleteEmitter(emitter)}
            >
              x
            </ActionIcon>
          </Group>
        ))}
        {regionAudio.ambienceZones.map((zone) => (
          <Group key={zone.zoneId} gap="xs" justify="space-between">
            <Button
              size="xs"
              variant={
                selectedZone?.zoneId === zone.zoneId ? "light" : "subtle"
              }
              onClick={() => setSelection({ kind: "zone", id: zone.zoneId })}
            >
              {zone.displayName}
            </Button>
            <ActionIcon
              size="sm"
              variant="subtle"
              color="red"
              aria-label={`Remove ${zone.displayName}`}
              onClick={() => deleteZone(zone)}
            >
              x
            </ActionIcon>
          </Group>
        ))}
        {selectedEmitter ? (
          <Stack gap="sm">
            <TextInput
              label="Emitter Name"
              size="xs"
              value={selectedEmitter.displayName}
              onChange={(event) =>
                updateEmitter(selectedEmitter, {
                  displayName: event.currentTarget.value
                })
              }
            />
            <Select
              label="Cue"
              size="xs"
              data={cueOptions}
              value={selectedEmitter.cueDefinitionId}
              onChange={(value) =>
                updateEmitter(selectedEmitter, { cueDefinitionId: value })
              }
              placeholder="Select cue..."
            />
            <Switch
              label="Enabled"
              size="xs"
              checked={selectedEmitter.enabled}
              onChange={(event) =>
                updateEmitter(selectedEmitter, {
                  enabled: event.currentTarget.checked
                })
              }
            />
            <NumberInput
              label="Radius"
              size="xs"
              min={0.1}
              step={0.5}
              value={selectedEmitter.radius}
              onChange={(value) =>
                updateEmitter(selectedEmitter, {
                  radius:
                    typeof value === "number" ? value : selectedEmitter.radius
                })
              }
            />
            <Group grow>
              <NumberInput
                label="X"
                size="xs"
                value={selectedEmitter.position[0]}
                onChange={(value) =>
                  updateEmitter(selectedEmitter, {
                    position: updateTuple(selectedEmitter.position, 0, value)
                  })
                }
              />
              <NumberInput
                label="Y"
                size="xs"
                value={selectedEmitter.position[1]}
                onChange={(value) =>
                  updateEmitter(selectedEmitter, {
                    position: updateTuple(selectedEmitter.position, 1, value)
                  })
                }
              />
              <NumberInput
                label="Z"
                size="xs"
                value={selectedEmitter.position[2]}
                onChange={(value) =>
                  updateEmitter(selectedEmitter, {
                    position: updateTuple(selectedEmitter.position, 2, value)
                  })
                }
              />
            </Group>
          </Stack>
        ) : null}
        {selectedZone ? (
          <Stack gap="sm">
            <TextInput
              label="Zone Name"
              size="xs"
              value={selectedZone.displayName}
              onChange={(event) =>
                updateZone(selectedZone, {
                  displayName: event.currentTarget.value
                })
              }
            />
            <Select
              label="Cue"
              size="xs"
              data={cueOptions}
              value={selectedZone.cueDefinitionId}
              onChange={(value) =>
                updateZone(selectedZone, { cueDefinitionId: value })
              }
              placeholder="Select cue..."
            />
            <Select
              label="Trigger"
              size="xs"
              data={[
                { value: "always", label: "Always" },
                { value: "on-enter", label: "On Enter" }
              ]}
              value={selectedZone.trigger}
              onChange={(value) =>
                value &&
                updateZone(selectedZone, {
                  trigger: value as RegionAmbienceZone["trigger"]
                })
              }
            />
            <Switch
              label="Enabled"
              size="xs"
              checked={selectedZone.enabled}
              onChange={(event) =>
                updateZone(selectedZone, {
                  enabled: event.currentTarget.checked
                })
              }
            />
            <Group grow>
              <NumberInput
                label="Center X"
                size="xs"
                value={selectedZone.center[0]}
                onChange={(value) =>
                  updateZone(selectedZone, {
                    center: updateTuple(selectedZone.center, 0, value)
                  })
                }
              />
              <NumberInput
                label="Center Y"
                size="xs"
                value={selectedZone.center[1]}
                onChange={(value) =>
                  updateZone(selectedZone, {
                    center: updateTuple(selectedZone.center, 1, value)
                  })
                }
              />
              <NumberInput
                label="Center Z"
                size="xs"
                value={selectedZone.center[2]}
                onChange={(value) =>
                  updateZone(selectedZone, {
                    center: updateTuple(selectedZone.center, 2, value)
                  })
                }
              />
            </Group>
            <Group grow>
              <NumberInput
                label="Width"
                size="xs"
                min={0.1}
                value={selectedZone.size[0]}
                onChange={(value) =>
                  updateZone(selectedZone, {
                    size: updateTuple(selectedZone.size, 0, value)
                  })
                }
              />
              <NumberInput
                label="Height"
                size="xs"
                min={0.1}
                value={selectedZone.size[1]}
                onChange={(value) =>
                  updateZone(selectedZone, {
                    size: updateTuple(selectedZone.size, 1, value)
                  })
                }
              />
              <NumberInput
                label="Depth"
                size="xs"
                min={0.1}
                value={selectedZone.size[2]}
                onChange={(value) =>
                  updateZone(selectedZone, {
                    size: updateTuple(selectedZone.size, 2, value)
                  })
                }
              />
            </Group>
          </Stack>
        ) : null}
      </Stack>
    </PanelSection>
  );
}
