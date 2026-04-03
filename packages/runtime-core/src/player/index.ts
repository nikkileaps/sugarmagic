import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinnedObject } from "three/examples/jsm/utils/SkeletonUtils.js";
import type {
  AssetDefinition,
  ContentLibrarySnapshot,
  PlayerAnimationSlot,
  PlayerDefinition
} from "@sugarmagic/domain";

const gltfLoader = new GLTFLoader();

const DEFAULT_CAPSULE_COLOR = 0x89b4fa;

function getAssetDefinition(
  contentLibrary: ContentLibrarySnapshot,
  definitionId: string | null | undefined
): AssetDefinition | null {
  if (!definitionId) return null;

  return (
    contentLibrary.assetDefinitions.find(
      (definition) => definition.definitionId === definitionId
    ) ?? null
  );
}

function getAssetSourceUrl(
  definition: AssetDefinition | null,
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

function createCapsuleRoot(definition: PlayerDefinition): THREE.Group {
  const root = new THREE.Group();
  const height = Math.max(definition.physicalProfile.height, 0.5);
  const radius = Math.max(
    definition.physicalProfile.radius,
    Math.min(0.45, height * 0.45)
  );

  const capsule = new THREE.Mesh(
    new THREE.CapsuleGeometry(radius, Math.max(0.05, height - radius * 2), 8, 16),
    new THREE.MeshStandardMaterial({
      color: DEFAULT_CAPSULE_COLOR,
      roughness: 0.35,
      metalness: 0.05
    })
  );
  capsule.position.y = height / 2;
  root.add(capsule);
  return root;
}

function normalizeModelScale(root: THREE.Object3D, targetHeight: number) {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.y <= 0) return;

  const scale = targetHeight / size.y;
  root.scale.setScalar(scale);
  box.setFromObject(root);
  const minY = box.min.y;
  root.position.y -= minY;
}

export interface PlayerPreviewWarning {
  code:
    | "missing-model"
    | "model-load-failed"
    | "animation-load-failed"
    | "missing-animation";
  message: string;
}

export interface PlayerPreviewApplyResult {
  warnings: PlayerPreviewWarning[];
  availableSlots: PlayerAnimationSlot[];
}

export interface PlayerPreviewController {
  readonly root: THREE.Group;
  readonly stageTargetHeight: number;
  apply: (input: {
    playerDefinition: PlayerDefinition;
    contentLibrary: ContentLibrarySnapshot;
    assetSources: Record<string, string>;
    activeAnimationSlot: PlayerAnimationSlot | null;
    isPlaying: boolean;
  }) => Promise<PlayerPreviewApplyResult>;
  update: (deltaSeconds: number) => void;
  dispose: () => void;
}

export function createPlayerVisualController(
  scene: THREE.Scene
): PlayerPreviewController {
  const root = new THREE.Group();
  root.name = "runtime-player-preview-root";
  scene.add(root);

  let currentRoot: THREE.Group | null = null;
  let currentMixer: THREE.AnimationMixer | null = null;
  let currentApplyVersion = 0;
  let stageTargetHeight = 1.8;

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
    definition: AssetDefinition,
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
        playerDefinition,
        contentLibrary,
        assetSources,
        activeAnimationSlot,
        isPlaying
      } = input;
      const version = ++currentApplyVersion;
      const warnings: PlayerPreviewWarning[] = [];
      stageTargetHeight = playerDefinition.physicalProfile.height;

      clearCurrent();

      const modelDefinition = getAssetDefinition(
        contentLibrary,
        playerDefinition.presentation.modelAssetDefinitionId
      );
      const modelSourceUrl = getAssetSourceUrl(modelDefinition, assetSources);
      const availableSlots = (Object.entries(
        playerDefinition.presentation.animationAssetBindings
      ) as Array<[PlayerAnimationSlot, string | null]>)
        .filter(([, definitionId]) => Boolean(definitionId))
        .map(([slot]) => slot);

      if (!modelDefinition || !modelSourceUrl) {
        if (playerDefinition.presentation.modelAssetDefinitionId) {
          warnings.push({
            code: "missing-model",
            message:
              "The bound player model could not be resolved from the content library."
          });
        }
        const capsuleRoot = createCapsuleRoot(playerDefinition);
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
        const clonedScene = cloneSkinnedObject(gltf.scene) as THREE.Object3D;
        normalizeModelScale(clonedScene, playerDefinition.physicalProfile.height);
        modelRoot.add(clonedScene);

        const animationClips = new Map<PlayerAnimationSlot, THREE.AnimationClip>();
        for (const [slot, definitionId] of Object.entries(
          playerDefinition.presentation.animationAssetBindings
        ) as Array<[PlayerAnimationSlot, string | null]>) {
          if (!definitionId) continue;
          const definition = getAssetDefinition(contentLibrary, definitionId);
          if (!definition) {
            warnings.push({
              code: "missing-animation",
              message: `The ${slot} animation binding could not be resolved.`
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
                message: `The ${slot} animation asset does not contain any clips.`
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
          message: "The bound player model failed to load; showing capsule preview instead."
        });

        const capsuleRoot = createCapsuleRoot(playerDefinition);
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

export const createPlayerPreviewController = createPlayerVisualController;
