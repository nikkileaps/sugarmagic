import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const catalogRoot = path.join(repoRoot, "packages/plugins/src/catalog");
const errors = [];

async function collectSourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(fullPath)));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

// Discover catalog names from directory entries (avoids hard-coding the list).
const catalogEntries = await readdir(catalogRoot, { withFileTypes: true });
const knownCatalogs = catalogEntries
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

for (const filePath of await collectSourceFiles(catalogRoot)) {
  const relativePath = path.relative(repoRoot, filePath);
  const contents = await readFile(filePath, "utf8");

  // Which catalog does this file belong to?
  const catalogRelative = path.relative(catalogRoot, filePath);
  const thisCatalog = catalogRelative.split(path.sep)[0];

  // Match relative import/export-from paths, including dynamic import().
  // Static `from "..."` / `export ... from "..."` AND `await import("...")`
  // both need to be caught -- a dynamic cross-catalog import is exactly the
  // pattern this guard exists to prevent.
  const importPattern = /(?:from\s+['"]|import\s*\(\s*['"])(\.[^'"]+)['"]/g;
  let match;
  while ((match = importPattern.exec(contents)) !== null) {
    const importPath = match[1];
    for (const otherCatalog of knownCatalogs) {
      if (
        otherCatalog !== thisCatalog &&
        (importPath.includes(`/${otherCatalog}/`) ||
          importPath.endsWith(`/${otherCatalog}`))
      ) {
        errors.push(
          `${relativePath}: cross-catalog import from "${thisCatalog}" into "${otherCatalog}" -- route data through execution.annotations instead`
        );
        break;
      }
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
