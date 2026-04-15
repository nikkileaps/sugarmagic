/**
 * Shared WebGPU render graph.
 *
 * Owns the shared scene pass and post-process output composition for Studio
 * and published-web hosts. Hardcoded bloom is intentionally absent; authored
 * post-process bindings are the single source of truth for post effects.
 */

import type * as THREE from "three";
import { RenderPipeline, type WebGPURenderer } from "three/webgpu";
import { pass } from "three/tsl";
import type { EnvironmentDefinition } from "@sugarmagic/domain";
import type { EnvironmentSceneWarning } from "@sugarmagic/runtime-core";

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
  const scenePass = pass(scene, options.camera);
  const baseOutputNode = scenePass.getTextureNode("output");

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

  return {
    pipeline,
    applyEnvironment(definition) {
      if (!definition) {
        return warnings;
      }
      if (definition.atmosphere.ssao.enabled && !ssaoFallbackWarned) {
        warnings.push({
          code: "render-pipeline-fallback",
          message:
            "Shared WebGPU render graph currently disables SSAO/GTAO because the Three.js GTAO node is unstable in this runtime path."
        });
        ssaoFallbackWarned = true;
      }
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
      // The TSL graph pulls the drawing buffer size from the renderer.
    },
    setCamera(nextCamera) {
      scenePass.camera = nextCamera;
    },
    dispose() {
      pipeline?.dispose();
    }
  };
}
