/**
 * Shared render pipeline wrapper.
 *
 * Owns the stable host-facing API for the shared WebGPU render graph used by
 * Studio and the published web runtime.
 */

import type * as THREE from "three";
import type { WebGPURenderer } from "three/webgpu";
import type { EnvironmentDefinition } from "@sugarmagic/domain";
import type { EnvironmentSceneWarning } from "@sugarmagic/runtime-core";
import { createRuntimeRenderGraph } from "./RuntimeRenderGraph";

export interface RuntimeRenderPipeline {
  applyEnvironment: (definition: EnvironmentDefinition | null) => EnvironmentSceneWarning[];
  getBaseOutputNode: () => unknown | null;
  /** Explicit scene-depth node from the scenePass. See RuntimeRenderGraph.getSceneDepthNode. */
  getSceneDepthNode: () => unknown | null;
  setPostProcessOutputNode: (node: unknown | null) => void;
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
    getBaseOutputNode() {
      return graph.getBaseOutputNode();
    },
    getSceneDepthNode() {
      return graph.getSceneDepthNode();
    },
    setPostProcessOutputNode(node) {
      graph.setPostProcessOutputNode(node);
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
