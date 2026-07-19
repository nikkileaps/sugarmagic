/**
 * Instanced-mask probe (Plan 070.5 / bug #360). QA-only, never shipped.
 *
 * Proves the mechanism the 070.5 fix rests on, on a REAL GPU: a "local-space"
 * gradient mask normalizes a position attribute against the geometry's
 * object-space bounds. On an InstancedMesh the node pipeline reassigns
 * `positionLocal` to the instance-WORLD position BEFORE user nodes, so an
 * off-origin instance reads a position far outside its object bounds ->
 * saturates -> FLAT. `positionGeometry` (the raw attribute) stays object-space
 * -> correct per-geometry ramp on every instance.
 *
 * Two rows of instanced boxes at x = 0, 6, 12 (off-origin):
 *   BACK  row -> colorNode uses positionLocal   (the #360 bug: 2 of 3 flat)
 *   FRONT row -> colorNode uses positionGeometry (the fix: all 3 ramp)
 *
 * Run:  pnpm --filter @sugarmagic/perf-harness probe:mask   (screenshots it)
 */

import * as THREE from "three";
import { WebGPURenderer, MeshBasicNodeMaterial } from "three/webgpu";
import { positionLocal, positionGeometry, vec3, mix } from "three/tsl";

const container = document.getElementById("view") as HTMLElement;
const hud = document.getElementById("hud") as HTMLElement;

const renderer = new WebGPURenderer({ antialias: true });
const width = container.clientWidth || window.innerWidth;
const height = container.clientHeight || window.innerHeight;
renderer.setSize(width, height);
renderer.setClearColor(0x101014, 1);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 200);
camera.position.set(6, 10, 20);
camera.lookAt(6, 1, 2);

const DARK = vec3(0.1, 0.1, 0.12);
const BRIGHT = vec3(1.0, 0.35, 0.8);
const INSTANCE_X = [0, 6, 12]; // off-origin -> where positionLocal diverges from object space

// A "local-space X gradient" mask: normalize the object box's X extent
// [-0.5, 0.5] to 0..1 and ramp dark->bright. Exactly what materialize/mask.ts
// gradientAxisNode does, minus the full surface pipeline.
function gradientMaterial(useGeometry: boolean): MeshBasicNodeMaterial {
  const src = (useGeometry ? positionGeometry : positionLocal).x;
  const t = src.add(0.5).clamp(0, 1);
  const mat = new MeshBasicNodeMaterial();
  mat.colorNode = mix(DARK, BRIGHT, t);
  return mat;
}

function instancedRow(useGeometry: boolean, z: number): void {
  const geometry = new THREE.BoxGeometry(1, 2, 1);
  const mesh = new THREE.InstancedMesh(
    geometry,
    gradientMaterial(useGeometry),
    INSTANCE_X.length
  );
  const m = new THREE.Matrix4();
  INSTANCE_X.forEach((x, i) => {
    m.makeTranslation(x, 1, z);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
}

instancedRow(false, 0); // BACK: positionLocal (buggy)
instancedRow(true, 5); // FRONT: positionGeometry (fixed)

hud.textContent =
  "instanced-mask probe (#360)\n" +
  "BACK row  = positionLocal   (bug: x=6 & x=12 flat)\n" +
  "FRONT row = positionGeometry (fix: all ramp dark->pink)";

let frames = 0;
function loop(): void {
  renderer.render(scene, camera);
  frames += 1;
  if (frames === 30) {
    (globalThis as { __maskProbeReady?: boolean }).__maskProbeReady = true;
  }
  requestAnimationFrame(loop);
}

await renderer.init();
loop();
