import * as THREE from "three";
import { RenderPipeline, WebGPURenderer } from "three/webgpu";
import { float, mix, pass, vec4 } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import type {
  BloomSettings,
  EnvironmentDefinition,
  SSAOSettings
} from "@sugarmagic/domain";
import type { EnvironmentSceneWarning } from "../environment";

export interface RuntimeRenderGraph {
  readonly pipeline: RenderPipeline | null;
  applyEnvironment: (definition: EnvironmentDefinition | null) => EnvironmentSceneWarning[];
  resize: (width: number, height: number) => void;
  setCamera: (camera: THREE.PerspectiveCamera) => void;
  dispose: () => void;
}

export function createRuntimeRenderGraph(options: {
  renderer: WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  width: number;
  height: number;
}): RuntimeRenderGraph {
  const { renderer, scene } = options;
  let camera = options.camera;
  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode("output");
  const sceneDepth = scenePass.getTextureNode("depth");
  const bloomPass = bloom(sceneColor, 0.4, 0.4, 0.9);
  // GTAO can reconstruct normals from depth when an explicit normal buffer is absent.
  const aoPass = ao(sceneDepth, undefined as never, camera);
  const aoBlend = float(0);

  const warnings: EnvironmentSceneWarning[] = [];
  let pipeline: RenderPipeline | null = null;

  try {
    pipeline = new RenderPipeline(renderer);
    pipeline.outputNode = sceneColor
      .mul(mix(vec4(1), aoPass.getTextureNode(), aoBlend))
      .add(bloomPass);
  } catch (error) {
    warnings.push({
      code: "render-pipeline-fallback",
      message: `Shared WebGPU render graph fell back to direct rendering: ${String(error)}`
    });
    pipeline = null;
  }

  function applyBloom(config: BloomSettings) {
    bloomPass.strength.value = config.enabled ? config.strength : 0;
    bloomPass.radius.value = config.radius;
    bloomPass.threshold.value = config.threshold;
  }

  function applySsao(config: SSAOSettings) {
    aoBlend.value = config.enabled ? 1 : 0;
    aoPass.radius.value = config.kernelRadius / 32;
    aoPass.thickness.value = Math.max(config.minDistance * 100, 0.0001);
    aoPass.distanceFallOff.value = THREE.MathUtils.clamp(
      config.maxDistance * 10,
      0.0001,
      1
    );
  }

  return {
    pipeline,
    applyEnvironment(definition) {
      if (!definition) return warnings;
      applyBloom(definition.atmosphere.bloom);
      applySsao(definition.atmosphere.ssao);
      return warnings;
    },
    resize() {
      // WebGPU TSL post nodes pull the drawing buffer size from the renderer
      // during their own frame update. Avoid forcing an early setSize() before
      // Bloom/GTAO have finished internal setup.
    },
    setCamera(nextCamera) {
      camera = nextCamera;
      scenePass.camera = nextCamera;
    },
    dispose() {
      pipeline?.dispose();
    }
  };
}
