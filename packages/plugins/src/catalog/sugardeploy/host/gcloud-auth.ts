// Story 49.2 — runs `gcloud auth print-access-token` as a side-
// effect-free probe of whether gcloud can authenticate. Returns
// null on success; returns a human-readable reason string ending
// with a pointer to docs/setup/persistent-gcloud-auth.md on
// failure.
//
// Modeled on `ensureGhCliOnPath` / `ensureGitOnPath` in
// `middleware.ts` — same return shape so callers can use it
// identically: `null` means "go ahead" and a string means
// "stop and surface this reason."
//
// Distinct from `ensureGcloudOnPath`: that one only verifies the
// binary exists on PATH. This one verifies the gcloud install
// can actually mint a credential, which is what every host
// action downstream of it needs.
//
// Lives inside `catalog/sugardeploy/host/` (NOT the generic
// `packages/plugins/src/host/`) because gcloud auth is a
// sugardeploy-specific concern today — no other plugin shells
// gcloud. If a future plugin needs the same helper, lift this
// file up to the shared host/ namespace at that point. See
// AGENTS.md "avoid utility dumping grounds" / "broad shared
// modules with unclear ownership" — co-locating it here keeps
// ownership explicit.

import { runHostCommand } from "../../../host/command";

export async function ensureGcloudAuthReady(): Promise<string | null> {
  const result = await runHostCommand({
    command: "gcloud",
    args: ["auth", "print-access-token"],
    cwd: process.cwd()
  });
  if (result.exitCode === 0) return null;
  return (
    "`gcloud auth print-access-token` failed — Studio's gcloud-" +
    "needing actions can't authenticate. Either run " +
    "`gcloud auth login` in a terminal once and retry, OR set up " +
    "persistent auth so this stops happening: " +
    "`docs/setup/persistent-gcloud-auth.md`."
  );
}
