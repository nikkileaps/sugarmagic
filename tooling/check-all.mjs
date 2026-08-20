/**
 * Runs every lint and boundary check, then reports.
 *
 * `pnpm lint` used to be an `&&` chain, so the first failing check hid every one
 * after it -- a guard added at the end of the chain never ran while an earlier
 * check was red, which is most of the time. Here each check runs regardless of
 * what the previous one did, and the summary at the bottom says which failed.
 *
 * Individual checks are still runnable on their own through their `lint:*`
 * scripts; this is the one that runs the lot.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

const checks = [
  { name: "eslint", command: "npx", args: ["eslint", "."] },
  { name: "package boundaries", script: "check-package-boundaries.mjs" },
  { name: "shell tokens", script: "check-shell-tokens.mjs" },
  { name: "filename conventions", script: "check-filename-conventions.mjs" },
  { name: "viewport imperative API", script: "check-viewport-imperative.mjs" },
  {
    name: "render engine boundary",
    script: "check-render-engine-boundary.mjs"
  },
  { name: "mechanics boundary", script: "check-mechanics-boundary.mjs" },
  { name: "surface traits", script: "check-surface-trait-boundary.mjs" },
  {
    name: "surface layer stack",
    script: "check-surface-layerstack-boundary.mjs"
  },
  { name: "plugin catalog", script: "check-plugin-catalog-boundary.mjs" },
  {
    name: "editor bundle isolation",
    script: "check-editor-bundle-isolation.mjs"
  }
];

const failed = [];

for (const check of checks) {
  const command = check.command ?? process.execPath;
  const args = check.args ?? [path.join(repoRoot, "tooling", check.script)];
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit" });
  if (result.status !== 0) {
    failed.push(check.name);
  }
}

if (failed.length > 0) {
  console.error(`\n${failed.length} of ${checks.length} checks failed:`);
  for (const name of failed) {
    console.error(`- ${name}`);
  }
  process.exit(1);
}

console.log(`\nAll ${checks.length} checks passed.`);
