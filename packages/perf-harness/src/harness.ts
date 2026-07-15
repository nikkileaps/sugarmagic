/**
 * Synthetic GPU load rig (Perf task #337).
 *
 * Drives the REAL RenderView loop over a tunable plain-three GPU load --
 * no domain region / auth / picker needed, because `createRenderView`
 * accepts an arbitrary scene. Used to sanity-check the driving infra and
 * to A/B isolated engine changes against a synthetic load. The live
 * scene (scatter / ensure-loop machinery) is measured separately by
 * attaching to a running preview -- see driver/measure-live.mjs.
 *
 * Tune load with ?meshes=<n>&detail=<n>. Run vsync-unlocked (the driver
 * passes the Chrome flags) so frame time reflects real GPU work.
 */

import * as THREE from "three";
// The engine renders through a node-based WebGPU pipeline; plain
// MeshStandardMaterial silently draws nothing there, so the load meshes
// must use the node material.
import { MeshStandardNodeMaterial } from "three/webgpu";
import { createRenderView, createWebRenderEngine } from "@sugarmagic/render-web";

const params = new URLSearchParams(location.search);
const MESH_COUNT = Number(params.get("meshes") ?? 600);
const DETAIL = Number(params.get("detail") ?? 48);

const container = document.getElementById("view") as HTMLElement;
const hud = document.getElementById("hud") as HTMLElement;

const engine = createWebRenderEngine({ compileProfile: "authoring-preview" });

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101014);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
camera.position.set(0, 8, 30);

scene.add(new THREE.AmbientLight(0xffffff, 0.45));
const key = new THREE.DirectionalLight(0xffffff, 1.3);
key.position.set(12, 22, 10);
scene.add(key);

// Load generator: MESH_COUNT separate meshes -> MESH_COUNT draw calls
// (each mesh is its own geometry, so no instancing/batching), of a
// moderately heavy geometry (-> triangle pressure). Materials come from
// a small PALETTE so draw-call count is decoupled from shader-compile
// count -- thousands of UNIQUE node materials would stall on pipeline
// compiles, which isn't the load we're modelling. Dial via
// ?meshes= & ?detail=.
const PALETTE = 16;
const materials = Array.from(
  { length: PALETTE },
  (_, p) =>
    new MeshStandardNodeMaterial({
      color: new THREE.Color().setHSL(p / PALETTE, 0.6, 0.55),
      roughness: 0.5,
      metalness: 0.1
    })
);
const grid = Math.ceil(Math.sqrt(MESH_COUNT));
for (let i = 0; i < MESH_COUNT; i += 1) {
  const geometry = new THREE.TorusKnotGeometry(
    0.5,
    0.18,
    DETAIL,
    Math.max(8, Math.round(DETAIL / 3))
  );
  const mesh = new THREE.Mesh(geometry, materials[i % PALETTE]);
  const gx = (i % grid) - grid / 2;
  const gz = Math.floor(i / grid) - grid / 2;
  mesh.position.set(gx * 1.7, 0, gz * 1.7);
  scene.add(mesh);
}

const renderView = createRenderView({
  engine,
  scene,
  camera,
  compileProfile: "authoring-preview"
});
renderView.mount(container);
renderView.startRenderLoop();

function resize(): void {
  const w = container.clientWidth || window.innerWidth;
  const h = container.clientHeight || window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderView.resize(w, h);
}
resize();
window.addEventListener("resize", resize);

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Orbit so every frame does real GPU work (no static-frame shortcuts),
// and record wall-clock frame periods for the fps measurement.
const frameTimes: number[] = [];
let last = performance.now();
let orbit = 0;
renderView.subscribeFrame(() => {
  const now = performance.now();
  frameTimes.push(now - last);
  last = now;
  if (frameTimes.length > 400) {
    frameTimes.shift();
  }
  orbit += 0.012;
  camera.position.x = Math.sin(orbit) * 30;
  camera.position.z = Math.cos(orbit) * 30;
  camera.lookAt(0, 0, 0);
  const med = median(frameTimes);
  hud.textContent =
    `meshes=${MESH_COUNT} detail=${DETAIL}\n` +
    `frame=${med.toFixed(1)}ms  fps=${(1000 / med).toFixed(1)}`;
});

interface PerfGlobals {
  __perfHarness?: unknown;
}

(globalThis as PerfGlobals).__perfHarness = {
  ready: true,
  meshCount: MESH_COUNT,
  detail: DETAIL,
  async sample(durationMs = 2500): Promise<unknown> {
    frameTimes.length = 0;
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    const arr = [...frameTimes];
    const med = median(arr);
    return {
      frames: arr.length,
      medianFrameMs: Number(med.toFixed(2)),
      fps: Number((1000 / med).toFixed(1))
    };
  }
};
