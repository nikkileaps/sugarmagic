#!/usr/bin/env node

/**
 * Render-engine boundary guard.
 *
 * Enforces Epic 036 Stage 0's architectural rules:
 * - render-web stays free of @sugarmagic/shell imports
 * - WebGPURenderer construction is limited to the sanctioned host sites
 *   (RenderView for live viewports, captureFrame for one-shot offscreen
 *   capture — both share the engine's device)
 * - WebRenderEngine is the only ShaderRuntime / AuthoredAssetResolver
 *   construction site
 */

import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";

const repoRoot = new URL("..", import.meta.url).pathname;

function loadSource(relativePath) {
  return readFileSync(`${repoRoot}${relativePath}`, "utf8");
}

function fail(message) {
  console.error(`[check-render-engine-boundary] ${message}`);
  process.exitCode = 1;
}

function collectFiles(directory, collected = []) {
  for (const entry of readdirSync(directory)) {
    const absolutePath = `${directory}/${entry}`;
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      collectFiles(absolutePath, collected);
      continue;
    }
    if (absolutePath.endsWith(".ts") || absolutePath.endsWith(".tsx")) {
      collected.push(absolutePath.replace(repoRoot, ""));
    }
  }
  return collected;
}

const renderWebFiles = collectFiles(`${repoRoot}packages/render-web/src`);

for (const file of renderWebFiles) {
  const source = loadSource(file);
  if (source.includes("@sugarmagic/shell")) {
    fail(`${file} must not import @sugarmagic/shell.`);
  }
}

const ALLOWED_RENDERER_SITES = new Set([
  "packages/render-web/src/view/RenderView.ts",
  "packages/render-web/src/captureFrame.ts"
]);

const rendererConstructorSites = renderWebFiles.filter((file) =>
  loadSource(file).includes("new WebGPURenderer(")
);
const unauthorizedRendererSites = rendererConstructorSites.filter(
  (site) => !ALLOWED_RENDERER_SITES.has(site)
);
if (unauthorizedRendererSites.length > 0) {
  fail(
    `Unsanctioned WebGPURenderer constructor site(s): ${unauthorizedRendererSites.join(", ")}.`
  );
}

const shaderRuntimeConstructorSites = renderWebFiles.filter((file) =>
  loadSource(file).includes("new ShaderRuntime(")
);
if (
  shaderRuntimeConstructorSites.length !== 1 ||
  shaderRuntimeConstructorSites[0] !== "packages/render-web/src/engine/WebRenderEngine.ts"
) {
  fail(
    `Expected exactly one ShaderRuntime constructor site in packages/render-web/src/engine/WebRenderEngine.ts, found: ${shaderRuntimeConstructorSites.join(", ") || "none"}.`
  );
}

const assetResolverConstructorSites = renderWebFiles.filter((file) => {
  if (file === "packages/render-web/src/authoredAssetResolver.ts") {
    return false;
  }
  return /\bcreateAuthoredAssetResolver\s*\(/.test(loadSource(file));
});
if (
  assetResolverConstructorSites.length !== 1 ||
  assetResolverConstructorSites[0] !== "packages/render-web/src/engine/WebRenderEngine.ts"
) {
  fail(
    `Expected exactly one AuthoredAssetResolver constructor site in packages/render-web/src/engine/WebRenderEngine.ts, found: ${assetResolverConstructorSites.join(", ") || "none"}.`
  );
}

if (process.exitCode) {
  process.exit(process.exitCode);
}
