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
- **Layer B — Per-project access prompt (INSIDE sugarmagic, on-
  demand).** When opening a project whose Cloud Run target needs
  the developer SA to have specific roles in the project's GCP,
  sugarmagic detects the gap and surfaces a copy-pasteable
  terminal command block. The user runs the bindings themselves
  (as their own gcloud user account, which has the required
  project-IAM-admin perms by virtue of being project owner);
  sugarmagic re-detects after they click Retry. Sugarmagic
  never runs the grant itself — keeps the user/SA boundary
  explicit. One-time bootstrap per game project.

Sugarmagic's job at the auth layer is narrowly scoped and
deliberately mirrors how `gh auth` is handled today (see
`ensureGhCliOnPath` in
`packages/plugins/src/catalog/sugardeploy/host/middleware.ts`):

1. **Use it transparently.** `runHostCommand` already propagates
   `process.env` to every subprocess; whatever the developer set
   in their shell flows through. No per-command env injection.
2. **Check at action time.** Each gcloud-needing host action
   pre-flights the auth state (parallel to the `gh auth status`
   check the GitHub workflow setup action already runs). If
   gcloud can't authenticate, the action returns ok:false with
   a message pointing the developer at
   `docs/setup/persistent-gcloud-auth.md`.

That's it. Sugarmagic does not create SAs, does not generate
keys, does not modify shell rc files, does NOT surface a
proactive banner at studio load. Same pattern as gh: the CLI
either works or it doesn't, and we error at first use with a
clear next step.

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
- Sugarmagic's auth-layer job is narrow and matches the gh
  pattern: inherit ADC via `process.env` for any host
  subprocess, and surface an at-action-time error pointing at
  the setup docs when gcloud auth fails. No banner-at-load, no
  reauth-pattern-specific overlay. Same UX shape as
  `ensureGhCliOnPath` today.
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
  to remember which roles each game project needs. Layer B
  prompts on demand the first time sugarmagic encounters a gap
  and surfaces the exact commands to run; the developer runs
  them in a terminal once per project.
- **At-action-time error, not banner-at-load.** Sugarmagic does
  not proactively surface a "you need to set up gcloud auth"
  banner when Studio loads. Instead, each gcloud-needing host
  action runs a pre-flight (parallel to `gh auth status` that
  the GitHub workflow setup action already runs today). On
  failure, the action returns ok:false with a message pointing
  at `docs/setup/persistent-gcloud-auth.md`. Same UX shape as
  `ensureGhCliOnPath` produces today; chosen for consistency
  with the existing pattern, not because banners are wrong in
  principle. Revisit if the at-action-time surfaces are getting
  hit so often that proactive warning would actually save time.

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

### Layer A — Pre-flight at action time (sugarmagic's only responsibility)

- New host module `packages/plugins/src/host/gcloud-auth.ts`
  exposing the pre-flight check used by every gcloud-needing
  action:
  - `ensureGcloudAuthReady(): Promise<string | null>` — invokes
    `gcloud auth print-access-token` (or `gcloud auth list
    --filter=status:ACTIVE`); returns null when gcloud can
    authenticate; returns a human-readable reason string
    pointing at `docs/setup/persistent-gcloud-auth.md` when it
    can't. Modeled exactly on `ensureGhCliOnPath` /
    `ensureGitOnPath` already in the codebase.
- Existing host actions that already call `ensureGhCliOnPath`
  before shelling `gh` add a parallel `ensureGcloudAuthReady`
  call before shelling `gcloud`. Failure returns ok:false with
  the setup-docs link in the reason.
- `runHostCommand` is unchanged. `process.env` propagates
  whatever the developer set in their shell rc; no per-command
  env injection.

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

### Layer B — Per-project access prompt (on-demand)

- Detection happens at the FIRST gcloud-needing host action on a
  project after Layer A is configured. If the SA is missing the
  IAM roles SugarDeploy needs in the project's GCP, the action's
  failure response carries a special
  `code: "developer-sa-needs-project-grant"` along with the
  missing role list and the SA email.
