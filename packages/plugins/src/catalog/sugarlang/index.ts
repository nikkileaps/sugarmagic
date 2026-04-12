/**
 * packages/plugins/src/catalog/sugarlang/index.ts
 *
 * Purpose: Defines the sugarlang plugin entry point and runtime-plugin factory.
 *
 * Exports:
 *   - createSugarlangPlugin
 *   - pluginDefinition
 *   - buildSugarlangPreviewBootPayloadForSession
 *   - SUGARLANG_PLUGIN_ID
 *   - SUGARLANG_DISPLAY_NAME
 *   - normalizeSugarLangPluginConfig
 *   - resolveSugarLangTargetLanguage
 *
 * Relationships:
 *   - Depends on ./manifest and ./config for the canonical plugin definition.
 *   - Is discovered by packages/plugins/src/builtin/index.ts through the catalog glob.
 *
 * Implements: Proposal 001 §The Substrate (Untouched) / §File Structure
 *
 * Status: active
 */

import {
  createSugarlangPlugin,
  pluginDefinition,
  SUGARLANG_DISPLAY_NAME,
  SUGARLANG_PLUGIN_ID
} from "./manifest";
import { buildSugarlangPreviewBootPayloadForSession } from "./preview-boot";

export { createSugarlangPlugin } from "./manifest";
export {
  normalizeSugarLangPluginConfig,
  resolveSugarLangTargetLanguage
} from "./config";
export { buildSugarlangPreviewBootPayloadForSession } from "./preview-boot";
export {
  pluginDefinition,
  SUGARLANG_DISPLAY_NAME,
  SUGARLANG_PLUGIN_ID
} from "./manifest";
