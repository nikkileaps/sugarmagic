/**
 * scripts/vendor-character-clips.mjs
 *
 * Plan 062 §062.1 — vendors the Character Wizard's animation
 * library + regenerates the standard-rig domain contract, BOTH
 * derived from the same source so they cannot drift.
 *
 * Source: Quaternius Universal Animation Library (CC0), via the
 * glTF mirror pinned below. One glTF+bin carries the universal
 * humanoid rig (53 Rigify-style DEF- bones) and 46 clips.
 *
 * Outputs:
 *   - vendor/quaternius-ual/clips/<Clip>.glb — one self-contained
 *     GLB per curated clip (bone-node hierarchy + that clip only;
 *     no mesh/skin/materials). Track names target the standard
 *     rig's bone names, which is all three.js AnimationMixer
 *     needs to drive a wizard-generated character.
 *   - vendor/quaternius-ual/LICENSE + ATTRIBUTION.md
 *   - packages/domain/src/standard-rig/rig-data.ts — GENERATED
 *     rig contract data (bone names, parents, rest TRS).
 *
 * Usage: node scripts/vendor-character-clips.mjs
 * Re-run only to change the curated clip set or bump the pinned
 * source; commit the outputs.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Pinned provenance — the mirror of the itch.io CC0 distribution.
const SOURCE_REPO = "J-Ponzo/gltf-universal-animation-library";
const SOURCE_COMMIT = "e24c23cf2a1323488a3faa226ea7ea21f644b73e";
const SOURCE_BASE = `https://raw.githubusercontent.com/${SOURCE_REPO}/${SOURCE_COMMIT}/glTF/AnimationLibrary_Godot_Standard`;

// The curated v1 set. Slot mapping lives with the wizard; this
// script only cares which clips ship.
const CURATED_CLIPS = ["Idle_Loop", "Walk_Loop", "Jog_Fwd_Loop", "Sprint_Loop"];

async function fetchSource() {
  const [gltfResponse, binResponse] = await Promise.all([
    fetch(`${SOURCE_BASE}.gltf`),
    fetch(`${SOURCE_BASE}.bin`)
  ]);
  if (!gltfResponse.ok || !binResponse.ok) {
    throw new Error(
      `source fetch failed: gltf ${gltfResponse.status}, bin ${binResponse.status}`
    );
  }
  const document = await gltfResponse.json();
  const bin = Buffer.from(await binResponse.arrayBuffer());
  return { document, bin };
}

/** Component byte sizes per glTF accessor componentType. */
const COMPONENT_BYTES = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4
};
const TYPE_COMPONENTS = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT4: 16
};

function accessorByteLength(accessor) {
  return (
    accessor.count *
    TYPE_COMPONENTS[accessor.type] *
    COMPONENT_BYTES[accessor.componentType]
  );
}

/**
 * Build a self-contained single-animation GLB from the library:
 * bone nodes only (the skin's joint subtree + scene roots that
 * lead to it), one animation, and a bin rebuilt from just the
 * accessors that animation's samplers use.
 */
function extractClipGlb(document, bin, clipName) {
  const animation = document.animations.find((a) => a.name === clipName);
  if (!animation) throw new Error(`clip not found: ${clipName}`);

  // Node subtree: keep every node (the library's node list is the
  // armature + one mesh node). Drop the mesh node by keeping only
  // nodes that are part of the joint hierarchy.
  const jointSet = new Set(document.skins[0].joints);
  // Include ancestors of joints so the hierarchy stays rooted.
  const parentOf = new Map();
  document.nodes.forEach((node, index) => {
    for (const child of node.children ?? []) parentOf.set(child, index);
  });
  const keep = new Set();
  for (const joint of jointSet) {
    let cursor = joint;
    while (cursor !== undefined) {
      keep.add(cursor);
      cursor = parentOf.get(cursor);
    }
  }

  const oldToNew = new Map();
  const newNodes = [];
  [...keep].sort((a, b) => a - b).forEach((oldIndex) => {
    oldToNew.set(oldIndex, newNodes.length);
    const source = document.nodes[oldIndex];
    newNodes.push({
      name: source.name,
      ...(source.translation ? { translation: source.translation } : {}),
      ...(source.rotation ? { rotation: source.rotation } : {}),
      ...(source.scale ? { scale: source.scale } : {}),
      ...(source.children
        ? {
            children: source.children
              .filter((child) => keep.has(child))
              .map((child) => oldToNew.get(child) ?? child)
          }
        : {})
    });
  });
  // Second pass: child indices referenced before assignment above
  // (children with higher old index) — remap now that the full map
  // exists.
  newNodes.forEach((node) => {
    if (node.children) {
      node.children = node.children.map((child) =>
        oldToNew.has(child) ? oldToNew.get(child) : child
      );
    }
  });

  const rootNodes = [...keep].filter((index) => !parentOf.has(index));

  // Accessors used by this animation's samplers, deduped.
  const usedAccessors = new Set();
  for (const sampler of animation.samplers) {
    usedAccessors.add(sampler.input);
    usedAccessors.add(sampler.output);
  }
  const accessorOldToNew = new Map();
  const newAccessors = [];
  const newBufferViews = [];
  const binParts = [];
  let binOffset = 0;
  for (const oldIndex of [...usedAccessors].sort((a, b) => a - b)) {
    const accessor = document.accessors[oldIndex];
    const view = document.bufferViews[accessor.bufferView];
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const length = accessorByteLength(accessor);
    const slice = bin.subarray(start, start + length);
    // 4-byte align each part.
    const padded = Buffer.concat([
      slice,
      Buffer.alloc((4 - (slice.length % 4)) % 4)
    ]);
    accessorOldToNew.set(oldIndex, newAccessors.length);
    newBufferViews.push({
      buffer: 0,
      byteOffset: binOffset,
      byteLength: length
    });
    newAccessors.push({
      bufferView: newBufferViews.length - 1,
      componentType: accessor.componentType,
      count: accessor.count,
      type: accessor.type,
      ...(accessor.min ? { min: accessor.min } : {}),
      ...(accessor.max ? { max: accessor.max } : {})
    });
    binParts.push(padded);
    binOffset += padded.length;
  }
  const newBin = Buffer.concat(binParts);

  const newAnimation = {
    name: animation.name,
    samplers: animation.samplers.map((sampler) => ({
      input: accessorOldToNew.get(sampler.input),
      output: accessorOldToNew.get(sampler.output),
      interpolation: sampler.interpolation ?? "LINEAR"
    })),
    channels: animation.channels
      .filter((channel) => keep.has(channel.target.node))
      .map((channel) => ({
        sampler: channel.sampler,
        target: {
          node: oldToNew.get(channel.target.node),
          path: channel.target.path
        }
      }))
  };

  const outDocument = {
    asset: {
      version: "2.0",
      generator: "sugarmagic vendor-character-clips",
      copyright:
        "Quaternius Universal Animation Library (CC0) - quaternius.com"
    },
    scene: 0,
    scenes: [{ nodes: rootNodes.map((index) => oldToNew.get(index)) }],
    nodes: newNodes,
    animations: [newAnimation],
    accessors: newAccessors,
    bufferViews: newBufferViews,
    buffers: [{ byteLength: newBin.length }]
  };

  return packGlb(outDocument, newBin);
}

