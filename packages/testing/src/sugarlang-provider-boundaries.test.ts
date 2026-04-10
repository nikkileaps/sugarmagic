/**
 * packages/testing/src/sugarlang-provider-boundaries.test.ts
 *
 * Purpose: Enforces the ADR 010 one-way dependency rules for sugarlang provider contracts and implementations.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Reads sugarlang provider contract and implementation files from the shared workspace.
 *   - Guards Epic 3's provider-boundary discipline before later implementation epics land.
 *
 * Implements: Epic 3 Story 3.7 architectural checks
 *
 * Status: active
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function listFilesRecursively(directory: string): string[] {
  const entries = readdirSync(directory);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(directory, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...listFilesRecursively(fullPath));
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

function readImportLines(filePath: string): string[] {
  return readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => line.trimStart().startsWith("import "));
}

describe("sugarlang provider boundaries", () => {
  it("keeps contracts/providers.ts free of runtime implementation imports", () => {
    const providersPath = join(
      process.cwd(),
      "packages/plugins/src/catalog/sugarlang/runtime/contracts/providers.ts"
    );
    const importLines = readImportLines(providersPath);

    expect(
      importLines.some((line) =>
        /from ["'][^"']*(?:director|budgeter|learner)\//.test(line)
      )
    ).toBe(false);
  });

  it("keeps provider impls isolated from director and middleware modules", () => {
    const implDirectory = join(
      process.cwd(),
      "packages/plugins/src/catalog/sugarlang/runtime/providers/impls"
    );
    const files = listFilesRecursively(implDirectory);

    for (const filePath of files) {
      const importLines = readImportLines(filePath);

      expect(
        importLines.some((line) =>
          /from ["'][^"']*(?:director|middlewares)\//.test(line)
        ),
        filePath
      ).toBe(false);
    }
  });
});
