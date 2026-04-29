import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinnedObject } from "three/examples/jsm/utils/SkeletonUtils.js";
import type {
  AssetDefinition,
  CharacterAnimationDefinition,
  CharacterModelDefinition,
  ContentLibrarySnapshot,
  PlayerAnimationSlot,
  PlayerDefinition,
  RegionDocument
} from "@sugarmagic/domain";
import {
  getCharacterAnimationDefinition,
  getCharacterModelDefinition
} from "@sugarmagic/domain";
import {
  Caster,
  CameraTarget,
  PlayerControlled,
  Position,
  Renderable,
  Velocity,
  type Entity,
  type World
} from "../ecs";
import { DEFAULT_MAX_BATTERY, MAX_RESONANCE } from "../caster";

const gltfLoader = new GLTFLoader();

const DEFAULT_CAPSULE_COLOR = 0x89b4fa;

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
  // Compute the world-space bounding box, then scale the root so the
  // bbox height matches the player's physical-profile height. This
  // matches Sugarengine's CharacterLoader.normalizeModel — same
  // multiplyScalar semantics, same recompute-then-snap-to-floor step.
  // Requires the upstream loader to use plain Object3D.clone (not
  // SkeletonUtils.clone), otherwise SkinnedMesh.computeBoundingBox
  // produces a garbage bbox driven by a corrupted bind matrix and
  // the resulting scale is wildly wrong.
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.y <= 0) return;

  root.scale.multiplyScalar(targetHeight / size.y);
  box.setFromObject(root);
  root.position.y -= box.min.y;
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
  /**
   * Cheap per-frame slot swap: stops the currently-playing animation
   * action (if any) and starts the action for `slot`, reusing the
   * already-loaded clip + mixer. No-op when the requested slot
   * isn't bound, when it's already active, or when no model is
   * loaded. Used by the gameplay runtime to switch idle ↔ walk based
   * on player velocity.
   */
  setActiveAnimationSlot: (slot: PlayerAnimationSlot | null) => void;
  dispose: () => void;
}

export interface RuntimePlayerSpawn {
  entity: Entity;
  eyeHeight: number;
  position: [number, number, number];
}

export function spawnRuntimePlayerEntity(
  world: World,
  region: RegionDocument | null,
  playerDefinition: PlayerDefinition
): RuntimePlayerSpawn {
  const entity = world.createEntity();
  const position = region?.scene.playerPresence?.transform.position ?? [0, 0, 0];
  world.addComponent(entity, new Position(...position));
  world.addComponent(entity, new Velocity());
  world.addComponent(
    entity,
    new PlayerControlled(playerDefinition.movementProfile.walkSpeed)
  );
  world.addComponent(
    entity,
    new Caster(
      Math.max(0, Math.min(DEFAULT_MAX_BATTERY, playerDefinition.casterProfile.initialBattery)),
      DEFAULT_MAX_BATTERY,
      playerDefinition.casterProfile.rechargeRate,
      Math.max(0, Math.min(MAX_RESONANCE, playerDefinition.casterProfile.initialResonance)),
      [...playerDefinition.casterProfile.allowedSpellTags],
      [...playerDefinition.casterProfile.blockedSpellTags]
    )
  );
  world.addComponent(entity, new CameraTarget());
  world.addComponent(entity, new Renderable("player", true));

  return {
    entity,
    eyeHeight: playerDefinition.physicalProfile.eyeHeight,
    position
  };
}

