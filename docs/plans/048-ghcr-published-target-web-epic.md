# Plan 048: Engine Released via Manual GHA, Game Pins Engine Version

**Status:** Deferred (superseded for immediate use by
[Plan 053](/docs/plans/053-deploy-time-engine-build.md)).

> The full GHCR-published versioned engine remains the right
> design for the multi-game / breaking-schema-change future. For
> the current single-game development loop, [Plan 053](/docs/plans/053-deploy-time-engine-build.md)
> ships the smaller win (no committed `dist/`, no Build Frontend
> button, GHA builds the engine on each deploy) without version
> pinning. Pick this plan back up when (a) wordlark isn't the
> only game, OR (b) deploy-time builds become a friction point,
> OR (c) we hit a regression cycle bad enough to want pinning.

## Epic

### Title

Cut `@sugarmagic/target-web` over from "build-and-commit per game
repo" to a versioned, GHCR-published artifact. **Engine releases**
happen via a manual GitHub Actions workflow in the sugarmagic repo
(nikki triggers them when she's ready); **game deploys** consume a
pinned engine version. Studio surfaces an upgrade prompt on project
open when a newer engine is available.

### Context

Two distinct lifecycles, previously conflated:

- **Engine lifecycle** (`@sugarmagic/target-web`): a release cuts a
  new version of the engine bundle and publishes it to GHCR. Done by
  the engine maintainer (currently nikki) when she's ready to ship.
  Infrequent, deliberate, human-curated.
- **Game lifecycle** (wordlark, etc.): provision, cut major version,
  deploy. Frequent, routine. Built out by Plans 045 / 046 / 047. Game
  deploys consume a pinned engine version — they never publish one.

Story 46.10's follow-up landed a stopgap (`Build Frontend` button +
committed `dist/` in the game repo). That treats the engine bundle as
a per-game managed file, which bloats game repos and conflates the
two lifecycles. This epic separates them.

### Goal

- Engine releases are a `workflow_dispatch`-only GHA inside the
  sugarmagic repo. nikki opens GitHub's Actions tab, picks
  "Publish target-web", clicks Run. Workflow builds the engine,
  publishes it to GHCR as `ghcr.io/nikkileaps/target-web:vX.Y.Z`,
  bumps a git tag, posts a release note. No Studio involvement.
- Each game project pins a `frontendBundleVersion` in plugin state.
  Studio writes this value during the upgrade prompt; users never
  type it.
- On project open, Studio checks GHCR for the latest available
  engine version vs the project's pin. If newer is available, shows
  a Unity-style modal: "Engine v0.5.0 is available; you're on
  v0.4.2. Upgrade now or stay?" with two buttons.
- Game Deploy is unchanged in spirit from 46.10: pre-baked
  `.sugarmagic/published-web/boot.json` + pulled GHCR engine image,
  netlify-deploy. The engine version baked into the deploy workflow
  YAML is the project's pinned `frontendBundleVersion`.

### Resolved Decisions

- **Distribution channel: GHCR.** OCI image registry, auth via
  `GITHUB_TOKEN`, works for private images. Image contents are just
  `/dist`; consumers extract via `docker create + docker cp`.
- **Engine release is a manual GHA, not Studio-triggered.** Lives in
  `sugarmagic/.github/workflows/publish-target-web.yml`. Triggered
  only by `workflow_dispatch` (and optionally `push: tags:
  ['target-web-v*']` for tag-driven releases later). Studio does not
  dispatch this workflow.
- **Game's deploy never triggers engine publishes.** If Studio
  detects engine drift but the user dismisses the upgrade prompt,
  the deploy proceeds against the pinned version. No silent publish.
