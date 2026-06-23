// Story 45.7.5 — SugarDeploy plugin state lives in the plugin's namespaced
// pluginConfigurations[].config slot, not directly on GameProject. These
// helpers are the single read/write API for SugarDeploy's slice of the
// project; the deploy plugin and the Studio UI route through them rather
// than reach into the project shape directly. That keeps the `GameProject`
// domain type free of deploy-shaped fields (contractor test: uninstall the
// deploy plugin -> nothing in domain references it).
//
// Reads accept BOTH the legacy shape (top-level `deployment` +
// `versionedProjectIdentifiers` on GameProject) AND the new shape (under
// `pluginConfigurations[id="sugardeploy"].config`) during the migration
// window. Once the legacy fields are removed from `GameProject` the
// fallback branches in `getDeploymentSettings` / `getVersionedProjectIdentifiers`
// drop out naturally because the property accesses won't typecheck.

import type {
  AuthoringAggregateRef,
  PluginConfigurationRecord,
  SubjectReference,
  UpdatePluginConfigurationCommand
} from "@sugarmagic/domain";
import {
  createDefaultDeploymentSettings,
  createPluginConfigurationRecord,
  normalizeDeploymentSettings,
  type DeploymentSettings
} from "@sugarmagic/domain";

import { SUGARDEPLOY_PLUGIN_ID } from "../catalog/sugardeploy";
import {
  createDefaultPublishTargetSettings,
  normalizePublishTargetSettings,
  type PublishTargetSettings
} from "./publish-targets";

// Structural type that captures the slice of a game project these
// helpers actually inspect: the plugin-config slot (always) plus the
// legacy top-level fields (read-only fallback during the migration
// window). Loose by design so existing `Pick<GameProject, ...>`-typed
// signatures in the deployment package can layer this on without
// inflating their declared dependencies.
export type DeployStateInput = {
  pluginConfigurations: PluginConfigurationRecord[];
  // Legacy migration window — these fields are still on `GameProject`
  // today but will be removed once all reads route through these
  // helpers. The `?` keeps the type valid for callers that synthesize
  // a project shape without them.
  deployment?: unknown;
  versionedProjectIdentifiers?: unknown;
};

interface DeployPluginConfig {
  settings: DeploymentSettings;
  versionedProjectIdentifiers: Record<string, string>;
  publishSettings: PublishTargetSettings;
}

function findSugarDeployConfigRecord(
  gameProject: Pick<DeployStateInput, "pluginConfigurations">
): PluginConfigurationRecord | null {
  return (
    gameProject.pluginConfigurations.find(
      (record) => record.pluginId === SUGARDEPLOY_PLUGIN_ID
    ) ?? null
  );
}

function readDeployPluginConfig(
  gameProject: Pick<DeployStateInput, "pluginConfigurations">
): Partial<DeployPluginConfig> {
  const record = findSugarDeployConfigRecord(gameProject);
  if (!record) return {};
  const raw = record.config as Record<string, unknown>;
  const settings =
    raw && typeof raw.settings === "object" && raw.settings !== null
      ? (raw.settings as DeploymentSettings)
      : undefined;
  const versionedProjectIdentifiers =
    raw &&
    typeof raw.versionedProjectIdentifiers === "object" &&
    raw.versionedProjectIdentifiers !== null
      ? (raw.versionedProjectIdentifiers as Record<string, string>)
      : undefined;
  const publishSettings =
    raw &&
    typeof raw.publishSettings === "object" &&
    raw.publishSettings !== null
      ? (raw.publishSettings as PublishTargetSettings)
      : undefined;
  return { settings, versionedProjectIdentifiers, publishSettings };
}

/**
 * Single read API for SugarDeploy's deployment settings on a game project.
 * Returns the plugin-config-slot value if present; falls back to the
 * legacy top-level `gameProject.deployment` field for projects mid-
 * migration. When neither is present, returns the default shape so
 * callers can rely on a non-null `DeploymentSettings`.
 */
export function getDeploymentSettings(
  gameProject: DeployStateInput
): DeploymentSettings {
  const fromPluginSlot = readDeployPluginConfig(gameProject).settings;
  if (fromPluginSlot) {
    return normalizeDeploymentSettings(fromPluginSlot);
  }
  const legacy = gameProject.deployment;
  if (legacy && typeof legacy === "object") {
    return normalizeDeploymentSettings(legacy as Partial<DeploymentSettings>);
  }
  return createDefaultDeploymentSettings();
}

/**
 * Single read API for the per-major GCP project id suffix map. Legacy
 * fallback identical in shape to `getDeploymentSettings`. Empty object
 * is the right default — older project files that never had this slot
 * fall through to the suffix-less project-id derivation in the
 * deployment normalizer.
 */
export function getVersionedProjectIdentifiers(
  gameProject: DeployStateInput
): Record<string, string> {
  const fromPluginSlot = readDeployPluginConfig(
    gameProject
  ).versionedProjectIdentifiers;
  if (fromPluginSlot) return { ...fromPluginSlot };
  const legacy = gameProject.versionedProjectIdentifiers;
  if (legacy && typeof legacy === "object") {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(
      legacy as Record<string, unknown>
    )) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  }
  return {};
}

