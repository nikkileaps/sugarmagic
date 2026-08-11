/**
 * packages/plugins/src/catalog/sugarlang/plugin-id.ts
 *
 * Purpose: This plugin's own id, in a module that imports nothing.
 *
 * WHY IT IS NOT IN THE MANIFEST
 *   Runtime code needs the id to namespace its per-account storage, and the
 *   manifest imports the runtime. Reading it from there would close the loop
 *   manifest -> runtime-services -> learner -> manifest. A leaf module has no
 *   such problem, and the manifest re-exports it so callers see one name.
 *
 * Exports:
 *   - SUGARLANG_PLUGIN_ID
 *
 * Status: active
 */

export const SUGARLANG_PLUGIN_ID = "sugarlang";
