/**
 * Mountain silhouette probe. QA-only, never shipped.
 *
 * Loads the generated mountain GLBs and shows them the ONLY way that matters:
 * as silhouettes against the sky, at the distance they are actually authored
 * for. A distant mountain lives or dies on its outline -- a shape that looks
 * fine spinning in an asset viewer at 3 metres can read as a traffic cone at
 * 400, and there is no way to know except to look at it from there.
 *
 * Two rows in one frame:
 *   back  -- each piece at its authored distance (300 / 450 / 620 units)
 *   front -- all three side by side, closer, for shape comparison
 *
 * The GLBs are read from public/assets/, which is gitignored -- these are the
 * wordlark project's assets, not sugarmagic's. Refresh them before a run:
 *   cp ~/projects/wordlark/asset-kit/mountain-*.glb packages/perf-harness/public/assets/
 *
 * Run:  pnpm --filter @sugarmagic/perf-harness probe:mountain
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { buildSkyMaterial } from "@sugarmagic/render-web";
import {
  DEFAULT_SKY_SETTINGS,
  createDefaultEnvironmentDefinition,
  type EnvironmentDefinition,
  type SkySettings
} from "@sugarmagic/domain";
import { WebGPURenderer } from "three/webgpu";

const container = document.getElementById("view") as HTMLElement;
const hud = document.getElementById("hud") as HTMLElement;

const renderer = new WebGPURenderer({ antialias: true });
const width = container.clientWidth || window.innerWidth;
const height = container.clientHeight || window.innerHeight;
renderer.setSize(width, height);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 2000);
camera.position.set(0, 60, 340);
camera.lookAt(0, 55, -400);

// Golden-hour key + sky fill, so the silhouette is read against a lit sky
// rather than as a flat black cutout.
const sun = new THREE.DirectionalLight(0xffd9a8, 2.2);
sun.position.set(-260, 180, 220);
scene.add(sun);
scene.add(new THREE.AmbientLight(0xa8b6d8, 1.1));

const SUNSET_SKY: SkySettings = {
  ...DEFAULT_SKY_SETTINGS,
  enabled: true,
  topColor: 0x6e5a9e,
  bottomColor: 0xffdca8,
  gradientMidEnabled: true,
  gradientMidColor: 0xe8a5b8,
  gradientMidPosition: 0.35,
  horizonBlend: 0.55,
  cloudsEnabled: false,
  undercastEnabled: false
};

const base = createDefaultEnvironmentDefinition("probe");
const environment: EnvironmentDefinition = {
  ...base,
  atmosphere: { ...base.atmosphere, sky: SUNSET_SKY }
};

const dome = new THREE.Mesh(new THREE.SphereGeometry(1200, 48, 24), buildSkyMaterial(environment));
dome.renderOrder = -1000;
scene.add(dome);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(4000, 4000),
  new THREE.MeshStandardMaterial({ color: 0x6b6252, roughness: 1 })
);
ground.geometry.rotateX(-Math.PI / 2);
scene.add(ground);

const PIECES = [
  { name: "mountain-ridge-a", far: { x: -260, z: -520 }, near: { x: -340, z: -40 } },
  { name: "mountain-peak-b", far: { x: 140, z: -700 }, near: { x: 0, z: -40 } },
  { name: "mountain-far-c", far: { x: 620, z: -900 }, near: { x: 340, z: -40 } }
];

const loader = new GLTFLoader();
const errors: string[] = [];
const consoleError = console.error.bind(console);
console.error = (...parts: unknown[]) => {
  errors.push(parts.map((p) => String(p)).join(" "));
  consoleError(...parts);
};
window.addEventListener("error", (event) => errors.push(String(event.message)));

const report: string[] = [];

async function load(name: string): Promise<THREE.Group> {
  const gltf = await loader.loadAsync(`/assets/${name}.glb`);
  return gltf.scene;
}

async function main(): Promise<void> {
  for (const piece of PIECES) {
    const model = await load(piece.name);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const slots = new Set<string>();
    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const material = child.material as THREE.Material & { name?: string };
        if (material?.name) slots.add(material.name);
      }
    });
    report.push(
      `${piece.name.padEnd(18)} ${size.x.toFixed(0)}w ${size.y.toFixed(0)}h ${size.z.toFixed(0)}d  ` +
        `base y=${box.min.y.toFixed(2)}  slots=[${[...slots].join(", ")}]`
    );

    const far = model.clone();
    far.position.set(piece.far.x, 0, piece.far.z);
    scene.add(far);

    const near = model.clone();
    near.position.set(piece.near.x, 0, piece.near.z);
    near.scale.setScalar(0.55);
    scene.add(near);
  }

  hud.textContent =
    "mountain probe -- back row at authored distance, front row scaled 0.55 for shape\n" +
    report.join("\n") +
    (errors.length > 0 ? `\n\nerrors: ${errors.length}` : "");

  Object.defineProperty(globalThis, "__mountainProbe", {
    get: () => ({ report, errors })
  });

  let frame = 0;
  renderer.setAnimationLoop(() => {
    renderer.render(scene, camera);
    frame += 1;
    if (frame === 20) (globalThis as { __probeReady?: boolean }).__probeReady = true;
  });
}

void main().catch((error) => {
  errors.push(String(error));
  hud.textContent = `FAILED: ${String(error)}`;
  (globalThis as { __probeReady?: boolean }).__probeReady = true;
});
