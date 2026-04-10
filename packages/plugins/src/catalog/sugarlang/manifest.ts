/**
 * packages/plugins/src/catalog/sugarlang/manifest.ts
 *
 * Purpose: Declares the discovered-plugin manifest and skeleton contribution ownership for sugarlang.
 *
 * Exports:
 *   - SUGARLANG_PLUGIN_ID
 *   - SUGARLANG_DISPLAY_NAME
 *   - createSugarlangPlugin
 *   - SUGARLANG_MIDDLEWARE_FACTORIES
 *   - pluginDefinition
 *
 * Relationships:
 *   - Depends on ./config and ./ui/shell/contributions for the skeleton plugin surfaces.
 *   - Is re-exported by ./index as the canonical plugin definition for discovery.
 *
 * Implements: Proposal 001 §The Substrate (Untouched) / §End-to-End Turn Flow / §File Structure
 *
 * Status: skeleton (no implementation yet; see Epic 10 and Epic 12)
 */

import type { DiscoveredPluginDefinition } from "../../sdk";
import type { RuntimePluginFactoryContext } from "../../runtime";
import type { RuntimePluginInstance } from "@sugarmagic/runtime-core";
import { normalizeSugarLangPluginConfig } from "./config";
import {
  createSugarLangContextMiddleware
} from "./runtime/middlewares/sugar-lang-context-middleware";
import {
  createSugarLangDirectorMiddleware
} from "./runtime/middlewares/sugar-lang-director-middleware";
import {
  createSugarLangObserveMiddleware
} from "./runtime/middlewares/sugar-lang-observe-middleware";
import {
  createSugarLangVerifyMiddleware
} from "./runtime/middlewares/sugar-lang-verify-middleware";
import {
  extractSugarlangPreviewBootLexicons
} from "./runtime/compile/preview-boot";
import {
  seedSugarlangRuntimeCompileCache
} from "./runtime/compile/runtime-cache-state";
import { sugarlangShellContributionDefinition } from "./ui/shell/contributions";

export const SUGARLANG_PLUGIN_ID = "sugarlang";
export const SUGARLANG_DISPLAY_NAME = "Sugarlang";

export function createSugarlangPlugin(
  context: RuntimePluginFactoryContext
): RuntimePluginInstance {
  normalizeSugarLangPluginConfig(context.configuration.config, context.environment);

  return {
    pluginId: context.configuration.pluginId,
    displayName: SUGARLANG_DISPLAY_NAME,
    contributions: [],
    async init(runtimeContext) {
      const lexicons = extractSugarlangPreviewBootLexicons(
        runtimeContext.pluginBootPayloads?.[SUGARLANG_PLUGIN_ID]
      );
      await seedSugarlangRuntimeCompileCache(lexicons);
    },
    dispose() {
      return undefined;
    },
    serializeState: () => ({ enabled: context.configuration.enabled })
  };
}

export const SUGARLANG_MIDDLEWARE_FACTORIES = [
  createSugarLangContextMiddleware,
  createSugarLangDirectorMiddleware,
  createSugarLangVerifyMiddleware,
  createSugarLangObserveMiddleware
] as const;

export const pluginDefinition: DiscoveredPluginDefinition = {
  manifest: {
    pluginId: SUGARLANG_PLUGIN_ID,
    displayName: SUGARLANG_DISPLAY_NAME,
    summary:
      "Adaptive language-learning plugin skeleton for Sugarmagic conversations.",
    capabilityIds: []
  },
  runtime: {
    createRuntimePlugin: createSugarlangPlugin
  },
  shell: sugarlangShellContributionDefinition
};
