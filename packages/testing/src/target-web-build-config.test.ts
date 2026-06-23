/**
 * Story 46.4 — build-time config wiring for targets/web.
 *
 * `readBuildConfig` reads a `VITE_SUGARMAGIC_*` env shape and produces
 * the typed `BuildConfig` the bundle uses at boot. These tests
 * exercise both the populated path (a hosted deploy with gateway URL
 * etc. baked in) and the empty path (Package's pure-client build —
 * gatewayUrl: null, no runtime env keys forwarded).
 */

import { describe, expect, it } from "vitest";
import { readBuildConfig } from "@sugarmagic/target-web/buildConfig";

describe("target-web build config", () => {
  it("a populated env produces a fully-typed BuildConfig with the right runtime-env keys", () => {
    const config = readBuildConfig({
      VITE_SUGARMAGIC_GATEWAY_URL: "https://wordlark-v1-abcde-uc.a.run.app",
      VITE_SUGARMAGIC_GATEWAY_BEARER_TOKEN: "tok_xyz",
      VITE_SUGARMAGIC_GAME_MAJOR_VERSION: "2",
      VITE_SUGARMAGIC_VERSIONED_SLUG: "wordlark-v2-fghij",
      VITE_SUGARMAGIC_GIT_SHA: "deadbeef",
      VITE_SUGARMAGIC_BUILD_TIMESTAMP: "2026-06-22T00:00:00.000Z",
      VITE_SUGARMAGIC_SUGARLANG_TARGET_LANGUAGE: "es"
    });
    expect(config).toEqual({
      gatewayUrl: "https://wordlark-v1-abcde-uc.a.run.app",
      gatewayBearerToken: "tok_xyz",
      majorVersion: 2,
      versionedSlug: "wordlark-v2-fghij",
      gitSha: "deadbeef",
      buildTimestamp: "2026-06-22T00:00:00.000Z",
      // The runtime env carries the gateway URL under both the
      // generic SUGARMAGIC_GATEWAY_URL key AND the per-plugin proxy
      // keys (SugarAgent + Sugarlang point at the same gateway when
      // no plugin-specific override is set). Studio's preview path
      // does the same thing via readStudioPluginRuntimeEnvironment;
      // plugin runtime code reads through these keys without per-
      // target forking.
      pluginRuntimeEnvironment: {
        SUGARMAGIC_GATEWAY_URL: "https://wordlark-v1-abcde-uc.a.run.app",
        SUGARMAGIC_GATEWAY_BEARER_TOKEN: "tok_xyz",
        SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL:
          "https://wordlark-v1-abcde-uc.a.run.app",
        SUGARMAGIC_SUGARLANG_PROXY_BASE_URL:
          "https://wordlark-v1-abcde-uc.a.run.app",
        SUGARMAGIC_SUGARLANG_TARGET_LANGUAGE: "es"
      }
    });
  });

  it("an empty env produces the pure-client (no gateway) shape", () => {
    // This is the build Package (Story 46.1) produces — no gateway,
    // no plugins needing runtime env keys, no version identity yet
    // (until the user runs through SugarDeploy provisioning).
    const config = readBuildConfig({});
    expect(config).toEqual({
      gatewayUrl: null,
      gatewayBearerToken: null,
      majorVersion: null,
      versionedSlug: "",
      gitSha: "",
      buildTimestamp: "",
      pluginRuntimeEnvironment: {}
    });
  });

  it("per-plugin proxy overrides take precedence over the generic gateway URL", () => {
    // A future setup where SugarAgent and Sugarlang each have their
    // own dedicated proxy hosts (e.g. different gateways per service)
    // — the explicit per-plugin URL wins.
    const config = readBuildConfig({
      VITE_SUGARMAGIC_GATEWAY_URL: "https://gateway.example.com",
      VITE_SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL: "https://agent.example.com",
      VITE_SUGARMAGIC_SUGARLANG_PROXY_BASE_URL: "https://lang.example.com"
    });
    expect(config.pluginRuntimeEnvironment).toMatchObject({
      SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL: "https://agent.example.com",
      SUGARMAGIC_SUGARLANG_PROXY_BASE_URL: "https://lang.example.com"
    });
  });

  it("invalid major version values fall back to null", () => {
    // Whitespace, non-numeric, negative, and zero all collapse to null
    // — the runtime treats missing majorVersion as "development build,
    // no version identity yet."
    expect(readBuildConfig({ VITE_SUGARMAGIC_GAME_MAJOR_VERSION: "" }).majorVersion).toBeNull();
    expect(readBuildConfig({ VITE_SUGARMAGIC_GAME_MAJOR_VERSION: "abc" }).majorVersion).toBeNull();
    expect(readBuildConfig({ VITE_SUGARMAGIC_GAME_MAJOR_VERSION: "-1" }).majorVersion).toBeNull();
    expect(readBuildConfig({ VITE_SUGARMAGIC_GAME_MAJOR_VERSION: "0" }).majorVersion).toBeNull();
    expect(readBuildConfig({ VITE_SUGARMAGIC_GAME_MAJOR_VERSION: "1.7" }).majorVersion).toBe(1);
    expect(readBuildConfig({ VITE_SUGARMAGIC_GAME_MAJOR_VERSION: "5" }).majorVersion).toBe(5);
  });
});
