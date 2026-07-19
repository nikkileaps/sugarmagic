import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  createRenderableReconciler,
  type RenderableReconcilerConfig
} from "@sugarmagic/render-web";
import type { SceneObject } from "@sugarmagic/runtime-core";

// Plan 070.8 (#344) — headless render-budget alarm. NO GPU: the reconciler's
// instanceable partition + draw/chunk counting is pure JS, and InstancedMesh
// construction over a fake GLB needs no device. Guards the epic's core win —
// a same-surface scatter field folds onto ONE instanced draw root instead of N
// — so a regression (surfaces that stop sharing a representationKey → draws and
// materials balloon) trips in CI, not on someone's frame timer.

function obj(instanceId: string, representationKey: string): SceneObject {
  return {
    instanceId,
    kind: "asset",
    displayName: instanceId,
    assetDefinitionId: "asset:lavender",
    assetKind: "model",
    modelSourcePath: "models/lavender.glb",
    targetModelHeight: null,
    effectiveShaders: { surface: null, deform: null, effect: null },
    effectiveMaterialSlots: [],
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    representationKey,
    capsule: null,
    collider: null
  };
}

function fakeGltfScene(): THREE.Object3D {
  const g = new THREE.Group();
  g.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial()
    )
  );
  return g;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function gameReconciler() {
  const config: RenderableReconcilerConfig = {
    parent: new THREE.Group(),
    resolveUrl: (o) => (o.modelSourcePath ? `blob:${o.modelSourcePath}` : null),
    loadModel: async () => fakeGltfScene(),
    createFallback: () =>
      new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()),
    shaderRuntime: null,
    getFileSources: () => ({}),
    grouping: true,
    isInstanceable: () => true
  };
  return createRenderableReconciler(config);
}

// Budget for the fixture "meadow": one shared-surface scatter field plus a
// handful of distinct props. If this ever needs RAISING, that's a real
// regression to investigate — not a number to bump.
const DRAW_UNIT_BUDGET = 8;

describe("070.8 — headless render budget (#344)", () => {
  it("a 250-plant shared-surface field folds to ONE draw unit", async () => {
    const r = gameReconciler();
    r.reconcile(Array.from({ length: 250 }, (_, i) => obj(`p${i}`, "rep:lav")));
    await flush();
    const stats = r.stats();
    expect(stats.instances).toBe(250);
    expect(stats.groups).toBe(1);
    expect(stats.drawUnits).toBe(1);
    expect(stats.drawUnits).toBeLessThanOrEqual(DRAW_UNIT_BUDGET);
  });

  it("mixed scene (shared field + distinct props) stays within budget", async () => {
    const r = gameReconciler();
    const field = Array.from({ length: 100 }, (_, i) =>
      obj(`p${i}`, "rep:lav")
    );
    const props = ["rep:rock", "rep:bench", "rep:tree"].map((rep, i) =>
      obj(`prop${i}`, rep)
    );
    r.reconcile([...field, ...props]);
    await flush();
    const stats = r.stats();
    // 1 group (lavender) + 3 lone props = 4 draw units for 103 placed things.
    expect(stats.drawUnits).toBe(4);
    expect(stats.drawUnits).toBeLessThanOrEqual(DRAW_UNIT_BUDGET);
  });

  it("REGRESSION guard: surfaces that stop sharing a representationKey trip the budget", async () => {
    const r = gameReconciler();
    // Each plant gets a UNIQUE rep — what a material-dedup / surface-folding
    // regression looks like: every instance becomes its own draw root.
    r.reconcile(
      Array.from({ length: 250 }, (_, i) => obj(`p${i}`, `rep:lav:${i}`))
    );
    await flush();
    const stats = r.stats();
    expect(stats.groups).toBe(0);
    expect(stats.singletons).toBe(250);
    // The alarm has teeth: this scene BLOWS the budget the healthy cases hold.
    expect(stats.drawUnits).toBeGreaterThan(DRAW_UNIT_BUDGET);
  });
});
