/**
 * packages/runtime-core/src/camera/moves.ts
 *
 * Purpose: NAMED camera moves. A move is a declarative, reusable framing
 *   change that anything can ask for by name -- dialogue first, then item
 *   inspection, and whatever wants the same framing later.
 *
 * WHY NAMED AND NOT WRITTEN INTO DIALOGUE
 *   The requester should not know what a camera is. A plugin asks for
 *   "dialogue-focus" and never touches camera state, which is what keeps
 *   sugarlang on its side of the plugin boundary.
 *
 * WHERE THE PIECES LIVE
 *   define   here, pure: what a move is and where it should be at time t.
 *   apply    the web target's frame loop, which owns the live camera state.
 *            Nothing in runtime-core owns a camera -- this module is math.
 *   request  a callback injected into the gameplay session, alongside
 *            claimInput / releaseInput.
 *
 * WHAT A MOVE MAY NOT DO
 *   Touch yaw. Auto-follow drives yaw whenever the player moves, so a move
 *   that sets it fights the follow the instant control comes back. Moves are
 *   pitch and distance only, and that is enforced by the return type.
 *
 * Exports:
 *   - CameraMove, CameraMoveSample, CameraMovePhase
 *   - DIALOGUE_FOCUS_MOVE, CAMERA_MOVES
 *   - getCameraMove, listCameraMoves
 *   - sampleCameraMove
 *
 * Status: active
 */

export interface CameraMoveBounds {
  pitchMin: number;
  pitchMax: number;
  distanceMin: number;
  distanceMax: number;
}

export interface CameraMove {
  readonly name: string;
  /**
   * Multiplier on the resting distance. Below 1 brings the camera IN.
   */
  readonly distanceScale: number;
  /**
   * Degrees added to the resting pitch.
   *
   * NEGATIVE drops the camera toward the horizon, which is what shows a
   * character's face and body. Positive tips it further overhead, which shows
   * the tops of their heads -- the opposite of the point.
   */
  readonly pitchDelta: number;
  /** How long the move takes to arrive. */
  readonly enterMs: number;
  /**
   * How long it takes to give the framing back. Deliberately SHORTER than
   * enterMs: the player is regaining control, and a slow return reads as input
   * lag rather than as grace.
   */
  readonly exitMs: number;
}

/**
 * Conversation framing: closer, and lower toward eye level.
 *
 * The dialogue cards carry no portraiture, so the scene has to show who is
 * speaking. Against the default rig (pitch 45, distance 25) this lands at
 * pitch 35 and distance ~16 -- both at the edge of the player's own manual
 * range rather than beyond it, so the framing stays somewhere they could have
 * put the camera themselves.
 */
export const DIALOGUE_FOCUS_MOVE: CameraMove = {
  name: "dialogue-focus",
  distanceScale: 0.65,
  pitchDelta: -10,
  enterMs: 500,
  exitMs: 300
};

export const CAMERA_MOVES: Readonly<Record<string, CameraMove>> = {
  [DIALOGUE_FOCUS_MOVE.name]: DIALOGUE_FOCUS_MOVE
};

export function getCameraMove(name: string): CameraMove | null {
  return CAMERA_MOVES[name] ?? null;
}

/** The moves a requester may ask for. */
export function listCameraMoves(): CameraMove[] {
  return Object.values(CAMERA_MOVES);
}

export type CameraMovePhase = "entering" | "held" | "exiting" | "done";

/** Only pitch and distance: a move structurally cannot touch yaw or target. */
export interface CameraMoveSample {
  pitch: number;
  distance: number;
  phase: CameraMovePhase;
}

export interface CameraMoveExit {
  /**
   * Where the camera actually WAS when the move was released.
   *
   * Captured rather than assumed: releasing during the entry means the camera
   * never reached the target, and returning from the target would snap it
   * forward before easing back.
   */
  fromPitch: number;
  fromDistance: number;
  elapsedMs: number;
}

export interface SampleCameraMoveInput {
  move: CameraMove;
  /** The framing to return to -- captured when the move was requested. */
  baseline: { pitch: number; distance: number };
  bounds: CameraMoveBounds;
  /** Milliseconds since the move was requested. */
  elapsedMs: number;
  /** Set once the move has been released; null while it is still held. */
  exit?: CameraMoveExit | null;
}

