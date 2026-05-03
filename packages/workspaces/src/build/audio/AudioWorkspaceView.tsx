/**
 * Build audio cue workspace.
 *
 * Build > Audio owns reusable `SoundCueDefinition` authoring. Raw clips are
 * managed in Library > Audio, and scene application sites such as emitters and
 * ambience zones are placed from Layout against `RegionDocument.audio`.
 */

import { useMemo, useState } from "react";
import {
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
  type AudioClipDefinition,
  type AudioMixerSettings,
  type RuntimeSoundEventKey,
  type SoundCategory,
  type SoundCueDefinition,
  type SoundCuePlaybackMode,
  type SoundEventBindingMap
} from "@sugarmagic/domain";
import {
  AudioTransport,
  Inspector,
  PanelSection,
  PanelSectionList
} from "@sugarmagic/ui";
import type { WorkspaceViewContribution } from "../../workspace-view";

export interface AudioWorkspaceViewProps {
  audioClipDefinitions: AudioClipDefinition[];
  soundCueDefinitions: SoundCueDefinition[];
  assetSources: Record<string, string>;
  soundEventBindings: SoundEventBindingMap;
  audioMixer: AudioMixerSettings | null;
  onCreateSoundCueDefinition: () => SoundCueDefinition | null;
  onUpdateSoundCueDefinition: (
    definitionId: string,
    patch: Partial<SoundCueDefinition>
  ) => void;
  onRemoveSoundCueDefinition: (definitionId: string) => void;
  onSetSoundEventBinding: (
    eventKey: RuntimeSoundEventKey,
    soundCueDefinitionId: string | null
  ) => void;
  onUpdateAudioMixer: (patch: Partial<AudioMixerSettings>) => void;
}

const categoryOptions: Array<{ value: SoundCategory; label: string }> = [
  { value: "music", label: "Music" },
  { value: "sfx", label: "SFX" },
  { value: "ambient", label: "Ambient" },
  { value: "ui", label: "UI" },
  { value: "voice", label: "Voice" }
];

const modeOptions: Array<{ value: SoundCuePlaybackMode; label: string }> = [
  { value: "single", label: "Single" },
  { value: "random", label: "Random" },
  { value: "sequence", label: "Sequence" },
  { value: "loop", label: "Loop" },
  { value: "random-interval", label: "Random Interval" }
];

const retriggerOptions = [
  { value: "restart", label: "Restart" },
  { value: "overlap", label: "Overlap" },
  { value: "ignore-while-playing", label: "Ignore While Playing" }
];

const eventOptions: Array<{ value: RuntimeSoundEventKey; label: string }> = [
  { value: "game.menu-open", label: "Menu Open" },
  { value: "game.menu-close", label: "Menu Close" },
  { value: "ui.click", label: "UI Click" },
  { value: "ui.hover", label: "UI Hover" },
  { value: "player.footstep", label: "Player Footstep" },
  { value: "item.pickup", label: "Item Pickup" },
  { value: "interaction.activate", label: "Interaction" },
  { value: "spell.cast-success", label: "Spell Cast Success" },
  { value: "quest.reward", label: "Quest Reward" }
];

