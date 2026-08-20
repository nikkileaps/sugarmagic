/**
 * The unknown-cue warning.
 *
 * `playCue` is the single place a missing cue is reported, so every caller --
 * quest actions, volume triggers, background music, sound events -- gets the
 * same report. A cue id that is absent warns; no cue id at all stays silent,
 * because most sound events have no binding and fire constantly.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultAudioClipDefinition,
  createDefaultAudioMixerSettings,
  createDefaultSoundCueDefinition,
  createEmptyContentLibrarySnapshot
} from "@sugarmagic/domain";
import { createRuntimeAudioController } from "@sugarmagic/runtime-core";

function controllerWithCues(
  cues: ReturnType<typeof createDefaultSoundCueDefinition>[]
) {
  const contentLibrary = createEmptyContentLibrarySnapshot("test-project");
  return createRuntimeAudioController({
    contentLibrary: { ...contentLibrary, soundCueDefinitions: cues },
    soundEventBindings: {},
    mixer: createDefaultAudioMixerSettings(),
    activeRegion: null
  });
}

function knownCue() {
  const clip = createDefaultAudioClipDefinition({
    displayName: "Bell",
    source: {
      relativeAssetPath: "audio/bell.wav",
      fileName: "bell.wav",
      mimeType: "audio/wav"
    }
  });
  return createDefaultSoundCueDefinition({
    displayName: "Bell Cue",
    clips: [{ audioClipDefinitionId: clip.definitionId, weight: 1, sprite: null }]
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("unknown sound cue", () => {
  it("warns once per cue id and does not throw", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const controller = controllerWithCues([]);

    expect(() =>
      controller.playCue({
        cueDefinitionId: "missing-cue",
        instanceKey: "first",
        source: 'quest "q1" node "n1"'
      })
    ).not.toThrow();
    controller.playCue({ cueDefinitionId: "missing-cue", instanceKey: "second" });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("missing-cue");
    expect(warn.mock.calls[0]?.[0]).toContain('quest "q1" node "n1"');
    expect(
      controller.drainCommands().some((command) => command.kind === "play-cue")
    ).toBe(false);
  });

  it("stays silent when no cue id is named", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const controller = controllerWithCues([]);

    controller.playCue({ cueDefinitionId: null, instanceKey: "none" });
    controller.playCue({ cueDefinitionId: undefined, instanceKey: "none" });
    // An unbound sound event resolves to null and goes through the same path.
    controller.emitEvent("player.footstep", { instanceKey: "step" });

    expect(warn).not.toHaveBeenCalled();
  });

  it("plays a known cue without warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cue = knownCue();
    const controller = controllerWithCues([cue]);

    controller.playCue({
      cueDefinitionId: cue.definitionId,
      instanceKey: "bell"
    });

    expect(warn).not.toHaveBeenCalled();
    expect(controller.drainCommands()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "play-cue",
          cueDefinitionId: cue.definitionId,
          instanceKey: "bell"
        })
      ])
    );
  });
});
