import * as THREE from "three";
import { RenderPipeline, WebGPURenderer } from "three/webgpu";
import { pass } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import type {
  BloomSettings,
  EnvironmentDefinition,
  SSAOSettings
} from "@sugarmagic/domain";
import type { EnvironmentSceneWarning } from "../environment";

export interface RuntimeRenderGraph {
  readonly pipeline: RenderPipeline | null;
  applyEnvironment: (definition: EnvironmentDefinition | null) => EnvironmentSceneWarning[];
  getBaseOutputNode: () => unknown | null;
  setPostProcessOutputNode: (node: unknown | null) => void;
  resize: (width: number, height: number) => void;
  setCamera: (camera: THREE.Camera) => void;
  dispose: () => void;
}

export function createRuntimeRenderGraph(options: {
  renderer: WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  width: number;
  height: number;
}): RuntimeRenderGraph {
  const { renderer, scene } = options;
  let camera = options.camera;
  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode("output");
  const bloomPass = bloom(sceneColor, 0.4, 0.4, 0.9);
  const baseOutputNode = sceneColor.add(bloomPass);

  const warnings: EnvironmentSceneWarning[] = [];
  let pipeline: RenderPipeline | null = null;
  let ssaoFallbackWarned = false;

  try {
    pipeline = new RenderPipeline(renderer);
    pipeline.outputNode = baseOutputNode;
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
    if (!config.enabled || ssaoFallbackWarned) {
      return;
    }

    warnings.push({
      code: "render-pipeline-fallback",
      message:
        "Shared WebGPU render graph currently disables SSAO/GTAO because the Three.js GTAO node is unstable in this runtime path."
    });
    ssaoFallbackWarned = true;
  }

  return {
    pipeline,
    applyEnvironment(definition) {
      if (!definition) return warnings;
      applyBloom(definition.atmosphere.bloom);
      applySsao(definition.atmosphere.ssao);
      return warnings;
    },
    getBaseOutputNode() {
      return pipeline ? baseOutputNode : null;
    },
    setPostProcessOutputNode(node) {
      if (!pipeline) {
        return;
      }
      pipeline.outputNode = (node as typeof baseOutputNode | null) ?? baseOutputNode;
    },
    resize() {
      // WebGPU TSL post nodes pull the drawing buffer size from the renderer
      // during their own frame update. Avoid forcing an early setSize() before
      // post nodes have finished internal setup.
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