- **Version pin lives on plugin state as `frontendBundleVersion`.**
  Studio reads it for the upgrade check; Studio writes it ONLY when
  the user picks "Upgrade" in the prompt. Hand-editable as the
  escape hatch (Unity's `ProjectVersion.txt` analog).
- **Old GHCR tags stay around forever.** No retention policy. Games
  pinned to old versions keep deploying fine. This is GHCR's default
  behavior; we just don't override it.
- **First-deploy on a new game project** behaves the same as the
  upgrade prompt — Studio sees `frontendBundleVersion` is null,
  queries GHCR for the latest, and shows "Engine v0.5.0 is the
  current release. Use it for this project?" with one button
  (Accept). No way to opt out — every game has to have a pinned
  engine to deploy.
- **Schema-version stamping.** The engine bundle ships a
  `bootJsonSchemaVersion` constant. boot.json carries the same
  value at save time. Runtime asserts they match at boot. Mismatch
  surfaces as a clean "schema mismatch" overlay, not a runtime
  error. (Schema migrations themselves are out of scope for this
  epic; we accept that an engine bump can require user attention to
  the game's data.)
- **Upgrade prompt is on project open, NOT on Deploy.** Deploy uses
  whatever's pinned, no questions asked. The upgrade check runs
  exactly once per project-open and dismisses for the session.

### What is NOT in scope

- Auto-cutting engine releases on push. The publish workflow is
  `workflow_dispatch`-only in v1. (Tag-triggered as a fast-follow.)
- Boot.json schema migrations. Each engine version asserts schema
  match; when a bump breaks compatibility, the user has to attend to
  it manually (re-author affected data, or stay on the old engine).
- Cross-game engine sharing. Each game has its own pin.
- Per-environment pinning (dev vs prod). One pin per game.
- Multiple engine flavors (target-web only).

### Open Questions

- Should the upgrade prompt remember "stay" per-project and not
  re-prompt for that specific newer version again? Probably yes —
  re-prompting every project open is annoying. Persist a "dismissed
  versions" array on plugin state.
- Should there be an "always upgrade" project-level toggle for
  active-development games? Defer until we feel the friction.

## Deliverables

### Sugarmagic repo

- `.github/workflows/publish-target-web.yml`:
  - Triggers: `workflow_dispatch` with inputs:
    - `versionBump` (optional, default `"patch"`): "patch" | "minor"
      | "major". Bumps from the most recent `target-web-v*` git tag.
    - `releaseNote` (optional): short human-readable summary,
      attached to the published image as a label and to the git tag
      annotation.
  - Steps:
    1. Checkout.
    2. Resolve the new tag (parse latest `target-web-v*`,
       increment per `versionBump`, default `v0.0.1` for the very
       first publish).
    3. setup-pnpm + setup-node.
    4. `pnpm install --frozen-lockfile`.
    5. `pnpm --filter @sugarmagic/target-web build`.
    6. docker buildx build via `targets/web/Dockerfile.publish` with
       labels:
       - `org.sugarmagic.boot-json-schema-version=<schema>`
       - `org.sugarmagic.release-note=<note>`
       - `org.opencontainers.image.version=<tag>`
       Tagged `ghcr.io/${{ github.repository_owner }}/target-web:<tag>`
       AND `:latest`.
    7. `docker push --all-tags`.
    8. Create + push annotated git tag `target-web-<tag>` with the
       release note in the body.
  - Output: published tag + image digest in the run annotations.
- `targets/web/Dockerfile.publish` — `FROM scratch` image whose
  entire contents is `/dist`. No runtime.
- `BOOT_JSON_SCHEMA_VERSION` becomes a shared export in
  `packages/plugins/src/deployment/published-web.ts`. Imported by
  both the target-web runtime (boot-time assert) and the boot.json
  generator (save-time stamp).

### Studio (engine drift detection)

- `getFrontendBundleVersion(gameProject) -> string | null` on the
  SugarDeploy plugin state.
- `buildSetFrontendBundleVersionCommand(gameProject, version)` —
  builder Studio dispatches when the user picks Upgrade in the
  prompt.
- New host endpoint `POST /__sugardeploy/list-engine-versions` —
  given an owner, runs `gh api
  /users/<owner>/packages/container/target-web/versions` and returns
  a sorted list of available tags. Cached briefly to avoid hammering
  GitHub on rapid project switches.
- Project-open hook in Studio: when a game project loads, fire
  `list-engine-versions`, compare the latest with the project's
  `frontendBundleVersion`. If a newer version exists AND wasn't
  previously dismissed, surface the prompt.
- Upgrade prompt UI:
  - Title: "Engine update available"
  - Body: "This project is using target-web vX.Y.Z. Engine vA.B.C is
    available. (Release note: ...)"
  - Buttons: "Upgrade to vA.B.C" (primary) / "Stay on vX.Y.Z" /
    "Don't ask again for vA.B.C".
  - "Upgrade" dispatches `buildSetFrontendBundleVersionCommand`,
    saves the project, regenerates managed files (the workflow YAML
    bakes in the new pin), Studio prompts the user to commit + push.
- Dismissed-versions tracking: an array on plugin state of versions
  the user explicitly chose not to upgrade to. Suppresses repeat
  prompts on subsequent opens. Cleared whenever the user does
  upgrade.

### Game repos (wordlark first)

- New plugin-state field: `frontendBundleVersion: string | null`,
  null by default until the first engine pin.
- `.sugarmagic/published-web/dist/` is `git rm`'d in the cutover
  commit and added to `.gitignore`. The deploy workflow populates it
  at deploy time from the pulled GHCR image.
- `boot.json` continues to regenerate on save (Story 46.10 follow-
  up's pattern). Lives at `.sugarmagic/published-web/boot.json`.
  Schema version field is read from the engine's
  `BOOT_JSON_SCHEMA_VERSION` constant at the time of generation.

### GHA `deploy-frontend` job rewrite

The job becomes:

1. Checkout the game repo.
2. Login to GHCR using `${{ secrets.GITHUB_TOKEN }}`.
3. `docker pull ghcr.io/${OWNER}/target-web:${VERSION}` where
   `${OWNER}` and `${VERSION}` are baked into the YAML at
   sugardeploy-save-time (from
   `pluginConfigurations[sugardeploy].config.frontendBundleVersion`).
4. `docker create --name target-web-stage ghcr.io/.../target-web:${VERSION}`
   then `docker cp target-web-stage:/dist .sugarmagic/published-web/dist`.
5. `cp .sugarmagic/published-web/boot.json .sugarmagic/published-web/dist/boot.json`.
6. `npx -y netlify-cli@17 deploy --site=$NETLIFY_SITE_ID
   --dir=.sugarmagic/published-web/dist --message="SugarDeploy
   $GITHUB_REF_NAME" --prod`.

The pin is part of the workflow YAML's text (baked in at save time),
so changing the pin -> saving -> committing automatically
regenerates the workflow with the new image tag.

### Build Frontend button removal

`POST /__sugardeploy/build-published-web` and the "Build Frontend"
Studio button are removed. The engine bundle no longer lives in the
game repo, and there's no manual build step to think about.

### Tests

- Snapshot test for `publish-target-web.yml` (in sugarmagic CI).
- Snapshot test for the regenerated `deploy-frontend` job: GHCR
  login + pull + extract + overlay + netlify deploy. Asserts the
  baked-in version matches the game's pin.
- Test for `getFrontendBundleVersion` /
  `buildSetFrontendBundleVersionCommand`.
- Test for the upgrade-prompt dismissal logic (dismissed versions
  don't re-prompt; non-dismissed do).
- Test for the boot-time schema-version assertion.

## Verification

- In sugarmagic, open GitHub -> Actions -> Publish target-web ->
  Run workflow. Choose `versionBump: "patch"`. Workflow runs.
  `ghcr.io/nikkileaps/target-web:v0.0.1` exists; git tag
  `target-web-v0.0.1` was pushed.
- Open wordlark in Studio. Modal: "Engine v0.0.1 is the current
  release. Use it for this project?" Accept. plugin state's
  `frontendBundleVersion` is now `"v0.0.1"`. Save + commit + push.
- Dispatch Deploy. GHA pulls the GHCR image, drops boot.json into
  dist, netlify-deploys. Live URL renders the engine + game data.
- In sugarmagic, edit a target-web source file. Open the publish
  workflow again, dispatch. New `v0.0.2` published.
- Re-open wordlark. Modal: "Engine v0.0.2 is available; you're on
  v0.0.1. (Release note: ...)" Three buttons. Pick "Stay on v0.0.1".
  Deploy. Goes out with v0.0.1.
- Re-open wordlark again. No prompt (dismissed for v0.0.2).
- Re-open wordlark; pick "Upgrade to v0.0.2" this time. plugin state
  updates; save + commit + push; deploy uses v0.0.2.
- Hand-edit `frontendBundleVersion` in `project.sgrmagic` back to
  `"v0.0.1"`. Save (no auto-revert). Deploy uses v0.0.1. Escape hatch
  works.

## Builds On

- Plan 045 (cloud-run-plugin-owned-infrastructure-epic) — backend
  deployment infrastructure.
- Plan 046 (sugardeploy-web-publish-target-epic) — the boot.json
  managed-file pattern that this epic preserves; replaces the Build
  Frontend stopgap.

## Replaces

- The "Build Frontend button + committed `dist/` to game repo"
  workflow introduced in Story 46.10's follow-up. That was always
  intended as a stopgap; this epic is the production design.
