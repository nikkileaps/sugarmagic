/**
 * Root Vitest configuration.
 *
 * Test suites import package public entrypoints so boundary checks and runtime
 * resolution agree. App workspaces are not linked into the root node_modules
 * graph by default, so aliases here mirror the package-level public exports
 * without allowing deep imports.
 */
import { resolve } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@sugarmagic/studio": resolve(
        import.meta.dirname,
        "apps/studio/src/index.ts"
      )
    }
  },
  test: {
    /**
     * `*.e2e.test.ts` is opt-in, via `pnpm test:e2e`.
     *
     * These hit real external services through the local gateway. They are
     * written to skip when the gateway is unreachable -- which means they skip
     * in CI and RUN on a developer machine with the stack up, where they poll a
     * live vector store for up to 90 seconds. That made `pnpm test` fail
     * differently run to run, and starved unrelated unit tests into timeouts
     * (`item-definition.test.ts` taking 14s for a pure assertion), so a failure
     * count stopped meaning anything. A suite that must be run several times to
     * be believed is not a signal.
     */
    exclude:
      process.env["SUGARMAGIC_E2E"] === "1"
        ? [...configDefaults.exclude]
        : [...configDefaults.exclude, "**/*.e2e.test.ts"]
  }
});
