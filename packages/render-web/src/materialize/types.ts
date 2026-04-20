/**
 * Shared ShaderRuntime materialization contracts.
 *
 * These types exist so the ShaderRuntime can keep one materialization
 * implementation while splitting large op families into focused internal
 * modules. This is an internal render-web boundary, not a second runtime.
 */

import type { ShaderIROp } from "@sugarmagic/runtime-core";

export interface EffectNodeCacheEntry {
  node: unknown;
  kind: "bloom";
}

export type MaterializeInputResolver = (portId: string) => unknown;

export interface EffectMaterializeContext {
  effectNodes: Map<string, EffectNodeCacheEntry>;
}

export type MaterializeOpResult =
  | {
      handled: true;
      value: unknown;
    }
  | {
      handled: false;
    };

export interface MaterializeOpRequest {
  op: ShaderIROp;
  input: MaterializeInputResolver;
}
