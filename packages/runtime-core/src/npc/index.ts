import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinnedObject } from "three/examples/jsm/utils/SkeletonUtils.js";
import type {
  AssetDefinition,
  CharacterAnimationDefinition,
  CharacterModelDefinition,
  ContentLibrarySnapshot,
  NPCAnimationSlot,
  NPCDefinition
} from "@sugarmagic/domain";
import {
  getCharacterAnimationDefinition,
  getCharacterModelDefinition
} from "@sugarmagic/domain";

const gltfLoader = new GLTFLoader();
const DEFAULT_CAPSULE_COLOR = 0xa6e3a1;

function getAssetSourceUrl(
  definition: Pick<
    AssetDefinition | CharacterAnimationDefinition | CharacterModelDefinition,
    "source"
  > | null,
  assetSources: Record<string, string>
): string | null {
  if (!definition) return null;
  return assetSources[definition.source.relativeAssetPath] ?? null;
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    if (Array.isArray(child.material)) {
      for (const material of child.material) {
        material.dispose();
      }
    } else {
      child.material.dispose();
    }
  });
}

function createCapsuleRoot(definition: NPCDefinition): THREE.Group {
  const root = new THREE.Group();
  const height = Math.max(definition.presentation.modelHeight, 0.5);
  const radius = Math.max(0.25, Math.min(0.45, height * 0.22));

  const capsule = new THREE.Mesh(
    new THREE.CapsuleGeometry(radius, Math.max(0.05, height - radius * 2), 8, 16),
    new THREE.MeshStandardMaterial({
      color: DEFAULT_CAPSULE_COLOR,
      roughness: 0.38,
      metalness: 0.04
    })
  );
  capsule.position.y = height / 2;
  root.add(capsule);
  return root;
}

function normalizeModelScale(root: THREE.Object3D, targetHeight: number) {
  // Same shape as Sugarengine's CharacterLoader.normalizeModel.
  // Requires the upstream loader to use plain Object3D.clone (not
  // SkeletonUtils.clone) — otherwise SkinnedMesh.computeBoundingBox
  // produces a garbage bbox driven by a corrupted bind matrix.
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.y <= 0) return;

  root.scale.multiplyScalar(targetHeight / size.y);
  box.setFromObject(root);
  root.position.y -= box.min.y;
}

export interface NPCPreviewWarning {
  code:
    | "missing-model"
    | "model-load-failed"
    | "animation-load-failed"
    | "missing-animation";
  message: string;
}

export interface NPCPreviewApplyResult {
  warnings: NPCPreviewWarning[];
  availableSlots: NPCAnimationSlot[];
}

export interface NPCPreviewController {
  readonly root: THREE.Group;
  readonly stageTargetHeight: number;
  apply: (input: {
    npcDefinition: NPCDefinition;
    contentLibrary: ContentLibrarySnapshot;
    assetSources: Record<string, string>;
    activeAnimationSlot: NPCAnimationSlot | null;
    isPlaying: boolean;
  }) => Promise<NPCPreviewApplyResult>;
  update: (deltaSeconds: number) => void;
  dispose: () => void;
}

