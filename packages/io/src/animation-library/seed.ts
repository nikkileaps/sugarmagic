/**
 * packages/io/src/animation-library/seed.ts
 *
 * Purpose: AnimLib 2 -- seed the project's animation library with
 * the three "Cozy" generated master clips (Idle / Walk / Run).
 *
 * These are contract-scale generated clips (hipScale = 1.0, tail
 * tracks included). Each clip GLB has the MotionRecipe stamped in
 * its asset.extras so the Animation panel can reopen + re-tune it.
 *
 * Auto-seeded on project open/create if the well-known IDs are
 * absent; caller passes the in-memory blobs to publishAssetSource
 * to avoid FSAccess read-after-write flakes (same pattern as the
 * character wizard commit).
 *
 * Status: active
 */

import {
  STANDARD_RIG_CORE_WITH_TAIL,
  createDefaultAnimationLibraryDefinition,
  createDefaultMotionRecipe,
  type AnimationLibraryDefinition,
  type MotionGeneratorId
} from "@sugarmagic/domain";
import {
  RELAXED_ARM_POSE,
  composeBasePose,
  generateIdleChannels,
  generateRunChannels,
  generateWalkChannels,
  getStandardRigHipHeight,
  sampleMotion,
  sampleTailWag
} from "@sugarmagic/character-rig";
import { buildClipGlb, mergeClipTracks, readClipDuration, scaleClipHipsTranslation } from "../glb";
import { writeBlobFile } from "../fs-access";
import type { GameRootDescriptor } from "../game-root";

/**
 * Path where the Quaternius UAL base character maquette should live
 * (used as the animation preview character in the library browser).
 *
 * DEFERRED: Quaternius UAL base character GLB needs to be vendored
 * before this path is usable. Revisit when AnimLib 3 (library view)
 * is wired: the library view adds a "Download maquette" action that
 * writes this file and documents the Blender authoring workflow.
 * See: packages/workspaces/src/build/animations/AnimationLibraryBrowser.tsx
 */
export const ANIMATION_LIBRARY_MAQUETTE_PATH = "vendor/maquette/quaternius-ual-character.glb";

export interface SeedAnimationLibraryRequest {
  projectHandle: FileSystemDirectoryHandle;
  descriptor: GameRootDescriptor;
  projectId: string;
}

export interface SeedAnimationLibraryResult {
  definitions: AnimationLibraryDefinition[];
  writtenAssets: Array<{ relativeAssetPath: string; blob: Blob }>;
}

const COZY_GENERATORS: Array<{
  id: MotionGeneratorId;
  displayName: string;
  slug: string;
}> = [
  { id: "idle", displayName: "Cozy Idle", slug: "cozy-idle" },
  { id: "walk", displayName: "Cozy Walk", slug: "cozy-walk" },
  { id: "run", displayName: "Cozy Run", slug: "cozy-run" }
];

/** Well-known definition ID for a Cozy seed clip -- stable across projects. */
export function cozySeedDefinitionId(
  projectId: string,
  slug: string
): string {
  return `${projectId}:animation-library:${slug}`;
}

const GENERATORS = {
  idle: generateIdleChannels,
  walk: generateWalkChannels,
  run: generateRunChannels
} as const;

function buildCozyClip(id: MotionGeneratorId): ArrayBuffer {
  const recipe = createDefaultMotionRecipe(id);
  const composed = GENERATORS[id]({
    ...recipe.personality,
    seed: recipe.seed
  });
  const motion = sampleMotion(composed, {
    basePose: composeBasePose(RELAXED_ARM_POSE, recipe.basePoseOverrides),
    channelOverrides: recipe.curveOverrides
  });
  // Seed clips are contract scale (hipScale = 1.0). They include
  // tail bones so tailed characters can play them directly.
  const hipScale = 1.0 / getStandardRigHipHeight();
  const bones = STANDARD_RIG_CORE_WITH_TAIL.bones.map((bone) => ({
    name: bone.name,
    parentName: bone.parentName,
    restPosition: bone.restPosition,
    restRotation: bone.restRotation
  }));
  const clipName = `Generated_${id[0]!.toUpperCase()}${id.slice(1)}`;
  let glb = buildClipGlb({
    clipName,
    duration: motion.duration,
    boneTracks: motion.boneTracks,
    hipsTranslation: motion.hipsTranslation,
    bones,
    recipe
  });
  glb = scaleClipHipsTranslation(glb, hipScale);
  // Overlay a default tail wag so the preview maquette's tail moves.
  const duration = readClipDuration(glb);
  if (duration > 0) {
    const tailMotion = sampleTailWag(
      { ...recipe.personality, seed: recipe.seed },
      duration
    );
    const tailBones = bones.filter((b) => b.name.startsWith("DEF-tail."));
    glb = mergeClipTracks({
      hostGlb: glb,
      bones: tailBones,
      tracks: tailMotion.boneTracks.filter((t) =>
        t.boneName.startsWith("DEF-tail.")
      )
    });
  }
  return glb;
}

/**
 * Generate and write the three Cozy library clips to
 * assets/animations/. Skips any clip whose well-known ID is
 * already present in `existingIds` (safe to call on every project
 * open without clobbering user edits).
 */
export async function seedCozyAnimations(
  request: SeedAnimationLibraryRequest,
  existingIds: Set<string>
): Promise<SeedAnimationLibraryResult> {
  const definitions: AnimationLibraryDefinition[] = [];
  const writtenAssets: Array<{ relativeAssetPath: string; blob: Blob }> = [];
  const assetsDir = request.descriptor.authoredAssetsPath;

  for (const { id, displayName, slug } of COZY_GENERATORS) {
    const definitionId = cozySeedDefinitionId(request.projectId, slug);
    if (existingIds.has(definitionId)) continue;

    const glb = buildCozyClip(id);
    const fileName = `${slug}.glb`;
    const relativeAssetPath = `${assetsDir}/animations/${fileName}`;
    const blob = new Blob([glb], { type: "model/gltf-binary" });
    await writeBlobFile(
      request.projectHandle,
      [assetsDir, "animations", fileName],
      blob
    );
    writtenAssets.push({ relativeAssetPath, blob });

    const clipName = `Generated_${id[0]!.toUpperCase()}${id.slice(1)}`;
    definitions.push(
      createDefaultAnimationLibraryDefinition(request.projectId, {
        definitionId,
        displayName,
        origin: "generated",
        source: {
          relativeAssetPath,
          fileName,
          mimeType: "model/gltf-binary"
        },
        clipNames: [clipName]
      })
    );
  }

  return { definitions, writtenAssets };
}
