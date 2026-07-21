/**
 * packages/io/src/character-wizard/index.ts
 *
 * Purpose: Plan 062 §062.4 — the Character Wizard's COMMIT step,
 * following the import-family shape (write asset files, return
 * definitions; the authoring session commits them through the
 * normal command path — nothing here touches session state).
 *
 * Writes:
 *   - assets/character-models/<name>.glb — the skinned model
 *     (built by `buildSkinnedCharacterGlb`).
 *   - assets/character-animations/<name>-<Clip>.glb — one copy
 *     per selected clip, hips-translation scaled to the
 *     character's proportions (`scaleClipHipsTranslation`).
 *   - assets/character-animations/QUATERNIUS-ATTRIBUTION.md —
 *     the CC0 provenance note (vendor/quaternius-ual/), copied
 *     so the game project stays self-contained.
 *
 * Status: active
 */

import {
  STANDARD_RIG_ID,
  STANDARD_RIG_SCHEMA_VERSION,
  createDefaultCharacterAnimationDefinition,
  createDefaultCharacterModelDefinition,
  type CharacterAnimationDefinition,
  type CharacterModelDefinition
} from "@sugarmagic/domain";
import { writeBlobFile } from "../fs-access";
import type { GameRootDescriptor } from "../game-root";
import { packGlb, readGlb } from "../glb";

export interface WizardClipInput {
  /** Clip name as authored in the library (e.g. "Idle_Loop"). */
  clipName: string;
  /** The vendored clip GLB bytes (Studio loads the bundled file). */
  bytes: ArrayBuffer;
}

export interface CommitCharacterWizardRequest {
  projectHandle: FileSystemDirectoryHandle;
  descriptor: GameRootDescriptor;
  projectId: string;
  /** Display name for the character; also seeds file names. */
  characterName: string;
  /** The skinned model GLB (buildSkinnedCharacterGlb output). */
  modelGlb: ArrayBuffer;
  /** Plan 062 §062.9 — the UNTOUCHED source GLB, kept alongside
   *  the rigged output so Edit can rebuild from pristine mesh. */
  sourceGlb: ArrayBuffer;
  /** The confirmed landmarks — stamped into the rigged GLB's
   *  extras as the reopenable recipe. */
  landmarks: Record<string, [number, number, number]>;
  /** Clips to copy, already hips-scaled by the caller. */
  clips: WizardClipInput[];
  /** Attribution markdown to place beside the clips. */
  attributionText: string;
}

/** Stamp the wizard recipe into a rigged GLB's asset.extras.
 *  Exported for headless tooling that rebuilds rigged GLBs
 *  outside the Studio wizard (must produce the same artifact). */
export function stampWizardRecipe(
  modelGlb: ArrayBuffer,
  landmarks: Record<string, [number, number, number]>,
  sourceAssetPath: string
): ArrayBuffer {
  const chunks = readGlb(modelGlb);
  if (!chunks?.binaryChunk) return modelGlb;
  chunks.document.asset = {
    ...(chunks.document.asset ?? { version: "2.0" }),
    extras: {
      ...((chunks.document.asset?.extras as Record<string, unknown>) ?? {}),
      sugarmagicRig: {
        rigId: STANDARD_RIG_ID,
        rigSchemaVersion: STANDARD_RIG_SCHEMA_VERSION,
        landmarks,
        sourceAssetPath
      }
    }
  };
  return packGlb(chunks.document, chunks.binaryChunk);
}

export interface CommitCharacterWizardResult {
  characterModelDefinition: CharacterModelDefinition;
  characterAnimationDefinitions: CharacterAnimationDefinition[];
  /** The EXACT blobs written, keyed by project-relative path.
   *  Callers publish these to the asset-source store instead of
   *  re-reading the files — FSAccess intermittently returns null
   *  on read-after-write (2026-07-20 Mim clip-binding loss). */
  writtenAssets: Array<{ relativeAssetPath: string; blob: Blob }>;
}

function sanitizeSegment(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned.length > 0 ? cleaned : "character";
}

