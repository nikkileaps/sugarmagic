/**
 * packages/plugins/src/catalog/sugarlang/manifest.ts
 *
 * Purpose: Declares the discovered-plugin manifest and runtime middleware ownership for sugarlang.
 *
 * Exports:
 *   - SUGARLANG_PLUGIN_ID
 *   - SUGARLANG_DISPLAY_NAME
 *   - createSugarlangPlugin
 *   - SUGARLANG_MIDDLEWARE_FACTORIES
 *   - pluginDefinition
 *
 * Relationships:
 *   - Depends on ./config, ./runtime/runtime-services, and ./ui/shell/contributions for plugin assembly.
 *   - Is re-exported by ./index as the canonical plugin definition for discovery.
 *
 * Implements: Proposal 001 §The Substrate (Untouched) / §End-to-End Turn Flow / §File Structure
 *
 * Status: active
 */

import type { DiscoveredPluginDefinition } from "../../sdk";
import type { RuntimePluginFactoryContext } from "../../runtime";
import type {
  ConversationMiddlewareContribution,
  RuntimePluginInstance
} from "@sugarmagic/runtime-core";
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
import {
  SUGARLANG_BLACKBOARD_FACT_DEFINITIONS
} from "./runtime/learner/fact-definitions";
import { createNoOpSugarlangLogger } from "./runtime/middlewares/shared";
import { SugarlangRuntimeServices } from "./runtime/runtime-services";
import { resolveSugarlangTelemetrySink } from "./runtime/telemetry/telemetry";
import {
  sugarlangShellContributionDefinition,
  setSugarlangChunkExtractionEnabled
} from "./ui/shell/contributions";

export const SUGARLANG_PLUGIN_ID = "sugarlang";
export const SUGARLANG_DISPLAY_NAME = "Sugarlang";

export function createSugarlangPlugin(
  context: RuntimePluginFactoryContext
): RuntimePluginInstance {
  const config = normalizeSugarLangPluginConfig(
    context.configuration.config,
    context.environment
  );

  // Wire the chunk extraction toggle so Studio shell components respect it.
  setSugarlangChunkExtractionEnabled(config.chunkExtraction.enabled);
  const logger = config.debugLogging
    ? {
        debug(message: string, payload?: Record<string, unknown>) {
          console.debug("[sugarlang]", message, payload ?? {});
        },
        info(message: string, payload?: Record<string, unknown>) {
          console.info("[sugarlang]", message, payload ?? {});
        },
        warn(message: string, payload?: Record<string, unknown>) {
          console.warn("[sugarlang]", message, payload ?? {});
        },
        error(message: string, payload?: Record<string, unknown>) {
          console.error("[sugarlang]", message, payload ?? {});
        }
      }
    : createNoOpSugarlangLogger();
  const telemetry = resolveSugarlangTelemetrySink(context.boot);
  const services = new SugarlangRuntimeServices({
    config,
    environment: context.environment,
    logger,
    telemetry
  });
  const contributions: ConversationMiddlewareContribution[] =
    SUGARLANG_MIDDLEWARE_FACTORIES.map((factory) => {
      const middleware = factory({ services, logger, telemetry });
      return {
        pluginId: context.configuration.pluginId,
        contributionId: `sugarlang.middleware.${middleware.middlewareId}`,
        kind: "conversation.middleware",
        displayName: middleware.displayName,
        priority: middleware.priority,
        payload: {
          middlewareId: middleware.middlewareId,
          summary: `Sugarlang ${middleware.stage} middleware`,
          stage: middleware.stage,
          status: "ready",
          middleware
        }
      };
    });

  return {
    pluginId: context.configuration.pluginId,
    displayName: SUGARLANG_DISPLAY_NAME,
    contributions,
    blackboardFactDefinitions: SUGARLANG_BLACKBOARD_FACT_DEFINITIONS,
    async init(runtimeContext) {
      services.bindRuntime(runtimeContext);
      const lexicons = extractSugarlangPreviewBootLexicons(
        runtimeContext.pluginBootPayloads?.[SUGARLANG_PLUGIN_ID]
      );
      await seedSugarlangRuntimeCompileCache(lexicons);
      services.seedPreviewLexicons(
        runtimeContext.pluginBootPayloads?.[SUGARLANG_PLUGIN_ID]
      );
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
      "Adaptive language-learning middleware pipeline for Sugarmagic conversations.",
    capabilityIds: ["conversation.middleware", "design.workspace"]
  },
  runtime: {
    createRuntimePlugin: createSugarlangPlugin
  },
  shell: sugarlangShellContributionDefinition
};
