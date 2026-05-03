/**
 * Sound system tests.
 *
 * Guards the authored audio source of truth, runtime-core command generation,
 * managed audio import path, and browser-audio boundary.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  addAudioClipDefinitionToSession,
  addSoundCueDefinitionToSession,
  createAuthoringSession,
  createDefaultAudioClipDefinition,
  createEmptyContentLibrarySnapshot,
  createDefaultGameProject,
  createDefaultRegion,
  createDefaultSoundCueDefinition,
  createRegionSoundEmitter,
  removeAudioClipDefinitionFromSession,
  setSoundEventBindingInSession
} from "@sugarmagic/domain";
import { importAudioClipDefinitionFromFile } from "@sugarmagic/io";
import { createRuntimeAudioController } from "@sugarmagic/runtime-core";

class MemoryFileHandle {
  blob: Blob | null = null;

  async createWritable() {
    return {
      write: async (blob: Blob) => {
        this.blob = blob;
      },
      close: async () => {}
    };
  }
}

class MemoryDirectoryHandle {
  directories = new Map<string, MemoryDirectoryHandle>();
  files = new Map<string, MemoryFileHandle>();

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const existing = this.directories.get(name);
    if (existing) return existing;
    if (!options?.create) throw new Error(`Missing directory ${name}`);
    const next = new MemoryDirectoryHandle();
    this.directories.set(name, next);
    return next;
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    const existing = this.files.get(name);
    if (existing) return existing;
    if (!options?.create) throw new Error(`Missing file ${name}`);
    const next = new MemoryFileHandle();
    this.files.set(name, next);
    return next;
  }
}

function listFiles(root: string): string[] {
  const entries: string[] = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) {
      entries.push(...listFiles(path));
    } else {
      entries.push(path);
    }
  }
  return entries;
}

describe("sound system", () => {
  it("normalizes legacy projects with empty audio collections and mixer state", () => {
    const project = createDefaultGameProject("Audio Test", "audio-test");
    const region = createDefaultRegion({
      regionId: "region:audio",
      displayName: "Audio Region"
    });
    const legacyContentLibrary = {
      ...createEmptyContentLibrarySnapshot(project.identity.id),
      audioClipDefinitions: undefined,
      soundCueDefinitions: undefined
    } as never;
    const session = createAuthoringSession(
      {
        ...project,
        soundEventBindings: undefined,
        audioMixer: undefined
      } as never,
      [{ ...region, audio: undefined } as never],
      legacyContentLibrary
    );

    expect(session.contentLibrary.audioClipDefinitions).toEqual([]);
    expect(session.contentLibrary.soundCueDefinitions).toEqual([]);
    expect(session.gameProject.audioMixer.master).toBe(1);
    expect(session.regions.get("region:audio")?.audio?.emitters).toEqual([]);
  });

  it("removing an audio clip clears cue references through the session helper", () => {
    const project = createDefaultGameProject("Audio Test", "audio-test");
    const region = createDefaultRegion({
      regionId: "region:audio",
      displayName: "Audio Region"
    });
    const clip = createDefaultAudioClipDefinition({
      displayName: "Pickup",
      source: {
        relativeAssetPath: "assets/audio/pickup.wav",
        fileName: "pickup.wav",
        mimeType: "audio/wav"
      }
    });
    const cue = createDefaultSoundCueDefinition({
      displayName: "Pickup Cue",
      clips: [
        { audioClipDefinitionId: clip.definitionId, weight: 1, sprite: null }
      ]
    });
    const session = addSoundCueDefinitionToSession(
      addAudioClipDefinitionToSession(
        createAuthoringSession(project, [region]),
        clip
      ),
      cue
    );

    const nextSession = removeAudioClipDefinitionFromSession(
      session,
      clip.definitionId
    );

    expect(nextSession.contentLibrary.audioClipDefinitions).toEqual([]);
    expect(nextSession.contentLibrary.soundCueDefinitions?.[0]?.clips).toEqual(
      []
    );
  });

  it("writes imported audio clips into managed assets/audio paths", async () => {
    const root = new MemoryDirectoryHandle();
    const file = new File(["wav"], "Pickup Sparkle.wav", { type: "audio/wav" });

    const result = await importAudioClipDefinitionFromFile(file, {
      projectHandle: root as unknown as FileSystemDirectoryHandle,
      descriptor: { authoredAssetsPath: "assets" } as never
    });

    expect(result.audioClipDefinition.source.relativeAssetPath).toBe(
      "assets/audio/pickup-sparkle.wav"
    );
    expect(
      root.directories
        .get("assets")
        ?.directories.get("audio")
        ?.files.has("pickup-sparkle.wav")
    ).toBe(true);
  });

  it("resolves bound events and region emitters into runtime sound commands", () => {
    const project = createDefaultGameProject("Audio Test", "audio-test");
    const region = createDefaultRegion({
      regionId: "region:audio",
      displayName: "Audio Region"
    });
    const clip = createDefaultAudioClipDefinition({
      displayName: "Pickup",
      source: {
        relativeAssetPath: "assets/audio/pickup.wav",
        fileName: "pickup.wav",
        mimeType: "audio/wav"
      }
    });
    const cue = createDefaultSoundCueDefinition({
      displayName: "Pickup Cue",
      clips: [
        { audioClipDefinitionId: clip.definitionId, weight: 1, sprite: null }
      ]
    });
    const emitter = createRegionSoundEmitter({
      cueDefinitionId: cue.definitionId,
      position: [1, 0, 2]
    });
    const session = setSoundEventBindingInSession(
      addSoundCueDefinitionToSession(
        addAudioClipDefinitionToSession(
          createAuthoringSession(project, [
            { ...region, audio: { emitters: [emitter], ambienceZones: [] } }
          ]),
          clip
        ),
        cue
      ),
      "item.pickup",
      cue.definitionId
    );

    const controller = createRuntimeAudioController({
      contentLibrary: session.contentLibrary,
      soundEventBindings: session.gameProject.soundEventBindings,
      mixer: session.gameProject.audioMixer,
      activeRegion: session.regions.get(region.identity.id) ?? null
    });
    controller.emitEvent("item.pickup", { instanceKey: "pickup:test" });

    const commands = controller.drainCommands();
    expect(commands.some((command) => command.kind === "set-mixer")).toBe(true);
    expect(commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "play-cue",
          cueDefinitionId: cue.definitionId,
          instanceKey: `region:${region.identity.id}:emitter:${emitter.emitterId}`,
          position: [1, 0, 2]
        }),
        expect.objectContaining({
          kind: "play-cue",
          cueDefinitionId: cue.definitionId,
          instanceKey: "pickup:test"
        })
      ])
    );
  });

  it("uses the active cue fade-out when stopping a runtime sound instance", () => {
    const project = createDefaultGameProject("Audio Test", "audio-test");
    const region = createDefaultRegion({
      regionId: "region:audio",
      displayName: "Audio Region"
    });
    const clip = createDefaultAudioClipDefinition({
      displayName: "Menu Music",
      source: {
        relativeAssetPath: "assets/audio/menu.mp3",
        fileName: "menu.mp3",
        mimeType: "audio/mpeg"
      }
    });
    const cue = createDefaultSoundCueDefinition({
      displayName: "Menu Music Cue",
      category: "music",
      clips: [
        { audioClipDefinitionId: clip.definitionId, weight: 1, sprite: null }
      ],
      playback: {
        mode: "loop",
        fadeOutMs: 500
      }
    });
    const session = setSoundEventBindingInSession(
      addSoundCueDefinitionToSession(
        addAudioClipDefinitionToSession(
          createAuthoringSession(project, [region]),
          clip
        ),
        cue
      ),
      "game.menu-open",
      cue.definitionId
    );
    const controller = createRuntimeAudioController({
      contentLibrary: session.contentLibrary,
      soundEventBindings: session.gameProject.soundEventBindings,
      mixer: session.gameProject.audioMixer,
      activeRegion: null
    });

    controller.emitEvent("game.menu-open", { instanceKey: "game.menu-open" });
    controller.stopInstance("game.menu-open");

    expect(controller.drainCommands()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "stop-cue",
          instanceKey: "game.menu-open",
          fadeOutMs: 500
        })
      ])
    );
  });

  it("keeps Howler out of runtime-core", () => {
    const runtimeFiles = listFiles(
      join(process.cwd(), "packages/runtime-core/src")
    );
    const runtimeSource = runtimeFiles
      .filter((path) => path.endsWith(".ts") || path.endsWith(".tsx"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(runtimeSource).not.toMatch(
      /from\s+["']howler["']|new\s+AudioContext|window\.AudioContext|Howl\(/
    );
  });
});
