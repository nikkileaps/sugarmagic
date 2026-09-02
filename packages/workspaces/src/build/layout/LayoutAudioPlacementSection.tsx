/**
 * Layout audio placement inspector section.
 *
 * Layout owns one region application site for sound: emitters live on
 * `RegionDocument.audio` and bind to reusable cues authored in Build > Audio.
 * This keeps cue definitions and scene placement separate.
 *
 * A sound that plays while the player is inside an area is a volume with
 * Play Cue on enter and Stop Cue on exit, authored in Spatial. Volume
 * authoring has one home and this is not it.
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
  createRegionSoundEmitter,
  type RegionDocument,
  type RegionSoundEmitter,
  type SemanticCommand,
  type SoundCueDefinition
} from "@sugarmagic/domain";
import { PanelSection } from "@sugarmagic/ui";

type AudioSelection = { kind: "emitter"; id: string };

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
  const regionAudio = region.audio ?? { emitters: [] };
  const [selection, setSelection] = useState<AudioSelection | null>(null);
  const selectedEmitter =
    selection?.kind === "emitter"
      ? (regionAudio.emitters.find(
          (emitter) => emitter.emitterId === selection.id
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

  return (
    <PanelSection title="Audio Placement">
      <Stack gap="sm">
        <Group gap="xs">
          <Button size="xs" variant="light" onClick={createEmitter}>
            Add Emitter
          </Button>
        </Group>
        {regionAudio.emitters.length === 0 ? (
          <Text size="xs" c="var(--sm-color-overlay0)">
            Place emitters here, then bind them to cues from Build &gt; Audio.
          </Text>
        ) : null}
        <Text size="xs" c="var(--sm-color-overlay0)">
          For a sound that plays while the player is in an area, draw a volume
          in Spatial and give it Play Cue on enter and Stop Cue on exit.
        </Text>
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
      </Stack>
    </PanelSection>
  );
}
