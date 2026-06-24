# Plan 049: Persistent gcloud Auth via Developer Service Account

## Epic

### Title

Replace the `gcloud auth login` reauth dance with a long-lived
developer service account whose JSON key lives on disk. Sugarmagic
detects when it's missing and walks the user through one-time
setup; per-project access grants happen contextually the first time
they're needed.

### Why this epic exists

Story 46.14 surfaced the persistent symptom: gcloud auth tokens
expire on Google's reauth cadence (org policy, typically 7 days).
When they expire, every sugarmagic host action that shells gcloud
fails — often silently in places where the host action swallowed
the gcloud non-zero exit and proceeded. The user pattern is:

1. Open Studio. Click some sugardeploy button.
2. See a cryptic error (or worse, a silent half-success that
   produces a broken deploy).
3. Realise gcloud is reauth-needed.
4. Run `gcloud auth login` in a terminal.
5. Retry the action.

This is the GCP equivalent of AWS reauth pain, and it bites every
few days. AWS solves it with `~/.aws/credentials` profiles (long-
lived access-key files). GCP's equivalent is service account JSON
keys + `GOOGLE_APPLICATION_CREDENTIALS` / `CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE`.

This epic lands the same pattern for sugarmagic, in two layers
that match nikki's mental model:

- **Layer A — Developer-level setup (OUTSIDE sugarmagic).** The
  developer creates a service account that represents themselves
  on their machine, saves its JSON key to a known location on
  disk, and configures their shell so anything that reads ADC
  picks it up. This is a developer-environment concern, like
  installing gcloud itself — done once-ever with Claude's help
  in a regular Claude session, NOT inside sugarmagic. Sugarmagic
  has no UI for SA creation, no wizard, no bootstrap. There's a
  docs page (`docs/setup/persistent-gcloud-auth.md`) explaining
  how to do it.
- **Layer B — Per-project access grant (INSIDE sugarmagic, on-
  demand).** When opening a project whose Cloud Run target needs
  the developer SA to have specific roles in the project's GCP,
  sugarmagic prompts contextually and runs the IAM bindings.
  Idempotent.

Sugarmagic's job at the auth layer is narrowly scoped:

1. **Detect** whether a persistent credential is configured (via
   the standard `GOOGLE_APPLICATION_CREDENTIALS` env var path).
2. **Use it** if present — `runHostCommand` propagates the env
   to every gcloud / terraform subprocess.
3. **Warn** if it's missing AND a gcloud-needing action is about
   to run, asking whether the user wants to proceed with
   interactive gcloud login as a fallback. Link to the setup docs
   from the warning.

That's it. Sugarmagic does not create SAs, does not generate
keys, does not modify shell rc files.

### Goal

- No more `gcloud auth login` dances. After the developer's
  one-time machine-level setup (NOT in sugarmagic), every gcloud
  call — sugarmagic's host actions AND raw `gcloud foo` in any
  terminal — uses the developer SA's JSON key.
- Sugarmagic owns no part of Layer A. The developer creates the
  SA, downloads the JSON key, and adds
  `GOOGLE_APPLICATION_CREDENTIALS` + `CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE`
  to their shell rc themselves (with a Claude session's help if
  they want — Layer A is just a docs page in this repo, no UI
  and no host action).
- Sugarmagic's auth-layer job is narrow: detect that ADC is set,
  inherit it via `process.env` for any host subprocess, and warn
  contextually when it's missing. That's the entirety of
  sugarmagic's involvement on the credential side.
- Per-project IAM bindings (Layer B) happen inside sugarmagic as
  a contextual banner in Provision — not a button, not a wizard.
- Other CLIs the developer runs (`gh`, terraform, Python clients,
  raw `gcloud foo`) get the credential for free because they all
  read ADC. That's the whole point of doing this at the shell-rc
  layer instead of inside sugarmagic.

### Resolved Decisions

- **Layer A is a docs-only deliverable inside sugarmagic.**
  `docs/setup/persistent-gcloud-auth.md` walks the developer
  through SA creation + key generation + shell rc setup. No UI,
  no wizard, no host action. The doc is a recipe Claude can follow
  in a regular session if the developer asks for help, but the
  steps are run by the developer in their terminal — not by
  sugarmagic.
- **Sugarmagic reads `GOOGLE_APPLICATION_CREDENTIALS` to detect
  the configured key.** Not a sugarmagic-specific path —
  whatever the developer pointed ADC at, sugarmagic uses. If the
  developer chose to save the key at
  `~/.config/sugarmagic/gcp-developer-key.json`, fine. If they
  put it under `~/.config/gcloud/keys/`, also fine. Sugarmagic
  doesn't care where it lives; it cares that ADC is configured.
