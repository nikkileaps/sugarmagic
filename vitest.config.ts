/**
 * Root Vitest configuration.
 *
 * Test suites import package public entrypoints so boundary checks and runtime
 * resolution agree. App workspaces are not linked into the root node_modules
 * graph by default, so aliases here mirror the package-level public exports
 * without allowing deep imports.
 */
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@sugarmagic/studio": resolve(
        import.meta.dirname,
        "apps/studio/src/index.ts"
      )
    }
  }
});
