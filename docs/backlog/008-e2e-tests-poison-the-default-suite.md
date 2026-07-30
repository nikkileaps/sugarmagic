# Backlog 008 -- e2e tests poison the default suite

Raised 2026-07-30, while wrapping Plan 090 story 090.2c.

## What happened

`pnpm test` was failing a different number of tests on every run: 1, then 2,
then 3, with a different set each time. That was true on a clean tree as well,
so it predates 090.2.

The cause is `packages/testing/src/lore-roundtrip.e2e.test.ts`. It uploads a file
to the REAL OpenAI vector store through the local gateway and polls for up to 90
seconds waiting for indexing. It is written to skip when the gateway is
unreachable -- so it skips in CI and on a cold machine, and RUNS on a developer
machine with the stack up.

Two consequences, and the second is the nastier one:

1. The test itself fails on network timing.
2. It starves unrelated tests. `item-definition.test.ts > defaults readable
   items to no bound document` was taking **14.5 seconds** for a pure in-memory
   assertion and timing out. It passes in 7ms in isolation. Nothing was wrong
   with it; it was collateral damage.

So a failure count from `pnpm test` stopped meaning anything, which is worse
than a red suite -- a red suite tells you to look.

## What was done now

`*.e2e.test.ts` is excluded from the default run (root `vitest.config.ts`) and
is opt-in via `pnpm test:e2e`, gated on `SUGARMAGIC_E2E=1`. The default suite is
now stable: three consecutive runs, 2024 passed, 0 failed.

Also fixed, and NOT deleted: `plugin-infrastructure.test.ts > SugarDeploy plugin
definition exposes a hostMiddleware contribution` was failing consistently. That
one was not flaky and not broken -- `sugardeploy-update-blocklist` shipped in
`sugardeploy/host/middleware.ts:3511` without being added to the expected list.
The assertion caught a real omission, which is what it is for.

## What to look into

- **Should the e2e test run anywhere at all?** Right now it runs only when
  someone remembers `pnpm test:e2e`. That is better than poisoning the suite but
  it means the ingest->search pipeline has no standing guard. Options: a nightly
  cron against a dedicated store, or a gateway-level contract test that fakes
  OpenAI and a much smaller live smoke test.
- **The skip is silent.** `if (!gatewayReachable) return;` logs to stdout and
  passes. A test that passes without asserting anything reads as coverage it is
  not providing. `it.skipIf(...)` at least reports as skipped.
- **Is anything else in `packages/testing` network-dependent?** This was found by
  running the suite repeatedly rather than by looking, so there may be more.
- **Suite-level timeout policy.** A pure unit test taking 14s should be a hard
  failure with a clear message, not a mystery. A per-file timeout would have
  named the problem immediately instead of costing six full-suite runs.

## Related

- Feedback memory: a test that fails intermittently must be fixed or deleted,
  never tolerated -- flakes poison the failure signal.
