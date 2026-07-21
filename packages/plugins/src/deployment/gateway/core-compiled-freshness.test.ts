/**
 * packages/plugins/src/deployment/gateway/core-compiled-freshness.test.ts
 *
 * Purpose: Guards against drift between the gateway TS source (core.ts +
 * supabase-jwt.ts) and the committed compiled artifact that actually ships
 * to Cloud Run (core.compiled.ts).
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Compiles core.ts in-process with the exact options from
 *     compile-options.ts (shared with scripts/build-gateway-source.mts)
 *     and compares byte-for-byte against GATEWAY_CORE_COMPILED_SOURCE.
 *
 * Implements: Story 071.9 gateway source pipeline
 *
 * Status: active
 */

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { GATEWAY_CORE_COMPILED_SOURCE } from "./core.compiled";
import { buildGatewayCompileOptions } from "./compile-options";

describe("core.compiled.ts freshness", () => {
  it("matches an in-process esbuild of core.ts", async () => {
    const coreTs = join(dirname(fileURLToPath(import.meta.url)), "core.ts");
    const result = await build(buildGatewayCompileOptions(coreTs));
    const fresh = result.outputFiles?.[0]?.text ?? "";

    expect(fresh.length).toBeGreaterThan(0);
    // Compare via boolean so a mismatch fails with the remedy instead of
    // dumping two ~35KB strings into the diff.
    expect(
      fresh === GATEWAY_CORE_COMPILED_SOURCE,
      "core.compiled.ts is stale: run `pnpm --filter @sugarmagic/plugins build:gateway-source` and commit the result."
    ).toBe(true);
  });
});
