import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  createRenderableReconciler,
  type RenderableReconcilerConfig
} from "@sugarmagic/render-web";
import {
  SCENE_OBJECT_MARKER_KEY,
  buildSceneObjectMarker,
  resolveSceneObjectMarker
} from "@sugarmagic/workspaces";
import type { SceneObject } from "@sugarmagic/runtime-core";

/**
 * Plan 070.2 regression guard. 070.2 replaced the studio's hand-rolled
 * createRenderableRoot (which stamped SCENE_OBJECT_MARKER_KEY on every root)
 * with the shared reconciler, and dropped the marker — rendering was fine but
 * picking + surface-painting silently broke, and a render-only screenshot
 * missed it. This test asserts the ROUND TRIP: a reconciler-built root, marked
 * exactly the way the studio marks it (buildSceneObjectMarker in onEntryLoaded),
 * resolves back to the right instanceId via the hit-test resolver. If a future
 * change drops the marker, resolveSceneObjectMarker returns null and this fails.
 */

function obj(instanceId: string, overrides: Partial<SceneObject> = {}): SceneObject {
  return {
    instanceId,
    kind: "asset",
    displayName: instanceId,
    assetDefinitionId: "asset:x",
    assetKind: "model",
    modelSourcePath: "models/x.glb",
    targetModelHeight: null,
    effectiveShaders: { surface: null, deform: null, effect: null },
    effectiveMaterialSlots: [],
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    representationKey: "rep:x",
    capsule: null,
    collider: null,
    ...overrides
  };
}

function fakeGltfScene(): THREE.Object3D {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
  return g;
}
const flush = () => new Promise((r) => setTimeout(r, 0));

// The studio's exact marker wiring, shared with the real viewport via
// buildSceneObjectMarker in onEntryLoaded.
function studioConfig(parent: THREE.Object3D, extra: Partial<RenderableReconcilerConfig> = {}): RenderableReconcilerConfig {
  return {
    parent,
    resolveUrl: (o) => (o.modelSourcePath ? `blob:${o.modelSourcePath}` : null),
    loadModel: async () => fakeGltfScene(),
    createFallback: () => new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()),
    shaderRuntime: null,
    getFileSources: () => ({}),
    onEntryLoaded: (entry) => {
      entry.root.userData[SCENE_OBJECT_MARKER_KEY] = buildSceneObjectMarker(entry);
    },
    ...extra
  };
}

describe("070.2 regression guard — scene-object marker round-trip", () => {
  it("a reconciler-built singleton root resolves to its instanceId (marker present)", async () => {
    const parent = new THREE.Group();
    const reconciler = createRenderableReconciler(studioConfig(parent));
    reconciler.reconcile([obj("plant-a")]);
    await flush();
    const entry = reconciler.get("plant-a")!;
    // Resolve starting from a mesh DEEP in the tree (as a raycast hit would).
    const mesh = entry.root.children[0]!;
    const resolved = resolveSceneObjectMarker(mesh, parent);
    expect(resolved).not.toBeNull();
    expect(resolved!.objectName).toBe("plant-a");
  });

  it("returns null when the marker is missing (the 070.2 bug shape)", async () => {
    const parent = new THREE.Group();
    // Config WITHOUT the onEntryLoaded marker stamp = the regression.
    const reconciler = createRenderableReconciler({
      ...studioConfig(parent),
      onEntryLoaded: undefined
    });
    reconciler.reconcile([obj("plant-a")]);
    await flush();
    const mesh = reconciler.get("plant-a")!.root.children[0]!;
    expect(resolveSceneObjectMarker(mesh, parent)).toBeNull();
  });

  it("an instanced group root resolves each InstancedMesh index to its member id", async () => {
    const parent = new THREE.Group();
    const reconciler = createRenderableReconciler(
      studioConfig(parent, { grouping: true, isInstanceable: () => true })
    );
    reconciler.reconcile([obj("g0"), obj("g1"), obj("g2")]); // same rep -> one group
    await flush();
    const group = [...reconciler.entries()].find((e) => e.instanced)!;
    const instancedMesh = group.root.children[0]!; // InstancedMesh under the group root
    expect(resolveSceneObjectMarker(instancedMesh, parent, 0)!.objectName).toBe("g0");
    expect(resolveSceneObjectMarker(instancedMesh, parent, 2)!.objectName).toBe("g2");
  });
});
