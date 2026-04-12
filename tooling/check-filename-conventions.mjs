/**
 * Enforce filename conventions for selected source areas.
 *
 * Current rule set:
 * - TypeScript files under packages/plugins/src/catalog/sugarlang must use kebab-case
 * - optional ".test" infix is allowed for test files
 */

import { readdir } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const errors = [];

const filenameRules = [
  {
    root: path.join(repoRoot, "packages/plugins/src/catalog/sugarlang"),
    pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.test)?\.(ts|tsx)$/,
    description:
      "kebab-case with an optional .test infix (examples: lexical-budgeter.ts, lexical-budgeter.test.ts)"
  }
];

async function collectFiles(directory) {
  const files = [];
  let entries;

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
      continue;
    }

    if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

for (const rule of filenameRules) {
  const files = await collectFiles(rule.root);

  for (const filePath of files) {
    const baseName = path.basename(filePath);
    if (rule.pattern.test(baseName)) continue;

    errors.push(
      `${path.relative(repoRoot, filePath)}: filename must match ${rule.description}.`
    );
  }
}

if (errors.length > 0) {
  console.error("Filename convention check failed:\n");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log("Filename convention check passed.");
}