export async function commitCharacterWizardResult(
  request: CommitCharacterWizardRequest
): Promise<CommitCharacterWizardResult> {
  const safeName = sanitizeSegment(request.characterName);
  const assetsPath = request.descriptor.authoredAssetsPath;

  const modelFileName = `${safeName}-rigged.glb`;
  const sourceFileName = `${safeName}-source.glb`;
  const sourceAssetPath = `${assetsPath}/character-models/${sourceFileName}`;
  const stamped = stampWizardRecipe(
    request.modelGlb,
    request.landmarks,
    sourceAssetPath
  );
  const modelBlob = new Blob([stamped], { type: "model/gltf-binary" });
  const sourceBlob = new Blob([request.sourceGlb], {
    type: "model/gltf-binary"
  });
  await writeBlobFile(
    request.projectHandle,
    [assetsPath, "character-models", modelFileName],
    modelBlob
  );
  await writeBlobFile(
    request.projectHandle,
    [assetsPath, "character-models", sourceFileName],
    sourceBlob
  );
  const characterModelDefinition = createDefaultCharacterModelDefinition(
    request.projectId,
    {
      definitionId: `${request.projectId}:character-model:${safeName}-rigged`,
      displayName: `${request.characterName} (rigged)`,
      source: {
        relativeAssetPath: `${assetsPath}/character-models/${modelFileName}`,
        fileName: modelFileName,
        mimeType: "model/gltf-binary"
      },
      rigId: STANDARD_RIG_ID
    }
  );

  const characterAnimationDefinitions = await commitCharacterAnimationClips({
    projectHandle: request.projectHandle,
    descriptor: request.descriptor,
    projectId: request.projectId,
    characterName: request.characterName,
    clips: request.clips
  });

  await writeBlobFile(
    request.projectHandle,
    [assetsPath, "character-animations", "QUATERNIUS-ATTRIBUTION.md"],
    new Blob([request.attributionText], { type: "text/markdown" })
  );

  return {
    characterModelDefinition,
    characterAnimationDefinitions,
    writtenAssets: [
      {
        relativeAssetPath: characterModelDefinition.source.relativeAssetPath,
        blob: modelBlob
      },
      { relativeAssetPath: sourceAssetPath, blob: sourceBlob },
      ...characterAnimationDefinitions.map((definition, index) => ({
        relativeAssetPath: definition.source.relativeAssetPath,
        blob: new Blob([request.clips[index]!.bytes], {
          type: "model/gltf-binary"
        })
      }))
    ]
  };
}

export interface CommitCharacterAnimationClipsRequest {
  projectHandle: FileSystemDirectoryHandle;
  descriptor: GameRootDescriptor;
  projectId: string;
  characterName: string;
  clips: WizardClipInput[];
}

/**
 * Write animation clip GLBs for a character and return their
 * definitions. Deterministic ids (name + clip name) so re-saving
 * the same clip UPSERTS instead of orphaning — the Plan 063
 * animation panel re-commits slots through this path.
 */
export async function commitCharacterAnimationClips(
  request: CommitCharacterAnimationClipsRequest
): Promise<CharacterAnimationDefinition[]> {
  const safeName = sanitizeSegment(request.characterName);
  const assetsPath = request.descriptor.authoredAssetsPath;
  const definitions: CharacterAnimationDefinition[] = [];
  for (const clip of request.clips) {
    const clipFileName = `${safeName}-${sanitizeSegment(clip.clipName)}.glb`;
    await writeBlobFile(
      request.projectHandle,
      [assetsPath, "character-animations", clipFileName],
      new Blob([clip.bytes], { type: "model/gltf-binary" })
    );
    definitions.push(
      createDefaultCharacterAnimationDefinition(request.projectId, {
        definitionId: `${request.projectId}:character-animation:${safeName}-${sanitizeSegment(clip.clipName)}`,
        displayName: `${request.characterName} ${clip.clipName}`,
        source: {
          relativeAssetPath: `${assetsPath}/character-animations/${clipFileName}`,
          fileName: clipFileName,
          mimeType: "model/gltf-binary"
        },
        clipNames: [clip.clipName]
      })
    );
  }
  return definitions;
}
