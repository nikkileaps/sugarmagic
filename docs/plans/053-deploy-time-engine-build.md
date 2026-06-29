# Plan 053: Deploy-Time Engine Build (GHA builds target-web on each deploy)

**Status:** Shipped 2026-06-29. Story 053.7 replaced by [Plan 054](/docs/plans/054-player-session-owner-epic.md) (PlayerSession) — the per-callsite halt() handle is gone; structural guarantee now lives in `SerializedSaveStore`.
**Date:** 2026-06-27

> **Supersedes the immediate scope of [Plan 048](/docs/plans/048-ghcr-published-target-web-epic.md).**
> Plan 048's full GHCR-published versioned engine remains the
> right design for a future state with multiple games / breaking
> schema changes / distributed engine. For nikki's current
> single-game development loop, the smaller win is removing the
> Build Frontend dance — the "click button → commit dist → push"
> friction was the actual pain point, not the lack of version
> pinning. Plan 053 ships that smaller win.

## Epic

### Title

Stop committing the built `target-web` `dist/` to game repos. Make
the deploy GHA job check out the sugarmagic repo and run
`pnpm --filter @sugarmagic/target-web build` itself, so the only
thing the author commits between content changes and deploy is the
small `boot.json` file.

### Context

Today the loop is:

1. Author edits content in Studio → Studio writes
   `.sugarmagic/published-web/boot.json`.
2. Author clicks **Build Frontend** in Studio → Studio shells
   `pnpm --filter @sugarmagic/target-web build` and copies
   `dist/` into `.sugarmagic/published-web/dist/`.
3. Author `git add .sugarmagic/published-web/` (boot.json AND
   dist/ — the latter is multi-megabyte) → commit → push.
4. GHA `deploy-frontend` job: checkout, validate dist/ exists,
   `cp boot.json dist/`, `netlify-cli deploy --prod`.

Friction:

- **Step 2** has to be remembered. Forget it and step 4 errors
  with "dist missing".
- **Step 3** stages a lot of bytes for what's conceptually a
  content-only change.
- The engine bundle in the game repo is "whichever build
  succeeded last", with no provenance.
- Plan 047 §47.10.5 verification hit a related bug: the bundle
  Studio's Build Frontend produces appears to be a **dev React
  bundle** (`jsxDEV` calls observed), which broke
  StrictMode-sensitive code in prod. Captured separately in
  [Plan 052](/docs/plans/052-target-web-build-mode-investigation.md);
  folded into this plan because the new GHA build path has to
  produce a production bundle to be useful.

### Goal

- **No `Build Frontend` button.** Studio stops shipping the
  endpoint + UI affordance for it.
- **No committed `dist/`.** Game repos `git rm` the existing
  `.sugarmagic/published-web/dist/` and add it to `.gitignore`.
  The directory regenerates inside the GHA runner at deploy time.
- **GHA builds the engine.** The `deploy-frontend` job clones the
  sugarmagic repo as a sibling working directory, runs
  `pnpm install --frozen-lockfile`, runs `pnpm --filter
  @sugarmagic/target-web build`, copies the resulting `dist/` to
  the expected location, overlays `boot.json`, deploys to Netlify.
- **The bundle is a production React bundle.** No `jsxDEV` calls.
  StrictMode is a no-op. Effects run once. (Closes [Plan 052](/docs/plans/052-target-web-build-mode-investigation.md).)