- Studio's per-project action result handlers (one shared
  utility) intercept that code and surface a modal: "Your
  developer SA doesn't yet have access to this project. Run
  these commands in a terminal where your `gcloud auth login`
  user creds are fresh — they grant the SA the roles it needs."
  Followed by a copy-to-clipboard command block of N explicit
  `gcloud projects add-iam-policy-binding ... --account=$USER`
  invocations OR a single shell loop. The user runs them in
  their terminal, returns to the modal, clicks Retry.
- Sugarmagic does NOT execute the bindings. The SA can't grant
  itself IAM (chicken-and-egg on a fresh project); the
  alternatives (sugarmagic auto-detecting + using `--account=
  USER`, or org-level `projectIamAdmin` on the SA) all drag
  user-identity routing or expanded blast radius into the
  plugin layer. Per AGENTS.md "narrow modules with obvious
  ownership," sugarmagic only ever acts as the SA; the user
  only ever acts as themselves.
- Roles SugarDeploy needs in a project's GCP (initial set; tune
  on first real run): `roles/run.admin`,
  `roles/iam.serviceAccountAdmin`,
  `roles/iam.serviceAccountUser`, `roles/secretmanager.admin`,
  `roles/artifactregistry.admin`, `roles/storage.admin`,
  `roles/cloudbuild.builds.editor`,
  `roles/serviceusage.serviceUsageConsumer`.

### Plugin SDK docs

- New section in `packages/plugins/README.md` (Browser-side proxy
  section already added in 46.14): "Host-side gcloud auth uses
  the Sugarmagic developer SA key — every plugin that shells
  gcloud / terraform / similar via `runHostCommand` automatically
  inherits the credential. Plugins do NOT need their own auth
  plumbing; they just call `runHostCommand` and the credential
  flows in."

### Tests

- `ensureGcloudAuthReady` returns null when gcloud can
  authenticate; returns a reason string pointing at the setup
  docs when it can't. Mocked subprocess shells; both the
  expired-creds and no-creds-at-all cases.
- Layer B grant endpoint runs the role bindings; idempotent
  re-run on an already-granted project is a no-op.
- Layer B detection produces the
  `developer-sa-needs-project-grant` code with the missing role
  list on the first action against a fresh project.

Out of scope for tests: `runHostCommand` env injection. Sugarmagic
does not inject `GOOGLE_APPLICATION_CREDENTIALS` per command;
Node's `process.env` already propagates whatever the developer
set in their shell. No conditional-by-command logic to test.

## Open Questions

- **Which gcloud probe command to use.** `gcloud auth
  print-access-token` is the most direct: success exit code
  means a usable credential is configured. `gcloud auth list
  --filter=status:ACTIVE --format=value(account)` returns the
  active account; empty output means none configured. Both
  work; pick whichever is faster to invoke + has a cleaner
  error path. Resolve in 49.2 with whichever the existing gh
  pre-flight pattern most closely mirrors.
- **Layer B role list completeness.** The initial set
  (`roles/run.admin`, `roles/iam.serviceAccountAdmin`,
  `roles/iam.serviceAccountUser`, `roles/secretmanager.admin`,
  `roles/artifactregistry.admin`, `roles/storage.admin`,
  `roles/cloudbuild.builds.editor`,
  `roles/serviceusage.serviceUsageConsumer`) is a best-guess.
  First real run against an empty GCP project will surface gaps
  as PERMISSION_DENIED errors with specific missing role IDs.
  Plan: 49.6 emits whatever role list we have; first real
  failure adds the missing role(s) and we ship a docs note.
- **One project vs many.** Layer B prompts on first contact with
  each new project (idempotent re-runs skip). When nikki spins
  up a second game, the prompt fires again for that game's
  separate GCP project. That's fine for the solo-dev shape;
  flagged here in case a future "team" mode wants to batch the
  grants.

## Stories

### 49.1 — Layer A setup doc

**Files (create):**

- `docs/setup/persistent-gcloud-auth.md` — recipe per the
  Deliverables outline above. Numbered terminal commands, no
  sugarmagic-side artifacts. Steps end with a `gcloud auth list`
  verification that doesn't require a fresh `gcloud auth login`.

