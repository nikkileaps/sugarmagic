/**
 * Plan 062 §062.1 — the standard-rig contract vs the vendored
 * animation library. The whole Character Wizard design rests on
 * "every vendored clip resolves against the rig contract" — this
 * suite makes that a test, not a hope. If a future re-vendor or a
 * hand edit lets the two drift, this fails before anything ships.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  STANDARD_RIG,
  STANDARD_RIG_CORE,
  STANDARD_RIG_CORE_WITH_TAIL,
  STANDARD_RIG_LANDMARK_BONES,
  STANDARD_RIG_SCHEMA_VERSION,
  STANDARD_RIG_TAIL_BONES,
  STANDARD_RIG_TAIL_LANDMARK_BONES,
  isStandardRigBoneName,
  isStandardRigCoreBoneName,
  isStandardRigTailBoneName
} from "@sugarmagic/domain";

const CLIPS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../vendor/quaternius-ual/clips"
);

interface GltfDocument {
  nodes?: Array<{ name?: string; children?: number[] }>;
  animations?: Array<{
    name?: string;
    channels: Array<{ target: { node?: number; path: string } }>;
    samplers: Array<{ input: number; output: number }>;
  }>;
  accessors?: Array<unknown>;
}

/** Minimal GLB chunk reader (mirrors io's readGlbChunks contract). */
function readGlbJson(buffer: Buffer): GltfDocument {
  expect(buffer.readUInt32LE(0)).toBe(0x46546c67); // magic "glTF"
  expect(buffer.readUInt32LE(4)).toBe(2);
  const jsonLength = buffer.readUInt32LE(12);
  expect(buffer.readUInt32LE(16)).toBe(0x4e4f534a); // "JSON"
  return JSON.parse(
    buffer.subarray(20, 20 + jsonLength).toString("utf8")
  ) as GltfDocument;
}

