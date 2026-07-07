/**
 * apps/studio/src/character-wizard/characterWizardServices.ts
 *
 * Plan 062 §062.6 — the Studio-side implementation of
 * `CharacterWizardServices`: everything the wizard UI must not
 * own itself (io, the solver worker, the vendored clip assets,
 * session registration). The workspaces package sees only the
 * interface.
 *
 * Vendored clips are bundled Vite assets straight out of
 * vendor/quaternius-ual/ — the same files the standard-rig
 * contract was generated from, fetched on demand and copied into
 * the game project at commit (hips-scaled per character).
 */

import {
  computeBoneSegments,
  detectRigLandmarks,
  generateStandardSkeleton,
  getStandardRigHipHeight,
  type GeneratedSkeleton,
  type RigLandmarks,
  type SkinWeights
} from "@sugarmagic/character-rig";
import {
  buildSkinnedCharacterGlb,
  commitCharacterWizardResult,
  extractMeshFromGlb,
  readBlobFile,
  readSkinWeightsFromGlb,
  readWizardRecipe,
  scaleClipHipsTranslation,
  type GameRootDescriptor
} from "@sugarmagic/io";
import type {
  CharacterAnimationDefinition,
  CharacterModelDefinition
} from "@sugarmagic/domain";
import type {
  CharacterWizardServices,
  WizardGenerated,
  WizardLandmarks
} from "@sugarmagic/workspaces";
import type { WeightSolveResponse } from "./weight-solver.worker";
// Idle_Loop stays the idle slot: Idle_Talking_Loop's gestures read
// as twitchy on chibi characters ("she has fleas" - nikki,
// 2026-07-07). The library has no neutral-cute standing idle;
// de-combat-ifying Idle_Loop (calm/stance/posture sliders) is
// plan 063's job. Talking idle stays vendored for future NPC
// dialogue states.
import idleClipUrl from "../../../../vendor/quaternius-ual/clips/Idle_Loop.glb?url";
import walkClipUrl from "../../../../vendor/quaternius-ual/clips/Walk_Loop.glb?url";
import runClipUrl from "../../../../vendor/quaternius-ual/clips/Jog_Fwd_Loop.glb?url";
import attributionText from "../../../../vendor/quaternius-ual/ATTRIBUTION.md?raw";

const SLOT_CLIPS: Array<{
  slot: "idle" | "walk" | "run";
  clipName: string;
  url: string;
}> = [
  { slot: "idle", clipName: "Idle_Loop", url: idleClipUrl },
  { slot: "walk", clipName: "Walk_Loop", url: walkClipUrl },
  { slot: "run", clipName: "Jog_Fwd_Loop", url: runClipUrl }
];

export interface CharacterWizardServiceDeps {
  getProjectContext: () => {
    projectHandle: FileSystemDirectoryHandle;
    descriptor: GameRootDescriptor;
    projectId: string;
  } | null;
  /** Register the committed definitions on the authoring session. */
  registerDefinitions: (
    model: CharacterModelDefinition,
    animations: CharacterAnimationDefinition[]
  ) => void;
  /** Refresh blob URLs after edit-in-place overwrote asset files. */
  refreshAssetPaths: (relativeAssetPaths: string[]) => Promise<void>;
}

function solveWeightsInWorker(
  positions: Float32Array,
  indices: Uint32Array,
  segments: ReturnType<typeof computeBoneSegments>,
  onProgress: (fraction: number) => void
): Promise<SkinWeights> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./weight-solver.worker.ts", import.meta.url),
      { type: "module" }
    );
    worker.onmessage = (event: MessageEvent<WeightSolveResponse>) => {
      const message = event.data;
      if (message.type === "progress") {
        onProgress(message.fraction);
        return;
      }
      worker.terminate();
      if (message.type === "done") {
        resolve({
          boneOrder: message.boneOrder,
          joints: message.joints,
          weights: message.weights
        });
      } else {
        reject(new Error(message.message));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "weight solver worker failed"));
    };
    // Copy (not transfer) the mesh buffers: the caller reuses them.
    worker.postMessage({ positions, indices, segments });
  });
}

