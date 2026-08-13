import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Build-time version stamp baked into the deployed bundle as
 * `__SUGARMAGIC_VERSION__` (footer chip, autosave's
 * `writtenByVersion` stamp). The `X-Game-Version` response header
 * carries the same value but is written by the deploy, not here.
 * Resolution cascade:
 *
 *   1. `SUGARMAGIC_GAME_VERSION` env var — the GHA deploy workflow
 *      sets this from `git describe` run inside the GAME repo
 *      (wordlark), so the player-facing chip carries the game's
 *      release tag (`v1.0.0`), not the engine's commit. This is
 *      always the right source for production builds.
 *   2. `git describe --tags --always --dirty` in THIS (engine)
 *      working tree — local dev fallback when there's no game
 *      context around. Useful while iterating on the engine.
 *   3. `package.json#version` — last-resort defensive fallback if
 *      git is unreachable.
 */
function resolveBuildVersion(): string {
  const fromEnv = process.env.SUGARMAGIC_GAME_VERSION?.trim();
  if (fromEnv) return fromEnv;
  try {
    return execSync("git describe --tags --always --dirty", {
      encoding: "utf-8",
      cwd: import.meta.dirname,
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    const pkg = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "package.json"), "utf-8")
    ) as { version?: string };
    return pkg.version ?? "unknown";
  }
}

const BUILD_VERSION = resolveBuildVersion();

// `_headers` is written by the deploy (packages/plugins/src/deployment/
// published-web.ts), which owns cache rules AND X-Game-Version. A plugin
// here used to write its own copy carrying only the version, and the
// deploy overwrote it — so the header never reached production.
// BUILD_VERSION still reaches the bundle below as __SUGARMAGIC_VERSION__.

export default defineConfig({
  plugins: [react()],
  define: {
    __SUGARMAGIC_VERSION__: JSON.stringify(BUILD_VERSION)
  }
});
