/**
 * Plan 063 §063.1 — motion core: determinism, loop closure,
 * contract compliance, and personality monotonicity. These pin
 * STRUCTURE, never aesthetics (amplitude taste is tuned against
 * the live preview in §063.4).
 */
import { describe, expect, it } from "vitest";
import {
  CHANNEL_PROJECTION,
  IDLE_DEFAULTS,
  evaluateCurve,
  generateIdleChannels,
  sampleMotion,
  type SampledMotion
} from "@sugarmagic/character-rig";
import { STANDARD_RIG_CORE, isStandardRigCoreBoneName } from "@sugarmagic/domain";

function sampleIdle(overrides: Partial<typeof IDLE_DEFAULTS> = {}): SampledMotion {
  return sampleMotion(generateIdleChannels({ ...IDLE_DEFAULTS, ...overrides }));
}

function trackAmplitude(motion: SampledMotion, boneName: string): number {
  const track = motion.boneTracks.find((t) => t.boneName === boneName);
  if (!track) return 0;
  // Max quaternion distance from the first key — a cheap motion
  // magnitude proxy.
  let max = 0;
  for (let key = 1; key < track.times.length; key += 1) {
    let dot = 0;
    for (let c = 0; c < 4; c += 1) {
      dot += track.rotations[c]! * track.rotations[key * 4 + c]!;
    }
    max = Math.max(max, 1 - Math.abs(dot));
  }
  return max;
}

describe("motion core (Plan 063)", () => {
  it("is deterministic: same recipe, byte-identical tracks", () => {
    const a = sampleIdle();
    const b = sampleIdle();
    expect(a.duration).toBe(b.duration);
    expect(a.boneTracks.length).toBe(b.boneTracks.length);
    for (let i = 0; i < a.boneTracks.length; i += 1) {
      expect([...a.boneTracks[i]!.rotations]).toEqual([
        ...b.boneTracks[i]!.rotations
      ]);
    }
    expect([...a.hipsTranslation!.values]).toEqual([
      ...b.hipsTranslation!.values
    ]);
    // Different seed = different motion.
    const c = sampleIdle({ seed: 99 });
    const aHead = a.boneTracks.find((t) => t.boneName === "DEF-head")!;
    const cHead = c.boneTracks.find((t) => t.boneName === "DEF-head")!;
    expect([...aHead.rotations]).not.toEqual([...cHead.rotations]);
  });

  it("closes the loop: last key equals the first, at t=duration", () => {
    const motion = sampleIdle();
    for (const track of motion.boneTracks) {
      const keys = track.times.length;
      expect(track.times[keys - 1]).toBeCloseTo(motion.duration, 5);
      for (let c = 0; c < 4; c += 1) {
        expect(track.rotations[(keys - 1) * 4 + c]).toBeCloseTo(
          track.rotations[c]!,
          6
        );
      }
    }
    const hips = motion.hipsTranslation!;
    for (let c = 0; c < 3; c += 1) {
      expect(hips.values[(hips.times.length - 1) * 3 + c]).toBeCloseTo(
        hips.values[c]!,
        6
      );
    }
  });

  it("complies with the contract: core bones only, unit quaternions", () => {
    const motion = sampleIdle({ energy: 1, bounce: 1, curiosity: 1, fidgetiness: 1 });
    expect(motion.boneTracks.length).toBeGreaterThan(0);
    for (const track of motion.boneTracks) {
      expect(isStandardRigCoreBoneName(track.boneName), track.boneName).toBe(true);
      for (let key = 0; key < track.times.length; key += 1) {
        const norm = Math.hypot(
          track.rotations[key * 4]!,
          track.rotations[key * 4 + 1]!,
          track.rotations[key * 4 + 2]!,
          track.rotations[key * 4 + 3]!
        );
        expect(norm).toBeCloseTo(1, 5);
      }
    }
  });

  it("projection table targets only core bones", () => {
    for (const targets of Object.values(CHANNEL_PROJECTION)) {
      for (const target of targets) {
        expect(isStandardRigCoreBoneName(target.boneName), target.boneName).toBe(true);
      }
    }
  });

  it("personality is monotone: more bounce = bigger bob, more curiosity = busier head", () => {
    const calm = sampleIdle({ bounce: 0.05, curiosity: 0.05 });
    const lively = sampleIdle({ bounce: 0.95, curiosity: 0.95 });

    const bobRange = (motion: SampledMotion): number => {
      const values = motion.hipsTranslation!.values;
      let min = Infinity, max = -Infinity;
      for (let key = 0; key < values.length / 3; key += 1) {
        const z = values[key * 3 + 2]!;
        min = Math.min(min, z);
        max = Math.max(max, z);
      }
      return max - min;
    };
    expect(bobRange(lively)).toBeGreaterThan(bobRange(calm));
    expect(trackAmplitude(lively, "DEF-head")).toBeGreaterThan(
      trackAmplitude(calm, "DEF-head")
    );

    // Energy compresses the loop.
    expect(sampleIdle({ energy: 1 }).duration).toBeLessThan(
      sampleIdle({ energy: 0 }).duration
    );
  });

  it("curves are periodic including noise", () => {
    const curve = {
      harmonics: [{ cycles: 2, amplitude: 1, phase: 0.3 }],
      noise: { seed: 7, amplitude: 0.5, points: 6 }
    };
    expect(evaluateCurve(curve, 0)).toBeCloseTo(evaluateCurve(curve, 1), 9);
    expect(evaluateCurve(curve, 0.25)).toBeCloseTo(evaluateCurve(curve, 1.25), 9);
  });

  it("rest pose is the baseline: zero-amplitude curves emit rest rotations", () => {
    const motion = sampleMotion({
      duration: 2,
      channels: {
        breathing: { harmonics: [{ cycles: 1, amplitude: 0, phase: 0 }] }
      }
    });
    const spine = motion.boneTracks.find((t) => t.boneName === "DEF-spine.002")!;
    const rest = STANDARD_RIG_CORE.bones.find(
      (bone) => bone.name === "DEF-spine.002"
    )!.restRotation;
    for (let c = 0; c < 4; c += 1) {
      expect(spine.rotations[c]).toBeCloseTo(rest[c]!, 5);
    }
    expect(motion.hipsTranslation).toBeNull();
  });
});
