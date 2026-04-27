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
  // MSAA explicitly off on the scene pass.
  //
  // Why explicit: `pass(scene, camera)` without options inherits
  // samples from `renderer.samples`, and `WebGPURenderer({ antialias:
  // true })` sets `renderer.samples = 4`. Without this `{ samples: 0 }`
  // override the scene pass would silently render at 4× MSAA.
  //
  // Why off: with MSAA on, partially-covered grass pixels average
  // samples-on-blade with samples-on-background-through-inter-blade-
  // gaps. Wind motion shifts blades sub-pixel each frame, so the
  // composition of "blade vs gap" samples changes per frame, producing
  // per-pixel brightness variation. Bloom amplifies that into visible
  // "camera flash" halos on grass tips. Confirmed by isolated test
  // 2026-04-26: this is the only line that needed to change to
  // eliminate the flicker; all the other MSAA / alphaToCoverage /
  // shader-graph tuning we tried was either wrong or made trees worse.
  //
  // Trade-off: scene edges are technically aliased without MSAA. In
  // practice with the current stylized look + camera distances they
  // don't read as jaggy, so we ship without. If aliasing becomes a
  // visible problem later, the tractable upgrade paths are FXAA/SMAA
  // post-process AA (no coverage-variation issue), TAA with a custom
  // per-vertex velocity pass (proper fix; three.js's TRAANode +
  // VelocityNode does NOT capture wind-driven vertex motion → would
  // ghost), or rendering foliage to a buffer that bypasses bloom.
  const scenePass = pass(scene, options.camera, { samples: 0 });
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
