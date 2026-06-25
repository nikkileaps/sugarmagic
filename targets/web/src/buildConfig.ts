/**
 * Story 46.4 — build-time configuration baked into the published-web
 * bundle.
 *
 * Build flow (GHA workflow, Story 46.7 will wire this): every Vite
 * env var prefixed `VITE_SUGARMAGIC_*` gets inlined as a compile-time
 * constant in the bundle. `readBuildConfigFromViteEnv()` reads those
 * constants on startup and produces a typed `BuildConfig`. The Studio
 * preview path uses the exact same `VITE_SUGARMAGIC_*` convention via
 * `apps/studio/src/runtimeEnv.ts` — same naming, different consumer.
 *
 * `pluginRuntimeEnvironment` is the unprefixed `SUGARMAGIC_*` map the
 * plugin runtime contract expects (see
 * `packages/plugins/src/runtime/index.ts`). Gateway-needing plugins
 * (SugarAgent's LLM proxy, etc.) read their URLs out of this map —
 * exact same shape Studio's preview passes through, only the source
 * differs (build-time inlined env vs. Studio dev-server runtime env).
 *
 * For Package's no-gateway build (Story 46.1): the env vars are
 * absent, `readBuildConfig` returns `gatewayUrl: null` + empty
 * runtime environment, and any plugin that demanded one would have
 * already been blocked at Package's enabled-plugin gate.
 */

import type { RuntimePluginEnvironment } from "@sugarmagic/plugins";

export interface BuildConfig {
  /**
   * The Cloud Run gateway URL the bundle calls for plugin requests.
   * `null` when this is a pure-client (no-gateway) build.
   */
  gatewayUrl: string | null;
  /**
   * Bearer token presented as `Authorization: Bearer <token>` on every
   * gateway request when `gatewayAuthMode === "bearer"`. `null` when
   * the gateway is open (`gatewayAuthMode === "none"`) or when this is
   * a pure-client build. Honor-system value — baked into the bundle,
   * extractable by anyone who downloads it (per Plan 045 / 45.5.8).
   */
  gatewayBearerToken: string | null;
  /**
   * Major version of the game project the bundle was built from.
   * `null` when unset (development builds without versioning).
   */
  majorVersion: number | null;
  /**
   * Versioned slug `${slug}-v${major}-${suffix}` — the canonical
   * identifier for THIS build's matching backend Cloud Run project +
   * Netlify deploy. Empty string when unset.
   */
  versionedSlug: string;
  /** Git SHA the bundle was built from. Empty string when unset. */
  gitSha: string;
  /** ISO-8601 timestamp of the build. Empty string when unset. */
  buildTimestamp: string;
  /**
   * The plugin runtime environment threaded into
   * `createWebRuntimeHost.start()`. Same shape Studio's preview path
   * produces via `readStudioPluginRuntimeEnvironment`. Empty when no
   * gateway-needing values were provided at build time.
   */
  pluginRuntimeEnvironment: RuntimePluginEnvironment;
}

interface RawBuildEnv {
  VITE_SUGARMAGIC_GATEWAY_URL?: string;
  VITE_SUGARMAGIC_GATEWAY_BEARER_TOKEN?: string;
  VITE_SUGARMAGIC_GAME_MAJOR_VERSION?: string;
  VITE_SUGARMAGIC_VERSIONED_SLUG?: string;
  VITE_SUGARMAGIC_GIT_SHA?: string;
  VITE_SUGARMAGIC_BUILD_TIMESTAMP?: string;
  /**
   * Additional gateway-routed plugin URLs — same naming convention
   * Studio uses. Forwarded into the runtime environment so the
   * plugin runtime can resolve them.
   */
  VITE_SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL?: string;
  VITE_SUGARMAGIC_SUGARLANG_PROXY_BASE_URL?: string;
  VITE_SUGARMAGIC_SUGARLANG_TARGET_LANGUAGE?: string;
}

function asStringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringOrNull(value: unknown): string | null {
  const trimmed = asStringOrEmpty(value);
  return trimmed.length > 0 ? trimmed : null;
}

function asMajorVersionOrNull(value: unknown): number | null {
  const trimmed = asStringOrEmpty(value);
  if (trimmed.length === 0) return null;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || numeric < 1) return null;
  return Math.floor(numeric);
}

/**
 * Pure-function build-config reader — takes any object resembling
 * Vite's env shape and produces a `BuildConfig`. Lets tests synthesize
 * arbitrary envs without mocking `import.meta.env`.
 */
export function readBuildConfig(env: RawBuildEnv): BuildConfig {
  const gatewayUrl = asStringOrNull(env.VITE_SUGARMAGIC_GATEWAY_URL);
  const gatewayBearerToken = asStringOrNull(
    env.VITE_SUGARMAGIC_GATEWAY_BEARER_TOKEN
  );
  const majorVersion = asMajorVersionOrNull(
    env.VITE_SUGARMAGIC_GAME_MAJOR_VERSION
  );
  const versionedSlug = asStringOrEmpty(env.VITE_SUGARMAGIC_VERSIONED_SLUG);
  const gitSha = asStringOrEmpty(env.VITE_SUGARMAGIC_GIT_SHA);
  const buildTimestamp = asStringOrEmpty(
    env.VITE_SUGARMAGIC_BUILD_TIMESTAMP
  );

  // Mirror the keys Studio's `readStudioPluginRuntimeEnvironment`
  // produces so plugin runtime code that already works in Studio's
  // preview also works in the published bundle without per-target
  // forking. Only forward keys whose values are non-empty.
  const pluginRuntimeEnvironment: RuntimePluginEnvironment = {};
  function forward(key: string, value: unknown): void {
    const trimmed = asStringOrNull(value);
    if (trimmed !== null) pluginRuntimeEnvironment[key] = trimmed;
  }
  forward("SUGARMAGIC_GATEWAY_URL", env.VITE_SUGARMAGIC_GATEWAY_URL);
  forward(
    "SUGARMAGIC_GATEWAY_BEARER_TOKEN",
    env.VITE_SUGARMAGIC_GATEWAY_BEARER_TOKEN
  );
  forward(
    "SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL",
    env.VITE_SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL ??
      env.VITE_SUGARMAGIC_GATEWAY_URL
  );
  forward(
    "SUGARMAGIC_SUGARLANG_PROXY_BASE_URL",
    env.VITE_SUGARMAGIC_SUGARLANG_PROXY_BASE_URL ??
      env.VITE_SUGARMAGIC_GATEWAY_URL
  );
  forward(
    "SUGARMAGIC_SUGARLANG_TARGET_LANGUAGE",
    env.VITE_SUGARMAGIC_SUGARLANG_TARGET_LANGUAGE
  );

  return {
    gatewayUrl,
    gatewayBearerToken,
    majorVersion,
    versionedSlug,
    gitSha,
    buildTimestamp,
    pluginRuntimeEnvironment
  };
}

/**
 * Browser-side entrypoint. Reads the build-time-inlined Vite env vars
 * and returns the typed config. Don't call this from tests — use
 * `readBuildConfig` with a synthesized env instead.
 */
export function readBuildConfigFromViteEnv(): BuildConfig {
  const env = import.meta.env as unknown as RawBuildEnv;
  return readBuildConfig(env);
}
