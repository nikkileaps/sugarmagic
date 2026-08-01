import { describe, expect, it } from "vitest";

import { DEFAULT_CAMERA_CONFIG } from "./index";
import {
  DIALOGUE_FOCUS_MOVE,
  createCameraMoveDirector,
  getCameraMove,
  listCameraMoves,
  sampleCameraMove,
  type CameraMoveBounds
} from "./moves";

const BOUNDS: CameraMoveBounds = {
  pitchMin: DEFAULT_CAMERA_CONFIG.pitchMin,
  pitchMax: DEFAULT_CAMERA_CONFIG.pitchMax,
  distanceMin: DEFAULT_CAMERA_CONFIG.distanceMin,
  distanceMax: DEFAULT_CAMERA_CONFIG.distanceMax
};

const BASELINE = {
  pitch: DEFAULT_CAMERA_CONFIG.pitchDefault,
  distance: DEFAULT_CAMERA_CONFIG.distanceDefault
};

const sample = (elapsedMs: number, exit?: Parameters<typeof sampleCameraMove>[0]["exit"]) =>
  sampleCameraMove({
    move: DIALOGUE_FOCUS_MOVE,
    baseline: BASELINE,
    bounds: BOUNDS,
    elapsedMs,
    exit
  });

describe("camera move registry", () => {
  it("exposes moves by name for a requester that never sees a camera", () => {
    expect(getCameraMove("dialogue-focus")).toEqual(DIALOGUE_FOCUS_MOVE);
    expect(getCameraMove("no-such-move")).toBeNull();
    expect(listCameraMoves().map((move) => move.name)).toContain("dialogue-focus");
  });

  it("returns faster than it arrives", () => {
    // A slow return reads as input lag exactly when control comes back.
    for (const move of listCameraMoves()) {
      expect(move.exitMs).toBeLessThan(move.enterMs);
    }
  });
});

describe("sampleCameraMove", () => {
  it("starts at the baseline", () => {
    const start = sample(0);
    expect(start.pitch).toBeCloseTo(BASELINE.pitch, 5);
    expect(start.distance).toBeCloseTo(BASELINE.distance, 5);
    expect(start.phase).toBe("entering");
  });

  it("moves closer and toward the horizon, never overhead", () => {
    const held = sample(DIALOGUE_FOCUS_MOVE.enterMs);

    expect(held.distance).toBeLessThan(BASELINE.distance);
    // Lower pitch shows a face; higher pitch shows the top of a head.
    expect(held.pitch).toBeLessThan(BASELINE.pitch);
    expect(held.phase).toBe("held");
  });

  it("holds steady once it has arrived", () => {
    const atArrival = sample(DIALOGUE_FOCUS_MOVE.enterMs);
    const muchLater = sample(DIALOGUE_FOCUS_MOVE.enterMs * 10);

    expect(muchLater.pitch).toBeCloseTo(atArrival.pitch, 5);
    expect(muchLater.distance).toBeCloseTo(atArrival.distance, 5);
    expect(muchLater.phase).toBe("held");
  });

  it("never frames beyond the rig's own limits", () => {
    // A baseline already at the near/low edge must not be pushed past it.
    const edge = sampleCameraMove({
      move: DIALOGUE_FOCUS_MOVE,
      baseline: { pitch: BOUNDS.pitchMin, distance: BOUNDS.distanceMin },
      bounds: BOUNDS,
      elapsedMs: DIALOGUE_FOCUS_MOVE.enterMs
    });

    expect(edge.pitch).toBeGreaterThanOrEqual(BOUNDS.pitchMin);
    expect(edge.distance).toBeGreaterThanOrEqual(BOUNDS.distanceMin);
  });

  it("returns to the baseline it was given", () => {
    const held = sample(DIALOGUE_FOCUS_MOVE.enterMs);
    const returned = sample(DIALOGUE_FOCUS_MOVE.enterMs, {
      fromPitch: held.pitch,
      fromDistance: held.distance,
      elapsedMs: DIALOGUE_FOCUS_MOVE.exitMs
    });

    expect(returned.pitch).toBeCloseTo(BASELINE.pitch, 5);
    expect(returned.distance).toBeCloseTo(BASELINE.distance, 5);
    expect(returned.phase).toBe("done");
  });

  it("returns from where the camera actually was, not from the target", () => {
    // Released a fifth of the way in: the camera has barely moved, and the
    // return must not snap it to the full framing first.
    const partial = sample(DIALOGUE_FOCUS_MOVE.enterMs * 0.2);
    const exitStart = sample(DIALOGUE_FOCUS_MOVE.enterMs * 0.2, {
      fromPitch: partial.pitch,
      fromDistance: partial.distance,
      elapsedMs: 0
    });

    expect(exitStart.pitch).toBeCloseTo(partial.pitch, 5);
    expect(exitStart.distance).toBeCloseTo(partial.distance, 5);
    expect(exitStart.phase).toBe("exiting");
  });

  it("eases rather than moving linearly", () => {
    const half = sample(DIALOGUE_FOCUS_MOVE.enterMs / 2);
    const linearHalf = (BASELINE.distance + sample(DIALOGUE_FOCUS_MOVE.enterMs).distance) / 2;

    // Ease-out commits early, so it is already past the linear midpoint.
    expect(half.distance).toBeLessThan(linearHalf);
  });

  it("reports done so a finished move can simply be dropped", () => {
    const done = sample(DIALOGUE_FOCUS_MOVE.enterMs, {
      fromPitch: 35,
      fromDistance: 16,
      elapsedMs: DIALOGUE_FOCUS_MOVE.exitMs * 3
    });

    expect(done.phase).toBe("done");
    expect(done.pitch).toBeCloseTo(BASELINE.pitch, 5);
    expect(done.distance).toBeCloseTo(BASELINE.distance, 5);
  });
});