export function createPlayerVisualController(
  scene: THREE.Scene
): PlayerPreviewController {
  const root = new THREE.Group();
  root.name = "runtime-player-preview-root";
  scene.add(root);

  let currentRoot: THREE.Group | null = null;
  let currentMixer: THREE.AnimationMixer | null = null;
  // Map of available clips for the currently-loaded model, keyed by
  // animation slot. Populated by apply(); consumed by
  // setActiveAnimationSlot() so the host can swap which animation
  // plays each frame (e.g. idle ↔ walk based on velocity) without
  // re-parsing the model GLB.
  let currentClips = new Map<PlayerAnimationSlot, THREE.AnimationClip>();
  let currentAction: THREE.AnimationAction | null = null;
  let activeSlot: PlayerAnimationSlot | null = null;
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
    currentClips = new Map();
    currentAction = null;
    activeSlot = null;
  }

  function setActiveAnimationSlot(slot: PlayerAnimationSlot | null): void {
    if (slot === activeSlot) return;
    if (!currentMixer) return;
    if (currentAction) {
      currentAction.stop();
      currentAction = null;
    }
    activeSlot = slot;
    if (slot && currentClips.has(slot)) {
      const action = currentMixer.clipAction(currentClips.get(slot)!);
      action.reset();
      action.play();
      currentAction = action;
      // eslint-disable-next-line no-console
      console.warn("[player-anim-debug] switched to slot", {
        slot,
        clipName: currentClips.get(slot)?.name,
        actionEnabled: action.enabled,
        actionWeight: action.getEffectiveWeight(),
        mixerTimeScale: currentMixer.timeScale
      });
    } else {
      // eslint-disable-next-line no-console
      console.warn("[player-anim-debug] requested slot not in clips", {
        slot,
        availableSlots: Array.from(currentClips.keys())
      });
    }
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

      const modelDefinitionId =
        playerDefinition.presentation.modelAssetDefinitionId;
      const modelDefinition = modelDefinitionId
        ? getCharacterModelDefinition(contentLibrary, modelDefinitionId)
        : null;
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
              "The bound player model could not be resolved as a character model. Re-import the model via the Player inspector."
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
        // SkeletonUtils.clone is required for the cloned SkinnedMesh's
        // skeleton to point at the CLONED bones (rather than the source
        // gltf's bones). Plain Object3D.clone shares the skeleton ref
        // with the source per SkinnedMesh.copy, which means moving the
        // cloned wrapper Group does NOT move the rendered mesh — the
        // skinning shader follows the source bones, which never moved
        // because the source tree was never added to the scene.
        const clonedScene = cloneSkinnedObject(gltf.scene) as THREE.Object3D;
        // Critical: populate matrixWorld for every node BEFORE measuring
        // the bbox. SkinnedMesh.computeBoundingBox (called by Box3.set
        // FromObject) evaluates `boneMatrix * inverseBindMatrix * vertex`
        // per vertex — with un-updated bone matrixWorlds (still identity
        // from clone) the computed bbox is garbage and normalizeModelScale
        // then computes a wildly wrong scale.
        clonedScene.updateMatrixWorld(true);
        normalizeModelScale(clonedScene, playerDefinition.physicalProfile.height);
        // Disable frustum culling on skinned meshes — their bounding sphere
        // is computed from the bind-pose geometry and goes stale after
        // rescaling and once animations deform the mesh, which can make the
        // model pop out of view at certain camera angles. Same workaround as
        // Sugarengine's CharacterLoader.
        clonedScene.traverse((child) => {
          if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
            child.frustumCulled = false;
          }
        });
        modelRoot.add(clonedScene);

        const animationClips = new Map<PlayerAnimationSlot, THREE.AnimationClip>();
        for (const [slot, definitionId] of Object.entries(
          playerDefinition.presentation.animationAssetBindings
        ) as Array<[PlayerAnimationSlot, string | null]>) {
          if (!definitionId) continue;
          const definition = getCharacterAnimationDefinition(
            contentLibrary,
            definitionId
          );
          if (!definition) {
            warnings.push({
              code: "missing-animation",
              message: `The ${slot} animation binding could not be resolved as a character animation. Re-import the clip via the Player inspector.`
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
        currentClips = animationClips;

        // eslint-disable-next-line no-console
        console.warn("[player-anim-debug] model loaded", {
          clonedSceneName: clonedScene.name,
          modelBoneNames: (() => {
            const names: string[] = [];
            clonedScene.traverse((child) => {
              if ((child as THREE.Bone).isBone) names.push(child.name);
            });
            return names.slice(0, 10);
          })(),
          clipTracksBySlot: Array.from(animationClips.entries()).map(
            ([slot, clip]) => [
              slot,
              clip.tracks.slice(0, 5).map((t) => t.name)
            ]
          )
        });

        // Create the mixer whenever ANY clips loaded. The host controls
        // which slot plays via setActiveAnimationSlot each frame, so we
        // can't gate on the initial activeAnimationSlot — a player with
        // only walk bound (no idle) would otherwise never get a mixer
        // and every later setActiveAnimationSlot("walk") would silently
        // no-op.
        if (animationClips.size > 0) {
          currentMixer = new THREE.AnimationMixer(clonedScene);
          currentMixer.timeScale = isPlaying ? 1 : 0;
          if (activeAnimationSlot && animationClips.has(activeAnimationSlot)) {
            setActiveAnimationSlot(activeAnimationSlot);
          }
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
    setActiveAnimationSlot,
    dispose() {
      currentApplyVersion += 1;
      clearCurrent();
      scene.remove(root);
    }
  };
}

export const createPlayerPreviewController = createPlayerVisualController;
