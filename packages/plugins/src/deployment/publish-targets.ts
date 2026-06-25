// Story 46.2 — publish-target types.
//
// A publish target is the medium a game ships to: the player-facing
// shape of the product. v1's single value is `"web"` (browser-played).
// Future publish targets would be `"mobile"`, `"steam"`, `"console"`,
// etc. — distinct user-product shapes, NOT subdivided by hosting
// provider.
//
// Where the artifacts physically run is the orthogonal axis. Backend
// runs on a backend deployment target (local docker, Cloud Run, etc.);
// the web bundle gets pushed to a frontend deployment target (Netlify,
// Vercel, GCP static, etc.). Those live on `DeploymentSettings`, NOT
// here. This file is just publish-medium metadata.
//
// PublishTargetSettings is the SugarDeploy plugin state slot's
// `config.publishSettings` shape — parallel to the deployment-target
// `config.settings` shape. Lives in the plugin slot (not on
// `GameProject` directly) per the contractor-test architecture from
// Plan 045 / 45.7.5.

export type PublishTargetId = "web";

export interface PublishTargetSettings {
  publishTargetId: PublishTargetId;
  /**
   * Project-level "live alias" domain — e.g.
   * `play.wordlarkhollow.com`. Empty string means "no custom live
   * alias; use the per-deploy URL the frontend deployment target
   * generates as the public-facing URL." When set, CORS allowed-
   * origins on the matching backend major include this domain so
   * sessions loaded from the alias keep working after the alias
   * points elsewhere. Empty by default; user fills it in via the
   * Provision workspace.
   */
  liveDomain: string;
}

export function createDefaultPublishTargetSettings(): PublishTargetSettings {
  return {
    publishTargetId: "web",
    liveDomain: ""
  };
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isPublishTargetId(value: unknown): value is PublishTargetId {
  return value === "web";
}

/**
 * Project files persisted under pre-046 had `publishTargetId: "web"`
 * living on the deployment-settings slot. 46.2 lifts that field out
 * of `config.settings` and into the new `config.publishSettings`
 * slot. The value itself doesn't change — `"web"` was and is the
 * publication medium. (The provider — Netlify, Vercel, etc. — lives
 * on the frontend deployment-target axis introduced in later 046
 * stories.)
 */
export function migrateLegacyPublishTargetId(value: unknown): PublishTargetId {
  if (isPublishTargetId(value)) return value;
  return "web";
}

export function normalizePublishTargetSettings(
  input: Partial<PublishTargetSettings> | null | undefined
): PublishTargetSettings {
  const publishTargetId = migrateLegacyPublishTargetId(input?.publishTargetId);
  const liveDomain = asTrimmedString(input?.liveDomain);
  return {
    publishTargetId,
    liveDomain
  };
}
