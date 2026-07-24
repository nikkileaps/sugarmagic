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
  /**
   * Story 46.16 — declarative schema for the plugin's per-game
   * settings panel. When a plugin contributes a `designWorkspace`
   * with this schema set, Studio auto-renders the panel from the
   * schema. Plugins needing custom UI (lore actions, embedded
   * inspectors, etc.) override the auto-mount by shipping a
   * hand-written `apps/studio/src/plugins/catalog/<id>/index.tsx`,
   * which can still embed `<PluginSchemaSettingsPanel>` to keep
   * field rendering schema-driven where appropriate.
   *
   * Cross-references `gatewayRuntimeConfigKeys`: every entry's
   * `configKey` MUST appear as a schema field. The cross-reference
   * check lives in `validatePluginSettingsSchema` so plugin
   * authors can't declare a runtime-config value without a UI
   * surface for it.
   *
   * See `PluginSettingsSchemaField` for field shape.
   */
  pluginSettingsSchema?: PluginSettingsSchemaField[];
}

/**
 * Story 46.16 — one entry in a plugin's settings schema. Each
 * entry declares a single per-game config field plus the metadata
 * Studio's auto-renderer needs to render it. The schema is the
 * public contract any plugin (bundled or future third-party) uses
 * to surface its config in Studio without writing UI code.
 *
 * `type`:
 *   - `"text"`   -> Mantine TextInput, value is `string`
 *   - `"select"` -> Mantine Select, value is `string`; `options`
 *                   carries `{ value, label }[]`
 *   - `"number"` -> Mantine NumberInput, value is `number`;
 *                   honors optional `min` / `max`
 *   - `"boolean"`-> Mantine Switch, value is `boolean`
 *
 * `showWhen` makes a field conditional on another field's value
 * (e.g. SugarAgent's `loreLocalPath` only renders when
 * `loreSourceKind === "local"`). The validator checks that the
 * `configKey` referenced by `showWhen` exists in the same schema.
 *
 * `default` is the value the per-game config falls back to when
 * the schema field has never been touched. Plugins should also
 * carry the default in their `defaultConfig` for parity at
 * project-creation time; the schema default is what the renderer
 * uses for fresh fields after a schema migration.
 */
export type PluginSettingsSchemaFieldType =
  | "text"
  | "textarea"
  | "select"
  | "number"
  | "boolean";

export interface PluginSettingsSchemaSelectOption {
  value: string;
  label: string;
}

export interface PluginSettingsSchemaShowWhen {
  configKey: string;
  equals: string | number | boolean;
}

export interface PluginSettingsSchemaField {
  configKey: string;
  label: string;
  type: PluginSettingsSchemaFieldType;
  description?: string;
  placeholder?: string;
  default?: string | number | boolean;
  options?: PluginSettingsSchemaSelectOption[];
  min?: number;
  max?: number;
  showWhen?: PluginSettingsSchemaShowWhen;
  /**
   * Group label for visual section header in the auto-rendered
   * panel. Adjacent fields with the same `group` render under one
   * header; fields without a group render at the panel top level.
   */
  group?: string;
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

export interface PluginSettingsSchemaValidationResult {
  ok: boolean;
  reason?: string;
}

/**
 * Story 46.16 — validates a plugin's `pluginSettingsSchema` plus
 * its cross-reference with `gatewayRuntimeConfigKeys`. Returns
 * `{ ok: true }` when the schema is well-formed and every runtime-
 * config key has a matching schema field; returns the first
 * problem encountered as a user-readable reason otherwise.
 *
 * Rules:
 *   1. No duplicate `configKey` entries.
 *   2. `type` is one of "text" / "select" / "number" / "boolean".
 *   3. `type: "select"` requires non-empty `options`.
 *   4. `showWhen.configKey` resolves to a sibling schema field.
 *   5. Every `gatewayRuntimeConfigKeys[i].configKey` has a matching
 *      schema field (so the value has a UI surface).
 *
 * Pure function; no I/O. Designed to be called eagerly at plugin
 * discovery / startup so misconfiguration surfaces clearly rather
 * than producing a silently broken settings panel.
 */
export function validatePluginSettingsSchema(
  pluginId: string,
  schema: PluginSettingsSchemaField[] | undefined,
  gatewayRuntimeConfigKeys: GatewayRuntimeConfigKey[] | undefined
): PluginSettingsSchemaValidationResult {
  if (!schema || schema.length === 0) {
    if (gatewayRuntimeConfigKeys && gatewayRuntimeConfigKeys.length > 0) {
      return {
        ok: false,
        reason: `Plugin "${pluginId}" declares gatewayRuntimeConfigKeys but no pluginSettingsSchema. Every runtime-config key must have a matching schema field so the value has a UI surface; declare the schema or remove the runtime-config entries.`
      };
    }
    return { ok: true };
  }
  const seenKeys = new Set<string>();
  for (const field of schema) {
    if (typeof field.configKey !== "string" || field.configKey.trim().length === 0) {
      return {
        ok: false,
        reason: `Plugin "${pluginId}" has a pluginSettingsSchema entry with an empty configKey.`
      };
    }
    if (seenKeys.has(field.configKey)) {
      return {
        ok: false,
        reason: `Plugin "${pluginId}" has duplicate pluginSettingsSchema configKey "${field.configKey}".`
      };
    }
    seenKeys.add(field.configKey);
    if (
      field.type !== "text" &&
      field.type !== "textarea" &&
      field.type !== "select" &&
      field.type !== "number" &&
      field.type !== "boolean"
    ) {
      return {
        ok: false,
        reason: `Plugin "${pluginId}" schema field "${field.configKey}" has unsupported type "${String(field.type)}". Supported types: text / textarea / select / number / boolean.`
      };
    }
    if (field.type === "select" && (!field.options || field.options.length === 0)) {
      return {
        ok: false,
        reason: `Plugin "${pluginId}" schema field "${field.configKey}" has type "select" but no options.`
      };
    }
  }
  for (const field of schema) {
    if (field.showWhen && !seenKeys.has(field.showWhen.configKey)) {
      return {
        ok: false,
        reason: `Plugin "${pluginId}" schema field "${field.configKey}" has showWhen.configKey "${field.showWhen.configKey}" that does not match any sibling schema field.`
      };
    }
  }
  if (gatewayRuntimeConfigKeys && gatewayRuntimeConfigKeys.length > 0) {
    for (const runtimeKey of gatewayRuntimeConfigKeys) {
      if (!seenKeys.has(runtimeKey.configKey)) {
        return {
          ok: false,
          reason: `Plugin "${pluginId}" declares gatewayRuntimeConfigKey "${runtimeKey.configKey}" (envVar "${runtimeKey.envVarName}") with no matching pluginSettingsSchema field. The value needs a UI surface so users can set it.`
        };
      }
    }
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