/**
 * Returns the SugarDeploy plugin config record on this game project, or
 * creates a fresh disabled+empty one if absent. Builders below use this
 * so that dispatching a write to the deploy plugin slot on a project
 * that's never opened SugarDeploy still lands a coherent record.
 */
function ensureSugarDeployConfigRecord(
  gameProject: Pick<DeployStateInput, "pluginConfigurations">
): PluginConfigurationRecord {
  return (
    findSugarDeployConfigRecord(gameProject) ??
    createPluginConfigurationRecord(SUGARDEPLOY_PLUGIN_ID, false, {})
  );
}

function buildUpdateCommand(
  configuration: PluginConfigurationRecord
): UpdatePluginConfigurationCommand {
  const aggregate: AuthoringAggregateRef = {
    aggregateKind: "plugin-config",
    aggregateId: configuration.identity.id
  };
  const subject: SubjectReference = {
    subjectKind: "plugin-configuration",
    subjectId: configuration.identity.id
  };
  return {
    kind: "UpdatePluginConfiguration",
    target: aggregate,
    subject,
    payload: { configuration }
  };
}

/**
 * Build the command that persists a deployment-settings change. Studio
 * dispatches this via the normal command bus; the deploy plugin never
 * hand-rolls plugin-config patches.
 */
export function buildUpdateDeploymentSettingsCommand(
  gameProject: DeployStateInput,
  settings: DeploymentSettings
): UpdatePluginConfigurationCommand {
  const current = ensureSugarDeployConfigRecord(gameProject);
  const currentConfig = (current.config as Record<string, unknown>) ?? {};
  return buildUpdateCommand({
    ...current,
    config: {
      ...currentConfig,
      settings
    }
  });
}

/**
 * Story 46.2 — single read API for publish-target settings on a game
 * project. Returns the plugin-config-slot value if present; falls
 * back to migrating a legacy `publishTargetId` recorded on the
 * deployment-settings slot (carried over from pre-046 project files
 * via 45.7.5's lift) by mapping the umbrella value `"web"` to the
 * concrete `"web-netlify"`. When neither is present, returns the
 * default `PublishTargetSettings` shape so callers can rely on
 * non-null fields.
 */
export function getPublishSettings(
  gameProject: DeployStateInput
): PublishTargetSettings {
  const fromPluginSlot = readDeployPluginConfig(gameProject).publishSettings;
  if (fromPluginSlot) {
    return normalizePublishTargetSettings(fromPluginSlot);
  }
  // Legacy fallback — pre-046 projects have publishTargetId living on
  // the deployment-settings slot (`config.settings.publishTargetId`)
  // because 45.7.5 lifted the entire pre-45.7.5 `gameProject.deployment`
  // shape there. Lift it again now, mapping the umbrella value to the
  // concrete v1 target.
  const legacyDeploy = readDeployPluginConfig(gameProject).settings as
    | (DeploymentSettings & { publishTargetId?: unknown })
    | undefined;
  if (legacyDeploy && legacyDeploy.publishTargetId !== undefined) {
    return normalizePublishTargetSettings({
      publishTargetId: legacyDeploy.publishTargetId as
        | PublishTargetSettings["publishTargetId"]
        | undefined
    });
  }
  return createDefaultPublishTargetSettings();
}

/**
 * Build the command that persists a publish-target-settings change.
 * Mirrors `buildUpdateDeploymentSettingsCommand` for the publish
 * side of the publish/deploy axis.
 */
export function buildUpdatePublishSettingsCommand(
  gameProject: DeployStateInput,
  settings: PublishTargetSettings
): UpdatePluginConfigurationCommand {
  const current = ensureSugarDeployConfigRecord(gameProject);
  const currentConfig = (current.config as Record<string, unknown>) ?? {};
  return buildUpdateCommand({
    ...current,
    config: {
      ...currentConfig,
      publishSettings: settings
    }
  });
}

/**
 * Idempotent suffix-register builder. Returns `null` if the entry for
 * the given major already exists with a non-empty suffix — preserves
 * the historical-suffix-is-immutable rule from Story 45.4.7 (worktrees
 * checked out at older majors must resolve back to the original GCP
 * project id, so we never overwrite a recorded suffix). Callers can
 * `if (cmd)` and skip dispatch when null.
 */
export function buildSetVersionedProjectIdentifierCommand(
  gameProject: DeployStateInput,
  majorVersion: number,
  suffix: string
): UpdatePluginConfigurationCommand | null {
  if (!Number.isFinite(majorVersion) || majorVersion < 1) return null;
  if (typeof suffix !== "string" || suffix.trim().length === 0) return null;
  const key = `v${Math.floor(majorVersion)}`;
  const current = ensureSugarDeployConfigRecord(gameProject);
  const currentConfig = (current.config as Record<string, unknown>) ?? {};
  const existingIdentifiers = getVersionedProjectIdentifiers(gameProject);
  if (existingIdentifiers[key] && existingIdentifiers[key].length > 0) {
    return null;
  }
  return buildUpdateCommand({
    ...current,
    config: {
      ...currentConfig,
      versionedProjectIdentifiers: {
        ...existingIdentifiers,
        [key]: suffix.trim()
      }
    }
  });
}
