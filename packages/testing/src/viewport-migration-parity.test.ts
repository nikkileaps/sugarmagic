/**
 * Stage 0 structural parity tests.
 *
 * Mirrors the render-engine lint guard inside the test suite so CI exercises
 * the intended construction-site and dependency rules even when the standalone
 * lint script is not the only signal being run.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const RENDER_WEB_ROOT = join(REPO_ROOT, "packages", "render-web", "src");

function collectTypeScriptFiles(directory: string, collected: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const absolutePath = join(directory, entry);
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      collectTypeScriptFiles(absolutePath, collected);
      continue;
    }
    if (absolutePath.endsWith(".ts") || absolutePath.endsWith(".tsx")) {
      collected.push(absolutePath);
    }
  }
  return collected;
}

function sourceOf(absolutePath: string): string {
  return readFileSync(absolutePath, "utf8");
}

describe("viewport migration structural parity", () => {
  it("keeps packages/render-web free of shell imports", () => {
    const renderWebFiles = collectTypeScriptFiles(RENDER_WEB_ROOT);
    const offenders = renderWebFiles.filter((file) =>
      sourceOf(file).includes("@sugarmagic/shell")
    );

    expect(offenders).toEqual([]);
  });

  it("keeps WebGPURenderer construction owned solely by RenderView", () => {
    const renderWebFiles = collectTypeScriptFiles(RENDER_WEB_ROOT);
    const constructorSites = renderWebFiles.filter((file) =>
      sourceOf(file).includes("new WebGPURenderer(")
    );

    expect(constructorSites).toEqual([
      join(REPO_ROOT, "packages", "render-web", "src", "view", "RenderView.ts")
    ]);
  });

  it("keeps ShaderRuntime construction owned solely by WebRenderEngine", () => {
    const renderWebFiles = collectTypeScriptFiles(RENDER_WEB_ROOT);
    const constructorSites = renderWebFiles.filter((file) =>
      sourceOf(file).includes("new ShaderRuntime(")
    );

    expect(constructorSites).toEqual([
      join(REPO_ROOT, "packages", "render-web", "src", "engine", "WebRenderEngine.ts")
    ]);
  });

  it("keeps AuthoredAssetResolver construction limited to the allowed bridge sites", () => {
    const renderWebFiles = collectTypeScriptFiles(RENDER_WEB_ROOT);
    const constructorSites = renderWebFiles.filter((file) => {
      if (file.endsWith(`${join("render-web", "src", "authoredAssetResolver.ts")}`)) {
        return false;
      }
      return /\bcreateAuthoredAssetResolver\s*\(/.test(sourceOf(file));
    });

    expect(constructorSites).toEqual([
      join(REPO_ROOT, "packages", "render-web", "src", "engine", "WebRenderEngine.ts")
    ]);
  });
});
