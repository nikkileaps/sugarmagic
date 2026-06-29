// Story 49.3 — developer service account introspection + the
// IAM role list Layer B's grant endpoint applies.
//
// The "developer SA" is whichever service account the developer
// pointed `GOOGLE_APPLICATION_CREDENTIALS` at when they followed
// `docs/setup/persistent-gcloud-auth.md`. Sugarmagic doesn't
// create it, doesn't manage its key, doesn't decide its email —
// we just read the email out of the key file so Layer B's grant
// endpoint knows who to grant project roles to.
//
// Lives inside `catalog/sugardeploy/host/` (NOT the generic
// `packages/plugins/src/host/`) — same reasoning as
// `gcloud-auth.ts`: gcloud is a sugardeploy-specific concern
// today, no other plugin needs this.

import { readFile } from "node:fs/promises";
import { runHostCommand } from "../../../host";

/**
 * Initial role set the developer SA needs in each game project's
 * GCP. Conservative best-guess; first real Layer B failure
 * against an empty project will surface gaps as
 * PERMISSION_DENIED with a specific missing role ID, at which
 * point we add the role here and document it in
 * `docs/setup/persistent-gcloud-auth.md`. Open Question #2 in
 * Plan 049 covers this.
 *
 * Story 49.3 — initial 8 roles for the actual sugardeploy work.
 * Story 49.4 amendment — added `roles/iam.securityReviewer`. The
 * detection helper below calls `gcloud projects get-iam-policy`
 * to verify the SA's role coverage; without securityReviewer the
 * SA can't read the policy on its own project (none of the 8
 * functional roles grant `resourcemanager.projects.getIamPolicy`),
 * so detection would loop forever post-bootstrap. securityReviewer
 * is read-only on IAM policies; tight blast radius for the role
 * the SA needs to introspect itself.
 */
export const DEVELOPER_SA_REQUIRED_ROLES: readonly string[] = [
  "roles/run.admin",
  "roles/iam.serviceAccountAdmin",
  "roles/iam.serviceAccountUser",
  "roles/secretmanager.admin",
  "roles/artifactregistry.admin",
  "roles/storage.admin",
  "roles/cloudbuild.builds.editor",
  "roles/serviceusage.serviceUsageConsumer",
  "roles/iam.securityReviewer"
];

/**
 * Read the developer SA's email from the JSON key file that
 * `GOOGLE_APPLICATION_CREDENTIALS` points at. Returns null when:
 *   - the env var is unset or empty
 *   - the file doesn't exist or can't be read
 *   - the file isn't valid JSON
 *   - the JSON doesn't carry a non-empty `client_email`
 *
 * Used by Layer B's grant endpoint to identify who to grant
 * project roles to. Null indicates "no developer SA configured;
 * Layer B doesn't apply" — the caller should surface the setup
 * docs in that case.
 *
 * The JSON key file's `client_email` field is the canonical
 * source per Google's service-account key file schema; reading
 * it avoids round-tripping through `gcloud auth list` which
 * could return the user's email when both an SA and a user
 * session are active.
 *
 * Story 49.3.
 */
/**
 * Story 49.4 — result of checking the developer SA's IAM
 * coverage on a target game project.
 *
 * The "no SA configured" case (developer is using
 * `gcloud auth login` user creds instead of an SA key)
 * short-circuits to `ok: true` — Layer B is a no-op when there's
 * no SA to grant roles to; the user's own auth carries any
 * permission they already have on the project.
 */
export type DeveloperSaProjectAccessResult =
  | { ok: true; saEmail: string | null }
  | {
      ok: false;
      code: "developer-sa-needs-project-grant";
      saEmail: string;
      gcpProjectId: string;
      missingRoles: string[];
      reason: string;
    };

