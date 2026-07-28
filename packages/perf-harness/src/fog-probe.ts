/**
 * Fog probe. QA-only, never shipped.
 *
 * Answers one question with numbers instead of eyeballs: does the fog
 * post-process tint the SKY, and does it still fade DISTANT GEOMETRY?
 *
 * Those two want opposite things and the built-in graph got them backwards.
 * Fog is a post-process keyed on the depth buffer, and the sky dome draws with
 * `depthWrite = false`, so sky pixels keep the cleared depth -> linearized to
 * cameraFar (1000). That made the sky the farthest thing on screen and so the
 * single most-fogged thing in the frame: at density 0.001 the sky took 63% fog
 * while scene geometry 30 units out took 3%. Authors read that as "fog washed
 * out my sky and did nothing to my scene", and no density/heightFalloff
 * combination fixes it.
 *
 * The probe builds a real `createRenderView` (the same path Studio and the
 * game use), a real camera-locked sky dome, and a row of pillars marching away
 * from the camera to the far plane. It renders the frame twice -- fog off,
 * then fog on -- and reports the sampled RGB at the sky and at each pillar.
 *
 * Read the output as:
 *   sky delta      ~0   -> the sky is NOT being eaten by fog     (the fix)
 *   far-ground delta > near-ground delta -> atmospheric perspective survives
 *
 * A regression that re-broke the sky gate would show a large sky delta; a
 * regression that over-corrected (gating all distant geometry, not just sky)
 * would show the far-ground delta collapsing to zero. One run catches both.
 *
 * Run:  pnpm --filter @sugarmagic/perf-harness probe:fog
 */

import * as THREE from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { buildSkyMaterial, createRenderView, createWebRenderEngine } from "@sugarmagic/render-web";
import {
  DEFAULT_SKY_SETTINGS,
  createDefaultEnvironmentDefinition,
  createDefaultFogTintPostProcessShaderGraph,
  createEmptyContentLibrarySnapshot,
  type ContentLibrarySnapshot,
  type EnvironmentDefinition,
  type RegionDocument,
  type SkySettings
} from "@sugarmagic/domain";

const container = document.getElementById("view") as HTMLElement;
const hud = document.getElementById("hud") as HTMLElement;

const PROJECT_ID = "probe";

/** Nikki's filming values, verbatim from the environment panel. */
const FOG_COLOR = 0xcdd6f4;
const FOG_DENSITY = 0.001;
const FOG_HEIGHT_FALLOFF = 0.08;

/** Distances the ground samples are taken at, in world units. The last two straddle the
 *  sky-gate fade band (940 -> 992) so a too-aggressive gate is visible. */
const GROUND_DISTANCES = [40, 120, 300, 550, 800, 920];

const engine = createWebRenderEngine({ compileProfile: "authoring-preview" });

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
camera.position.set(0, 30, 80);
camera.lookAt(0, 0, -320);

scene.add(new THREE.AmbientLight(0xffffff, 1.4));

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

const fogGraph = createDefaultFogTintPostProcessShaderGraph(PROJECT_ID);
const environment: EnvironmentDefinition = createDefaultEnvironmentDefinition(PROJECT_ID);
environment.atmosphere = { ...environment.atmosphere, sky: SUNSET_SKY };

// The sky dome, built exactly as EnvironmentSceneController does: radius 250,
// renderOrder -1000, riding the camera so it reads as infinitely distant.
const dome = new THREE.Mesh(
  new THREE.SphereGeometry(250, 48, 24),
  buildSkyMaterial(environment)
);
dome.renderOrder = -1000;
dome.onBeforeRender = (_r, _s, cam) => {
  dome.position.copy(cam.position);
  dome.updateMatrixWorld(true);
};
scene.add(dome);

// The ground plane: unoccluded depth-bearing pixels all the way to the horizon.
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(2400, 2400),
  new MeshStandardNodeMaterial({ color: new THREE.Color(0.32, 0.26, 0.2), roughness: 1 })
);
ground.geometry.rotateX(-Math.PI / 2);
scene.add(ground);

// NO occluding geometry. Samples are taken on the GROUND PLANE at increasing
// distance, which is both unoccluded and exactly what atmospheric perspective
// looks like in a real scene (a receding landscape). Ground sits at y = 0, so
// height attenuation is exp(0) = 1 at every sample and the only thing varying
// across samples is DISTANCE.
//
// An earlier version put walls at each distance; being centered on x = 0 they
// occluded each other, so every "distance" sample was really reading the
// nearest wall. That is why it reported identical colour at 40 and 800 units.
const SAMPLE_Y = 0;

