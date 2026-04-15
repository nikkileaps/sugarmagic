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

export function applyPostProcessStack(options: {
  shaderRuntime: ShaderRuntime;
  renderPipeline: RuntimeRenderPipeline;
  contentLibrary: ContentLibrarySnapshot;
  chain: PostProcessShaderBinding[];
}): void {
  const { shaderRuntime, renderPipeline, contentLibrary, chain } = options;
  const bindings = resolveEffectivePostProcessShaderBindings(
    chain
      .filter((binding) => binding.enabled)
      .slice()
      .sort((left, right) => left.order - right.order),
    contentLibrary
  );
  let previousOutputNode = renderPipeline.getBaseOutputNode();

  if (bindings.length === 0) {
    renderPipeline.setPostProcessOutputNode(previousOutputNode);
    return;
  }

  for (const binding of bindings) {
    previousOutputNode = shaderRuntime.applyShader(binding, {
      targetKind: "post-process",
      renderPipeline,
      previousOutputNode
    }) as unknown;
  }

  renderPipeline.setPostProcessOutputNode(previousOutputNode);
}
