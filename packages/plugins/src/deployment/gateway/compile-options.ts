/**
 * packages/plugins/src/deployment/gateway/compile-options.ts
 *
 * Purpose: Single source of truth for the esbuild options that compile
 * core.ts into GATEWAY_CORE_COMPILED_SOURCE.
 *
 * Exports:
 *   - buildGatewayCompileOptions
 *
 * Relationships:
 *   - Consumed by scripts/build-gateway-source.mts (the generator) and
 *     core-compiled-freshness.test.ts (the drift guard). Sharing the options
 *     is what makes the freshness test authoritative: both paths compile
 *     with byte-identical settings.
 *
 * Implements: Story 071.9 gateway source pipeline
 *
 * Status: active
 */

import { join, dirname } from "node:path";
import type { BuildOptions } from "esbuild";

export function buildGatewayCompileOptions(coreEntryPath: string): BuildOptions {
  return {
    entryPoints: [coreEntryPath],
    // Pin the working directory to the package root so the source-path
    // comments esbuild emits ("// src/deployment/gateway/...") are identical
    // no matter where the build is invoked from (script cwd vs vitest cwd).
    absWorkingDir: join(dirname(coreEntryPath), "..", "..", ".."),
    bundle: true,
    write: false,
    format: "esm",
    target: "es2022",
    platform: "node",
    external: ["node:*"],
    // Preserve /*! ... */ legal comments so the __GATEWAY_AUTH_GATE__
    // placeholder survives for buildGatewayServerFile to inject into.
    legalComments: "inline",
    minify: false,
    // Disable tree-shaking so verifySupabaseJwt and the JWKS helpers
    // are included in all auth modes. They're dead code in none/bearer
    // but the auth gate injection in buildGatewayServerFile may call
    // them, and the compiled string can't retroactively add them.
    treeShaking: false
  };
}
