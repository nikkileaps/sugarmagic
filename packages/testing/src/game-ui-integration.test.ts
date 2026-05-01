/**
 * Game UI integration boundary tests.
 *
 * These checks keep Plan 039's target-embed architecture verifiable: domain
 * and runtime-core own data/actions, while target-web owns DOM rendering.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = process.cwd();

function source(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

describe("game UI integration boundaries", () => {
  it("keeps target-web imports out of domain, runtime-core, and render-web", () => {
    const checkedFiles = [
      "packages/domain/src/index.ts",
      "packages/runtime-core/src/index.ts",
      "packages/render-web/src/index.ts"
    ];
    for (const file of checkedFiles) {
      expect(source(file)).not.toMatch(/@sugarmagic\/target-web/);
    }
  });

  it("documents menuKey as the runtime-visible menu address", () => {
    const epic = source("docs/plans/039-game-ui-and-menus-epic.md");
    expect(epic).toContain("This is MenuDefinition.menuKey, not definitionId");
    expect(epic).toContain("visibleMenuKey");
  });
});
