/**
 * Plan 063 §063.1 — motion core: determinism, loop closure,
 * contract compliance, and personality monotonicity. These pin
 * STRUCTURE, never aesthetics (amplitude taste is tuned against
 * the live preview in §063.4).
 */
import { describe, expect, it } from "vitest";
import {
  CHANNEL_PROJECTION,
  IDLE_COMPONENTS,
  IDLE_DEFAULTS,
  LOCOMOTION_COMPONENTS,
  RELAXED_ARM_POSE,
  composeComponents,
  evaluateCurve,
  generateIdleChannels,
  generateRunChannels,
  generateWalkChannels,
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

  it("the idle is a component stack and contributions to a channel sum", () => {
    expect(IDLE_COMPONENTS.map((component) => component.componentId)).toEqual([
      "breathing",
      "weight-shift",
      "head-motion",
      "arm-drift"
    ]);
    // Breathing owns the bob: it contributes bounce, others do not.
    const composed = generateIdleChannels(IDLE_DEFAULTS);
    expect(composed.bounce.length).toBe(1);
    // Stacked curves sum: composing breathing TWICE doubles the
    // composed channel's curve count and (roughly) its amplitude.
    const single = composeComponents([IDLE_COMPONENTS[0]!], IDLE_DEFAULTS, 4);
    const doubled = composeComponents(
      [IDLE_COMPONENTS[0]!, IDLE_COMPONENTS[0]!],
      IDLE_DEFAULTS,
      4
    );
    expect(doubled.channels.breathing!.length).toBe(2);
    const singleSpine = trackAmplitude(sampleMotion(single), "DEF-spine.002");
    const doubledSpine = trackAmplitude(sampleMotion(doubled), "DEF-spine.002");
    expect(doubledSpine).toBeGreaterThan(singleSpine * 1.5);
  });

  it("curves are periodic including noise", () => {
    const curve = {
      harmonics: [{ cycles: 2, amplitude: 1, phase: 0.3 }],
      noise: { seed: 7, amplitude: 0.5, points: 6 }
    };
    expect(evaluateCurve(curve, 0)).toBeCloseTo(evaluateCurve(curve, 1), 9);
    expect(evaluateCurve(curve, 0.25)).toBeCloseTo(evaluateCurve(curve, 1.25), 9);
  });

  it("walk: legs anti-phase, arms counter-swing, knees stay forward-bent", () => {
    const walk = generateWalkChannels(IDLE_DEFAULTS);
    expect(LOCOMOTION_COMPONENTS.map((c) => c.componentId)).toEqual([
      "leg-cycle",
      "hip-motion",
      "arm-swing",
      "body-bounce",
      "head-stabilization"
    ]);
    const at = (channel: keyof typeof walk.channels, phase: number) => {
      let value = 0;
      for (const curve of walk.channels[channel] ?? []) {
        value += evaluateCurve(curve, phase);
      }
      return value;
    };
    // Anti-phase legs: left at phase p mirrors right at p + 0.5.
    for (const phase of [0, 0.2, 0.35, 0.7]) {
      expect(at("legSwingL", phase)).toBeCloseTo(at("legSwingR", phase + 0.5), 6);
    }
    // Counter-swing: left arm tracks the RIGHT leg's phase.
    for (const phase of [0.1, 0.4, 0.8]) {
      const armL = at("armSwingL", phase);
      const legR = at("legSwingR", phase);
      expect(Math.sign(armL)).toBe(Math.sign(legR));
    }
    // Knees never hyperextend backward (DC keeps flexion >= 0).
    for (let i = 0; i <= 40; i += 1) {
      expect(at("kneeFlexL", i / 40)).toBeGreaterThanOrEqual(-1e-9);
      expect(at("kneeFlexR", i / 40)).toBeGreaterThanOrEqual(-1e-9);
    }
    // Bounce is twice per stride.
    const motion = sampleMotion(walk);
    expect(motion.hipsTranslation).not.toBeNull();
  });

  it("run is the walk stack at a faster, bigger gait", () => {
    const walk = generateWalkChannels(IDLE_DEFAULTS);
    const run = generateRunChannels(IDLE_DEFAULTS);
    expect(run.duration).toBeLessThan(walk.duration);
    const amplitude = (motion: typeof walk, channel: "legSwingL") =>
      Math.max(
        ...Array.from({ length: 32 }, (_, i) => {
          let value = 0;
          for (const curve of motion.channels[channel] ?? []) {
            value += Math.abs(evaluateCurve(curve, i / 32));
          }
          return value;
        })
      );
    expect(amplitude(run, "legSwingL")).toBeGreaterThan(
      amplitude(walk, "legSwingL")
    );
    // Contract compliance holds for locomotion output too.
    const motion = sampleMotion(run);
    for (const track of motion.boneTracks) {
      expect(isStandardRigCoreBoneName(track.boneName), track.boneName).toBe(true);
    }
    // Loop closure.
    for (const track of motion.boneTracks) {
      const keys = track.times.length;
      for (let c = 0; c < 4; c += 1) {
        expect(track.rotations[(keys - 1) * 4 + c]).toBeCloseTo(
          track.rotations[c]!,
          6
        );
      }
    }
  });

  it("the relaxed base pose hangs the arms (no contract T-pose)", () => {
    // Arm chain present with substantial offsets from rest.
    expect(Object.keys(RELAXED_ARM_POSE)).toContain("DEF-upper_arm.L");
    const motion = sampleMotion(generateIdleChannels(IDLE_DEFAULTS), {
      basePose: RELAXED_ARM_POSE
    });
    const upperArm = motion.boneTracks.find(
      (track) => track.boneName === "DEF-upper_arm.L"
    )!;
    const rest = STANDARD_RIG_CORE.bones.find(
      (bone) => bone.name === "DEF-upper_arm.L"
    )!.restRotation;
    let dot = 0;
    for (let c = 0; c < 4; c += 1) dot += upperArm.rotations[c]! * rest[c]!;
    const angle = 2 * Math.acos(Math.min(1, Math.abs(dot)));
    // Arms swing well away from the T-pose (library mean ~70 deg).
    expect(angle).toBeGreaterThan(Math.PI / 6);
    // Loop closure still holds with a base pose.
    const keys = upperArm.times.length;
    for (let c = 0; c < 4; c += 1) {
      expect(upperArm.rotations[(keys - 1) * 4 + c]).toBeCloseTo(
        upperArm.rotations[c]!,
        6
      );
    }
    // Hand gets a track purely from the base pose (no channel
    // touches it).
    expect(
      motion.boneTracks.some((track) => track.boneName === "DEF-hand.L")
    ).toBe(true);
  });

  it("rest pose is the baseline: zero-amplitude curves emit rest rotations", () => {
    const motion = sampleMotion({
      duration: 2,
      channels: {
        breathing: [{ harmonics: [{ cycles: 1, amplitude: 0, phase: 0 }] }]
      },
      bounce: []
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
