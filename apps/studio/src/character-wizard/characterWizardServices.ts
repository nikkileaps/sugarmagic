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
  RELAXED_ARM_POSE,
  composeBasePose,
  computeBoneSegments,
  evaluateCurve,
  sampleTailWag,
  detectRigLandmarks,
  generateIdleChannels,
  generateRunChannels,
  generateStandardSkeleton,
  generateWalkChannels,
  getStandardRigHipHeight,
  sampleMotion,
  type GeneratedSkeleton,
  type RigLandmarks,
  type SkinWeights
} from "@sugarmagic/character-rig";
import {
  buildClipGlb,
  buildSkinnedCharacterGlb,
  commitCharacterAnimationClips,
  commitCharacterWizardResult,
  extractMeshFromGlb,
  readBlobFile,
  readClipRecipe,
  mergeClipTracks,
  readClipDuration,
  readSkinWeightsFromGlb,
  readWizardRecipe,
  scaleClipHipsTranslation,
  type GameRootDescriptor
} from "@sugarmagic/io";
import {
  STANDARD_RIG_CORE,
  STANDARD_RIG_CORE_WITH_TAIL,
  STANDARD_RIG_TAIL_BONES,
  createDefaultMotionRecipe,
  isMotionRecipe,
  type CharacterAnimationDefinition,
  type CharacterModelDefinition,
  type MotionRecipe
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
    model: CharacterModelDefinition | null,
    animations: CharacterAnimationDefinition[]
  ) => void;
  /** Publish a just-written asset's bytes to the asset-source
   *  store. NEVER re-read a just-written file to build its blob
   *  URL: FSAccess intermittently returns null on read-after-write
   *  (2026-07-20 Mim regression — the refresh deleted + revoked
   *  live clip URLs, and the NEXT edit session then saw its slots
   *  as unbound and stomped them back to defaults). */
  publishAssetSource: (relativeAssetPath: string, blob: Blob) => void;
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

function generateClipFromRecipe(
  recipe: MotionRecipe,
  hipScale: number,
  hasTail: boolean
): { clipName: string; bytes: ArrayBuffer } {
  const generators = {
    idle: generateIdleChannels,
    walk: generateWalkChannels,
    run: generateRunChannels
  } as const;
  const composed = generators[recipe.generatorId]({
    ...recipe.personality,
    seed: recipe.seed
  });
  const motion = sampleMotion(composed, {
    basePose: composeBasePose(RELAXED_ARM_POSE, recipe.basePoseOverrides),
    channelOverrides: recipe.curveOverrides
  });
  const clipName = `Generated_${recipe.generatorId[0]!.toUpperCase()}${recipe.generatorId.slice(1)}`;
  // Tail-less characters get the 23-bone clip: tail tracks are
  // dropped by the writer when their nodes are absent.
  const clipBones = hasTail
    ? STANDARD_RIG_CORE_WITH_TAIL.bones
    : STANDARD_RIG_CORE.bones;
  const glb = buildClipGlb({
    clipName,
    duration: motion.duration,
    boneTracks: motion.boneTracks,
    hipsTranslation: motion.hipsTranslation,
    bones: clipBones.map((bone) => ({
      name: bone.name,
      parentName: bone.parentName,
      restPosition: bone.restPosition,
      restRotation: bone.restRotation
    })),
    recipe
  });
  return { clipName, bytes: scaleClipHipsTranslation(glb, hipScale) };
}

/** Bake the wag into a library-clip copy for tailed characters
 *  (Plan 064 §064.4) — tracks sampled at the HOST's duration so
 *  the wag loops with the clip. */
function overlayTailWag(
  clipBytes: ArrayBuffer,
  personality: {
    energy: number;
    bounce: number;
    curiosity: number;
    fidgetiness: number;
  },
  seed: number
): ArrayBuffer {
  const duration = readClipDuration(clipBytes);
  if (duration <= 0) return clipBytes;
  const motion = sampleTailWag({ ...personality, seed }, duration);
  return mergeClipTracks({
    hostGlb: clipBytes,
    bones: STANDARD_RIG_TAIL_BONES.map((bone) => ({
      name: bone.name,
      parentName: bone.parentName,
      restPosition: bone.restPosition,
      restRotation: bone.restRotation
    })),
    tracks: motion.boneTracks.filter((track) =>
      track.boneName.startsWith("DEF-tail.")
    )
  });
}

/** One library clip, hip-scaled (+tail wag for tailed rigs).
 *  Rotations play VERBATIM. With the rest-ALIGNED skeleton (mesh
 *  along bone axes), verbatim locals reproduce the library's
 *  world orientations at the character's own bone lengths —
 *  which IS correct retargeting. Two attempts at baking
 *  rest-delta corrections into keyframes both over/under-rotated
 *  limbs (2026-07-06: arms behind the back, then through the
 *  torso); the bind-side alignment was the whole answer. */
async function libraryClipForSlot(
  slot: "idle" | "walk" | "run",
  hipScale: number,
  tail: { personality: MotionRecipe["personality"]; seed: number } | null
): Promise<{ clipName: string; bytes: ArrayBuffer }> {
  const entry = SLOT_CLIPS.find((candidate) => candidate.slot === slot)!;
  const raw = await (await fetch(entry.url)).arrayBuffer();
  let bytes = scaleClipHipsTranslation(raw, hipScale);
  if (tail) bytes = overlayTailWag(bytes, tail.personality, tail.seed);
  return { clipName: entry.clipName, bytes };
}

