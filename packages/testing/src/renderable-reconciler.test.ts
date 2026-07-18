import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  createRenderableReconciler,
  type RenderableReconcilerConfig
} from "@sugarmagic/render-web";
import type { SceneObject } from "@sugarmagic/runtime-core";

// Minimal SceneObject factory (mirrors scene/index.ts field set).
function obj(
  instanceId: string,
  overrides: Partial<SceneObject> = {}
): SceneObject {
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

/** A fake GLB scene: one static mesh (buildInstancedAssetGroup-friendly). */
function fakeGltfScene(): THREE.Object3D {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
  return g;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function makeReconciler(overrides: Partial<RenderableReconcilerConfig> = {}) {
  const parent = new THREE.Group();
  let loads = 0;
  const config: RenderableReconcilerConfig = {
    parent,
    resolveUrl: (o) => (o.modelSourcePath ? `blob:${o.modelSourcePath}` : null),
    loadModel: async () => {
      loads += 1;
      return fakeGltfScene();
    },
    createFallback: () => new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()),
    shaderRuntime: null,
    getFileSources: () => ({}),
    ...overrides
  };
  return { parent, config, reconciler: createRenderableReconciler(config), loadCount: () => loads };
}

describe("070.2 — renderable reconciler (singletons)", () => {
  it("adds a renderable per desired object, parented", async () => {
    const { parent, reconciler } = makeReconciler();
    reconciler.reconcile([obj("a"), obj("b")]);
    await flush();
    expect([...reconciler.entries()].map((e) => e.object.instanceId).sort()).toEqual(["a", "b"]);
    expect(parent.children.length).toBe(2);
    expect(reconciler.get("a")?.loadedWithAsset).toBe(true);
  });

  it("updates transform in place without reloading", async () => {
    const { reconciler, loadCount } = makeReconciler();
    reconciler.reconcile([obj("a")]);
    await flush();
    const before = reconciler.get("a");
    expect(loadCount()).toBe(1);
    reconciler.reconcile([obj("a", { transform: { position: [5, 0, 3], rotation: [0, 0, 0], scale: [1, 1, 1] } })]);
    await flush();
    const after = reconciler.get("a");
    expect(after).toBe(before); // same entry, not rebuilt
    expect(loadCount()).toBe(1); // no reload
    expect(after!.root.position.x).toBe(5);
    expect(after!.root.position.z).toBe(3);
  });

  it("rebuilds when representationKey changes", async () => {
    const { reconciler, loadCount } = makeReconciler();
    reconciler.reconcile([obj("a", { representationKey: "rep:1" })]);
    await flush();
    const first = reconciler.get("a");
    reconciler.reconcile([obj("a", { representationKey: "rep:2" })]);
    await flush();
    const second = reconciler.get("a");
    expect(second).not.toBe(first);
    expect(second!.representationKey).toBe("rep:2");
    expect(loadCount()).toBe(2);
  });

  it("removes + disposes an object dropped from desired", async () => {
    const { parent, reconciler } = makeReconciler();
    reconciler.reconcile([obj("a"), obj("b")]);
    await flush();
    reconciler.reconcile([obj("a")]);
    await flush();
    expect(reconciler.get("b")).toBeUndefined();
    expect(parent.children.length).toBe(1);
  });

  it("shows a fallback when no url, then adopts the asset when it streams in", async () => {
    let hasUrl = false;
    const { reconciler, loadCount } = makeReconciler({
      resolveUrl: () => (hasUrl ? "blob:x" : null)
    });
    reconciler.reconcile([obj("a")]);
    await flush();
    expect(reconciler.get("a")?.loadedWithAsset).toBe(false);
    expect(loadCount()).toBe(0);
    hasUrl = true;
    reconciler.reconcile([obj("a")]);
    await flush();
    expect(reconciler.get("a")?.loadedWithAsset).toBe(true);
    expect(loadCount()).toBe(1);
  });

  it("discards a load that resolves after its object was removed (stale guard)", async () => {
    let release: (v: THREE.Object3D) => void = () => {};
    const { parent, reconciler } = makeReconciler({
      loadModel: () => new Promise<THREE.Object3D>((r) => (release = r))
    });
    reconciler.reconcile([obj("a")]);
    // load in flight; remove it before the load resolves
    reconciler.reconcile([]);
    release(fakeGltfScene());
    await flush();
    expect(reconciler.get("a")).toBeUndefined();
    expect(parent.children.length).toBe(0); // stale renderable not attached
  });

  it("remove() drops one singleton by id (host-driven, e.g. item collection)", async () => {
    const { parent, reconciler } = makeReconciler();
    reconciler.reconcile([obj("a"), obj("item1")]);
    await flush();
    reconciler.remove("item1");
    expect(reconciler.get("item1")).toBeUndefined();
    expect(parent.children.length).toBe(1);
    // a later reconcile that also drops it keeps it gone
    reconciler.reconcile([obj("a")]);
    await flush();
    expect(reconciler.get("item1")).toBeUndefined();
  });

  it("dispose() tears down every entry", async () => {
    const { parent, reconciler } = makeReconciler();
    reconciler.reconcile([obj("a"), obj("b"), obj("c")]);
    await flush();
    reconciler.dispose();
    expect([...reconciler.entries()].length).toBe(0);
    expect(parent.children.length).toBe(0);
  });
});

describe("070.2 — renderable reconciler (grouping gate)", () => {
  it("grouping OFF (studio): every object is a singleton", async () => {
    const { reconciler } = makeReconciler({ grouping: false });
    reconciler.reconcile([obj("a"), obj("b"), obj("c")]); // same rep
    await flush();
    expect([...reconciler.entries()].every((e) => !e.instanced)).toBe(true);
    expect(reconciler.get("a")).toBeDefined();
  });

  it("grouping ON (game): >=2 instanceable same-rep objects collapse to one group", async () => {
    const { parent, reconciler } = makeReconciler({
      grouping: true,
      isInstanceable: () => true
    });
    reconciler.reconcile([obj("a"), obj("b"), obj("c")]); // rep:x
    await flush();
    const all = [...reconciler.entries()];
    const grouped = all.filter((e) => e.instanced);
    expect(grouped.length).toBe(1);
    expect(grouped[0]!.instanceOrder).toEqual(["a", "b", "c"]);
    // group members are NOT singletons
    expect(reconciler.get("a")).toBeUndefined();
    // one InstancedMesh group root under the parent (no per-member roots)
    expect(parent.children.length).toBe(1);
  });

  it("grouping ON: a lone instanceable object stays a singleton", async () => {
    const { reconciler } = makeReconciler({
      grouping: true,
      isInstanceable: () => true
    });
    reconciler.reconcile([obj("solo")]);
    await flush();
    expect(reconciler.get("solo")?.instanced).toBe(false);
  });

  it("grouping ON: non-instanceable objects stay singletons alongside a group", async () => {
    const { reconciler } = makeReconciler({
      grouping: true,
      isInstanceable: (o) => o.representationKey === "rep:grass"
    });
    reconciler.reconcile([
      obj("g1", { representationKey: "rep:grass" }),
      obj("g2", { representationKey: "rep:grass" }),
      obj("npc", { kind: "npc", representationKey: "rep:npc" })
    ]);
    await flush();
    expect(reconciler.get("npc")?.instanced).toBe(false);
    expect([...reconciler.entries()].filter((e) => e.instanced).length).toBe(1);
  });
});
