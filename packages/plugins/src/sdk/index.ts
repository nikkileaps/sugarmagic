import {
  envVarNameLooksLikeSecret,
  type DeploymentRequirement,
  type NonSecretAttestation,
  type PluginConfigurationRecord
} from "@sugarmagic/domain";
import type { Plugin as VitePlugin } from "vite";
import type { RuntimePluginDefinition } from "../runtime";
import type { PluginShellContributionDefinition } from "../shell";

export interface PluginManifest {
  pluginId: string;
  displayName: string;
  summary: string;
  capabilityIds: string[];
}

/**
 * Story 46.15 — per-game plugin config key the plugin wants
 * propagated to the Cloud Run gateway as a process env var at
 * deploy time. Pure declarative: plugin code reads the value from
 * its own per-game config slot at runtime (Studio dev) or from
 * `process.env[envVarName]` at runtime (deployed Cloud Run); the
 * declaration here is purely for SugarDeploy's deploy-side
 * propagation step.
 *
 * Validated against three rules at plugin-discovery time:
 *  1. `envVarName` follows `SUGARMAGIC_<PLUGIN_ID_UPPER>_<KEY>`
 *     so it's obvious in `gcloud describe` which plugin owns the
 *     env var.
 *  2. `envVarName` does NOT pattern-match a secret-shaped name
 *     (`_API_KEY` / `_TOKEN` / `_SECRET` / `_PASSWORD` /
 *     `_PRIVATE_KEY`). Real secrets go through `SecretRequirement`
 *     + Secret Manager.
 *  3. `nonSecretAttestation` equals `"safe-to-expose-publicly"`.
 *     Forces a deliberate "yes, non-secret" call from the plugin
 *     author.
 */
export interface GatewayRuntimeConfigKey {
  /** Property name on the plugin's per-game config object. */
  configKey: string;
  /** Env var name the gateway server-side reads. Must follow the
   *  convention SUGARMAGIC_<PLUGIN_ID_UPPER>_<KEY>. */
  envVarName: string;
  /** What it carries and why the gateway needs it. */
  description: string;
  /** Plugin author's explicit "non-secret" attestation; only the
   *  exact string `"safe-to-expose-publicly"` is accepted. */
  nonSecretAttestation: NonSecretAttestation;
}

export interface InstalledPluginDefinition {
  manifest: PluginManifest;
  defaultConfig?: Record<string, unknown>;
  deploymentRequirements?: DeploymentRequirement[];
  /**
   * Story 46.15 — non-secret per-game config keys this plugin
   * wants propagated to the Cloud Run gateway as process env at
   * deploy time. See `GatewayRuntimeConfigKey` for the contract.
   */
  gatewayRuntimeConfigKeys?: GatewayRuntimeConfigKey[];
}

export interface GatewayRuntimeConfigKeyValidationResult {
  ok: boolean;
  reason?: string;
}

/**
 * Story 46.15 — validates a single `GatewayRuntimeConfigKey`
 * declaration against the three contract rules:
 *
 *   1. envVarName matches `SUGARMAGIC_<PLUGIN_ID_UPPER>_<SUFFIX>`.
 *      The plugin-id segment is the plugin's id with non-`[a-z0-9]`
 *      characters stripped and uppercased.
 *   2. envVarName does NOT pattern-match a secret name.
 *   3. nonSecretAttestation equals `"safe-to-expose-publicly"`.
 *
 * Designed to be called eagerly by SugarDeploy's deploy-side env
 * collection step so a misconfigured plugin surfaces clearly at
 * save time. Pure function; no I/O.
 */
export function validateGatewayRuntimeConfigKey(
  pluginId: string,
  key: GatewayRuntimeConfigKey
): GatewayRuntimeConfigKeyValidationResult {
  const normalizedPluginId = pluginId
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const expectedPrefix = `SUGARMAGIC_${normalizedPluginId}_`;
  if (!key.envVarName.startsWith(expectedPrefix)) {
    return {
      ok: false,
      reason: `Plugin "${pluginId}" declared gatewayRuntimeConfigKey envVarName "${key.envVarName}" — expected prefix "${expectedPrefix}". Convention is SUGARMAGIC_<PLUGIN_ID_UPPER>_<SUFFIX> so the plugin owner is obvious in gcloud-describe output.`
    };
  }
  if (envVarNameLooksLikeSecret(key.envVarName)) {
    return {
      ok: false,
      reason: `Plugin "${pluginId}" declared gatewayRuntimeConfigKey envVarName "${key.envVarName}" that pattern-matches a secret (suffixes _API_KEY / _TOKEN / _SECRET / _PASSWORD / _PRIVATE_KEY). Real secrets go through SecretRequirement + Secret Manager. If this value is genuinely non-secret, rename the env var.`
    };
  }
  if (key.nonSecretAttestation !== "safe-to-expose-publicly") {
    return {
      ok: false,
      reason: `Plugin "${pluginId}" declared gatewayRuntimeConfigKey envVarName "${key.envVarName}" without the required nonSecretAttestation: "safe-to-expose-publicly". The required + non-default attestation forces a deliberate non-secret call.`
    };
  }
  if (typeof key.configKey !== "string" || key.configKey.trim().length === 0) {
    return {
      ok: false,
      reason: `Plugin "${pluginId}" declared gatewayRuntimeConfigKey envVarName "${key.envVarName}" without a configKey. configKey names the field on the plugin's per-game config object where the value lives.`
    };
  }
  return { ok: true };
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