describe("createCameraMoveDirector", () => {
  /**
   * Runs frames and returns the last frame the director actually produced.
   * Deliberately not the last return value: the director goes quiet once a move
   * finishes, so that would be null and would say nothing about where the
   * camera ended up.
   */
  const drive = (director: ReturnType<typeof createCameraMoveDirector>, ms: number, step = 16) => {
    let last: ReturnType<typeof director.update> = null;
    for (let t = 0; t < ms; t += step) last = director.update(step, BOUNDS) ?? last;
    return last;
  };

  it("does nothing until a move is requested", () => {
    const director = createCameraMoveDirector();
    expect(director.update(16, BOUNDS)).toBeNull();
    expect(director.activeMoveName()).toBeNull();
  });

  it("ignores a move that does not exist rather than seizing the camera", () => {
    const director = createCameraMoveDirector();
    director.request("no-such-move", BASELINE);

    expect(director.activeMoveName()).toBeNull();
    expect(director.update(16, BOUNDS)).toBeNull();
  });

  it("arrives, holds, and gives the framing back", () => {
    const director = createCameraMoveDirector();
    director.request("dialogue-focus", BASELINE);

    const arrived = drive(director, DIALOGUE_FOCUS_MOVE.enterMs + 32);
    expect(arrived?.phase).toBe("held");
    expect(arrived!.distance).toBeLessThan(BASELINE.distance);

    director.release("dialogue-focus", BOUNDS);
    const returned = drive(director, DIALOGUE_FOCUS_MOVE.exitMs + 32);
    expect(returned?.phase).toBe("done");
    expect(returned!.pitch).toBeCloseTo(BASELINE.pitch, 3);
    expect(returned!.distance).toBeCloseTo(BASELINE.distance, 3);
  });

  it("goes quiet once the move is done, so the caller can stop applying it", () => {
    const director = createCameraMoveDirector();
    director.request("dialogue-focus", BASELINE);
    drive(director, DIALOGUE_FOCUS_MOVE.enterMs + 32);
    director.release("dialogue-focus", BOUNDS);
    drive(director, DIALOGUE_FOCUS_MOVE.exitMs + 32);

    expect(director.update(16, BOUNDS)).toBeNull();
    expect(director.activeMoveName()).toBeNull();
  });

  it("returns from a partial entry without snapping to the full framing", () => {
    const director = createCameraMoveDirector();
    director.request("dialogue-focus", BASELINE);
    const partial = drive(director, DIALOGUE_FOCUS_MOVE.enterMs * 0.25)!;

    director.release("dialogue-focus", BOUNDS);
    const firstExitFrame = director.update(1, BOUNDS)!;

    // Within a frame of where it was, not jumped to the target and back.
    expect(firstExitFrame.distance).toBeCloseTo(partial.distance, 0);
    expect(firstExitFrame.phase).toBe("exiting");
  });

  it("cancel drops the move immediately and leaves the camera alone", () => {
    const director = createCameraMoveDirector();
    director.request("dialogue-focus", BASELINE);
    drive(director, 200);

    director.cancel();
    expect(director.update(16, BOUNDS)).toBeNull();
    expect(director.activeMoveName()).toBeNull();
  });

  it("a second request re-baselines rather than stacking", () => {
    const director = createCameraMoveDirector();
    director.request("dialogue-focus", BASELINE);
    drive(director, DIALOGUE_FOCUS_MOVE.enterMs + 32);

    const moved = { pitch: 38, distance: 18 };
    director.request("dialogue-focus", moved);
    director.release("dialogue-focus", BOUNDS);
    const returned = drive(director, DIALOGUE_FOCUS_MOVE.exitMs + 32)!;

    // Returns to the SECOND baseline, not the first.
    expect(returned.pitch).toBeCloseTo(moved.pitch, 3);
    expect(returned.distance).toBeCloseTo(moved.distance, 3);
  });
});

