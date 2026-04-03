import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type {
  AssetDefinition,
  ContentLibrarySnapshot,
  ItemDefinition
} from "@sugarmagic/domain";

const gltfLoader = new GLTFLoader();
const DEFAULT_ITEM_COLOR = 0xf9e2af;

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

function normalizeModelScale(root: THREE.Object3D, targetHeight: number) {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.y <= 0) return;

  const scale = targetHeight / size.y;
  root.scale.setScalar(scale);
  box.setFromObject(root);
  root.position.y -= box.min.y;
}

function createFallbackRoot(definition: ItemDefinition): THREE.Group {
  const root = new THREE.Group();
  const height = Math.max(definition.presentation.modelHeight, 0.1);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(height * 0.75, height, height * 0.75),
    new THREE.MeshStandardMaterial({
      color: DEFAULT_ITEM_COLOR,
      roughness: 0.35,
      metalness: 0.06
    })
  );
  mesh.position.y = height / 2;
  root.add(mesh);
  return root;
}

export interface ItemPreviewWarning {
  code: "missing-model" | "model-load-failed";
  message: string;
}

export interface ItemPreviewApplyResult {
  warnings: ItemPreviewWarning[];
}

export interface ItemPreviewController {
  readonly root: THREE.Group;
  apply: (input: {
    itemDefinition: ItemDefinition;
    contentLibrary: ContentLibrarySnapshot;
    assetSources: Record<string, string>;
  }) => Promise<ItemPreviewApplyResult>;
  dispose: () => void;
}

export function createItemPreviewController(scene: THREE.Scene): ItemPreviewController {
  const root = new THREE.Group();
  root.name = "runtime-item-preview-root";
  scene.add(root);

  let currentRoot: THREE.Group | null = null;
  let currentApplyVersion = 0;

  function clearCurrent() {
    if (!currentRoot) return;
    root.remove(currentRoot);
    disposeObject(currentRoot);
    currentRoot = null;
  }

  return {
    root,
    async apply(input) {
      const { itemDefinition, contentLibrary, assetSources } = input;
      const version = ++currentApplyVersion;
      const warnings: ItemPreviewWarning[] = [];
      clearCurrent();

      const modelDefinition = getAssetDefinition(
        contentLibrary,
        itemDefinition.presentation.modelAssetDefinitionId
      );
      const modelSourceUrl = getAssetSourceUrl(modelDefinition, assetSources);

      if (!modelDefinition || !modelSourceUrl) {
        if (itemDefinition.presentation.modelAssetDefinitionId) {
          warnings.push({
            code: "missing-model",
            message: "The bound item model could not be resolved from the content library."
          });
        }
        const fallbackRoot = createFallbackRoot(itemDefinition);
        if (version !== currentApplyVersion) {
          disposeObject(fallbackRoot);
          return { warnings };
        }
        currentRoot = fallbackRoot;
        root.add(fallbackRoot);
        return { warnings };
      }

      try {
        const gltf = await gltfLoader.loadAsync(modelSourceUrl);
        const modelRoot = new THREE.Group();
        const clonedScene = gltf.scene.clone(true);
        normalizeModelScale(clonedScene, Math.max(itemDefinition.presentation.modelHeight, 0.1));
        modelRoot.add(clonedScene);

        if (version !== currentApplyVersion) {
          disposeObject(modelRoot);
          return { warnings };
        }

        currentRoot = modelRoot;
        root.add(modelRoot);
        return { warnings };
      } catch {
        warnings.push({
          code: "model-load-failed",
          message: "The bound item model failed to load."
        });
        const fallbackRoot = createFallbackRoot(itemDefinition);
        if (version !== currentApplyVersion) {
          disposeObject(fallbackRoot);
          return { warnings };
        }
        currentRoot = fallbackRoot;
        root.add(fallbackRoot);
        return { warnings };
      }
    },
    dispose() {
      clearCurrent();
      scene.remove(root);
    }
  };
}