- **Environment propagates via `runHostCommand`.** `runHostCommand`
  inherits `process.env` already; nothing extra needed if the
  developer set `GOOGLE_APPLICATION_CREDENTIALS` in their shell
  before launching Studio. If the env var isn't set when Studio
  launches, sugarmagic detects that and surfaces a warning at
  the first gcloud-needing action.
- **No automatic per-project access on Layer A setup.** When the
  developer creates the SA (outside sugarmagic), they don't have
  to remember which roles each game project needs. Layer B grants
  per-project access on demand the first time sugarmagic
  encounters a gap.
- **Detect-and-warn UX, not bootstrap-in-sugarmagic.** Sugarmagic
  surfaces the gap; it doesn't fix Layer A. The fix is the user
  going to their terminal (or a Claude session) and following
  the setup docs.
  - Studio launch with `GOOGLE_APPLICATION_CREDENTIALS` unset
    AND any project loaded has SugarDeploy enabled with a Cloud
    Run target -> top-of-window banner: "Persistent gcloud auth
    not configured. See docs/setup/persistent-gcloud-auth.md to
    set it up; or proceed and sugarmagic will fall back to
    interactive `gcloud auth login` when needed."
  - A gcloud-needing host action fails with a reauth-pattern
    error -> error overlay offers the same guidance + a "Open
    setup docs" link, plus a "Run gcloud auth login now"
    one-shot instructional message.

### What is NOT in scope

- Replacing the GitHub `gh auth login` dance. GitHub has its
  own auth lifecycle (PAT or OAuth refresh tokens); separate
  concern. The `gh` CLI's tokens already last way longer than
  gcloud's by default.
- Replacing terraform's GCP auth. Terraform reads ADC
  (`GOOGLE_APPLICATION_CREDENTIALS`) so it picks up the SA key
  for free.
