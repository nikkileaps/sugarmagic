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
  /**
   * The scene pass's linear depth node, in world-space view distance.
   * Wired explicitly so authored post-process graphs have a deterministic
   * depth source rather than relying on viewportLinearDepth — which reads
   * from whatever depth texture is currently bound, a fragile dependency
   * that was producing different results between Studio's authoring
   * viewport and the published runtime (fog visible in one, not the other).
   */
  getSceneDepthNode: () => unknown | null;
  setPostProcessOutputNode: (node: unknown | null) => void;
  resize: (width: number, height: number) => void;
  setCamera: (camera: THREE.Camera) => void;
  dispose: () => void;
}

/**
 * Three's WebGPU RenderPipeline does not react to outputNode swaps by itself.
 * Callers must mark the pipeline dirty so the fullscreen quad material gets
 * rebuilt on the next render. Without this, live post-process edits can leave
 * the previous output graph visually stuck until the host remounts.
 */
export function assignRenderPipelineOutputNode(
  pipeline: RenderPipeline,
  node: unknown | null,
  baseOutputNode: unknown
): void {
  pipeline.outputNode = (((node as typeof baseOutputNode | null) ?? baseOutputNode) as never);
  pipeline.needsUpdate = true;
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
  // Explicit depth node from the scene pass. Fog and other depth-based post-
  // process effects read this directly instead of going through
  // viewportLinearDepth, which has been observed to return different values
  // between Studio and the published runtime (same code, same content, same
  // pipeline) because it samples whatever depth texture is currently bound
  // globally rather than the scene pass's own depth attachment.
  const sceneDepthNode = scenePass.getViewZNode().negate();

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
    getSceneDepthNode() {
      return pipeline ? sceneDepthNode : null;
    },
    setPostProcessOutputNode(node) {
      if (!pipeline) {
        return;
      }
      assignRenderPipelineOutputNode(pipeline, node, baseOutputNode);
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
