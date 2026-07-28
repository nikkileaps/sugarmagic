/**
 * Post-process pipeline probe. QA-only, never shipped.
 *
 * Answers one question with no Studio, no project, and no file picker: does
 * the authored post-process stack actually reach the GPU in this runtime?
 *
 * It builds a real `createRenderView` (the same code path the game uses),
 * feeds it a real environment whose post-process chain contains the built-in
 * bloom shader cranked to maximum, then reports what the stack application
 * actually did and screenshots the result. A high-contrast scene is used on
 * purpose -- bright emissive spheres against a black background -- because
 * bloom is invisible on the flat, uniformly-lit frame that made this
 * ambiguous in the first place.
 *
 * Run:  pnpm --filter @sugarmagic/perf-harness probe:postprocess
 */

import * as THREE from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { createRenderView, createWebRenderEngine } from "@sugarmagic/render-web";
import {
  createDefaultBloomPostProcessShaderGraph,
  createDefaultEnvironmentDefinition,
  createEmptyContentLibrarySnapshot,
  type ContentLibrarySnapshot,
  type RegionDocument
} from "@sugarmagic/domain";

const container = document.getElementById("view") as HTMLElement;
const hud = document.getElementById("hud") as HTMLElement;

const PROJECT_ID = "probe";
const engine = createWebRenderEngine({ compileProfile: "authoring-preview" });

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05050a);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
camera.position.set(0, 3, 14);
camera.lookAt(0, 0, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.15));

// Deliberately blown-out emitters next to near-black gaps: the contrast bloom
// needs in order to be unmistakable.
for (let i = 0; i < 5; i += 1) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 32, 16),
    new MeshStandardNodeMaterial({
      color: new THREE.Color(4, 3.4, 2.2),
      roughness: 1,
      metalness: 0
    })
  );
  mesh.position.set((i - 2) * 3.2, 0, 0);
  scene.add(mesh);
}

// --- Environment with a maxed bloom binding -------------------------------

const bloomGraph = createDefaultBloomPostProcessShaderGraph(PROJECT_ID);
const environment = createDefaultEnvironmentDefinition(PROJECT_ID, {
  preset: "golden_hour"
});
environment.postProcessShaders = [
  {
    shaderDefinitionId: bloomGraph.shaderDefinitionId,
    order: 10,
    enabled: true,
    parameterOverrides: [
      { parameterId: "strength", value: 3 },
      { parameterId: "radius", value: 1 },
      { parameterId: "threshold", value: 0 }
    ]
  }
];

const contentLibrary: ContentLibrarySnapshot = {
  ...createEmptyContentLibrarySnapshot(PROJECT_ID),
  shaderDefinitions: [bloomGraph],
  environmentDefinitions: [environment]
};

// Minimal region pointing at the environment; the engine resolves through it.
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

function diagnose(): Record<string, unknown> {
  const report = renderView.lastPostProcessReport;
  return {
    hasRenderer: Boolean(renderView.renderer),
    hasRenderPipeline: Boolean(renderView.renderPipeline),
    baseOutputNodePresent: Boolean(renderView.renderPipeline?.getBaseOutputNode()),
    report,
    errors
  };
}

Object.defineProperty(globalThis, "__probeDiag", { get: () => diagnose() });

let frame = 0;
renderView.subscribeFrame(() => {
  frame += 1;
  if (frame === 20) {
    const diag = diagnose();
    const report = diag.report as
      | { pipelineActive: boolean; chainLength: number; resolvedShaderIds: string[]; failedShaderIds: string[] }
      | null;
    hud.textContent =
      "post-process probe -- bloom strength 3, radius 1, threshold 0\n" +
      `renderer=${diag.hasRenderer} pipeline=${diag.hasRenderPipeline} ` +
      `baseOutputNode=${diag.baseOutputNodePresent}\n` +
      (report
        ? `chain=${report.chainLength} resolved=[${report.resolvedShaderIds.join(",")}] ` +
          `failed=[${report.failedShaderIds.join(",")}] pipelineActive=${report.pipelineActive}`
        : "report=NULL (environment never applied)") +
      (errors.length > 0 ? `\nerrors: ${errors.length}` : "");
    (globalThis as { __probeReady?: boolean }).__probeReady = true;
  }
});
