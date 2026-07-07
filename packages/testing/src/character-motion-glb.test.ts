/**
 * Plan 063 §063.3 — generated clip GLBs: round-trip, contract
 * compliance (rotation-only + hips translation, core bones,
 * name-based binding), recipe survival, and compatibility with
 * the existing per-character hips scaling.
 */
import { describe, expect, it } from "vitest";
import {
  IDLE_DEFAULTS,
  generateIdleChannels,
  generateWalkChannels,
  sampleMotion
} from "@sugarmagic/character-rig";
import {
  STANDARD_RIG_CORE,
  createDefaultMotionRecipe,
  isMotionRecipe,
  isStandardRigCoreBoneName
} from "@sugarmagic/domain";
import {
  buildClipGlb,
  readClipRecipe,
  readGlb,
  scaleClipHipsTranslation
} from "@sugarmagic/io";

function buildIdleClip(): ArrayBuffer {
  const motion = sampleMotion(generateIdleChannels(IDLE_DEFAULTS));
  return buildClipGlb({
    clipName: "Generated_Idle",
    duration: motion.duration,
    boneTracks: motion.boneTracks,
    hipsTranslation: motion.hipsTranslation,
    bones: STANDARD_RIG_CORE.bones.map((bone) => ({
      name: bone.name,
      parentName: bone.parentName,
      restPosition: bone.restPosition,
      restRotation: bone.restRotation
    })),
    recipe: createDefaultMotionRecipe("idle")
  });
}

describe("generated clip GLBs (Plan 063)", () => {
  it("round-trips: parseable, one named animation, tracks target core bones", () => {
    const glb = buildIdleClip();
    const chunks = readGlb(glb);
    expect(chunks).not.toBeNull();
    const document = chunks!.document;
    expect(document.animations?.length).toBe(1);
    const animation = document.animations![0]!;
    expect(animation.name).toBe("Generated_Idle");
    expect(animation.channels.length).toBeGreaterThan(0);
    for (const channel of animation.channels) {
      const nodeName = document.nodes![channel.target.node!]!.name!;
      expect(isStandardRigCoreBoneName(nodeName), nodeName).toBe(true);
      if (channel.target.path === "translation") {
        expect(nodeName).toBe("DEF-hips");
      } else {
        expect(channel.target.path).toBe("rotation");
      }
    }
    // Hierarchy: exactly one scene root (the rig root).
    expect(document.scenes![0]!.nodes!.length).toBe(1);
    expect(document.nodes![document.scenes![0]!.nodes![0]!]!.name).toBe("root");
  });

  it("keyframe data survives the write byte-exact", () => {
    const motion = sampleMotion(generateWalkChannels(IDLE_DEFAULTS));
    const glb = buildClipGlb({
      clipName: "Generated_Walk",
      duration: motion.duration,
      boneTracks: motion.boneTracks,
      hipsTranslation: motion.hipsTranslation,
      bones: STANDARD_RIG_CORE.bones.map((bone) => ({
        name: bone.name,
        parentName: bone.parentName,
        restPosition: bone.restPosition,
        restRotation: bone.restRotation
      }))
    });
    const chunks = readGlb(glb)!;
    const document = chunks.document;
    const animation = document.animations![0]!;
    // Decode the first rotation channel's output and compare.
    const firstRotation = animation.channels.find(
      (channel) => channel.target.path === "rotation"
    )!;
    const nodeName = document.nodes![firstRotation.target.node!]!.name!;
    const source = motion.boneTracks.find((track) => track.boneName === nodeName)!;
    const sampler = animation.samplers[firstRotation.sampler]!;
    const accessor = document.accessors![sampler.output]!;
    const view = document.bufferViews![accessor.bufferView!]!;
    const start = chunks.binaryChunk!.byteOffset + (view.byteOffset ?? 0);
    const decoded = new Float32Array(
      chunks.binaryChunk!.buffer.slice(start, start + view.byteLength)
    );
    expect([...decoded]).toEqual([...source.rotations]);
    // Input accessor declares min/max (spec requirement).
    const input = document.accessors![sampler.input]!;
    expect(input.min).toEqual([0]);
    expect(input.max?.[0]).toBeCloseTo(motion.duration, 5);
  });

  it("carries its recipe and the recipe validates", () => {
    const recipe = readClipRecipe(buildIdleClip());
    expect(isMotionRecipe(recipe)).toBe(true);
    expect((recipe as { generatorId: string }).generatorId).toBe("idle");
  });

  it("hips scaling applies to generated clips unchanged", () => {
    const glb = buildIdleClip();
    const scaled = scaleClipHipsTranslation(glb, 0.5);
    const chunks = readGlb(scaled)!;
    const document = chunks.document;
    const translation = document.animations![0]!.channels.find(
      (channel) => channel.target.path === "translation"
    )!;
    const sampler = document.animations![0]!.samplers[translation.sampler]!;
    const accessor = document.accessors![sampler.output]!;
    const view = document.bufferViews![accessor.bufferView!]!;
    const start = chunks.binaryChunk!.byteOffset + (view.byteOffset ?? 0);
    const decoded = new Float32Array(
      chunks.binaryChunk!.buffer.slice(start, start + view.byteLength)
    );
    // Hips rest height ~0.9167 halved.
    const original = sampleMotion(generateIdleChannels(IDLE_DEFAULTS));
    expect(decoded[2]).toBeCloseTo(original.hipsTranslation!.values[2]! * 0.5, 4);
  });
});
