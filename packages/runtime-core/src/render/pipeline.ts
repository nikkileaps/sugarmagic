import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import type { EnvironmentDefinition } from "@sugarmagic/domain";
import type { EnvironmentSceneWarning } from "../environment";
import { createRuntimeRenderGraph } from "./graph";

export interface RuntimeRenderPipeline {
  applyEnvironment: (definition: EnvironmentDefinition | null) => EnvironmentSceneWarning[];
  render: () => void;
  resize: (width: number, height: number) => void;
  setCamera: (camera: THREE.Camera) => void;
  dispose: () => void;
}

export function createRuntimeRenderPipeline(options: {
  renderer: WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  width: number;
  height: number;
}): RuntimeRenderPipeline {
  const graph = createRuntimeRenderGraph(options);

  return {
    applyEnvironment(definition) {
      return graph.applyEnvironment(definition);
    },
    render() {
      if (!graph.pipeline) {
        throw new Error(
          "WebGPU render pipeline is not available. Sugarmagic requires WebGPU support."
        );
      }
      graph.pipeline.render();
    },
    resize(width, height) {
      graph.resize(width, height);
    },
    setCamera(nextCamera) {
      graph.setCamera(nextCamera);
    },
    dispose() {
      graph.dispose();
    }
  };
}