**Exit:** nikki follows the doc in a regular terminal (with a
regular Claude session helping if needed) and verifies
`gcloud auth list` shows the developer SA active. Sugarmagic
was not opened during this story.

### 49.2 — gcloud auth pre-flight + wire into existing host actions

**Files (create):**

- `packages/plugins/src/host/gcloud-auth.ts`:
  - `ensureGcloudAuthReady(): Promise<string | null>` — shells
    the probe command resolved per Open Question #1; returns
    null on success; returns a reason string ending with
    "See `docs/setup/persistent-gcloud-auth.md`." on failure.
  - Modeled on `ensureGhCliOnPath` /
    `ensureGitOnPath` already in the codebase — same return
    shape (null on success, reason string on failure) so host
    actions can use it identically.

**Files (modify):**

- Every host action that already calls `ensureGhCliOnPath`
  before shelling gcloud — add a parallel
  `ensureGcloudAuthReady()` call. Failure returns ok:false with
  the reason as the response message.

**Tests:** mocked-subprocess unit tests for both branches of
`ensureGcloudAuthReady`. No tests for the per-action wiring
beyond a spot-check that at least one host action returns the
expected reason when the probe fails.

**Exit:** with `GOOGLE_APPLICATION_CREDENTIALS` unset (or
pointing at a non-existent file), Provision actions that shell
gcloud return a clear "See `docs/setup/...`" reason instead of
the raw gcloud error.

### 49.3 — [DELETED] Layer B grant endpoint

Originally proposed: `POST /__sugardeploy/grant-developer-sa-project-access`
that ran `gcloud projects add-iam-policy-binding` per required
role as the SA. Initial implementation shipped, then deleted
during 49.4 design review.

**Why deleted:** the SA can't grant itself IAM bindings on a
fresh project (it has no `roles/resourcemanager.projectIamAdmin`
there yet — chicken-and-egg). Workarounds explored:
- `--account=USER@EMAIL` inside the endpoint (sugarmagic
  auto-detecting the user from `gcloud auth list`). Rejected:
  drags user-identity routing into sugarmagic; AGENTS.md
  "narrow modules with obvious ownership" violated.
- Org-level `projectIamAdmin` grant on the SA at Layer A time.
  Rejected: long-lived key with org-wide IAM admin = real
  blast-radius increase.
- Partial bootstrap (user grants projectIamAdmin manually,
  sugarmagic grants the other 7). Rejected: half-and-half
  responsibility split.

**Resolution:** sugarmagic doesn't grant IAM. It detects (49.4)
and surfaces a copy-pasteable terminal command (49.5). The user
runs the bindings themselves in a terminal where their own
gcloud user creds carry the necessary owner permission. Clean
boundary: sugarmagic only ever acts as the SA; the user only
ever acts as themselves.

Per AGENTS.md: "Prefer deletion over coexistence." The grant
endpoint stayed deleted; no fallback / no compatibility shim.

### 49.4 — Layer B detection in gcloud-needing host actions

**Files (modify):**

- Shared utility (likely in
  `packages/plugins/src/catalog/sugardeploy/host/middleware.ts`)
  that wraps existing host actions: BEFORE running the action's
  real gcloud calls, probe the developer SA's roles in the
  target project (`gcloud projects get-iam-policy ... --filter
  member:serviceAccount:<sa-email>`). If the result is missing
  any role from the required set, return ok:false with
  `code: "developer-sa-needs-project-grant"` and a
  `missingRoles: string[]` field.
- Existing host actions that hit gcloud are reshaped to flow
  through this check on entry.

**Tests:** mock-shelled — required-set vs actual-set
permutations produce the expected code or pass-through.

**Exit:** opening a project where the SA has zero project
access produces the `developer-sa-needs-project-grant` code on
the first gcloud-needing action.

### 49.5 — Layer B modal in Studio (copy-paste bootstrap)

**Files (modify):**

- Studio's per-host-action response handlers (likely a shared
  utility around `fetch('/__sugardeploy/...')` calls).
- New modal component.

