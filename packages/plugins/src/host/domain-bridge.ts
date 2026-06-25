// Domain helpers re-exported via relative path so the host-middleware
// surface (which is reachable from Studio's vite.config.ts at Vite's
// config-load phase) doesn't transit through the `@sugarmagic/domain`
// package alias. The alias gets externalized during esbuild's config
// bundle and Node fails to resolve the .ts entrypoint at runtime. The
// dependency direction is identical to importing via the alias — plugins
// → domain is already declared in the workspace boundary allowlist —
// only the import syntax differs. See 45.4.6 for context.
//
// Type re-exports are unchanged from the alias path; esbuild erases type
// imports during bundling so they never externalize either way.

export { normalizeDeploymentSettings } from "../../../domain/src/deployment/index";
export { normalizeGameProject } from "../../../domain/src/game-project/index";
export type { GameProject } from "../../../domain/src/game-project/index";