/** GLB container: header + JSON chunk + BIN chunk, 4-byte padded. */
function packGlb(document, bin) {
  const jsonBuffer = Buffer.from(JSON.stringify(document), "utf8");
  const jsonPadded = Buffer.concat([
    jsonBuffer,
    Buffer.alloc((4 - (jsonBuffer.length % 4)) % 4, 0x20)
  ]);
  const binPadded = Buffer.concat([
    bin,
    Buffer.alloc((4 - (bin.length % 4)) % 4)
  ]);
  const total = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
  const out = Buffer.alloc(total);
  let offset = 0;
  out.writeUInt32LE(0x46546c67, offset); // magic "glTF"
  out.writeUInt32LE(2, offset + 4);
  out.writeUInt32LE(total, offset + 8);
  offset += 12;
  out.writeUInt32LE(jsonPadded.length, offset);
  out.writeUInt32LE(0x4e4f534a, offset + 4); // "JSON"
  offset += 8;
  jsonPadded.copy(out, offset);
  offset += jsonPadded.length;
  out.writeUInt32LE(binPadded.length, offset);
  out.writeUInt32LE(0x004e4942, offset + 4); // "BIN\0"
  offset += 8;
  binPadded.copy(out, offset);
  return out;
}

/** Generate the domain rig-contract data module from the skin. */
function generateRigData(document) {
  const joints = document.skins[0].joints;
  const parentOf = new Map();
  document.nodes.forEach((node, index) => {
    for (const child of node.children ?? []) parentOf.set(child, index);
  });
  const bones = joints.map((jointIndex) => {
    const node = document.nodes[jointIndex];
    const parentIndex = parentOf.get(jointIndex);
    const parentName =
      parentIndex !== undefined && joints.includes(parentIndex)
        ? document.nodes[parentIndex].name
        : null;
    return {
      name: node.name,
      parentName,
      restPosition: node.translation ?? [0, 0, 0],
      restRotation: node.rotation ?? [0, 0, 0, 1],
      restScale: node.scale ?? [1, 1, 1]
    };
  });
  return [
    "/**",
    " * packages/domain/src/standard-rig/rig-data.ts",
    " *",
    " * GENERATED by scripts/vendor-character-clips.mjs — DO NOT EDIT.",
    " * Derived from the same pinned source as the vendored clips",
    ` * (${SOURCE_REPO}@${SOURCE_COMMIT.slice(0, 12)}), so the contract`,
    " * and the animation library cannot drift apart.",
    " *",
    " * Status: active (generated)",
    " */",
    "",
    'import type { StandardRigBone } from "./index";',
    "",
    "export const STANDARD_RIG_BONES: readonly StandardRigBone[] = " +
      JSON.stringify(bones, null, 2) + ";",
    ""
  ].join("\n");
}

const { document, bin } = await fetchSource();

const clipsDir = resolve(REPO_ROOT, "vendor/quaternius-ual/clips");
mkdirSync(clipsDir, { recursive: true });
for (const clipName of CURATED_CLIPS) {
  const glb = extractClipGlb(document, bin, clipName);
  writeFileSync(resolve(clipsDir, `${clipName}.glb`), glb);
  console.log(`wrote ${clipName}.glb (${glb.length} bytes)`);
}

writeFileSync(
  resolve(REPO_ROOT, "packages/domain/src/standard-rig/rig-data.ts"),
  generateRigData(document)
);
console.log("wrote rig-data.ts");
