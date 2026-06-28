# Plan 052: target-web Production Build Mode Investigation

**Status:** Proposed
**Date:** 2026-06-27

> Surfaced during Plan 047 §47.10.5 prod verification. The
> deployed Netlify bundle at `wordlark-prod.netlify.app` contains
> `jsxDEV` calls — React's development JSX runtime — when it
> should contain `jsx`/`jsxs` (production). That means React
> StrictMode is double-invoking effects in the "production"
> deploy, which broke the `sessionStorage`-flag-based New Game
> reset path (the boot's useEffect setup #1 read+cleared the flag,
> StrictMode cleanup ran, setup #2 re-read empty, and the host
> launched twice with `skipStartMenuOnBoot: false` the second
> time, re-opening the menu we'd just suppressed).

## Epic

### Title

Find and fix whatever's keeping `@sugarmagic/target-web` building
in development mode instead of production.

### Why this matters

- **Performance.** Dev React is ~3x larger, with extra runtime
  checks, prop-types validation, scheduler debug paths. Wordlark
  players pay the cost on every page load.
- **Correctness bait.** React StrictMode double-invokes effects
  in dev. Useful in development for catching cleanup bugs. In a
  shipped bundle, it makes setup-clear-setup patterns work
  differently than in true production. Plan 047 §47.10.5 hit
  this directly — we worked around it by moving sessionStorage
  read to module level, but other future code that legitimately
  relies on once-per-mount effects could trip on the same rake.
- **Hidden invariants.** Dev React swallows certain errors and
  logs them as warnings; prod surfaces them differently. Users
  could be hitting prod-only crash modes that we never see in
  dev, OR dev-mode crashes that real prod would handle cleanly.

### Goal

- The deployed `target-web` bundle contains `jsx`/`jsxs` calls,
  NOT `jsxDEV`. Verifiable via
  `curl <bundle-url> | grep -c jsxDEV` returning 0.
- `process.env.NODE_ENV === "production"` is true at React's
  resolution time in the build.
- React StrictMode is a no-op in the deployed bundle. Effects
  run once, not twice.
- The Plan 047 §47.10.5 module-level `__freshStartFlag` workaround
  retires (or stays as defensive belt-and-braces) once StrictMode
  is no-op in prod.

## Context

### What we know

- `targets/web/vite.config.ts` is minimal: `defineConfig({plugins: [react()]})`.
- Studio's Build Frontend host action shells
  `pnpm --filter @sugarmagic/target-web build` (in
  `packages/plugins/src/catalog/sugardeploy/host/middleware.ts:2721`).
- The `build` script in `targets/web/package.json` is `vite build`.
- `vite build` defaults to `--mode production`, which is supposed
  to set `NODE_ENV=production`.
- `@vitejs/plugin-react` is supposed to pick the production JSX
  runtime when mode is production.
- The deployed bundle has `jsxDEV(...)` calls, observed in
  Plan 047 §47.10.5 stack traces (`e.jsxDEV @ index-CqyBouX9.js`).
- React 18 in actual production mode would treat StrictMode as a
  no-op. The bundle is NOT in actual production mode.

### What we don't know

- Why `vite build` is emitting dev JSX. Suspects to investigate:
  - The `buildEnv` map Studio's middleware passes to the subprocess
    (line 2725) — does it inadvertently carry `NODE_ENV=development`
    from Studio's own dev-mode vite process?
  - Some implicit `mode` override in pnpm workspace config or
    target-web's own config.
  - `@vitejs/plugin-react` version-specific behavior — possibly a
    bug or undocumented requirement.
  - The published-web build path (Plan 048 GHCR engine image)
    might be using a different invocation than Studio's host
    action. If GHCR builds correctly and Studio's Build Frontend
    builds in dev mode, the diff is in the invocation environment.

## Deliverables

1. **Reproduce the bug deterministically.** Run
   `pnpm --filter @sugarmagic/target-web build` from the
   monorepo root and inspect `targets/web/dist/assets/index-*.js`
   for `jsxDEV` — that should NOT be there.
2. **Identify the root cause.** Most likely candidates:
   - Studio's Build Frontend host middleware leaking
     `NODE_ENV=development` into the subprocess env. Fix: scrub
     `NODE_ENV` from the passed env, or explicitly set it to
     `production`.
   - Vite default mode resolution is being overridden somewhere
     (a `mode` parameter, a `.env.development` file, etc.).
   - `@vitejs/plugin-react`'s `jsxRuntime` option needs explicit
     `'automatic'` + production mode handshake.
3. **Land the fix.** Change in one of:
   - `packages/plugins/src/catalog/sugardeploy/host/middleware.ts`
     (clean env passed to the build subprocess).
   - `targets/web/vite.config.ts` (explicit prod settings).
   - `targets/web/package.json` (`build: vite build --mode production`
     explicitly, as a belt + suspenders).
4. **Verify on prod.** Re-run Build Frontend → commit dist → push
   → deploy. Curl the new bundle and grep for `jsxDEV` — expect
   0. Curl for `jsx\(` and confirm production runtime calls
   present.
5. **Retire the §47.10.5 workaround** OR keep as comment-only
   note documenting the prior decision. Either is fine; the
   defensive module-level capture costs nothing.

## Open Questions

- **GHCR-built engine (Plan 048).** Does the GHCR engine image
  build also have this problem, or is it specific to the
  Studio-shelled Build Frontend invocation? If GHCR is correct,
  the bug is purely in Studio's shell-out env, which is the
  simpler fix.
- **Was the build ever correct?** It would be useful to bisect:
  earliest commit where `jsxDEV` started appearing in the deployed
  bundle. Could narrow the suspect set to a specific config /
  dependency change.

## Builds On

- [Plan 046: SugarDeploy Web Publish Target Epic](/docs/plans/046-sugardeploy-web-publish-target-epic.md)
  — defines the Build Frontend host action.
- [Plan 047 §47.10.5](/docs/plans/047-sugarprofile-user-management-plugin-epic.md)
  — where this bug surfaced and where the module-level workaround
  lives.
- [Plan 048: GHCR Published Target Web](/docs/plans/048-ghcr-published-target-web-epic.md)
  — the proper engine-image build path; relevant to the
  "does this affect both build paths?" open question.