async function prepareClips(
  skeleton: GeneratedSkeleton
): Promise<WizardGenerated["clips"]> {
  const hipScale = skeleton.hipHeight / getStandardRigHipHeight();
  const hasTail = skeleton.bones.some((bone) =>
    bone.name.startsWith("DEF-tail.")
  );
  // GENERATED clips are the default (nikki, 2026-07-20): the
  // library's Idle_Loop reads as a combat stance ("weird man
  // leaning forward"), and the whole point of the recipe
  // generators is a neutral-cute baseline. Library clips remain
  // one click away per slot in the Animations panel. The recipe
  // is stamped into each GLB, so reopening the panel restores
  // the sliders.
  const clips: WizardGenerated["clips"] = [];
  for (const entry of SLOT_CLIPS) {
    const recipe = createDefaultMotionRecipe(entry.slot);
    const generated = generateClipFromRecipe(recipe, hipScale, hasTail);
    clips.push({
      slot: entry.slot,
      clipName: generated.clipName,
      bytes: generated.bytes
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
        // Weights-only edit: don't rewrite clips (and below, don't
        // re-register or rebind them) — generated slots survive.
        // Marker-level edit: slots whose CURRENT clip carries a
        // motion recipe REGENERATE at the new skeleton's hip scale
        // (personality + pose survive); library-bound slots
        // re-fetch the library clip (generated.clips no longer
        // carries library copies — generated is the default).
        // Unbound slots take the generated default.
        clips: request.skipAnimations
          ? []
          : await Promise.all(
              request.generated.clips.map(async (clip) => {
                const hipScale =
                  request.generated.skeleton.hipHeight /
                  getStandardRigHipHeight();
                const hasTail = request.generated.skeleton.bones.some(
                  (bone) => bone.name.startsWith("DEF-tail.")
                );
                const boundBytes = request.boundClips?.[clip.slot];
                const recipe = boundBytes ? readClipRecipe(boundBytes) : null;
                if (recipe && isMotionRecipe(recipe)) {
                  const regenerated = generateClipFromRecipe(
                    recipe,
                    hipScale,
                    hasTail
                  );
                  return {
                    clipName: regenerated.clipName,
                    bytes: regenerated.bytes
                  };
                }
                if (boundBytes) {
                  return libraryClipForSlot(
                    clip.slot,
                    hipScale,
                    hasTail
                      ? {
                          personality:
                            createDefaultMotionRecipe(clip.slot).personality,
                          seed: 1
                        }
                      : null
                  );
                }
                return { clipName: clip.clipName, bytes: clip.bytes };
              })
            ),
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
      // Same paths, new bytes — publish the written blobs so
      // previews pick up the edited character without a reload.
      for (const written of result.writtenAssets) {
        deps.publishAssetSource(written.relativeAssetPath, written.blob);
      }
      return {
        characterModelDefinition: result.characterModelDefinition,
        characterAnimationDefinitions: request.skipAnimations
          ? []
          : request.generated.clips.map((clip, index) => ({
              slot: clip.slot,
              definition: result.characterAnimationDefinitions[index]!
            }))
      };
    },

    // ---- Plan 063: animation panel services --------------------

    async prepareAnimationPanel(riggedBytes) {
      const recipe = readWizardRecipe(riggedBytes);
      if (!recipe) {
        throw new Error("This model was not generated by the Character Wizard.");
      }
      const skeleton = generateStandardSkeleton(
        recipe.landmarks as RigLandmarks
      );
      return {
        hipScale: skeleton.hipHeight / getStandardRigHipHeight(),
        relaxedPose: RELAXED_ARM_POSE,
        hasTail: skeleton.bones.some((bone) =>
          bone.name.startsWith("DEF-tail.")
        )
      };
    },

    generateClip(recipe, hipScale, hasTail) {
      return generateClipFromRecipe(recipe, hipScale, hasTail);
    },

    async getLibraryClip(slot, hipScale, tail) {
      return libraryClipForSlot(slot, hipScale, tail ?? null);
    },

    sampleChannel(recipe, channel, count) {
      const generators = {
        idle: generateIdleChannels,
        walk: generateWalkChannels,
        run: generateRunChannels
      } as const;
      const composed = generators[recipe.generatorId]({
        ...recipe.personality,
        seed: recipe.seed
      });
      const stack =
        channel === "bounce"
          ? composed.bounce
          : (composed.channels[
              channel as keyof typeof composed.channels
            ] ?? []);
      return Array.from({ length: count }, (_, index) => {
        const x = index / count;
        let y = 0;
        for (const curve of stack) y += evaluateCurve(curve, x);
        return { x, y };
      });
    },

    readSlotRecipe(clipBytes) {
      const recipe = readClipRecipe(clipBytes);
      return isMotionRecipe(recipe) ? recipe : null;
    },

    async commitAnimationSlots(request) {
      const context = deps.getProjectContext();
      if (!context) throw new Error("No open project.");
      const definitions = await commitCharacterAnimationClips({
        projectHandle: context.projectHandle,
        descriptor: context.descriptor,
        projectId: context.projectId,
        characterName: request.characterName,
        clips: request.clips.map((clip) => ({
          clipName: clip.clipName,
          bytes: clip.bytes
        }))
      });
      deps.registerDefinitions(null, definitions);
      definitions.forEach((definition, index) => {
        deps.publishAssetSource(
          definition.source.relativeAssetPath,
          new Blob([request.clips[index]!.bytes], {
            type: "model/gltf-binary"
          })
        );
      });
      return request.clips.map((clip, index) => ({
        slot: clip.slot,
        definition: definitions[index]!
      }));
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
      for (const written of result.writtenAssets) {
        deps.publishAssetSource(written.relativeAssetPath, written.blob);
      }
      return {
        characterModelDefinition: result.characterModelDefinition,
        characterAnimationDefinitions: bySlot
      };
    }
  };
}