// Fog on/off is chosen at BOOT from the URL, not toggled at runtime. Mutating
// the binding after createRenderView does not rebuild the post-process chain,
// so a runtime toggle silently compares fog-on against fog-on -- which is how
// an earlier version of this probe reported "no fog anywhere".
const fogEnabled = new URLSearchParams(window.location.search).get("fog") !== "off";

environment.postProcessShaders = [
  {
    shaderDefinitionId: fogGraph.shaderDefinitionId,
    order: 0,
    enabled: fogEnabled,
    parameterOverrides: [
      { parameterId: "color", value: [0xcd / 255, 0xd6 / 255, 0xf4 / 255] },
      { parameterId: "density", value: FOG_DENSITY },
      { parameterId: "heightFalloff", value: FOG_HEIGHT_FALLOFF }
    ]
  }
];

const contentLibrary: ContentLibrarySnapshot = {
  ...createEmptyContentLibrarySnapshot(PROJECT_ID),
  shaderDefinitions: [fogGraph],
  environmentDefinitions: [environment]
};

const region = {
  identity: { id: `${PROJECT_ID}:region`, schema: "RegionDocument", version: 1 },
  environmentBinding: { defaultEnvironmentId: environment.definitionId }
} as unknown as RegionDocument;

engine.setContentLibrary(contentLibrary);
engine.setEnvironment(region, environment.definitionId);

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

const errors: string[] = [];
const consoleError = console.error.bind(console);
console.error = (...parts: unknown[]) => {
  errors.push(parts.map((p) => String(p)).join(" "));
  consoleError(...parts);
};
window.addEventListener("error", (event) => errors.push(String(event.message)));

/** Reads back a small pixel patch and averages it, so a single stray texel
 *  (an edge, a specular dot) can't decide the verdict. */
async function samplePatch(x: number, y: number): Promise<[number, number, number]> {
  const canvas = renderView.renderer?.domElement as HTMLCanvasElement | undefined;
  if (!canvas) return [0, 0, 0];
  const bitmap = await createImageBitmap(canvas);
  const off = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = off.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  const size = 6;
  const px = Math.round((x / canvas.clientWidth) * bitmap.width);
  const py = Math.round((y / canvas.clientHeight) * bitmap.height);
  const data = ctx.getImageData(
    Math.max(0, px - size / 2),
    Math.max(0, py - size / 2),
    size,
    size
  ).data;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i]!;
    g += data[i + 1]!;
    b += data[i + 2]!;
  }
  const n = data.length / 4;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

function projectToScreen(world: THREE.Vector3): { x: number; y: number } {
  const v = world.clone().project(camera);
  const canvas = renderView.renderer?.domElement as HTMLCanvasElement;
  return {
    x: ((v.x + 1) / 2) * canvas.clientWidth,
    y: ((1 - v.y) / 2) * canvas.clientHeight
  };
}

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    const off = renderView.subscribeFrame(() => {
      off();
      resolve();
    });
  });

async function settle(frames: number): Promise<void> {
  for (let i = 0; i < frames; i += 1) await nextFrame();
}

type Sample = { label: string; rgb: number[] };

async function run(): Promise<void> {
  await settle(40);

  const points: Array<{ label: string; x: number; y: number }> = [
    { label: "sky", x: window.innerWidth / 2, y: 40 }
  ];
  for (const distance of GROUND_DISTANCES) {
    const s = projectToScreen(new THREE.Vector3(0, SAMPLE_Y, -distance));
    points.push({ label: `ground@${distance}`, x: s.x, y: s.y });
  }

  const samples: Sample[] = [];
  for (const p of points) samples.push({ label: p.label, rgb: await samplePatch(p.x, p.y) });

  hud.textContent =
    `fog probe -- fog ${fogEnabled ? "ON" : "OFF"} ` +
    `(density ${FOG_DENSITY}, heightFalloff ${FOG_HEIGHT_FALLOFF}, ` +
    `color #${FOG_COLOR.toString(16)})\n` +
    samples.map((s) => `${s.label.padEnd(12)} [${s.rgb.join(", ")}]`).join("\n") +
    (errors.length > 0 ? `\n\nerrors: ${errors.length}` : "");

  Object.defineProperty(globalThis, "__fogProbe", {
    get: () => ({ fogEnabled, samples, errors })
  });
  (globalThis as { __probeReady?: boolean }).__probeReady = true;
}

void run();