/**
 * Story 49.4 — probe whether the developer SA has every role in
 * `DEVELOPER_SA_REQUIRED_ROLES` on the given GCP project.
 *
 * Behavior:
 *   - No SA configured (`resolveDeveloperSaEmail()` returns null):
 *     short-circuit to `ok: true`. Layer B doesn't apply.
 *   - SA configured, get-iam-policy succeeds, all required roles
 *     present for `serviceAccount:<saEmail>`: `ok: true`.
 *   - SA configured, get-iam-policy succeeds, some roles missing:
 *     `ok: false` with the missing role list.
 *   - SA configured, get-iam-policy fails (permission denied,
 *     project missing, etc.): treat as "needs grant" with the
 *     ENTIRE required-role list as missing. The caller (Studio
 *     modal in 49.5) surfaces the grant flow; the underlying
 *     gcloud error stays in `reason` for debugging.
 *
 * Uses `--format=json` so the bindings array parses
 * deterministically; the schema is `{ bindings: [{role, members}],
 * etag, version }` (verified against real gcloud output).
 */
export async function checkDeveloperSaProjectAccess(
  gcpProjectId: string
): Promise<DeveloperSaProjectAccessResult> {
  const saEmail = await resolveDeveloperSaEmail();
  if (saEmail === null) {
    return { ok: true, saEmail: null };
  }
  const requiredRoles = Array.from(DEVELOPER_SA_REQUIRED_ROLES);
  const member = `serviceAccount:${saEmail}`;
  const probe = await runHostCommand({
    command: "gcloud",
    args: [
      "projects",
      "get-iam-policy",
      gcpProjectId,
      "--format=json"
    ],
    cwd: process.cwd()
  });
  if (probe.exitCode !== 0) {
    // get-iam-policy failed — could be "permission denied"
    // (Layer B not bootstrapped yet) or "project not found"
    // (typo or wrong projectId). Either way, treat as
    // "needs grant" since the next downstream gcloud call
    // would fail anyway. The Studio modal can surface the
    // raw `reason` so the user can distinguish bootstrap-
    // needed from typo.
    return {
      ok: false,
      code: "developer-sa-needs-project-grant",
      saEmail,
      gcpProjectId,
      missingRoles: requiredRoles,
      reason:
        `Couldn't read the IAM policy on project "${gcpProjectId}" to ` +
        `verify the developer SA's roles. gcloud stderr: ` +
        `${probe.stderr.trim() || `exit ${probe.exitCode}`}`
    };
  }
  let parsed: { bindings?: Array<{ role?: unknown; members?: unknown }> };
  try {
    parsed = JSON.parse(probe.stdout);
  } catch (error) {
    return {
      ok: false,
      code: "developer-sa-needs-project-grant",
      saEmail,
      gcpProjectId,
      missingRoles: requiredRoles,
      reason: `Couldn't parse gcloud's IAM policy JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    };
  }
  const grantedRoles = new Set<string>();
  for (const binding of parsed.bindings ?? []) {
    const role = typeof binding.role === "string" ? binding.role : null;
    if (role === null) continue;
    const members = Array.isArray(binding.members) ? binding.members : [];
    if (members.some((m) => m === member)) {
      grantedRoles.add(role);
    }
  }
  const missingRoles = requiredRoles.filter((role) => !grantedRoles.has(role));
  if (missingRoles.length === 0) {
    return { ok: true, saEmail };
  }
  return {
    ok: false,
    code: "developer-sa-needs-project-grant",
    saEmail,
    gcpProjectId,
    missingRoles,
    reason:
      `Developer SA ${saEmail} is missing ${missingRoles.length} required ` +
      `role(s) on project ${gcpProjectId}: ${missingRoles.join(", ")}.`
  };
}

export async function resolveDeveloperSaEmail(): Promise<string | null> {
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (typeof path !== "string" || path.length === 0) return null;
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { client_email?: unknown };
    if (
      typeof parsed.client_email !== "string" ||
      parsed.client_email.length === 0
    ) {
      return null;
    }
    return parsed.client_email;
  } catch {
    return null;
  }
}