async function prepareClips(
  skeleton: GeneratedSkeleton
): Promise<WizardGenerated["clips"]> {
  const hipScale = skeleton.hipHeight / getStandardRigHipHeight();
  // Rotations play VERBATIM. With the rest-ALIGNED skeleton (mesh
  // along bone axes), verbatim locals reproduce the library's
  // world orientations at the character's own bone lengths —
  // which IS correct retargeting. Two attempts at baking
  // rest-delta corrections into keyframes both over/under-rotated
  // limbs (2026-07-06: arms behind the back, then through the
  // torso); the bind-side alignment was the whole answer.
  const clips: WizardGenerated["clips"] = [];
  for (const entry of SLOT_CLIPS) {
    const clipBytes = await (await fetch(entry.url)).arrayBuffer();
    clips.push({
      slot: entry.slot,
      clipName: entry.clipName,
      bytes: scaleClipHipsTranslation(clipBytes, hipScale)
    });
  }
  return clips;
}

function meshHeight(positions: Float32Array): number {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 1; i < positions.length; i += 3) {
    const y = positions[i]!;
    if (y < min) min = y;
    if (y > max) max = y;
  }
  return Math.max(0.1, max - min);
}

export function createCharacterWizardServices(
  deps: CharacterWizardServiceDeps
): CharacterWizardServices {
  return {
    async analyzeModel(bytes: ArrayBuffer) {
      const extracted = extractMeshFromGlb(bytes);
      const landmarks = detectRigLandmarks({
        positions: extracted.positions,
        indices: extracted.indices
      });
      return { landmarks: landmarks as WizardLandmarks };
    },

    async generate(
      bytes: ArrayBuffer,
      landmarks: WizardLandmarks,
      onProgress: (fraction: number) => void
    ): Promise<WizardGenerated> {
      const extracted = extractMeshFromGlb(bytes);
      const skeleton: GeneratedSkeleton = generateStandardSkeleton(
        landmarks as RigLandmarks
      );
      let meshTopY = -Infinity;
      for (let i = 1; i < extracted.positions.length; i += 3) {
        if (extracted.positions[i]! > meshTopY) meshTopY = extracted.positions[i]!;
      }
      const segments = computeBoneSegments(skeleton, { meshTopY });
      const weights = await solveWeightsInWorker(
        extracted.positions,
        extracted.indices,
        segments,
        (fraction) => onProgress(fraction * 0.85)
      );
      const modelGlb = buildSkinnedCharacterGlb({
        sourceGlb: bytes,
        skeleton,
        weights,
        ranges: extracted.ranges
      });
      onProgress(0.9);
      const clips = await prepareClips(skeleton);
      onProgress(1);
      return {
        modelGlb,
        clips,
        characterHeight: meshHeight(extracted.positions),
        // §062.8 — solver artifacts for the weight-paint step.
        skeleton,
        weights,
        ranges: extracted.ranges,
        mesh: { positions: extracted.positions, indices: extracted.indices }
      };
    },

    async reassemble(sourceBytes, generated) {
      return buildSkinnedCharacterGlb({
        sourceGlb: sourceBytes,
        skeleton: generated.skeleton,
        weights: generated.weights,
        ranges: generated.ranges
      });
    },

    async prepareEdit(riggedBytes) {
      const recipe = readWizardRecipe(riggedBytes);
      if (!recipe) {
        throw new Error("This model was not generated by the Character Wizard.");
      }
      // The source GLB is a loose project file (no definition
      // references it), so it is NOT in the asset-source map —
      // read it straight from the project folder.
      const context = deps.getProjectContext();
      if (!context) throw new Error("No open project.");
      const sourceBlob = await readBlobFile(
        context.projectHandle,
        ...recipe.sourceAssetPath.split("/").filter(Boolean)
      );
      if (!sourceBlob) {
        throw new Error(
          `The character's source file is missing: ${recipe.sourceAssetPath}`
        );
      }
      const sourceBytes = await sourceBlob.arrayBuffer();
      const extracted = extractMeshFromGlb(sourceBytes);
      const skeleton = generateStandardSkeleton(
        recipe.landmarks as RigLandmarks
      );
      const segments = computeBoneSegments(skeleton);
      const boneOrder = segments.map((segment) => segment.boneName);
      // Decode painted weights: GLB joint SLOTS -> solver columns.
      const decoded = readSkinWeightsFromGlb(riggedBytes);
      if (!decoded) {
        throw new Error("The rigged model carries no skin weights.");
      }
      const slotToColumn = new Map<number, number>();
      skeleton.bones.forEach((bone, slot) => {
        const column = boneOrder.indexOf(bone.name);
        if (column !== -1) slotToColumn.set(slot, column);
      });
      const joints = new Uint16Array(decoded.joints.length);
      for (let i = 0; i < decoded.joints.length; i += 1) {
        joints[i] = slotToColumn.get(decoded.joints[i]!) ?? 0;
      }
      const clips = await prepareClips(skeleton);
      return {
        sourceBytes,
        landmarks: recipe.landmarks as WizardLandmarks,
        generated: {
          modelGlb: riggedBytes,
          clips,
          characterHeight: meshHeight(extracted.positions),
          skeleton,
          weights: { boneOrder, joints, weights: decoded.weights },
          ranges: extracted.ranges,
          mesh: {
            positions: extracted.positions,
            indices: extracted.indices
          }
        }
      };
    },

    async commitEdit(request) {
      const context = deps.getProjectContext();
      if (!context) {
        throw new Error("No open project to save the character into.");
      }
      const result = await commitCharacterWizardResult({
        projectHandle: context.projectHandle,
        descriptor: context.descriptor,
        projectId: context.projectId,
        characterName: request.characterName,
        modelGlb: request.generated.modelGlb,
        sourceGlb: request.sourceBytes,
        landmarks: request.landmarks,
        clips: request.generated.clips.map((clip) => ({
          clipName: clip.clipName,
          bytes: clip.bytes
        })),
        attributionText
      });
      // Registration UPSERTS by definitionId: unchanged clip names
      // replace in place; a renamed clip (idle style swap) gets a
      // fresh definition the caller rebinds via onCommitted. The
      // OLD clip's definition + file are left behind (harmless
      // orphans) — revisit when content-library cleanup tooling
      // exists.
      deps.registerDefinitions(
        result.characterModelDefinition,
        result.characterAnimationDefinitions
      );
      // Same paths, new bytes — refresh the blob URLs so previews
      // pick up the edited character without a reload.
      const safe = request.characterName
        .trim()
        .replace(/[^a-zA-Z0-9-_]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
      const assets = context.descriptor.authoredAssetsPath;
      await deps.refreshAssetPaths([
        `${assets}/character-models/${safe}-rigged.glb`,
        `${assets}/character-models/${safe}-source.glb`,
        ...request.generated.clips.map(
          (clip) =>
            `${assets}/character-animations/${safe}-${clip.clipName.replace(/[^a-zA-Z0-9-_]+/g, "-")}.glb`
        )
      ]);
      return {
        characterModelDefinition: result.characterModelDefinition,
        characterAnimationDefinitions: request.generated.clips.map(
          (clip, index) => ({
            slot: clip.slot,
            definition: result.characterAnimationDefinitions[index]!
          })
        )
      };
    },

    async commit(request) {
      const context = deps.getProjectContext();
      if (!context) {
        throw new Error("No open project to commit the character into.");
      }
      const result = await commitCharacterWizardResult({
        projectHandle: context.projectHandle,
        descriptor: context.descriptor,
        projectId: context.projectId,
        characterName: request.characterName,
        modelGlb: request.generated.modelGlb,
        sourceGlb: request.sourceBytes,
        landmarks: request.landmarks,
        clips: request.generated.clips.map((clip) => ({
          clipName: clip.clipName,
          bytes: clip.bytes
        })),
        attributionText
      });
      // Slot mapping: commit preserved clip order == SLOT_CLIPS order.
      const bySlot = request.generated.clips.map((clip, index) => ({
        slot: clip.slot,
        definition: result.characterAnimationDefinitions[index]!
      }));
      deps.registerDefinitions(
        result.characterModelDefinition,
        result.characterAnimationDefinitions
      );
      return {
        characterModelDefinition: result.characterModelDefinition,
        characterAnimationDefinitions: bySlot
      };
    }
  };
}