- **Author's deploy loop:** save in Studio → `git add
  .sugarmagic/published-web/boot.json && git commit && git push`
  → wait for GHA → live. That's it.

### What is NOT in scope

- **Version pinning per game.** Every wordlark deploy uses
  whatever `sugarmagic` `main` is at the moment GHA runs. No
  `frontendBundleVersion` field, no upgrade prompt, no engine
  release workflow. (Plan 048 stays around as the design we'd
  reach for if this becomes painful.)
- **Engine release cadence.** No release notes, no engine
  versioning. Engine = whatever's on sugarmagic main.
- **Cross-game engine sharing.** Each game's GHA job clones
  sugarmagic independently. Build cache reuse across games is not
  attempted; pnpm install is repeated per job.
- **boot.json schema mismatch handling.** If a sugarmagic change
  bumps the boot.json shape in a way the game's committed
  boot.json doesn't match, the deploy fails at runtime. Acceptable
  for v1; schema-version assertion is a follow-up if it bites.
- **Private sugarmagic repo.** This plan assumes sugarmagic is
  reachable via a GHA-runtime token (either public, or accessible
  via the existing GHA `GITHUB_TOKEN` permissions, or a deploy
  key). Cross-org private-clone setup is out of scope; if the
  setup hits friction we narrow the plan accordingly.

### Resolved Decisions

- **Engine source = sugarmagic main, always.** No pinning. If
  main regresses, the next game deploy picks up the regression
  until fixed. nikki accepts this for the single-developer
  single-game horizon; if it becomes painful, revisit Plan 048.
- **Sugarmagic checkout via `actions/checkout`.** A second
  `actions/checkout` step with `repository: nikkileaps/sugarmagic`
  + `path: sugarmagic` clones into a sibling directory inside the
  GHA runner. Simpler than git submodules and avoids touching the
  wordlark repo's git config.
- **Build cache via GHA's `pnpm/action-setup` + node cache.**
  Standard pnpm cache config; no custom infrastructure.
- **Plan 052 work folds in as story 053.1.** The diagnosis +
  fix is a prerequisite for any deploy from this path — a dev
  bundle in prod is worse than the current state.

### Open Questions

- **Does the `sugarmagic` repo need to be public, or does the
  GHA token have read access?** Need to check `gh auth status`
  in the wordlark GHA job vs. sugarmagic's repo visibility.
  Resolution drives whether 053.2 needs a PAT or works with the
  default `GITHUB_TOKEN`. Verify before writing the YAML.
- **What ref of sugarmagic do we check out?** `main` is the
  default. We could also accept a hand-edited override in the
  generated YAML (escape hatch — "deploy this game against my
  feature branch"). Probably worth shipping as a workflow input.

## Stories

### 053.1 — Fix the dev-mode build (folds Plan 052 in)

**Files (likely modify):**

- `targets/web/vite.config.ts` — maybe add explicit
  `mode: "production"` handling or `jsxRuntime: "automatic"` if
  needed.
- `targets/web/package.json` — `build: vite build --mode production`
  (belt + suspenders).
- `packages/plugins/src/catalog/sugardeploy/host/middleware.ts` —
  if the bug is Studio's `buildEnv` leaking `NODE_ENV=development`
  into the spawned `vite build`, scrub it. (Build Frontend goes
  away in 053.4 either way, but during 053 verification we want
  the local build to also produce prod bundles so 053.1's
  verification is doable without redeploying.)

**Tests:**

- After 053.1, `pnpm --filter @sugarmagic/target-web build`
  produces a dist whose `assets/*.js` contains 0 occurrences of
  `jsxDEV`.
- `grep -c 'jsx(' assets/*.js > 0` (production runtime present).

**Exit:** local `pnpm build` + curl the dist file + grep
returns 0 `jsxDEV`. Once this lands, the next stories can ship a
deploy that's guaranteed to produce a prod bundle.

### 053.2 — Deploy-frontend job rewrite

**Files (modify):**

- `packages/plugins/src/deployment/github-workflow.ts` —
  rewrite the `deploy-frontend` job to:
  1. Checkout wordlark (default).
  2. Checkout `nikkileaps/sugarmagic` into `./sugarmagic/`.
  3. `pnpm/action-setup` + `actions/setup-node` with pnpm cache.
  4. `cd sugarmagic && pnpm install --frozen-lockfile`.
  5. `cd sugarmagic && pnpm --filter @sugarmagic/target-web build`.
  6. `mkdir -p .sugarmagic/published-web/dist && cp -r sugarmagic/targets/web/dist/* .sugarmagic/published-web/dist/`.
  7. `cp .sugarmagic/published-web/boot.json .sugarmagic/published-web/dist/boot.json`.
  8. `npx -y netlify-cli@17 deploy --site=$NETLIFY_SITE_ID
     --dir=.sugarmagic/published-web/dist --message="SugarDeploy
     $GITHUB_REF_NAME" --prod`.
- `packages/plugins/src/deployment/github-workflow.ts` template
  version bump + rename ledger entry for the YAML shape change.

**Tests:**

- Snapshot test in `plugin-infrastructure.test.ts` that the
  generated workflow YAML carries the new checkout / build /
  overlay / deploy sequence. Asserts the pinned actions (e.g.
  `actions/checkout@v4`) match.
- Snapshot test that the old "validate dist exists" step is gone.

**Exit:** snapshot tests pass. The generated YAML is committed
under wordlark's `.github/workflows/sugardeploy-deploy.yml` after
a fresh project save.

### 053.3 — Wordlark cutover

**Files (modify in wordlark):**

- `git rm -r .sugarmagic/published-web/dist/`.
- `.gitignore` — add `.sugarmagic/published-web/dist/`.
- Save project in Studio → commits the regenerated workflow YAML
  from 053.2 + the new .gitignore + the boot.json that hasn't
  changed.

**Tests:** verification recipe (manual): push → GHA runs → image
deployed → live URL renders correctly.

**Exit:** wordlark deploys successfully without `.sugarmagic/published-web/dist/`
being in the repo.

### 053.4 — Remove Build Frontend

**Files (modify):**

- `packages/plugins/src/catalog/sugardeploy/host/middleware.ts` —
  delete the `POST /__sugardeploy/build-published-web` handler.
- `apps/studio/src/plugins/catalog/sugardeploy/index.tsx` —
  delete the Build Frontend button + the React state machine
  that calls the endpoint.
- README updates: `packages/plugins/src/deployment/README.md` —
  drop the Build Frontend row from the host-endpoint table.

**Tests:** ensure no callers reference the deleted endpoint.

**Exit:** Studio's SugarDeploy workspace no longer has a Build
Frontend button. The endpoint 404s.

### 053.5 — Verify + clean up

- Manual: end-to-end deploy from a content-only change in
  wordlark. Loop should be: save → click Deploy in Studio →
  live. (053.6 makes Deploy the only step nikki touches; without
  053.6 the loop still includes the git commit/push dance.)
- Confirm `Plan 052` retires (or stays as a comment-only
  reference) — the dev-mode workaround in `targets/web/src/App.tsx`
  (the module-level `__freshStartFlag`) can stay as defensive
  belt-and-suspenders, or get cleaned up.
- Update `targets/web/README.md` to reflect the new deploy path
  (no Build Frontend; engine built at deploy time).
- Update Plan 048's status banner to "deferred — superseded for
  immediate use by Plan 053".

### 053.6 — Deploy is the only button

**Why:** the cleanup in 053.1–053.5 still leaves nikki running
`git add / git commit / git push` in two different repos depending
on whether her change was content (wordlark) or engine
(sugarmagic). The point of the rewrite was to collapse the deploy
loop down to one action. Right now it collapses to one action
+ two terminals.

**Behavior when Deploy is clicked:**

1. **Wordlark git preflight.** Detect uncommitted changes in the
   game repo (regenerated workflow YAML, boot.json, anything
   else staged or unstaged); auto-commit them with a default
   `[sugardeploy] <iso-timestamp>` message. If there are
   unpushed commits, push them.
2. **Sugarmagic git preflight.** Same treatment in the
   sugarmagic monorepo — Studio runs from inside it and knows
   its workdir. Auto-commit anything dirty (engine source edits,
   plugin edits) with the same `[sugardeploy] <iso-timestamp>`
   message; push if unpushed.
3. **Capture both head shas.** The wordlark head sha becomes the
   workflow's `ref` input; the sugarmagic head sha becomes the
   workflow's `sugarmagic_ref` input. Shipping shas explicitly
   instead of branch names removes the "what if main moved
   between push and dispatch" race.
4. **Dispatch.** Existing
   `POST /__sugardeploy/dispatch-deploy-workflow` endpoint
   (`packages/plugins/src/catalog/sugardeploy/host/middleware.ts`)
   gets the two-repo preflight + `sugarmagic_ref` input added.
5. **Surface the run URL.** Same toast / link Studio already
   shows for deploys today.

**Files (modify):**

- `packages/plugins/src/catalog/sugardeploy/host/middleware.ts` —
  add a `runGitPreflight(repoDir)` helper that does
  status / commit-if-dirty / push-if-unpushed and returns the
  resulting head sha. Call it for both the wordlark workdir and
  the sugarmagic workdir before the existing
  `gh workflow run` call. Pass `-f sugarmagic_ref=<sha>` through
  the dispatch args.
- Studio's deploy React form — likely no shape change; the same
  Deploy button gets the new behavior for free. May want to add
  a "Deploy did the following commits" panel under the run URL.
- `packages/plugins/src/deployment/README.md` — describe the
  preflight semantics.

**Guard rails (open for discussion):**

- Don't auto-commit if the sugarmagic checkout is on a non-`main`
  branch AND the workflow target is the production Netlify site.
  Either skip the auto-commit (so nikki sees a clear error) or
  require an explicit "ship from this branch" override. Default
  posture: trust nikki, ship from whatever branch is checked out
  — the workflow already accepts an arbitrary sugarmagic ref.
- If the auto-commit message ever needs editing (squashing, fix
  before merge), the regular git history flow still works; the
  commits aren't immutable.

**Tests:**

- Unit-test the git preflight helper against a fake `runHostCommand`
  matrix: clean/dirty x ahead/behind/up-to-date x main/feature
  branch. Assert the right sequence of `git add / git commit / git
  push` calls and the right return shape.

**Exit:** save a content change in Studio → click Deploy → run
URL appears → site updates. No terminal touched.

### 053.7 — New Game reset path drops position changes

**Status:** Fixed. See `useAutosave`'s new `AutosaveHandle.halt()`
in `targets/web/src/save/useAutosave.ts` and the
`await autosave.halt()` (or `registeredAutosaveHalt`) call before
`store.clear()` in both `targets/web/src/App.tsx` and
`apps/studio/src/preview.tsx`.

**Symptom:** clicking "New Game" in the published-web Start menu
correctly dismisses the menu, but the player is not back at
origin on the post-reload boot. The §47.10.5 fix was specifically
about the menu re-opening; player position reset was assumed to
work via the save delete + reload sequence, but never explicitly
verified.

**Hypothesis (likely):** autosave's 5s tick has an in-flight
Promise pending when `onStartNewGame` runs `store.delete(userId)`
+ reload. The delete resolves; the pending autosave then fires
its `store.save(userId, {...})` with the stale payload AFTER the
delete; reload reads the stale autosave write.

**Likely fix:** in `targets/web/src/App.tsx`'s `onStartNewGame`
callback, cancel the autosave hook (clear the interval / set a
"halted" flag the hook checks) BEFORE calling `store.delete`.
Belt-and-suspenders option: also have the delete branch set a
"recently deleted" timestamp the autosave checks before writing,
so a racing tick after delete drops on the floor.

**Verification recipe:** play wordlark in prod, advance the
player away from origin, autosave a few times (HUD shows
writes), click Start menu → New Game. Post-reload, player should
be back at origin AND have a fresh quest state.

**Builds On:** Plan 047 §47.10.5 (module-level `__freshStartFlag`
+ start-new-game UI action).

### Future direction (out of scope, sketched for context)

Sandbox / Staging / Production environments. Once those exist as
real Netlify sites + Cloud Run services, the Deploy button
becomes a split-button menu:

- **Deploy to Sandbox** — push everything to a sandbox env;
  same auto-commit + dispatch flow as 053.6 but targets the
  sandbox sites.
- **Deploy to Staging** — same flow against the staging sites.
- **Release** — formal: cuts a `v*` tag, dispatches against that
  tag, deploys to production. Auto-commit still allowed but the
  tag becomes the immutable reference.

053.6 ships the single-env "press Deploy and don't think about
it" UX so this future split-button just inherits the same
preflight, with the target as a parameter. Probably a separate
plan (054+) once the envs exist.

## Verification

End-to-end recipe once everything lands:

1. nikki edits a piece of authored content in wordlark via Studio.
2. nikki saves the project. Studio regenerates
   `.sugarmagic/published-web/boot.json` AND
   `.github/workflows/sugardeploy-deploy.yml` (the latter only if
   it changed shape).
3. `cd wordlark && git add .sugarmagic/published-web/boot.json
   .github/workflows/sugardeploy-deploy.yml && git commit -m "..."
   && git push`.
4. GHA fires the deploy workflow.
5. Runner clones wordlark, clones sugarmagic, runs pnpm install +
   build, copies dist + overlays boot.json, deploys to Netlify.
6. Visit `https://wordlark-prod.netlify.app/` — content change is
   live.

Total deploy time should be wall-clock ≤ 5 min (most of which is
pnpm install + build). All forward-flowing — no extra Studio
buttons, no committed engine bytes.

## Builds On

- [Plan 046: SugarDeploy Web Publish Target Epic](/docs/plans/046-sugardeploy-web-publish-target-epic.md)
  — defines the boot.json managed-file pattern that survives
  unchanged.
- [Plan 052: target-web Build Mode Investigation](/docs/plans/052-target-web-build-mode-investigation.md)
  — folded in as story 053.1.

## Defers

- [Plan 048: Engine via Manual GHA, Game Pins Engine Version](/docs/plans/048-ghcr-published-target-web-epic.md)
  — Plan 048's full GHCR-published versioned engine remains the
  right design for the multi-game / breaking-schema future. We're
  picking it back up when (a) wordlark isn't the only game, OR
  (b) deploy-time builds become a friction point because of
  build duration, OR (c) we hit a regression cycle bad enough to
  want pinning.