describe("regressions found in review", () => {
  const drive = (director: ReturnType<typeof createCameraMoveDirector>, ms: number, step = 16) => {
    let last: ReturnType<typeof director.update> = null;
    for (let t = 0; t < ms; t += step) last = director.update(step, BOUNDS) ?? last;
    return last;
  };

  it("never leaves the rig limits when releasing from a CLAMPED hold", () => {
    // The move wants pitch 30 from this baseline, which clamps to 35. Sampling
    // the release without bounds reported 31.5 -- a position the camera was
    // never in -- and the whole return then ran below pitchMin.
    const director = createCameraMoveDirector();
    director.request("dialogue-focus", { pitch: 40, distance: 20 });
    drive(director, DIALOGUE_FOCUS_MOVE.enterMs + 32);

    director.release("dialogue-focus", BOUNDS);
    for (let t = 0; t < DIALOGUE_FOCUS_MOVE.exitMs + 32; t += 16) {
      const frame = director.update(16, BOUNDS);
      if (!frame) break;
      expect(frame.pitch).toBeGreaterThanOrEqual(BOUNDS.pitchMin);
      expect(frame.pitch).toBeLessThanOrEqual(BOUNDS.pitchMax);
      expect(frame.distance).toBeGreaterThanOrEqual(BOUNDS.distanceMin);
      expect(frame.distance).toBeLessThanOrEqual(BOUNDS.distanceMax);
    }
  });

  it("releases only the move that is actually in flight", () => {
    const director = createCameraMoveDirector();
    director.request("dialogue-focus", BASELINE);
    drive(director, DIALOGUE_FOCUS_MOVE.enterMs + 32);

    // Someone else's move name must not hand back this one's framing.
    director.release("some-other-move", BOUNDS);
    expect(drive(director, 200)!.phase).toBe("held");

    director.release("dialogue-focus", BOUNDS);
    expect(drive(director, DIALOGUE_FOCUS_MOVE.exitMs + 32)!.phase).toBe("done");
  });

  it("re-requesting off the PLAYER's framing returns there, however many times", () => {
    // The host no longer writes the move into camera state, so the framing a
    // request captures is the player's own and cannot ratchet inward.
    const director = createCameraMoveDirector();
    const resting = { pitch: 45, distance: 25 };

    for (let round = 0; round < 3; round++) {
      director.request("dialogue-focus", resting);
      drive(director, DIALOGUE_FOCUS_MOVE.enterMs + 32);
      director.release("dialogue-focus", BOUNDS);
      const settled = drive(director, DIALOGUE_FOCUS_MOVE.exitMs + 32)!;
      expect(settled.pitch).toBeCloseTo(resting.pitch, 3);
      expect(settled.distance).toBeCloseTo(resting.distance, 3);
    }
  });
});
