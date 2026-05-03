/**
 * Runtime audio command model.
 *
 * This module is the single runtime-core enforcer for authored sound intent:
 * gameplay systems emit semantic events, region audio state becomes play/stop
 * commands, and target packages realize those commands with platform audio.
 * It deliberately has no browser or Howler dependency.
 */

import type {
  AudioMixerSettings,
  ContentLibrarySnapshot,
  RegionDocument,
  RuntimeSoundEventKey,
  SoundCueDefinition,
  SoundEventBindingMap
} from "@sugarmagic/domain";

export type RuntimeListenerMode = "player" | "camera";

export interface RuntimeSoundCommandBase<TKind extends string> {
  commandId: string;
  kind: TKind;
}

export interface RuntimePlayCueCommand extends RuntimeSoundCommandBase<"play-cue"> {
  cueDefinitionId: string;
  instanceKey: string;
  position: [number, number, number] | null;
}

export interface RuntimeStopCueCommand extends RuntimeSoundCommandBase<"stop-cue"> {
  instanceKey: string;
  fadeOutMs?: number;
}

export interface RuntimeSetMixerCommand extends RuntimeSoundCommandBase<"set-mixer"> {
  mixer: AudioMixerSettings;
}

export interface RuntimeSetListenerPoseCommand extends RuntimeSoundCommandBase<"set-listener-pose"> {
  mode: RuntimeListenerMode;
  position: [number, number, number];
  forward: [number, number, number];
}

export type RuntimeSoundCommand =
  | RuntimePlayCueCommand
  | RuntimeStopCueCommand
  | RuntimeSetMixerCommand
  | RuntimeSetListenerPoseCommand;

export interface RuntimeAudioControllerOptions {
  contentLibrary: ContentLibrarySnapshot;
  soundEventBindings: SoundEventBindingMap;
  mixer: AudioMixerSettings;
  activeRegion: RegionDocument | null;
}

export interface RuntimeAudioController {
  emitEvent: (
    eventKey: RuntimeSoundEventKey,
    options?: {
      instanceKey?: string;
      position?: [number, number, number] | null;
    }
  ) => void;
  playCue: (options: {
    cueDefinitionId: string | null | undefined;
    instanceKey: string;
    position?: [number, number, number] | null;
  }) => void;
  stopInstance: (instanceKey: string, fadeOutMs?: number) => void;
  setListenerPose: (options: {
    mode: RuntimeListenerMode;
    position: [number, number, number];
    forward: [number, number, number];
  }) => void;
  syncRegionAudio: (region: RegionDocument | null) => void;
  drainCommands: () => RuntimeSoundCommand[];
}

let commandCounter = 0;

function nextCommandId(): string {
  commandCounter += 1;
  return `audio-command-${commandCounter}`;
}

function cueExists(
  contentLibrary: ContentLibrarySnapshot,
  cueDefinitionId: string
): boolean {
  return (contentLibrary.soundCueDefinitions ?? []).some(
    (definition) => definition.definitionId === cueDefinitionId
  );
}

function getCueDefinition(
  contentLibrary: ContentLibrarySnapshot,
  cueDefinitionId: string | null | undefined
): SoundCueDefinition | null {
  if (!cueDefinitionId) {
    return null;
  }
  return (
    (contentLibrary.soundCueDefinitions ?? []).find(
      (definition) => definition.definitionId === cueDefinitionId
    ) ?? null
  );
}

export function createRuntimeAudioController(
  options: RuntimeAudioControllerOptions
): RuntimeAudioController {
  const commands: RuntimeSoundCommand[] = [
    {
      commandId: nextCommandId(),
      kind: "set-mixer",
      mixer: options.mixer
    }
  ];
  const activeRegionInstances = new Set<string>();
  const activeCueDefinitionByInstance = new Map<string, string>();

  function enqueue(command: RuntimeSoundCommand) {
    commands.push(command);
  }

  function playCue(input: {
    cueDefinitionId: string | null | undefined;
    instanceKey: string;
    position?: [number, number, number] | null;
  }) {
    const cueDefinitionId = input.cueDefinitionId;
    if (!cueExists(options.contentLibrary, cueDefinitionId ?? "")) {
      return;
    }
    activeCueDefinitionByInstance.set(input.instanceKey, cueDefinitionId!);
    enqueue({
      commandId: nextCommandId(),
      kind: "play-cue",
      cueDefinitionId: cueDefinitionId!,
      instanceKey: input.instanceKey,
      position: input.position ?? null
    });
  }

  function stopInstance(instanceKey: string, fadeOutMs?: number) {
    const activeCue = getCueDefinition(
      options.contentLibrary,
      activeCueDefinitionByInstance.get(instanceKey)
    );
    const resolvedFadeOutMs = fadeOutMs ?? activeCue?.playback.fadeOutMs;
    activeCueDefinitionByInstance.delete(instanceKey);
    enqueue({
      commandId: nextCommandId(),
      kind: "stop-cue",
      instanceKey,
      fadeOutMs: resolvedFadeOutMs
    });
  }

  const controller: RuntimeAudioController = {
    emitEvent(eventKey, eventOptions) {
      const cueDefinitionId = options.soundEventBindings[eventKey] ?? null;
      playCue({
        cueDefinitionId,
        instanceKey: eventOptions?.instanceKey ?? `event:${eventKey}`,
        position: eventOptions?.position ?? null
      });
    },
    playCue,
    stopInstance,
    setListenerPose(listener) {
      enqueue({
        commandId: nextCommandId(),
        kind: "set-listener-pose",
        mode: listener.mode,
        position: listener.position,
        forward: listener.forward
      });
    },
    syncRegionAudio(region) {
      for (const instanceKey of activeRegionInstances) {
        stopInstance(instanceKey);
      }
      activeRegionInstances.clear();

      if (!region) {
        return;
      }

      for (const emitter of region.audio?.emitters ?? []) {
        if (!emitter.enabled || emitter.trigger === "scripted") {
          continue;
        }
        const instanceKey = `region:${region.identity.id}:emitter:${emitter.emitterId}`;
        activeRegionInstances.add(instanceKey);
        playCue({
          cueDefinitionId: emitter.cueDefinitionId,
          instanceKey,
          position: emitter.position
        });
      }

      for (const zone of region.audio?.ambienceZones ?? []) {
        if (!zone.enabled || zone.trigger !== "always") {
          continue;
        }
        const instanceKey = `region:${region.identity.id}:ambience-zone:${zone.zoneId}`;
        activeRegionInstances.add(instanceKey);
        playCue({
          cueDefinitionId: zone.cueDefinitionId,
          instanceKey,
          position: zone.center
        });
      }
    },
    drainCommands() {
      const drained = commands.splice(0, commands.length);
      return drained;
    }
  };

  controller.syncRegionAudio(options.activeRegion);
  return controller;
}