export interface CameraMoveDirector {
  /**
   * Start a move, remembering `current` as the framing to give back.
   * Unknown names are ignored -- a requester asking for a move that does not
   * exist must not take the camera hostage.
   */
  request: (name: string, current: { pitch: number; distance: number }) => void;
  /**
   * Begin handing the framing back, from wherever the camera is now.
   *
   * Takes the SAME bounds the caller has been passing to update: sampling with
   * different limits reports a position the camera was never actually in.
   * Ignores a name that is not the move in flight, so one requester cannot
   * release another's framing.
   */
  release: (moveName: string, bounds: CameraMoveBounds) => void;
  /** Drop the move immediately, leaving the camera where it stands. */
  cancel: () => void;
  /**
   * Advance the clock and return the framing to apply, or null when nothing is
   * in flight. Returns the final frame exactly once, so the caller can apply it
   * and then stop.
   */
  update: (deltaMs: number, bounds: CameraMoveBounds) => CameraMoveSample | null;
  activeMoveName: () => string | null;
}

/**
 * Holds the one move in flight.
 *
 * Pure of time and of the camera: the caller passes elapsed milliseconds and
 * receives numbers. That is what makes the whole behaviour testable without a
 * frame loop, and it is why nothing here reads a clock.
 */
export function createCameraMoveDirector(): CameraMoveDirector {
  let move: CameraMove | null = null;
  let baseline = { pitch: 0, distance: 0 };
  let elapsedMs = 0;
  let exit: CameraMoveExit | null = null;

  function currentSample(bounds: CameraMoveBounds): CameraMoveSample | null {
    if (!move) return null;
    return sampleCameraMove({ move, baseline, bounds, elapsedMs, exit });
  }

  return {
    request(name, current) {
      const requested = getCameraMove(name);
      if (!requested) return;
      move = requested;
      baseline = { pitch: current.pitch, distance: current.distance };
      elapsedMs = 0;
      exit = null;
    },
    release(moveName, bounds) {
      if (!move || exit) return;
      if (move.name !== moveName) return;
      // Sampled with the REAL bounds. Sampling unbounded (which this did at
      // first) reports where the move would have gone if the rig had no
      // limits, not where the camera is -- so the return began by snapping
      // OUTSIDE the rig, several degrees past pitchMin, before easing back.
      const now = sampleCameraMove({ move, baseline, bounds, elapsedMs, exit: null });
      exit = { fromPitch: now.pitch, fromDistance: now.distance, elapsedMs: 0 };
    },
    cancel() {
      move = null;
      exit = null;
      elapsedMs = 0;
    },
    update(deltaMs, bounds) {
      if (!move) return null;
      if (exit) {
        exit = { ...exit, elapsedMs: exit.elapsedMs + deltaMs };
      } else {
        elapsedMs += deltaMs;
      }
      const sample = currentSample(bounds);
      if (sample && sample.phase === "done") {
        move = null;
        exit = null;
        elapsedMs = 0;
      }
      return sample;
    },
    activeMoveName() {
      return move?.name ?? null;
    }
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Ease-out cubic: quick to commit, gentle to settle. */
function ease(t: number): number {
  const clamped = clamp(t, 0, 1);
  return 1 - Math.pow(1 - clamped, 3);
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/**
 * Where the camera should be for this move, right now.
 *
 * Pure: the caller owns the clock and the camera. Returns the baseline
 * unchanged once the move is done, so a finished move is indistinguishable
 * from no move at all and the caller can simply drop it.
 */
export function sampleCameraMove(input: SampleCameraMoveInput): CameraMoveSample {
  const { move, baseline, bounds, elapsedMs, exit } = input;

  // Clamped to the rig's own limits so a move can never frame the scene
  // somewhere the player could not have framed it themselves.
  const targetPitch = clamp(
    baseline.pitch + move.pitchDelta,
    bounds.pitchMin,
    bounds.pitchMax
  );
  const targetDistance = clamp(
    baseline.distance * move.distanceScale,
    bounds.distanceMin,
    bounds.distanceMax
  );

  if (!exit) {
    const t = move.enterMs > 0 ? elapsedMs / move.enterMs : 1;
    const eased = ease(t);
    return {
      pitch: lerp(baseline.pitch, targetPitch, eased),
      distance: lerp(baseline.distance, targetDistance, eased),
      phase: t >= 1 ? "held" : "entering"
    };
  }

  const t = move.exitMs > 0 ? exit.elapsedMs / move.exitMs : 1;
  const eased = ease(t);
  // Clamped as well as the entry: a return is still a framing, and nothing this
  // module produces may sit outside the rig's limits.
  return {
    pitch: clamp(
      lerp(exit.fromPitch, baseline.pitch, eased),
      bounds.pitchMin,
      bounds.pitchMax
    ),
    distance: clamp(
      lerp(exit.fromDistance, baseline.distance, eased),
      bounds.distanceMin,
      bounds.distanceMax
    ),
    phase: t >= 1 ? "done" : "exiting"
  };
}