export function useAudioWorkspaceView(
  props: AudioWorkspaceViewProps
): WorkspaceViewContribution {
  const {
    audioClipDefinitions,
    soundCueDefinitions,
    assetSources,
    soundEventBindings,
    audioMixer,
    onCreateSoundCueDefinition,
    onUpdateSoundCueDefinition,
    onRemoveSoundCueDefinition,
    onSetSoundEventBinding,
    onUpdateAudioMixer
  } = props;
  const [selectedId, setSelectedId] = useState<string | null>(
    soundCueDefinitions[0]?.definitionId ?? null
  );

  const selectedCue =
    soundCueDefinitions.find(
      (definition) => definition.definitionId === selectedId
    ) ??
    soundCueDefinitions[0] ??
    null;

  const clipOptions = useMemo(
    () =>
      audioClipDefinitions.map((definition) => ({
        value: definition.definitionId,
        label: definition.displayName
      })),
    [audioClipDefinitions]
  );
  const cueOptions = useMemo(
    () =>
      soundCueDefinitions.map((definition) => ({
        value: definition.definitionId,
        label: definition.displayName
      })),
    [soundCueDefinitions]
  );
  const selectedCueClip = selectedCue?.clips[0]
    ? (audioClipDefinitions.find(
        (definition) =>
          definition.definitionId ===
          selectedCue.clips[0]?.audioClipDefinitionId
      ) ?? null)
    : null;
  const selectedCueClipUrl = selectedCueClip
    ? (assetSources[selectedCueClip.source.relativeAssetPath] ?? null)
    : null;

  function updateCue(patch: Partial<SoundCueDefinition>) {
    if (!selectedCue) return;
    onUpdateSoundCueDefinition(selectedCue.definitionId, patch);
  }

  function createCue() {
    const cue = onCreateSoundCueDefinition();
    if (!cue) return;
    setSelectedId(cue.definitionId);
  }

  function deleteCue(definitionId: string) {
    onRemoveSoundCueDefinition(definitionId);
    if (selectedCue?.definitionId === definitionId) {
      setSelectedId(null);
    }
  }

  function updateCueClip(
    index: number,
    patch: Partial<SoundCueDefinition["clips"][number]>
  ) {
    if (!selectedCue) return;
    updateCue({
      clips: selectedCue.clips.map((clip, clipIndex) =>
        clipIndex === index ? { ...clip, ...patch } : clip
      )
    });
  }

  function removeCueClip(index: number) {
    if (!selectedCue) return;
    updateCue({
      clips: selectedCue.clips.filter((_, clipIndex) => clipIndex !== index)
    });
  }

  function addCueClip() {
    if (!selectedCue) return;
    const firstClip = audioClipDefinitions[0];
    if (!firstClip) return;
    updateCue({
      clips: [
        ...selectedCue.clips,
        {
          audioClipDefinitionId: firstClip.definitionId,
          weight: 1,
          sprite: null
        }
      ]
    });
  }

  return {
    leftPanel: (
      <PanelSectionList
        title="Cues"
        icon="🔊"
        items={soundCueDefinitions}
        selectedId={selectedCue?.definitionId ?? null}
        getId={(definition) => definition.definitionId}
        getLabel={(definition) => definition.displayName}
        getDescription={(definition) =>
          `${definition.category} · ${definition.playback.mode}`
        }
        onSelect={(definitionId) => setSelectedId(definitionId)}
        searchPlaceholder="Search cues..."
        createLabel="Add cue"
        onCreate={createCue}
        emptyText="Add a cue, then choose clips from Library > Audio."
        contextActions={[
          {
            label: "Delete",
            color: "red",
            onSelect: (definition) => deleteCue(definition.definitionId)
          }
        ]}
      />
    ),
    rightPanel: (
      <Inspector selectionLabel={selectedCue?.displayName ?? "Audio"}>
        {selectedCue ? (
          <>
            <PanelSection title={selectedCue.displayName}>
              <Stack gap="sm">
                <TextInput
                  label="Display Name"
                  value={selectedCue.displayName}
                  onChange={(event) =>
                    updateCue({ displayName: event.currentTarget.value })
                  }
                />
                <Select
                  label="Category"
                  data={categoryOptions}
                  value={selectedCue.category}
                  onChange={(value) =>
                    value && updateCue({ category: value as SoundCategory })
                  }
                />
                <Select
                  label="Playback Mode"
                  data={modeOptions}
                  value={selectedCue.playback.mode}
                  onChange={(value) =>
                    value &&
                    updateCue({
                      playback: {
                        ...selectedCue.playback,
                        mode: value as SoundCuePlaybackMode
                      }
                    })
                  }
                />
                <Stack gap="xs">
                  <Group justify="space-between">
                    <Text size="xs" fw={600}>
                      Clips
                    </Text>
                    <Button
                      size="compact-xs"
                      variant="light"
                      onClick={addCueClip}
                      disabled={audioClipDefinitions.length === 0}
                    >
                      Add Clip
                    </Button>
                  </Group>
                  {selectedCue.clips.length === 0 ? (
                    <Text size="xs" c="var(--sm-color-overlay0)">
                      Import clips in Library &gt; Audio, then add them here.
                    </Text>
                  ) : null}
                  {selectedCue.clips.map((clip, index) => (
                    <Group key={`${clip.audioClipDefinitionId}:${index}`} grow>
                      <Select
                        label={`Clip ${index + 1}`}
                        data={clipOptions}
                        value={clip.audioClipDefinitionId}
                        onChange={(value) =>
                          value &&
                          updateCueClip(index, {
                            audioClipDefinitionId: value
                          })
                        }
                        placeholder="Select clip..."
                      />
                      <NumberInput
                        label="Weight"
                        min={0}
                        step={0.25}
                        value={clip.weight}
                        onChange={(value) =>
                          updateCueClip(index, {
                            weight: typeof value === "number" ? value : 1
                          })
                        }
                      />
                      <Button
                        mt="lg"
                        color="red"
                        variant="subtle"
                        onClick={() => removeCueClip(index)}
                      >
                        Remove
                      </Button>
                    </Group>
                  ))}
                </Stack>
                <NumberInput
                  label="Volume"
                  min={0}
                  max={1}
                  step={0.05}
                  value={selectedCue.playback.volume}
                  onChange={(value) =>
                    updateCue({
                      playback: {
                        ...selectedCue.playback,
                        volume: typeof value === "number" ? value : 1
                      }
                    })
                  }
                />
                <NumberInput
                  label="Pitch"
                  min={0.1}
                  max={4}
                  step={0.05}
                  value={selectedCue.playback.pitch}
                  onChange={(value) =>
                    updateCue({
                      playback: {
                        ...selectedCue.playback,
                        pitch: typeof value === "number" ? value : 1
                      }
                    })
                  }
                />
                <Group grow>
                  <NumberInput
                    label="Fade In (ms)"
                    min={0}
                    step={50}
                    value={selectedCue.playback.fadeInMs}
                    onChange={(value) =>
                      updateCue({
                        playback: {
                          ...selectedCue.playback,
                          fadeInMs: typeof value === "number" ? value : 0
                        }
                      })
                    }
                  />
                  <NumberInput
                    label="Fade Out (ms)"
                    min={0}
                    step={50}
                    value={selectedCue.playback.fadeOutMs}
                    onChange={(value) =>
                      updateCue({
                        playback: {
                          ...selectedCue.playback,
                          fadeOutMs: typeof value === "number" ? value : 0
                        }
                      })
                    }
                  />
                </Group>
                <Group grow>
                  <NumberInput
                    label="Max Instances"
                    min={1}
                    step={1}
                    value={selectedCue.playback.maxInstances}
                    onChange={(value) =>
                      updateCue({
                        playback: {
                          ...selectedCue.playback,
                          maxInstances: typeof value === "number" ? value : 1
                        }
                      })
                    }
                  />
                  <Select
                    label="Retrigger"
                    data={retriggerOptions}
                    value={selectedCue.playback.retrigger}
                    onChange={(value) =>
                      value &&
                      updateCue({
                        playback: {
                          ...selectedCue.playback,
                          retrigger:
                            value as SoundCueDefinition["playback"]["retrigger"]
                        }
                      })
                    }
                  />
                </Group>
                <Group grow>
                  <NumberInput
                    label="Random Volume Min"
                    min={0}
                    max={1}
                    step={0.05}
                    value={selectedCue.playback.randomVolume?.[0] ?? ""}
                    onChange={(value) =>
                      updateCue({
                        playback: {
                          ...selectedCue.playback,
                          randomVolume:
                            typeof value === "number"
                              ? [
                                  value,
                                  selectedCue.playback.randomVolume?.[1] ??
                                    selectedCue.playback.volume
                                ]
                              : null
                        }
                      })
                    }
                  />
                  <NumberInput
                    label="Random Volume Max"
                    min={0}
                    max={1}
                    step={0.05}
                    value={selectedCue.playback.randomVolume?.[1] ?? ""}
                    onChange={(value) =>
                      updateCue({
                        playback: {
                          ...selectedCue.playback,
                          randomVolume:
                            typeof value === "number"
                              ? [
                                  selectedCue.playback.randomVolume?.[0] ??
                                    selectedCue.playback.volume,
                                  value
                                ]
                              : null
                        }
                      })
                    }
                  />
                </Group>
                <Group grow>
                  <NumberInput
                    label="Random Pitch Min"
                    min={0.1}
                    max={4}
                    step={0.05}
                    value={selectedCue.playback.randomPitch?.[0] ?? ""}
                    onChange={(value) =>
                      updateCue({
                        playback: {
                          ...selectedCue.playback,
                          randomPitch:
                            typeof value === "number"
                              ? [
                                  value,
                                  selectedCue.playback.randomPitch?.[1] ??
                                    selectedCue.playback.pitch
                                ]
                              : null
                        }
                      })
                    }
                  />
                  <NumberInput
                    label="Random Pitch Max"
                    min={0.1}
                    max={4}
                    step={0.05}
                    value={selectedCue.playback.randomPitch?.[1] ?? ""}
                    onChange={(value) =>
                      updateCue({
                        playback: {
                          ...selectedCue.playback,
                          randomPitch:
                            typeof value === "number"
                              ? [
                                  selectedCue.playback.randomPitch?.[0] ??
                                    selectedCue.playback.pitch,
                                  value
                                ]
                              : null
                        }
                      })
                    }
                  />
                </Group>
                {selectedCue.playback.mode === "random-interval" ? (
                  <Group grow>
                    <NumberInput
                      label="Interval Min (s)"
                      min={0.1}
                      step={0.5}
                      value={
                        selectedCue.playback.randomIntervalSeconds?.[0] ?? ""
                      }
                      onChange={(value) =>
                        updateCue({
                          playback: {
                            ...selectedCue.playback,
                            randomIntervalSeconds:
                              typeof value === "number"
                                ? [
                                    value,
                                    selectedCue.playback
                                      .randomIntervalSeconds?.[1] ??
                                      Math.max(value, 1)
                                  ]
                                : null
                          }
                        })
                      }
                    />
                    <NumberInput
                      label="Interval Max (s)"
                      min={0.1}
                      step={0.5}
                      value={
                        selectedCue.playback.randomIntervalSeconds?.[1] ?? ""
                      }
                      onChange={(value) =>
                        updateCue({
                          playback: {
                            ...selectedCue.playback,
                            randomIntervalSeconds:
                              typeof value === "number"
                                ? [
                                    selectedCue.playback
                                      .randomIntervalSeconds?.[0] ?? 1,
                                    value
                                  ]
                                : null
                          }
                        })
                      }
                    />
                  </Group>
                ) : null}
                <Switch
                  label="Spatial"
                  checked={selectedCue.spatial.enabled}
                  onChange={(event) =>
                    updateCue({
                      spatial: {
                        ...selectedCue.spatial,
                        enabled: event.currentTarget.checked
                      }
                    })
                  }
                />
                <Group grow>
                  <NumberInput
                    label="Spatial Ref Distance"
                    min={0.1}
                    step={0.5}
                    value={selectedCue.spatial.refDistance}
                    onChange={(value) =>
                      updateCue({
                        spatial: {
                          ...selectedCue.spatial,
                          refDistance: typeof value === "number" ? value : 1
                        }
                      })
                    }
                  />
                  <NumberInput
                    label="Spatial Max Distance"
                    min={1}
                    step={1}
                    value={selectedCue.spatial.maxDistance}
                    onChange={(value) =>
                      updateCue({
                        spatial: {
                          ...selectedCue.spatial,
                          maxDistance: typeof value === "number" ? value : 40
                        }
                      })
                    }
                  />
                </Group>
                <NumberInput
                  label="Spatial Rolloff"
                  min={0}
                  step={0.1}
                  value={selectedCue.spatial.rolloffFactor}
                  onChange={(value) =>
                    updateCue({
                      spatial: {
                        ...selectedCue.spatial,
                        rolloffFactor: typeof value === "number" ? value : 1
                      }
                    })
                  }
                />
              </Stack>
            </PanelSection>
            <PanelSection title="Event Bindings">
              <Stack gap="xs">
                {eventOptions.map((eventOption) => (
                  <Select
                    key={eventOption.value}
                    label={eventOption.label}
                    data={
                      cueOptions.length > 0
                        ? [{ value: "", label: "None" }, ...cueOptions]
                        : [{ value: "", label: "None" }]
                    }
                    value={soundEventBindings[eventOption.value] ?? ""}
                    onChange={(value) =>
                      onSetSoundEventBinding(eventOption.value, value || null)
                    }
                  />
                ))}
              </Stack>
            </PanelSection>
            {audioMixer ? (
              <PanelSection title="Mixer">
                <Stack gap="xs">
                  {categoryOptions.map((category) => (
                    <NumberInput
                      key={category.value}
                      label={category.label}
                      min={0}
                      max={1}
                      step={0.05}
                      value={audioMixer[category.value]}
                      onChange={(value) =>
                        onUpdateAudioMixer({
                          [category.value]:
                            typeof value === "number" ? value : 1
                        })
                      }
                    />
                  ))}
                  <NumberInput
                    label="Master"
                    min={0}
                    max={1}
                    step={0.05}
                    value={audioMixer.master}
                    onChange={(value) =>
                      onUpdateAudioMixer({
                        master: typeof value === "number" ? value : 1
                      })
                    }
                  />
                </Stack>
              </PanelSection>
            ) : null}
          </>
        ) : (
          <PanelSection title="Audio">
            <Text size="sm" c="var(--sm-color-overlay0)">
              Create a cue, then bind it to clips from Library &gt; Audio.
            </Text>
          </PanelSection>
        )}
      </Inspector>
    ),
    centerPanel: (
      <Stack p="xl" gap="md">
        <Stack gap={4}>
          <Text fw={700}>Cue Audition</Text>
        </Stack>
        <AudioTransport
          sourceUrl={selectedCueClipUrl}
          label={selectedCue?.displayName ?? "Cue Preview"}
          disabledReason={
            selectedCue
              ? "Choose an Audio Library clip in the cue inspector."
              : "Create or select a sound cue to preview."
          }
          loop={selectedCue?.playback.mode === "loop"}
          playbackRate={selectedCue?.playback.pitch ?? 1}
          volume={selectedCue?.playback.volume ?? 1}
          fadeInMs={selectedCue?.playback.fadeInMs ?? 0}
          fadeOutMs={selectedCue?.playback.fadeOutMs ?? 0}
        />
        {selectedCueClip ? (
          <Text size="xs" c="var(--sm-color-overlay0)">
            Clip: {selectedCueClip.displayName}
          </Text>
        ) : null}
      </Stack>
    ),
    viewportOverlay: null
  };
}
