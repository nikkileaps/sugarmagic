/**
 * Web target audio adapter.
 *
 * Translates runtime-core sound commands into Howler playback. This file is
 * intentionally target-owned: authored sound truth lives in domain/runtime-core,
 * while browser unlock, Howl lifetime, panning, and fades live here.
 */

import { Howl, Howler } from "howler";
import type {
  AudioClipDefinition,
  AudioMixerSettings,
  ContentLibrarySnapshot,
  SoundCueDefinition
} from "@sugarmagic/domain";
import type { RuntimeSoundCommand } from "@sugarmagic/runtime-core";

interface LoadedClip {
  howl: Howl;
  clip: AudioClipDefinition;
}

export interface WebAudioAdapterOptions {
  ownerWindow: Window;
  root: HTMLElement;
  logger?: Pick<Console, "warn" | "error" | "info">;
}

export interface WebAudioProjectState {
  contentLibrary: ContentLibrarySnapshot;
  assetSources: Record<string, string>;
  mixer: AudioMixerSettings;
}

export class WebAudioAdapter {
  private contentLibrary: ContentLibrarySnapshot | null = null;
  private assetSources: Record<string, string> = {};
  private mixer: AudioMixerSettings | null = null;
  private loadedClips = new Map<string, LoadedClip>();
  private activeInstances = new Map<
    string,
    { cueDefinitionId: string; sounds: Array<{ howl: Howl; soundId: number }> }
  >();
  private randomTimers = new Map<string, number>();
  private sequenceCursors = new Map<string, number>();
  private unlocked = false;

  constructor(private readonly options: WebAudioAdapterOptions) {
    this.handleUnlockGesture = this.handleUnlockGesture.bind(this);
    options.root.addEventListener("pointerdown", this.handleUnlockGesture, {
      passive: true
    });
    options.root.addEventListener("keydown", this.handleUnlockGesture);
  }

  syncProject(state: WebAudioProjectState): void {
    this.contentLibrary = state.contentLibrary;
    this.assetSources = state.assetSources;
    this.mixer = state.mixer;
    this.applyMasterVolume();
  }

  handleCommands(commands: RuntimeSoundCommand[]): void {
    for (const command of commands) {
      switch (command.kind) {
        case "set-mixer":
          this.mixer = command.mixer;
          this.applyMasterVolume();
          break;
        case "set-listener-pose":
          Howler.pos(...command.position);
          Howler.orientation(...command.forward, 0, 1, 0);
          break;
        case "play-cue":
          this.playCue(
            command.cueDefinitionId,
            command.instanceKey,
            command.position
          );
          break;
        case "stop-cue":
          this.stopInstance(command.instanceKey, command.fadeOutMs);
          break;
      }
    }
  }

  dispose(): void {
    this.options.root.removeEventListener(
      "pointerdown",
      this.handleUnlockGesture
    );
    this.options.root.removeEventListener("keydown", this.handleUnlockGesture);
    for (const timer of this.randomTimers.values()) {
      this.options.ownerWindow.clearTimeout(timer);
    }
    this.randomTimers.clear();
    for (const instanceKey of Array.from(this.activeInstances.keys())) {
      this.stopInstance(instanceKey);
    }
    this.activeInstances.clear();
    for (const loaded of this.loadedClips.values()) {
      loaded.howl.unload();
    }
    this.loadedClips.clear();
  }

  pauseAll(): void {
    for (const instance of this.activeInstances.values()) {
      for (const { howl, soundId } of instance.sounds) {
        howl.pause(soundId);
      }
    }
  }

  resumeAll(): void {
    for (const instance of this.activeInstances.values()) {
      for (const { howl, soundId } of instance.sounds) {
        howl.play(soundId);
      }
    }
  }

  unlock(): void {
    if (this.unlocked) {
      return;
    }
    this.unlocked = true;
    void Howler.ctx?.resume?.().catch((error: unknown) => {
      this.options.logger?.warn("[web-audio] unlock failed", error);
    });
  }

  private handleUnlockGesture(): void {
    this.unlock();
  }

