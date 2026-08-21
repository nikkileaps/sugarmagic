/**
 * The one-shot animation hold on an NPC.
 *
 * The frame loop calls setNpcAnimationSlot for every NPC every frame, so a clip
 * played by a quest action needs locomotion selection to stand down until it
 * ends. That hold is this module: one place that starts a one-shot, one place
 * that ends it.
 *
 * three.js dispatches `finished` only when the last repetition genuinely
 * completes -- `stop()` and `reset()` dispatch nothing -- so `finished` never
 * arrives for a clip that is interrupted, on an NPC whose mixer stopped
 * ticking because it is hidden, or on a disposed entry. All three call
 * releaseNpcOneShot instead.
 */

import * as THREE from "three";
import type { NPCAnimationSlot } from "@sugarmagic/domain";

/** The slice of a reconciler entry's host data this module owns. */
export interface NpcAnimationState {
  mixer?: THREE.AnimationMixer;
  animationClips?: Map<NPCAnimationSlot, THREE.AnimationClip>;
  activeAnimationSlot?: NPCAnimationSlot;
  activeAnimationAction?: THREE.AnimationAction;
  /** Set while a quest-driven one-shot is playing. */
  oneShotAction?: THREE.AnimationAction;
  /** Takes the mixer's `finished` listener back off. */
  releaseOneShot?: () => void;
}

/** True while a one-shot holds this NPC out of locomotion. */
export function npcOneShotIsPlaying(state: NpcAnimationState): boolean {
  return Boolean(state.oneShotAction);
}

/**
 * Ends a one-shot and hands the NPC back to locomotion. Safe to call when none
 * is playing.
 *
 * `reset()` restores neither `loop` nor `clampWhenFinished`, and
 * `mixer.clipAction(clip)` returns a cached action per clip, so a one-shot on a
 * clip that is also a bound locomotion clip would leave that action LoopOnce
 * forever -- the NPC would freeze on its last frame the next time it walked.
 * Restoring the loop here is what prevents that.
 */
export function releaseNpcOneShot(state: NpcAnimationState): void {
  state.releaseOneShot?.();
  state.releaseOneShot = undefined;
  const action = state.oneShotAction;
  if (!action) {
    return;
  }
  state.oneShotAction = undefined;
  action.stop();
  action.setLoop(THREE.LoopRepeat, Infinity);
  action.clampWhenFinished = false;
  // Clearing the active slot makes the frame loop pick locomotion again next
  // tick. Without it, setNpcAnimationSlot's "already on this slot" early-return
  // would skip the NPC whenever the one-shot used that slot's clip.
  state.activeAnimationSlot = undefined;
  state.activeAnimationAction = undefined;
}

/**
 * Plays a bound slot `repeatCount` times through and holds locomotion off until
 * it ends. Returns false when the NPC has no clip for that slot.
 */
export function playNpcOneShot(
  state: NpcAnimationState,
  slot: NPCAnimationSlot,
  repeatCount: number
): boolean {
  const clip = state.animationClips?.get(slot);
  const mixer = state.mixer;
  if (!mixer || !clip) {
    return false;
  }

  // An interrupted clip never fires `finished`, so end the old one here.
  releaseNpcOneShot(state);
  state.activeAnimationAction?.stop();

  const action = mixer.clipAction(clip);
  action.reset();
  action.clampWhenFinished = false;
  // Repetitions counts plays: three.js fires `finished` once loopCount reaches
  // it (AnimationAction.js:800-820).
  action.setLoop(THREE.LoopRepeat, Math.max(1, Math.floor(repeatCount)));
  action.play();

  const onFinished = (event: { action: THREE.AnimationAction }) => {
    if (event.action !== action) {
      return;
    }
    releaseNpcOneShot(state);
  };
  // three.js types the mixer's event map loosely; the listener only reads
  // `action`, which every `finished` event carries.
  mixer.addEventListener("finished", onFinished as never);

  state.oneShotAction = action;
  state.releaseOneShot = () =>
    mixer.removeEventListener("finished", onFinished as never);
  return true;
}
