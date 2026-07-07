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
  STANDARD_RIG_LANDMARK_BONES,
  STANDARD_RIG_SCHEMA_VERSION,
  isStandardRigBoneName,
  isStandardRigCoreBoneName
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
