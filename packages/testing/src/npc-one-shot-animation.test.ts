/**
 * The one-shot animation hold on an NPC.
 *
 * A quest action plays a bound slot once and the NPC must go back to walking or
 * standing afterwards. three.js only fires `finished` when the last repetition
 * genuinely completes, so the cases that matter are the ones where it never
 * fires: the clip is interrupted, the NPC is hidden so its mixer stops
 * ticking, or the entry is disposed.
 */

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  npcOneShotIsPlaying,
  playNpcOneShot,
  releaseNpcOneShot,
  type NpcAnimationState
} from "@sugarmagic/target-web/npcOneShotAnimation";
import type { NPCAnimationSlot } from "@sugarmagic/domain";

/** A one-second clip that moves one object, enough for a real mixer to run. */
function clip(name: string): THREE.AnimationClip {
  return new THREE.AnimationClip(name, 1, [
    new THREE.VectorKeyframeTrack(".position", [0, 1], [0, 0, 0, 0, 1, 0])
  ]);
}

function npcWithClips(
  clips: Array<[NPCAnimationSlot, THREE.AnimationClip]>
): NpcAnimationState {
  const root = new THREE.Object3D();
  return {
    mixer: new THREE.AnimationMixer(root),
    animationClips: new Map(clips)
  };
}

describe("npc one-shot animation", () => {
  it("holds the NPC while playing and releases when the clip ends", () => {
    const state = npcWithClips([["idle", clip("idle")]]);

    expect(playNpcOneShot(state, "idle", 1)).toBe(true);
    expect(npcOneShotIsPlaying(state)).toBe(true);

    // Past the end of a one-second clip.
    state.mixer!.update(1.5);

    expect(npcOneShotIsPlaying(state)).toBe(false);
  });

  it("plays the clip the requested number of times before releasing", () => {
    const state = npcWithClips([["idle", clip("idle")]]);

    playNpcOneShot(state, "idle", 3);
    state.mixer!.update(1.5);
    expect(npcOneShotIsPlaying(state)).toBe(true);

    state.mixer!.update(1.0);
    expect(npcOneShotIsPlaying(state)).toBe(true);

    state.mixer!.update(1.0);
    expect(npcOneShotIsPlaying(state)).toBe(false);
  });

  it("releases the previous one-shot when a second interrupts it", () => {
    const walk = clip("walk");
    const state = npcWithClips([
      ["idle", clip("idle")],
      ["walk", walk]
    ]);

    playNpcOneShot(state, "idle", 5);
    const first = state.oneShotAction;
    playNpcOneShot(state, "walk", 1);

    // The interrupted clip never fires `finished`, so it has to be put back to
    // looping here or it stays LoopOnce forever.
    expect(first).toBeDefined();
    expect(first!.loop).toBe(THREE.LoopRepeat);
    expect(first!.repetitions).toBe(Infinity);
    expect(state.oneShotAction).not.toBe(first);
    expect(npcOneShotIsPlaying(state)).toBe(true);
  });

  it("releases when the NPC is hidden mid-clip", () => {
    // A hidden NPC's mixer stops being ticked, so `finished` never arrives.
    // The frame loop calls release directly instead.
    const state = npcWithClips([["idle", clip("idle")]]);

    playNpcOneShot(state, "idle", 1);
    releaseNpcOneShot(state);

    expect(npcOneShotIsPlaying(state)).toBe(false);
  });

  it("restores the loop so a slot played once still loops afterwards", () => {
    // The NPC's walk clip played as a one-shot. mixer.clipAction caches one
    // action per clip, and reset() does not restore loop, so without the
    // restore the NPC would freeze on the walk clip's last frame forever.
    const walk = clip("walk");
    const state = npcWithClips([["walk", walk]]);

    playNpcOneShot(state, "walk", 1);
    const action = state.oneShotAction!;
    expect(action.loop).toBe(THREE.LoopRepeat);
    expect(action.repetitions).toBe(1);

    state.mixer!.update(1.5);

    expect(npcOneShotIsPlaying(state)).toBe(false);
    expect(state.mixer!.clipAction(walk).loop).toBe(THREE.LoopRepeat);
    expect(state.mixer!.clipAction(walk).repetitions).toBe(Infinity);
    expect(state.mixer!.clipAction(walk).clampWhenFinished).toBe(false);
    // Cleared so the frame loop re-selects a locomotion slot next tick.
    expect(state.activeAnimationSlot).toBeUndefined();
  });

  it("reports when the NPC has no clip bound to that slot", () => {
    const state = npcWithClips([["idle", clip("idle")]]);

    expect(playNpcOneShot(state, "run", 1)).toBe(false);
    expect(npcOneShotIsPlaying(state)).toBe(false);
  });

  it("does nothing when released while no one-shot is playing", () => {
    const state = npcWithClips([["idle", clip("idle")]]);

    expect(() => releaseNpcOneShot(state)).not.toThrow();
    expect(npcOneShotIsPlaying(state)).toBe(false);
  });
});