describe("standard rig contract (Plan 062)", () => {
  it("carries the full 53-bone Quaternius-compatible skeleton, rooted once", () => {
    expect(STANDARD_RIG.rigSchemaVersion).toBe(STANDARD_RIG_SCHEMA_VERSION);
    expect(STANDARD_RIG.bones.length).toBe(53);
    const roots = STANDARD_RIG.bones.filter((bone) => bone.parentName === null);
    expect(roots.map((bone) => bone.name)).toEqual(["root"]);
    // Every parent reference resolves inside the contract.
    const names = new Set(STANDARD_RIG.bones.map((bone) => bone.name));
    for (const bone of STANDARD_RIG.bones) {
      if (bone.parentName !== null) {
        expect(names.has(bone.parentName)).toBe(true);
      }
    }
  });

  it("maps all 16 wizard landmarks to bones that exist in the contract", () => {
    const landmarkEntries = Object.entries(STANDARD_RIG_LANDMARK_BONES);
    expect(landmarkEntries.length).toBe(16);
    for (const [, boneName] of landmarkEntries) {
      expect(isStandardRigBoneName(boneName)).toBe(true);
    }
  });

  it("the tail extension chains off hips and leaves the core untouched (Plan 064)", () => {
    expect(STANDARD_RIG_SCHEMA_VERSION).toBe(2);
    expect(STANDARD_RIG_TAIL_BONES.length).toBe(3);
    expect(STANDARD_RIG_TAIL_BONES[0]!.parentName).toBe("DEF-hips");
    expect(STANDARD_RIG_TAIL_BONES[1]!.parentName).toBe("DEF-tail.001");
    expect(STANDARD_RIG_TAIL_BONES[2]!.parentName).toBe("DEF-tail.002");
    // Tail bones are NOT core (tail-less wizard output unchanged)
    // and not part of the vendored contract either.
    for (const bone of STANDARD_RIG_TAIL_BONES) {
      expect(isStandardRigTailBoneName(bone.name)).toBe(true);
      expect(isStandardRigCoreBoneName(bone.name)).toBe(false);
      expect(isStandardRigBoneName(bone.name)).toBe(false);
      // Unit rest rotations.
      const [x, y, z, w] = bone.restRotation;
      expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 4);
    }
    // Composed set = core + tail, in order.
    expect(STANDARD_RIG_CORE_WITH_TAIL.bones.length).toBe(26);
    expect(STANDARD_RIG_CORE_WITH_TAIL.bones.slice(0, 23)).toEqual(
      STANDARD_RIG_CORE.bones
    );
    // Landmarks map onto extension bones.
    for (const boneName of Object.values(STANDARD_RIG_TAIL_LANDMARK_BONES)) {
      expect(isStandardRigTailBoneName(boneName)).toBe(true);
    }
    // Authored rest arc sanity: composed world +Y of each tail
    // bone points BACK (-z) and increasingly UP (+y).
    const worldRot = new Map<string, [number, number, number, number]>();
    const mul = (
      a: [number, number, number, number],
      b: [number, number, number, number]
    ): [number, number, number, number] => [
      a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
      a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
    ];
    for (const bone of STANDARD_RIG.bones) {
      const parent = bone.parentName
        ? worldRot.get(bone.parentName)!
        : ([0, 0, 0, 1] as [number, number, number, number]);
      worldRot.set(
        bone.name,
        mul(parent, bone.restRotation as [number, number, number, number])
      );
    }
    let previousUp = -1;
    for (const bone of STANDARD_RIG_TAIL_BONES) {
      const parent = worldRot.get(bone.parentName!)!;
      const world = mul(
        parent,
        bone.restRotation as [number, number, number, number]
      );
      worldRot.set(bone.name, world);
      const [x, y, z, w] = world;
      const upY = 2 * (x * y - w * z) * 0 + (1 - 2 * (x * x + z * z));
      const backZ = 2 * (y * z + w * x);
      expect(backZ).toBeLessThan(0); // points backward
      expect(upY).toBeGreaterThan(previousUp); // curls upward
      previousUp = upY;
    }
  });

  it("the core set is a valid 23-bone subset with intact parent chains", () => {
    expect(STANDARD_RIG_CORE.bones.length).toBe(23);
    const coreNames = new Set(STANDARD_RIG_CORE.bones.map((b) => b.name));
    for (const bone of STANDARD_RIG_CORE.bones) {
      if (bone.parentName !== null) {
        expect(coreNames.has(bone.parentName), bone.name).toBe(true);
      }
    }
    // Landmarks all map into the core.
    for (const boneName of Object.values(STANDARD_RIG_LANDMARK_BONES)) {
      expect(isStandardRigCoreBoneName(boneName)).toBe(true);
    }
  });

  it("every vendored clip's animation tracks target only CORE bones (fingers stripped)", () => {
    const clipFiles = readdirSync(CLIPS_DIR).filter((file) =>
      file.endsWith(".glb")
    );
    expect(clipFiles.length).toBeGreaterThanOrEqual(3);
    for (const file of clipFiles) {
      const document = readGlbJson(readFileSync(resolve(CLIPS_DIR, file)));
      expect(document.animations?.length).toBe(1);
      const animation = document.animations![0]!;
      // Clip name matches its file name — the wizard binds slots
      // by clip name.
      expect(`${animation.name}.glb`).toBe(file);
      expect(animation.channels.length).toBeGreaterThan(0);
      // Rotation-only retargeting (2026-07-06): translation/scale
      // tracks on non-hips bones would override each character's
      // proportions with the library rig's.
      for (const channel of animation.channels) {
        if (channel.target.path === "translation") {
          const nodeName =
            document.nodes?.[channel.target.node!]?.name ?? "";
          expect(nodeName, `${file} translation track`).toBe("DEF-hips");
        } else {
          expect(channel.target.path, file).toBe("rotation");
        }
      }
      for (const channel of animation.channels) {
        const nodeIndex = channel.target.node;
        expect(nodeIndex).toBeDefined();
        const nodeName = document.nodes?.[nodeIndex!]?.name;
        expect(nodeName).toBeDefined();
        expect(
          isStandardRigCoreBoneName(nodeName!) || nodeName === "root"
        ).toBe(true);
      }
    }
  });

  it("ships the curated locomotion set (idle / walk / run)", () => {
    const clipFiles = readdirSync(CLIPS_DIR);
    for (const required of ["Idle_Loop.glb", "Walk_Loop.glb", "Jog_Fwd_Loop.glb"]) {
      expect(clipFiles).toContain(required);
    }
  });
});
