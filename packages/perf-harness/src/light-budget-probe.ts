/**
 * Light budget probe. QA-only, never shipped.
 *
 * Answers one question with a number instead of a guess: how many placed
 * lights can a region carry before the frame gets slower, on real hardware.
 *
 * WHY IT HAS TO BE MEASURED. three.js does no light culling -- every light in
 * the scene is evaluated by every lit pixel, however far away it is -- so the
 * cost of a light is paid by the whole screen and scales with how much lit
 * surface is on it. That makes the knee a property of the machine and the
 * shading, not something anyone can reason out from the light count alone.
 *
 * The scene is deliberately unkind: a floor and a field of boxes shaded with
 * the same `MeshStandardNodeMaterial` region content uses, filling the frame,
 * so every added light costs the most it can. A number measured here is a
 * floor for what a real region can afford, which is the safe direction for a
 * warning threshold to be wrong in.
 *
 * Frames are paced by the display, so anything comfortably inside budget reads
 * as one refresh interval. The knee is where the number climbs off that floor:
 * that is the moment a light stops being free and starts costing the player
 * frames.
 *
 * Run:  pnpm --filter @sugarmagic/perf-harness probe:light-budget
 */

import * as THREE from "three";
import { MeshStandardNodeMaterial, WebGPURenderer } from "three/webgpu";

const container = document.getElementById("view") as HTMLElement;
const hud = document.getElementById("hud") as HTMLElement;

/**
 * Light counts to walk, low to high. The knee is wherever the ms per frame
 * stops being flat.
 *
 * Overridable as `?counts=16,18,20,22` so a coarse sweep can be followed by a
 * fine one around whatever it found, without editing this file.
 */
const LIGHT_COUNTS = (() => {
  const requested = new URLSearchParams(location.search).get("counts");
  if (!requested) return [0, 1, 2, 4, 8, 16, 24, 32, 48, 64];
  const parsed = requested
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value >= 0);
  if (parsed.length === 0)
    throw new Error(`[light-budget] bad counts: ${requested}`);
  return parsed;
})();

/** Frames to throw away at each step, so a shader recompile is not measured
 *  as if it were the steady-state cost. Adding a light recompiles every
 *  material, which is a one-off and belongs in nobody's per-frame budget. */
const WARMUP_FRAMES = 30;

/** Frames measured at each step. The median of these is the answer; a mean
 *  would let one scheduling hiccup decide the result. */
const MEASURED_FRAMES = 90;

const renderer = new WebGPURenderer({ antialias: true });
const width = container.clientWidth || window.innerWidth;
const height = container.clientHeight || window.innerHeight;
renderer.setSize(width, height);
// A light is paid for by every lit pixel, so measuring at the panel's real
// pixel count rather than at CSS size is what makes the cost visible at all.
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.setClearColor(0x101014, 1);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 500);
camera.position.set(0, 14, 26);
camera.lookAt(0, 0, 0);

// A dim ambient so nothing is pure black with zero lights: the zero-light row
// has to be a real frame, not an early-out.
scene.add(new THREE.AmbientLight(0xffffff, 0.05));

const FIELD = 40;

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(FIELD * 2, FIELD * 2),
  new MeshStandardNodeMaterial({ color: 0x8a8177, roughness: 0.9 })
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

// Boxes, not one big plane: more lit surface at varying angles, which is what
// a region full of props actually gives a light to hit.
for (let x = -FIELD; x <= FIELD; x += 5) {
  for (let z = -FIELD; z <= FIELD; z += 5) {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2 + ((x + z) % 3), 2),
      new MeshStandardNodeMaterial({ color: 0xc9c4bd, roughness: 0.7 })
    );
    box.position.set(x, 1, z);
    scene.add(box);
  }
}

/** Lights spread over the field, built once and added or removed per step. */
const lights = Array.from({ length: Math.max(...LIGHT_COUNTS) }, (_, index) => {
  const light = new THREE.PointLight(0xffd9a0, 8, 6, 2);
  const angle = index * 2.399;
  const radius = FIELD * Math.sqrt(index / Math.max(...LIGHT_COUNTS));
  light.position.set(Math.cos(angle) * radius, 2.5, Math.sin(angle) * radius);
  light.castShadow = false;
  return light;
});

function setLightCount(count: number): void {
  for (const light of lights) scene.remove(light);
  for (let index = 0; index < count; index += 1) scene.add(lights[index]!);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

/**
 * Time between presented frames, not time spent submitting one.
 *
 * `renderAsync` resolves when the work is HANDED TO the GPU, so timing around
 * it reports a flat sub-millisecond number no matter how much shading is
 * happening -- a measurement that says every light is free. Waiting for the
 * next animation frame instead means the browser has actually presented the
 * previous one, so what is measured is the frame the player would see.
 */
function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function renderOnce(): Promise<number> {
  const started = await nextFrame();
  await renderer.renderAsync(scene, camera);
  const presented = await nextFrame();
  return presented - started;
}

export interface LightBudgetRow {
  lights: number;
  medianMs: number;
  worstMs: number;
}

async function measureAt(count: number): Promise<LightBudgetRow> {
  setLightCount(count);
  for (let frame = 0; frame < WARMUP_FRAMES; frame += 1) await renderOnce();
  const samples: number[] = [];
  for (let frame = 0; frame < MEASURED_FRAMES; frame += 1) {
    samples.push(await renderOnce());
  }
  return {
    lights: count,
    medianMs: Number(median(samples).toFixed(3)),
    worstMs: Number(Math.max(...samples).toFixed(3))
  };
}

async function run(): Promise<{ rows: LightBudgetRow[]; table: string }> {
  const rows: LightBudgetRow[] = [];
  for (const count of LIGHT_COUNTS) {
    hud.textContent = `measuring ${count} lights...`;
    rows.push(await measureAt(count));
  }
  const baseline = rows[0]!.medianMs;
  const table = [
    "lights  median ms  worst ms  vs 0 lights",
    ...rows.map(
      (row) =>
        `${String(row.lights).padStart(6)}  ${String(row.medianMs).padStart(9)}  ${String(
          row.worstMs
        ).padStart(8)}  ${(row.medianMs / baseline).toFixed(2)}x`
    )
  ].join("\n");
  hud.textContent = table;
  return { rows, table };
}

declare global {
  // eslint-disable-next-line no-var
  var __smLightBudget:
    | (() => Promise<{
        rows: LightBudgetRow[];
        table: string;
      }>)
    | undefined;
}

globalThis.__smLightBudget = run;
hud.textContent = "ready";
