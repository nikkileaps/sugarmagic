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
  createDefaultCharacterAnimationDefinition,
  createDefaultCharacterModelDefinition,
  type CharacterAnimationDefinition,
  type CharacterModelDefinition
} from "@sugarmagic/domain";
import { writeBlobFile } from "../fs-access";
import type { GameRootDescriptor } from "../game-root";

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
  /** Clips to copy, already hips-scaled by the caller. */
  clips: WizardClipInput[];
  /** Attribution markdown to place beside the clips. */
  attributionText: string;
}

export interface CommitCharacterWizardResult {
  characterModelDefinition: CharacterModelDefinition;
  characterAnimationDefinitions: CharacterAnimationDefinition[];
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
  await writeBlobFile(
    request.projectHandle,
    [assetsPath, "character-models", modelFileName],
    new Blob([request.modelGlb], { type: "model/gltf-binary" })
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
      }
    }
  );

  const characterAnimationDefinitions: CharacterAnimationDefinition[] = [];
  for (const clip of request.clips) {
    const clipFileName = `${safeName}-${sanitizeSegment(clip.clipName)}.glb`;
    await writeBlobFile(
      request.projectHandle,
      [assetsPath, "character-animations", clipFileName],
      new Blob([clip.bytes], { type: "model/gltf-binary" })
    );
    characterAnimationDefinitions.push(
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

  await writeBlobFile(
    request.projectHandle,
    [assetsPath, "character-animations", "QUATERNIUS-ATTRIBUTION.md"],
    new Blob([request.attributionText], { type: "text/markdown" })
  );

  return { characterModelDefinition, characterAnimationDefinitions };
}
