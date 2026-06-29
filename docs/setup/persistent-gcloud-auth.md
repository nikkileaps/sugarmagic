# Persistent gcloud Auth via Developer Service Account

**Audience:** developers running Sugarmagic locally who hit the
`gcloud auth login` reauth dance every few days.

**Time:** ~10 minutes, once per developer machine.

**Result:** every CLI on your machine that reads Google
Application Default Credentials (gcloud, terraform, Python
clients, Node clients, Sugarmagic's host actions) authenticates
as a long-lived "developer" service account whose JSON key sits
on disk. No more `gcloud auth login` interruptions.

---

## What this solves

GCP user credentials (from `gcloud auth login`) expire on the
org's reauth cadence (typically a few days to a week). When they
expire, every gcloud-needing tool fails until you re-run
`gcloud auth login` in a terminal. For Sugarmagic Studio
specifically, that means clicking a Provision / Deploy button,
getting a cryptic error, switching to a terminal, running
`gcloud auth login`, and retrying.

Service account JSON keys don't expire. They sit on disk, get
read by gcloud (and every ADC-aware library) on each invocation,
and mint a short-lived access token transparently. Set this up
once and the reauth interruption goes away.

This is the GCP equivalent of `~/.aws/credentials` profiles.

## What Sugarmagic owns vs what you own

- **You own (this doc):** creating the service account, generating
  the key, putting it in a known location, telling your shell + gcloud
  to use it. All in a regular terminal, NOT inside Sugarmagic.
- **Sugarmagic owns:** detecting at action time whether gcloud can
  authenticate. If it can't, returning a clear error pointing at
  this doc. Same pattern as `ensureGhCliOnPath` for `gh`.
- **Sugarmagic does NOT** create service accounts, generate keys,
  edit your shell rc, or wizard you through any of the steps
  below. The setup is intentionally out-of-band.

After Layer A (this doc) is done, Sugarmagic's per-project IAM
grant prompt (Layer B) handles per-game-project access on first
contact. You don't have to remember which roles each project
needs; Layer B prompts you the first time it hits a missing one.

---

## Prerequisites

- `gcloud` installed and on your PATH.
- One successful `gcloud auth login` recently — you need an
  authenticated user session to create the service account and
  generate its key. (After this setup, you won't need
  `gcloud auth login` again.)
- A GCP project to host the developer SA. The SA can live in:
  - An existing personal project you already use for tooling, OR
  - A new "tooling" project (steps below) — recommended if you
    want a clean separation from any specific game's GCP project.
- On that project: `roles/iam.serviceAccountAdmin` and
  `roles/iam.serviceAccountKeyAdmin` (which Project Owner
  implies). You probably already have these if it's your own
  project.

---

## Steps

The commands below use shell variables for the values you'll
substitute. Set them at the top of your terminal session so the
rest of the commands stay readable:

```bash
TOOLING_PROJECT_ID=my-tooling-project
SA_NAME=sugarmagic-developer
SA_EMAIL=$SA_NAME@$TOOLING_PROJECT_ID.iam.gserviceaccount.com
KEY_PATH=$HOME/.config/sugarmagic/gcp-developer-key.json
```

### 1. (Optional) Create a tooling project to host the SA

Skip this if you already have a project you'd like to host the
developer SA in. The SA is just an identity; this project
doesn't need any of your game data.

```bash
gcloud projects create $TOOLING_PROJECT_ID --name "My Tooling"
```

### 2. Create the developer service account

```bash
gcloud iam service-accounts create $SA_NAME \
  --display-name "Sugarmagic Developer (Persistent Auth)" \
  --project $TOOLING_PROJECT_ID
```

This creates `$SA_EMAIL` with no roles in any project. That's
intentional — Sugarmagic's Layer B grants per-game-project access
later.

### 3. Generate a JSON key

```bash
mkdir -p ~/.config/sugarmagic
gcloud iam service-accounts keys create $KEY_PATH \
  --iam-account $SA_EMAIL
chmod 600 $KEY_PATH
```

`chmod 600` locks the file to your user account — the key is
sensitive (it grants whoever has it the SA's full authority).
Treat it like an SSH private key.

### 4. Enable the Cloud Resource Manager API on the tooling project

Sugarmagic's Layer B grant flow calls
`gcloud projects add-iam-policy-binding` to grant the developer
SA roles on each game project's GCP. That call needs the Cloud
Resource Manager API enabled on the project the SA's quota
flows through — which defaults to the tooling project hosting
the SA. Enable it once now while you're still on user creds:

```bash
gcloud services enable cloudresourcemanager.googleapis.com \
  --project $TOOLING_PROJECT_ID
```

This is a one-time, server-side change on the tooling project
itself. New machines pointing at the same SA inherit the
enablement; you only re-do this step if you create a different
tooling project.

If you've already done step 5 (activate the SA) before this one
and the command fails with `PERMISSION_DENIED` (the SA has no
roles in the tooling project by design), re-run with
`--account YOUR_USER@EMAIL` to run that one command as you
instead of as the SA:

```bash
gcloud services enable cloudresourcemanager.googleapis.com \
  --project $TOOLING_PROJECT_ID \
  --account YOUR_USER@EMAIL
```

### 5. Activate the key for `gcloud`

This makes raw `gcloud foo` commands (and Sugarmagic's gcloud
shell-outs) use the SA instead of your user credentials.

```bash
gcloud auth activate-service-account $SA_EMAIL --key-file $KEY_PATH
```

Per gcloud docs: "this command authorizes gcloud to access
Google Cloud using service account credentials instead of user
credentials." This is gcloud's documented way to use a key file;
the credential state persists in `~/.config/gcloud/` so you only
run this command once per machine.

### 6. Configure `GOOGLE_APPLICATION_CREDENTIALS` for everything else

Anything else on your machine that reads Application Default
Credentials (terraform, Python clients, Node clients) reads the
env var `GOOGLE_APPLICATION_CREDENTIALS`. Add this to your shell
rc so it's set for every future shell:

For zsh:

```bash
echo "export GOOGLE_APPLICATION_CREDENTIALS=\"$KEY_PATH\"" >> ~/.zshrc
```

For bash, swap `~/.zshrc` for `~/.bashrc` (or `~/.bash_profile`
on macOS, depending on how your shell starts).

Reload the rc file in your current shell:

```bash
source ~/.zshrc   # or your shell's equivalent
```

Per Google's ADC docs: "the authentication libraries make those
credentials available to Cloud Client Libraries and Google API
Client Libraries." When `GOOGLE_APPLICATION_CREDENTIALS` is set,
ADC reads the JSON key from that path.

### 7. Verify

```bash
# Your SA email should appear as the active account.
gcloud auth list

# Should print a JWT-like blob, no prompts.
gcloud auth print-access-token > /dev/null && echo "gcloud OK"

# Should print the path you set in step 6.
echo $GOOGLE_APPLICATION_CREDENTIALS
```

If all three succeed without prompting you to run
`gcloud auth login`, you're done.

---

## Open Sugarmagic Studio

Sugarmagic Studio inherits the env you launched it from. Make
sure you start it from a shell where `GOOGLE_APPLICATION_CREDENTIALS`
is set (i.e. AFTER step 6, in a freshly-sourced shell). From the
sugarmagic checkout:

```bash
pnpm dev:studio
```

## Layer B: per-project access on first contact

The developer SA you just created starts with zero roles on any
specific game project's GCP. The first time you click a Cloud-
Run-touching action (Deploy, Setup Infra, Status, etc.) in
Studio against a project the SA hasn't been bootstrapped on,
Sugarmagic detects the gap and pops a modal:

- It names the target GCP project and the developer SA.
- It lists the IAM roles the SA needs (currently 9 —
  run.admin, iam.serviceAccountAdmin / serviceAccountUser,
  secretmanager.admin, artifactregistry.admin, storage.admin,
  cloudbuild.builds.editor, serviceusage.serviceUsageConsumer,
  and iam.securityReviewer so the SA can read its own IAM
  policy to verify Layer B was applied).
- It renders a copy-pasteable shell loop with a placeholder
  for `YOUR_USER@EMAIL`.

You paste it into a terminal, replace the placeholder with
your gcloud user account (the one with owner on that GCP
project), run it, then click Retry in the modal. The action
re-fires and proceeds. **One-time per new GCP project; daily
deploys never see this prompt again on that project.**

Why the user runs the bindings (not Sugarmagic itself): the SA
can't grant itself IAM (chicken-and-egg), and routing user-
identity through plugin code would muddy the clean
"Sugarmagic only ever acts as the SA" boundary. See
[Plan 049](/docs/plans/049-persistent-gcloud-developer-service-account-epic.md)
for the full rationale.

Your gcloud user creds need to be fresh for the bootstrap step
(occasional `gcloud auth login` before pasting the block). That
reauth is rare — once per new game project. **It is not the
"every Studio click" reauth this whole setup eliminates.**

---

## Rotation

Rotate the key yearly, or sooner if you have any reason to
suspect it's leaked.

```bash
# Generate a new key (gcloud overwrites the file at $KEY_PATH).
gcloud iam service-accounts keys create $KEY_PATH \
  --iam-account $SA_EMAIL
chmod 600 $KEY_PATH

# List existing keys to find the OLD one's ID.
gcloud iam service-accounts keys list --iam-account $SA_EMAIL

# Delete the old key (KEY_ID is the long hex string from the list output).
gcloud iam service-accounts keys delete OLD_KEY_ID \
  --iam-account $SA_EMAIL
```

If you suspect the laptop is lost or the file has leaked,
delete the key immediately (skip the rotate step; you can
re-key fresh later) and revoke any per-project bindings the SA
holds.

---

## Caveats

- **Org policy `iam.disableServiceAccountKeyCreation`.** Some
  orgs disable SA key creation by policy. If
  `gcloud iam service-accounts keys create` returns
  "Service account key creation is disabled", you can't use this
  pattern under that org. Workaround: pick a personal /
  unmanaged project to host the SA. (Workforce Identity
  Federation is the org-approved alternative; out of scope for
  this doc.)
- **Never commit the key.** Keep it under `~/.config/`, which is
  outside any Sugarmagic checkout. Don't put it inside a game
  project directory; one accidental `git add -A` and it's on
  GitHub.
- **One SA per developer.** Don't share the key file across
  machines or teammates. If you get a new laptop, generate a new
  key on the new machine and revoke the old one.
- **The SA has no project roles yet.** Sugarmagic's Layer B
  grants them on demand. If you're scripting outside Sugarmagic
  and need direct access to a specific project from the SA,
  grant it explicitly with
  `gcloud projects add-iam-policy-binding`.

---

## Troubleshooting

**`Reauthentication required` or `Your credentials are no longer
valid` from gcloud after setup.** Check `gcloud auth list` — if
your USER credentials are listed as the active account instead
of the SA, run step 5 again. The SA should be the `*` row.

**Sugarmagic Studio still says "auth not configured".** Studio
inherits its env from the shell that launched it. If you opened
the shell BEFORE step 6, the env var isn't set. Close that shell,
open a new one (which sources `~/.zshrc`), and re-launch Studio.

**`gcloud iam service-accounts keys create` returns a 403.**
You don't have `roles/iam.serviceAccountKeyAdmin` on the tooling
project. Grant yourself the role (or have a project owner do
it) and retry.

---

## References

- [Application Default Credentials (Google docs)](https://cloud.google.com/docs/authentication/application-default-credentials)
- [`gcloud auth activate-service-account`](https://cloud.google.com/sdk/gcloud/reference/auth/activate-service-account)
- [`gcloud iam service-accounts create`](https://cloud.google.com/sdk/gcloud/reference/iam/service-accounts/create)
- [`gcloud iam service-accounts keys create`](https://cloud.google.com/sdk/gcloud/reference/iam/service-accounts/keys/create)
- [Plan 049: Persistent gcloud Auth via Developer Service Account](/docs/plans/049-persistent-gcloud-developer-service-account-epic.md)