- Org-wide IAM policy enforcement (e.g. "SAs must rotate every
  90 days"). Solo-dev shape; rotation is a user responsibility
  documented in the setup README.
- Sandboxing the key file path. Sugarmagic reads whatever the
  developer pointed `GOOGLE_APPLICATION_CREDENTIALS` at — Layer A's
  setup docs *suggest* `~/.config/sugarmagic/gcp-developer-key.json`,
  but sugarmagic won't enforce or hardcode that location.
- ANY UI surface inside sugarmagic for Layer A. Sugarmagic does
  not generate keys, does not create SAs, does not edit shell
  rc files. The developer's machine setup is entirely out-of-band
  (in a regular terminal, with a regular Claude session's help if
  they want one). The only sugarmagic-side artifact for Layer A
  is the docs page recipe.

## Deliverables

### Layer A — Detect + warn (sugarmagic's only responsibility)

- New host module `packages/plugins/src/host/gcp-developer-key.ts`:
  - `developerCredentialPath() -> string | null` — reads
    `process.env.GOOGLE_APPLICATION_CREDENTIALS`; returns the
    path when the env var is set AND the file exists on disk,
    null otherwise.
  - `hasPersistentGcloudAuth() -> boolean` — true iff
    `developerCredentialPath()` returns non-null.
- Studio session-load probe: when `GOOGLE_APPLICATION_CREDENTIALS`
  is unset AND the loaded project has a Cloud Run target
  configured, render a top-of-window dismissible banner: "No
  persistent gcloud auth configured (`GOOGLE_APPLICATION_CREDENTIALS`
  env var not set). Studio will fall back to interactive `gcloud
  auth login` when needed — see [setup
  docs](/docs/setup/persistent-gcloud-auth.md) to make this
  go away." Stores the dismissal per-session.
- Existing host actions that shell gcloud detect reauth-pattern
  error messages in stderr (`reauthentication`, `auth login`,
  `expired credentials`) and append a one-screen instructional
  panel to the error overlay: "Your gcloud auth has expired.
  Either run `gcloud auth login` in a terminal once and retry,
  or set up persistent auth (see setup docs) to avoid this
  going forward."
- `runHostCommand` does NOT inject `GOOGLE_APPLICATION_CREDENTIALS`
  itself — `process.env` propagates whatever the developer set.
  The wiring is the developer's job; sugarmagic just inherits.

### Layer A docs — `docs/setup/persistent-gcloud-auth.md`

The only Layer A artifact in this repo. A setup recipe the
developer follows OUTSIDE sugarmagic — in a regular terminal,
with a regular Claude session if they want help — to set up a
machine-wide gcloud developer profile that any tool reading ADC
picks up.

Contents:

- What problem this solves and why GCP doesn't have an `~/.aws/
  credentials`-style profile model out of the box.
- The intent: a personal "nikki-developer" service account whose
  JSON key sits on disk, exposed via `GOOGLE_APPLICATION_CREDENTIALS`
  so EVERY gcloud usage on the machine — terminals, sugarmagic,
  terraform direct runs, Python clients — uses it. Sugarmagic
  benefits as a side effect, not as the driver.
- Step-by-step gcloud commands (run by the developer in a regular
  terminal, NOT by sugarmagic):
  1. Create a service account
     (`gcloud iam service-accounts create sugarmagic-developer
     --project=<your-tooling-project>`).
  2. Generate a JSON key
     (`gcloud iam service-accounts keys create
     ~/.config/sugarmagic/gcp-developer-key.json
     --iam-account=...`).
  3. Lock down the file permissions (`chmod 600`).
  4. Add `export GOOGLE_APPLICATION_CREDENTIALS=...` and
     `export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE=...` to
     `~/.zshrc` (or shell of choice). Restart shells / reload rc.
  5. Verify `gcloud auth list` shows the SA as active without
     ever running `gcloud auth login` again.
- Rotation guidance: rotate yearly, keep the key off shared
  storage, revoke promptly if the laptop is lost.
- Note: Layer B's per-project access grant happens inside
  sugarmagic — this doc only covers the developer's machine setup.
  Once the developer has done Layer A, opening any sugarmagic
  project with a Cloud Run target will prompt them through Layer
  B on first contact, no extra commands needed.

### Layer B — Per-project access grant (on-demand)

- Detection happens at the FIRST gcloud-needing host action on a
  project after Layer A is configured. If the SA is missing the
  IAM roles SugarDeploy needs in the project's GCP, the action's
  failure response carries a special `code: "developer-sa-needs-project-grant"`
  along with the missing role list.
- Studio's per-project action result handlers (one shared utility)
  intercepts that code and surfaces a modal: "Your developer SA
  doesn't yet have access to this project. Grant the required
  roles?" Listing them transparently. Confirm runs `gcloud
  projects add-iam-policy-binding <project> --member=serviceAccount:<sa-email>
  --role=<role>` for each.
- Roles SugarDeploy needs in a project's GCP (initial set; tune
  on first real run): `roles/run.admin`, `roles/iam.serviceAccountAdmin`,
  `roles/iam.serviceAccountUser`, `roles/secretmanager.admin`,
  `roles/artifactregistry.admin`, `roles/storage.admin`,
  `roles/cloudbuild.builds.editor`, `roles/serviceusage.serviceUsageConsumer`.
- New host endpoint
  `POST /__sugardeploy/grant-developer-sa-project-access` —
  takes `{ gcpProjectId }`, runs the per-role bindings, returns
  aggregated stdout. Re-running on an already-granted project is
  a no-op (`gcloud projects add-iam-policy-binding` is
  idempotent).

### Plugin SDK docs

- New section in `packages/plugins/README.md` (Browser-side proxy
  section already added in 46.14): "Host-side gcloud auth uses
  the Sugarmagic developer SA key — every plugin that shells
  gcloud / terraform / similar via `runHostCommand` automatically
  inherits the credential. Plugins do NOT need their own auth
  plumbing; they just call `runHostCommand` and the credential
  flows in."

### Tests

- `getDeveloperKeyPath` returns the right path on Mac / Linux.
- `readDeveloperKeyEnv` returns the env map when the file exists,
  empty map when absent.
- `runHostCommand` injects the env when the command is `gcloud`
  or `terraform`; doesn't inject for `git`, `gh`, `pnpm`,
  `docker`.
- Mock-shelled tests for the wizard's pre-flight + SA creation +
  key generation steps.
- Mock-shelled tests for the per-project access grant including
  the idempotent re-run case.

## Verification

- On a machine where gcloud is freshly auth-logged-in: open
  Studio, see the banner. Click through Developer Setup. Choose
  a GCP project. Wizard completes. `~/.config/sugarmagic/gcp-developer-key.json`
  exists with `600` perms.
- Wait long enough for the user's `gcloud auth login` to expire
  (or manually revoke it). Click a sugardeploy action that
  shells gcloud. It still works — `runHostCommand` injected the
  SA key path and gcloud used it instead of the expired user
  credential.
- Open a wordlark project with SugarDeploy enabled. Click Setup
  Infra. Errors out with "developer SA needs project grant" code.
  Modal appears listing the roles. Confirm. `gcloud projects
  add-iam-policy-binding` runs for each. Retry Setup Infra — it
  proceeds.
- Re-click Setup Infra without revoking access. Goes straight
  through (no second grant prompt).

## Builds On

- [Plan 045: SugarDeploy Cloud Run Plugin-Owned Infrastructure
  Epic](/docs/plans/045-sugardeploy-cloud-run-plugin-owned-infrastructure-epic.md)
  — established the shell-out pattern this epic credentials.
- [Plan 046: Studio Publish Productmode + SugarDeploy Provision /
  Release / Deploy](/docs/plans/046-sugardeploy-web-publish-target-epic.md)
  — story 46.14 surfaced the persistent symptom this epic fixes.
