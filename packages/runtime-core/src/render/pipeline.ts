import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import type { EnvironmentDefinition } from "@sugarmagic/domain";
import type { EnvironmentSceneWarning } from "../environment";
import { createRuntimeRenderGraph } from "./graph";

export interface RuntimeRenderPipeline {
  applyEnvironment: (definition: EnvironmentDefinition | null) => EnvironmentSceneWarning[];
  render: () => void;
  resize: (width: number, height: number) => void;
  setCamera: (camera: THREE.PerspectiveCamera) => void;
  dispose: () => void;
}

export function createRuntimeRenderPipeline(options: {
  renderer: WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  width: number;
  height: number;
}): RuntimeRenderPipeline {
  const { renderer, scene } = options;
  let camera = options.camera;
  const graph = createRuntimeRenderGraph(options);

  return {
    applyEnvironment(definition) {
      return graph.applyEnvironment(definition);
    },
    render() {
      if (graph.pipeline) {
        graph.pipeline.render();
        return;
      }
      renderer.render(scene, camera);
    },
    resize(width, height) {
      graph.resize(width, height);
    },
    setCamera(nextCamera) {
      camera = nextCamera;
      graph.setCamera(nextCamera);
    },
    dispose() {
      graph.dispose();
    }
  };
}