  private applyMasterVolume(): void {
    Howler.volume(this.mixer?.master ?? 1);
    for (const loaded of this.loadedClips.values()) {
      const cue = this.findCueForClip(loaded.clip.definitionId);
      loaded.howl.volume(this.categoryVolume(cue?.category ?? "sfx"));
    }
  }

  private categoryVolume(category: SoundCueDefinition["category"]): number {
    return Math.max(0, Math.min(1, this.mixer?.[category] ?? 1));
  }

  private getCue(cueDefinitionId: string): SoundCueDefinition | null {
    return (
      this.contentLibrary?.soundCueDefinitions?.find(
        (definition) => definition.definitionId === cueDefinitionId
      ) ?? null
    );
  }

  private findCueForClip(
    audioClipDefinitionId: string
  ): SoundCueDefinition | null {
    return (
      this.contentLibrary?.soundCueDefinitions?.find((cue) =>
        cue.clips.some(
          (clip) => clip.audioClipDefinitionId === audioClipDefinitionId
        )
      ) ?? null
    );
  }

  private getClip(audioClipDefinitionId: string): AudioClipDefinition | null {
    return (
      this.contentLibrary?.audioClipDefinitions?.find(
        (definition) => definition.definitionId === audioClipDefinitionId
      ) ?? null
    );
  }

  private getHowlerFormat(clip: AudioClipDefinition): string[] | undefined {
    const mimeType = clip.source.mimeType?.toLowerCase() ?? "";
    if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return ["mp3"];
    if (mimeType.includes("ogg") || mimeType.includes("opus")) return ["ogg"];
    if (mimeType.includes("wav") || mimeType.includes("wave")) return ["wav"];

    const extension =
      clip.source.fileName.split(".").pop()?.toLowerCase() ?? "";
    if (extension === "mp3" || extension === "ogg" || extension === "wav") {
      return [extension];
    }
    return undefined;
  }

  private getLoadedClip(
    clip: AudioClipDefinition,
    cue: SoundCueDefinition
  ): LoadedClip | null {
    const existing = this.loadedClips.get(clip.definitionId);
    if (existing) {
      existing.howl.volume(this.categoryVolume(cue.category));
      return existing;
    }
    const src = this.assetSources[clip.source.relativeAssetPath];
    if (!src) {
      this.options.logger?.warn("[web-audio] missing clip source", {
        audioClipDefinitionId: clip.definitionId,
        relativeAssetPath: clip.source.relativeAssetPath
      });
      return null;
    }
    const howl = new Howl({
      src: [src],
      format: this.getHowlerFormat(clip),
      volume: this.categoryVolume(cue.category),
      rate: cue.playback.pitch,
      html5: false
    });
    const loaded = { howl, clip };
    this.loadedClips.set(clip.definitionId, loaded);
    return loaded;
  }

  private selectCueClip(
    cue: SoundCueDefinition,
    instanceKey: string
  ): AudioClipDefinition | null {
    if (cue.clips.length === 0) {
      return null;
    }
    if (cue.playback.mode === "sequence") {
      const cursor = this.sequenceCursors.get(instanceKey) ?? 0;
      this.sequenceCursors.set(instanceKey, cursor + 1);
      return this.getClip(
        cue.clips[cursor % cue.clips.length]!.audioClipDefinitionId
      );
    }
    if (
      cue.playback.mode !== "random" &&
      cue.playback.mode !== "random-interval"
    ) {
      return this.getClip(cue.clips[0]!.audioClipDefinitionId);
    }
    const totalWeight = cue.clips.reduce(
      (sum, clip) => sum + Math.max(0, clip.weight),
      0
    );
    let cursor = Math.random() * Math.max(totalWeight, 1);
    for (const clipRef of cue.clips) {
      cursor -= Math.max(0, clipRef.weight);
      if (cursor <= 0) {
        return this.getClip(clipRef.audioClipDefinitionId);
      }
    }
    return this.getClip(cue.clips[0]!.audioClipDefinitionId);
  }

