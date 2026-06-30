import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Build-time version stamp. Prefers `git describe --tags --always
 * --dirty` so any tagged commit deploys with its tag name verbatim
 * (e.g. `v0.1.0`); untagged commits get `<tag>-<n>-g<sha>` or just
 * `<sha>` when no tags exist. Falls back to `package.json#version`
 * if git is unreachable.
 */
function resolveBuildVersion(): string {
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
