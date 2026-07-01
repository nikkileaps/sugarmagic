import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Build-time version stamp shown in the deployed bundle (footer
 * chip, X-Game-Version response header, autosave's
 * `writtenByVersion` stamp). Resolution cascade:
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

/**
 * Writes a Netlify `_headers` file into the build output so every
 * response carries `X-Game-Version: <build-version>`. Useful for
 * bug reports + cache-busting decisions without parsing HTML.
 */
function netlifyVersionHeaderPlugin(version: string): Plugin {
  return {
    name: "sugarmagic-netlify-version-header",
    apply: "build",
    closeBundle() {
      const headersPath = resolve(import.meta.dirname, "dist", "_headers");
      const body = `/*\n  X-Game-Version: ${version}\n`;
      writeFileSync(headersPath, body, "utf-8");
    }
  };
}

export default defineConfig({
  plugins: [react(), netlifyVersionHeaderPlugin(BUILD_VERSION)],
  define: {
    __SUGARMAGIC_VERSION__: JSON.stringify(BUILD_VERSION)
  }
});