  private playCue(
    cueDefinitionId: string,
    instanceKey: string,
    position: [number, number, number] | null
  ): void {
    const cue = this.getCue(cueDefinitionId);
    if (!cue) {
      return;
    }
    if (
      cue.playback.retrigger === "ignore-while-playing" &&
      this.activeInstances.has(instanceKey)
    ) {
      return;
    }
    if (cue.playback.retrigger === "restart") {
      this.stopInstance(instanceKey);
    }

    const clip = this.selectCueClip(cue, instanceKey);
    if (!clip) {
      return;
    }
    const loaded = this.getLoadedClip(clip, cue);
    if (!loaded) {
      return;
    }

    const soundId = loaded.howl.play();
    loaded.howl.loop(cue.playback.mode === "loop", soundId);
    const rate =
      this.randomInRange(cue.playback.randomPitch) ?? cue.playback.pitch;
    const volume =
      this.randomInRange(cue.playback.randomVolume) ?? cue.playback.volume;
    loaded.howl.rate(rate, soundId);
    loaded.howl.volume(volume * this.categoryVolume(cue.category), soundId);
    if (cue.spatial.enabled && position) {
      loaded.howl.pos(...position, soundId);
      loaded.howl.pannerAttr(
        {
          refDistance: cue.spatial.refDistance,
          maxDistance: cue.spatial.maxDistance,
          rolloffFactor: cue.spatial.rolloffFactor
        },
        soundId
      );
    }
    if (cue.playback.fadeInMs > 0) {
      loaded.howl.volume(0, soundId);
      loaded.howl.fade(
        0,
        volume * this.categoryVolume(cue.category),
        cue.playback.fadeInMs,
        soundId
      );
    }

    const existing = this.activeInstances.get(instanceKey);
    const sounds = [
      ...(existing?.sounds ?? []),
      { howl: loaded.howl, soundId }
    ];
    while (sounds.length > cue.playback.maxInstances) {
      const removed = sounds.shift();
      if (removed) {
        this.stopSound(removed.howl, removed.soundId, cue.playback.fadeOutMs);
      }
    }
    this.activeInstances.set(instanceKey, { cueDefinitionId, sounds });

    if (cue.playback.mode === "random-interval") {
      this.scheduleRandomInterval(cue, instanceKey, position);
    }
  }

  private scheduleRandomInterval(
    cue: SoundCueDefinition,
    instanceKey: string,
    position: [number, number, number] | null
  ): void {
    const range = cue.playback.randomIntervalSeconds;
    if (!range) {
      return;
    }
    const existingTimer = this.randomTimers.get(instanceKey);
    if (existingTimer) {
      this.options.ownerWindow.clearTimeout(existingTimer);
    }
    const delaySeconds = range[0] + Math.random() * (range[1] - range[0]);
    const timer = this.options.ownerWindow.setTimeout(() => {
      this.randomTimers.delete(instanceKey);
      if (this.activeInstances.has(instanceKey)) {
        this.playCue(cue.definitionId, instanceKey, position);
      }
    }, delaySeconds * 1000);
    this.randomTimers.set(instanceKey, timer);
  }

  private stopSound(howl: Howl, soundId: number, fadeOutMs: number): void {
    if (fadeOutMs > 0) {
      const currentVolume = howl.volume(soundId);
      howl.fade(
        typeof currentVolume === "number" ? currentVolume : 0,
        0,
        fadeOutMs,
        soundId
      );
      howl.once("fade", () => howl.stop(soundId), soundId);
      return;
    }
    howl.stop(soundId);
  }

  private stopInstance(instanceKey: string, fadeOutMs?: number): void {
    const timer = this.randomTimers.get(instanceKey);
    if (timer) {
      this.options.ownerWindow.clearTimeout(timer);
      this.randomTimers.delete(instanceKey);
    }
    const instance = this.activeInstances.get(instanceKey);
    if (!instance) {
      return;
    }
    const cue = this.getCue(instance.cueDefinitionId);
    const resolvedFadeOutMs = fadeOutMs ?? cue?.playback.fadeOutMs ?? 0;
    for (const { howl, soundId } of instance.sounds) {
      this.stopSound(howl, soundId, resolvedFadeOutMs);
    }
    this.activeInstances.delete(instanceKey);
  }

  private randomInRange(range: [number, number] | null): number | null {
    if (!range) {
      return null;
    }
    return range[0] + Math.random() * (range[1] - range[0]);
  }
}
