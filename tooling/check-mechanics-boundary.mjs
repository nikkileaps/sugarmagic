import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const runtimeRoot = path.join(repoRoot, "packages/runtime-core/src");
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

for (const filePath of await collectSourceFiles(runtimeRoot)) {
  const relativePath = path.relative(repoRoot, filePath);
  const contents = await readFile(filePath, "utf8");
  if (/castable\.id\s*={0,2}\s*["']/.test(contents)) {
    errors.push(
      `${relativePath}: runtime-core must treat castable.id as opaque; do not compare it to string literals.`
    );
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