**Behavior:** when a host action returns ok:false with
`code: "developer-sa-needs-project-grant"`, surface a modal
that:
1. Names the target project + the developer SA.
2. Lists the missing roles (from the response payload's
   `missingRoles[]`).
3. Renders a copy-to-clipboard command block containing a
   single shell loop (or N explicit `gcloud projects
   add-iam-policy-binding` commands) with
   `--account=$DETECTED_USER` baked in so the user's gcloud
   user-creds-as-themselves run the bindings. The `$USER`
   placeholder is shown explicitly with instructions to swap
   in their actual email — sugarmagic never tries to read or
   know their user identity.
4. After the user runs the commands in their terminal, they
   click "Retry" in the modal. Sugarmagic re-dispatches the
   original action; Layer B detection (49.4) re-runs;
   missing-role list should now be empty and the action
   proceeds.

Sugarmagic does NOT execute the grants. It detects and
instructs; the user runs the bindings in their own terminal.
This keeps sugarmagic narrowly focused on "act as the SA" and
avoids any --account user-identity routing in plugin code.

**Tests:** logic-level — given the
`developer-sa-needs-project-grant` response shape, assert the
modal renders with the right project / SA / role list, and the
retry path re-fires the original action.

**Exit:** Provision -> click a fresh-project action -> modal
appears with copy-pasteable bootstrap block -> user runs in
terminal -> clicks Retry -> action proceeds.

### 49.6 — Plugin SDK docs + close-out

**Files (modify):**

- `packages/plugins/README.md` — new "Host-side gcloud auth"
  section per Deliverables.
- `docs/setup/persistent-gcloud-auth.md` — final pass; ensure
  the doc references Layer B's per-project prompt at the end.

**Verification:** the Verification section above, run
end-to-end.

**Exit:** docs match the shipped behavior; verification passes;
Plan 049 marked complete.

## Verification

- **Layer A setup is done outside sugarmagic.** Follow
  `docs/setup/persistent-gcloud-auth.md` in a regular terminal:
  create the SA, generate the key, `chmod 600`, export
  `GOOGLE_APPLICATION_CREDENTIALS` +
  `CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE` in `~/.zshrc`,
  restart shell. Verify `gcloud auth list` shows the SA as
  active. Sugarmagic was not involved in any of this.
- **User-credential expiry no longer matters.** Wait long enough
  for the developer's last `gcloud auth login` to expire (or
  revoke it manually). Click a sugardeploy action that shells
  gcloud. Action still succeeds because `process.env` carried
  `GOOGLE_APPLICATION_CREDENTIALS` into the subprocess and
  gcloud read the SA key.
- **Missing-auth error path is friendly.** Launch Studio in a
  shell where `GOOGLE_APPLICATION_CREDENTIALS` is NOT set AND
  the developer has no `gcloud auth login` either. Click a
  gcloud-needing action. Error response carries the
  `ensureGcloudAuthReady` reason: a clear "See
  `docs/setup/persistent-gcloud-auth.md`" message, not a raw
  gcloud stderr blob.
- **Layer B prompts on first contact with a new project.** Open
  a project pointed at a GCP project the developer SA has not
  yet been granted access to. First gcloud-needing action fails
  with the `developer-sa-needs-project-grant` code; Studio
  surfaces the modal listing the missing roles + a copy-paste
  command block. Run the commands in a terminal (with your
  fresh `gcloud auth login` user creds via `--account=$USER`).
  Click Retry in the modal. Detection re-runs; missing-role
  list is empty; the original action proceeds.
- **Layer B detection is idempotent.** Re-click the same
  action without revoking access. No second prompt; action
  goes straight through (detection sees zero missing roles).

## Builds On

- [Plan 045: SugarDeploy Cloud Run Plugin-Owned Infrastructure
  Epic](/docs/plans/045-sugardeploy-cloud-run-plugin-owned-infrastructure-epic.md)
  — established the shell-out pattern this epic credentials.
- [Plan 046: Studio Publish Productmode + SugarDeploy Provision /
  Release / Deploy](/docs/plans/046-sugardeploy-web-publish-target-epic.md)
  — story 46.14 surfaced the persistent symptom this epic fixes.
