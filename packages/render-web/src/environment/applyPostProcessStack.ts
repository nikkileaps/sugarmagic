/**
 * Authored post-process stack application.
 *
 * Owns ordered post-process composition for shared web render hosts. The
 * environment definition remains the authored source of truth; this module
 * resolves the effective chain through runtime-core bindings and applies it in
 * order through ShaderRuntime.
 */

import type { ContentLibrarySnapshot, PostProcessShaderBinding } from "@sugarmagic/domain";
import { resolveEffectivePostProcessShaderBindings } from "@sugarmagic/runtime-core";
import type { ShaderRuntime } from "../ShaderRuntime";
import type { RuntimeRenderPipeline } from "../render";

/**
 * What the last stack application actually did. Exposed for diagnostics
 * because every failure mode here is silent: a null render pipeline, a
 * dropped binding, and a throwing shader all end with the scene rendering
 * normally and no post-processing applied.
 */
export interface PostProcessStackReport {
  /** False when the render graph fell back to direct rendering -- in that
   *  state NOTHING in the stack has any effect, whatever the bindings say. */
  pipelineActive: boolean;
  /** Bindings in the environment, before the enabled filter. */
  chainLength: number;
  /** Bindings that survived the enabled filter and resolved to a shader. */
  resolvedShaderIds: string[];
  /** Shaders that threw while being applied. */
  failedShaderIds: string[];
}

export function applyPostProcessStack(options: {
  shaderRuntime: ShaderRuntime;
  renderPipeline: RuntimeRenderPipeline;
  contentLibrary: ContentLibrarySnapshot;
  chain: PostProcessShaderBinding[];
}): PostProcessStackReport {
  const { shaderRuntime, renderPipeline, contentLibrary, chain } = options;
  const bindings = resolveEffectivePostProcessShaderBindings(
    chain
      .filter((binding) => binding.enabled)
      .slice()
      .sort((left, right) => left.order - right.order),
    contentLibrary
  );
  let previousOutputNode = renderPipeline.getBaseOutputNode();
  // A null base output node means the render graph fell back to direct
  // rendering. Every applyShader below would then no-op internally, so the
  // whole stack is inert -- worth reporting rather than discovering by eye.
  const pipelineActive = previousOutputNode !== null;
  const failedShaderIds: string[] = [];

  if (bindings.length === 0) {
    renderPipeline.setPostProcessOutputNode(previousOutputNode);
    return {
      pipelineActive,
      chainLength: chain.length,
      resolvedShaderIds: [],
      failedShaderIds
    };
  }

  for (const binding of bindings) {
    try {
      previousOutputNode = shaderRuntime.applyShader(binding, {
        targetKind: "post-process",
        renderPipeline,
        previousOutputNode
      }) as unknown;
    } catch (error) {
      failedShaderIds.push(binding.shaderDefinitionId);
      console.error(
        `[render-web] Failed to apply post-process shader "${binding.shaderDefinitionId}".`,
        error
      );
    }
  }

  renderPipeline.setPostProcessOutputNode(previousOutputNode);

  return {
    pipelineActive,
    chainLength: chain.length,
    resolvedShaderIds: bindings.map((binding) => binding.shaderDefinitionId),
    failedShaderIds
  };
}
