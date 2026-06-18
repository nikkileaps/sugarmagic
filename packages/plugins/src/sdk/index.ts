import type { DeploymentRequirement, PluginConfigurationRecord } from "@sugarmagic/domain";
import type { Plugin as VitePlugin } from "vite";
import type { RuntimePluginDefinition } from "../runtime";
import type { PluginShellContributionDefinition } from "../shell";

export interface PluginManifest {
  pluginId: string;
  displayName: string;
  summary: string;
  capabilityIds: string[];
}

export interface InstalledPluginDefinition {
  manifest: PluginManifest;
  defaultConfig?: Record<string, unknown>;
  deploymentRequirements?: DeploymentRequirement[];
}

/**
 * Contribution surface for plugins that need to mount Vite dev-server
 * middleware on the Studio host — typically because the plugin shells out
 * to host binaries (gcloud, terraform, git, docker, ssh) that the browser
 * can't spawn directly. The factory returns Vite plugins that the registry
 * spreads into Studio's `plugins:` array, so each contribution can mount
 * its own server middlewares via `configureServer`. Same shape as the
 * existing `runtime` and `shell` contributions: optional, typed, discovered.
 *
 * IMPORTANT — async return is the path plugins should use. The
 * `pluginDefinition` itself is loaded in BOTH the browser (Studio runtime)
 * and Node (Vite dev server) contexts; statically importing the middleware
 * module from the definition forces the browser to bundle node-only deps
 * like `node:child_process` and crashes the client. The convention is for
 * `createMiddleware` to be `async () => { const mod = await import(...); return mod.createXxx(); }`,
 * which defers the module load to the server-side registry call.
 */
export interface PluginHostMiddlewareDefinition {
  createMiddleware(): VitePlugin[] | Promise<VitePlugin[]>;
}

export interface DiscoveredPluginDefinition extends InstalledPluginDefinition {
  runtime?: RuntimePluginDefinition;
  shell?: PluginShellContributionDefinition;
  hostMiddleware?: PluginHostMiddlewareDefinition;
}

export interface PluginResolutionContext {
  configuration: PluginConfigurationRecord;
}