export function createNPCPreviewController(
  scene: THREE.Scene
): NPCPreviewController {
  const root = new THREE.Group();
  root.name = "runtime-npc-preview-root";
  scene.add(root);

  let currentRoot: THREE.Group | null = null;
  let currentMixer: THREE.AnimationMixer | null = null;
  let currentApplyVersion = 0;
  let stageTargetHeight = 1.7;

  function clearCurrent() {
    if (currentRoot) {
      root.remove(currentRoot);
      disposeObject(currentRoot);
      currentRoot = null;
    }
    currentMixer?.stopAllAction();
    currentMixer = null;
  }

  async function loadAnimationClip(
    definition: CharacterAnimationDefinition,
    assetSources: Record<string, string>
  ): Promise<THREE.AnimationClip | null> {
    const sourceUrl = getAssetSourceUrl(definition, assetSources);
    if (!sourceUrl) return null;

    const gltf = await gltfLoader.loadAsync(sourceUrl);
    return gltf.animations[0] ?? null;
  }

  return {
    root,
    get stageTargetHeight() {
      return stageTargetHeight;
    },
    async apply(input) {
      const {
        npcDefinition,
        contentLibrary,
        assetSources,
        activeAnimationSlot,
        isPlaying
      } = input;
      const version = ++currentApplyVersion;
      const warnings: NPCPreviewWarning[] = [];
      stageTargetHeight = npcDefinition.presentation.modelHeight;

      clearCurrent();

      const modelDefinitionId =
        npcDefinition.presentation.modelAssetDefinitionId;
      const modelDefinition = modelDefinitionId
        ? getCharacterModelDefinition(contentLibrary, modelDefinitionId)
        : null;
      const modelSourceUrl = getAssetSourceUrl(modelDefinition, assetSources);
      const availableSlots = (Object.entries(
        npcDefinition.presentation.animationAssetBindings
      ) as Array<[NPCAnimationSlot, string | null]>)
        .filter(([, definitionId]) => Boolean(definitionId))
        .map(([slot]) => slot);

      if (!modelDefinition || !modelSourceUrl) {
        if (npcDefinition.presentation.modelAssetDefinitionId) {
          warnings.push({
            code: "missing-model",
            message:
              "The bound NPC model could not be resolved as a character model. Re-import the model via the NPC inspector."
          });
        }
        const capsuleRoot = createCapsuleRoot(npcDefinition);
        if (version !== currentApplyVersion) {
          disposeObject(capsuleRoot);
          return { warnings, availableSlots };
        }
        currentRoot = capsuleRoot;
        root.add(capsuleRoot);
        return { warnings, availableSlots };
      }

      try {
        const gltf = await gltfLoader.loadAsync(modelSourceUrl);
        const modelRoot = new THREE.Group();
        // SkeletonUtils.clone (NOT plain Object3D.clone): plain clone
        // shares the skeleton reference with the source gltf, so moving
        // the cloned wrapper doesn't translate the rendered mesh — the
        // skinning shader anchors to the source bones which never move.
        const clonedScene = cloneSkinnedObject(gltf.scene) as THREE.Object3D;
        // Populate matrixWorld for every node BEFORE measuring the bbox.
        // SkinnedMesh.computeBoundingBox uses bone matrixWorlds; without
        // this update they're identity and the bbox is garbage.
        clonedScene.updateMatrixWorld(true);
        normalizeModelScale(clonedScene, npcDefinition.presentation.modelHeight);
        // Disable frustum culling on skinned meshes — bind-pose bounding
        // sphere goes stale after rescaling + animation, can pop the model
        // out of view at certain camera angles. Matches Sugarengine.
        clonedScene.traverse((child) => {
          if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
            child.frustumCulled = false;
          }
        });
        modelRoot.add(clonedScene);

        const animationClips = new Map<NPCAnimationSlot, THREE.AnimationClip>();
        for (const [slot, definitionId] of Object.entries(
          npcDefinition.presentation.animationAssetBindings
        ) as Array<[NPCAnimationSlot, string | null]>) {
          if (!definitionId) continue;
          const definition = getCharacterAnimationDefinition(
            contentLibrary,
            definitionId
          );
          if (!definition) {
            warnings.push({
              code: "missing-animation",
              message: `The ${slot} animation binding could not be resolved as a character animation. Re-import the clip via the NPC inspector.`
            });
            continue;
          }

          try {
            const clip = await loadAnimationClip(definition, assetSources);
            if (clip) {
              animationClips.set(slot, clip);
            } else {
              warnings.push({
                code: "missing-animation",
                message: `The ${slot} animation library entry does not contain any clips.`
              });
            }
          } catch {
            warnings.push({
              code: "animation-load-failed",
              message: `The ${slot} animation failed to load.`
            });
          }
        }

        if (version !== currentApplyVersion) {
          disposeObject(modelRoot);
          return { warnings, availableSlots };
        }

        currentRoot = modelRoot;
        root.add(modelRoot);

        if (activeAnimationSlot && animationClips.has(activeAnimationSlot)) {
          currentMixer = new THREE.AnimationMixer(clonedScene);
          const action = currentMixer.clipAction(
            animationClips.get(activeAnimationSlot)!
          );
          action.reset();
          action.play();
          currentMixer.timeScale = isPlaying ? 1 : 0;
        } else {
          currentMixer = null;
        }

        return { warnings, availableSlots };
      } catch {
        warnings.push({
          code: "model-load-failed",
          message: "The bound NPC model failed to load; showing capsule preview instead."
        });

        const capsuleRoot = createCapsuleRoot(npcDefinition);
        if (version !== currentApplyVersion) {
          disposeObject(capsuleRoot);
          return { warnings, availableSlots };
        }
        currentRoot = capsuleRoot;
        root.add(capsuleRoot);
        return { warnings, availableSlots };
      }
    },
    update(deltaSeconds) {
      currentMixer?.update(deltaSeconds);
    },
    dispose() {
      currentApplyVersion += 1;
      clearCurrent();
      scene.remove(root);
    }
  };
}
