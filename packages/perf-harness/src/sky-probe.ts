/**
 * Sky probe. QA-only, never shipped.
 *
 * Renders the REAL `buildSkyMaterial()` from @sugarmagic/render-web on an
 * actual GPU, with the three-stop gradient and the cloud band both enabled --
 * the two paths that are OFF by default in authored content and therefore
 * invisible to any "existing project still renders" check. A TSL authoring
 * mistake here surfaces as a black or broken dome, which is exactly what this
 * catches before it reaches a Studio session.
 *
 * Camera sits inside the dome looking at the horizon, matching how the sky is
 * actually seen in game.
 *
 * Run:  pnpm --filter @sugarmagic/perf-harness probe:sky   (screenshots it)
 */

import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import { buildSkyMaterial } from "@sugarmagic/render-web";
import {
  DEFAULT_SKY_SETTINGS,
  createDefaultEnvironmentDefinition,
  type EnvironmentDefinition,
  type SkySettings
} from "@sugarmagic/domain";

const container = document.getElementById("view") as HTMLElement;
const hud = document.getElementById("hud") as HTMLElement;

const renderer = new WebGPURenderer({ antialias: true });
const width = container.clientWidth || window.innerWidth;
const height = container.clientHeight || window.innerHeight;
renderer.setSize(width, height);
renderer.setClearColor(0x000000, 1);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
// Inside the dome, angled DOWN so one frame covers the overhead band, the
// horizon, and the deck below -- the cliff-edge view an isometric camera
// actually produces, where the underside of the dome is on screen.
camera.position.set(0, 0, 0);
camera.lookAt(0, -0.55, -1);

/** Sunset key-art values: violet zenith -> pink midband -> warm horizon. */
const SUNSET_SKY: SkySettings = {
  ...DEFAULT_SKY_SETTINGS,
  enabled: true,
  topColor: 0x6e5a9e,
  bottomColor: 0xffdca8,
  gradientMidEnabled: true,
  gradientMidColor: 0xe8a5b8,
  gradientMidPosition: 0.35,
  horizonBlend: 0.55,
  gradientExponent: 1.2,
  saturation: 1.1,
  cloudsEnabled: true,
  cloudColor: 0xfff2e0,
  cloudCoverage: 0.5,
  cloudOpacity: 0.7,
  cloudSoftness: 0.22,
  cloudScale: 2.2,
  cloudSpeed: 0.25,
  cloudDirectionDegrees: 18,
  undercastEnabled: true,
  undercastColor: 0xffe8cc,
  undercastShadowColor: 0xc98fa8,
  undercastCoverage: 0.62,
  undercastScale: 1.6,
  undercastOpacity: 0.95
};

// `--preset` renders the golden_hour preset exactly as authoring produces it,
// so preset retunes are verified against the same GPU path as hand-set values.
const usePreset = new URLSearchParams(window.location.search).has("preset");
const base = createDefaultEnvironmentDefinition("probe", {
  preset: usePreset ? "golden_hour" : "default"
});
const definition: EnvironmentDefinition = usePreset
  ? base
  : { ...base, atmosphere: { ...base.atmosphere, sky: SUNSET_SKY } };

const dome = new THREE.Mesh(
  new THREE.SphereGeometry(250, 48, 24),
  buildSkyMaterial(definition)
);
dome.renderOrder = -1000;
scene.add(dome);

const rendered = definition.atmosphere.sky;
const hex = (value: number) => `#${value.toString(16).padStart(6, "0")}`;
hud.textContent =
  `sky probe -- ${usePreset ? "golden_hour PRESET" : "hand-set sunset"}\n` +
  `gradient: ${hex(rendered.bottomColor)}` +
  (rendered.gradientMidEnabled
    ? ` -> ${hex(rendered.gradientMidColor)} @${rendered.gradientMidPosition}`
    : "") +
  ` -> ${hex(rendered.topColor)}\n` +
  (rendered.cloudsEnabled
    ? `clouds: ON (coverage ${rendered.cloudCoverage}, scale ${rendered.cloudScale}, wind ${rendered.cloudDirectionDegrees}deg)`
    : "clouds: off") +
  (rendered.undercastEnabled
    ? `\nundercast: ON (coverage ${rendered.undercastCoverage}, scale ${rendered.undercastScale})`
    : "\nundercast: off");

// A TSL authoring error usually surfaces as a console error at material
// compile rather than a thrown exception, so the driver asserts on this too --
// a dome that renders black would otherwise look like a "successful" capture.
const errors: string[] = [];
const consoleError = console.error.bind(console);
console.error = (...parts: unknown[]) => {
  errors.push(parts.map((part) => String(part)).join(" "));
  consoleError(...parts);
};
window.addEventListener("error", (event) => errors.push(String(event.message)));
Object.defineProperty(globalThis, "__skyProbeErrors", { get: () => errors });

let frame = 0;
renderer.setAnimationLoop(() => {
  frame += 1;
  // Slow yaw so a still frame shows cloud variation across the dome rather
  // than whatever single patch happens to sit in front of the camera.
  camera.rotation.y = Math.sin(frame * 0.002) * 0.3;
  renderer.render(scene, camera);
  if (frame === 8) {
    (globalThis as { __skyProbeReady?: boolean }).__skyProbeReady = true;
  }
});
