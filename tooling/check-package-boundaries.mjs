import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

const workspaces = [
  { dir: "apps/studio", kind: "app" },
  { dir: "targets/web", kind: "target" },
  { dir: "packages/shell", kind: "package" },
  { dir: "packages/productmodes", kind: "package" },
  { dir: "packages/domain", kind: "package" },
  { dir: "packages/runtime-core", kind: "package" },
  { dir: "packages/runtime-web", kind: "package" },
  { dir: "packages/plugins", kind: "package" },
  { dir: "packages/io", kind: "package" },
  { dir: "packages/ui", kind: "package" },
  { dir: "packages/testing", kind: "package" }
];

const allowedInternalDeps = {
  "@sugarmagic/studio": new Set([
    "@sugarmagic/domain",
    "@sugarmagic/io",
    "@sugarmagic/plugins",
    "@sugarmagic/productmodes",
    "@sugarmagic/runtime-core",
    "@sugarmagic/runtime-web",
    "@sugarmagic/shell",
    "@sugarmagic/testing",
    "@sugarmagic/ui"
  ]),
  "@sugarmagic/target-web": new Set([
    "@sugarmagic/runtime-core",
    "@sugarmagic/runtime-web",
    "@sugarmagic/plugins",
    "@sugarmagic/io"
  ]),
  "@sugarmagic/shell": new Set([
    "@sugarmagic/domain",
    "@sugarmagic/io",
    "@sugarmagic/productmodes",
    "@sugarmagic/ui"
  ]),
  "@sugarmagic/productmodes": new Set([
    "@sugarmagic/domain",
    "@sugarmagic/runtime-core",
    "@sugarmagic/runtime-web",
    "@sugarmagic/plugins",
    "@sugarmagic/io",
    "@sugarmagic/ui"
  ]),
  "@sugarmagic/domain": new Set(),
  "@sugarmagic/runtime-core": new Set([
    "@sugarmagic/domain",
    "@sugarmagic/plugins"
  ]),
  "@sugarmagic/runtime-web": new Set([
    "@sugarmagic/domain",
    "@sugarmagic/runtime-core",
    "@sugarmagic/io",
    "@sugarmagic/plugins"
  ]),
  "@sugarmagic/plugins": new Set([
    "@sugarmagic/domain",
    "@sugarmagic/runtime-core",
    "@sugarmagic/ui"
  ]),
  "@sugarmagic/io": new Set([
    "@sugarmagic/domain",
    "@sugarmagic/plugins"
  ]),
  "@sugarmagic/ui": new Set(),
  "@sugarmagic/testing": new Set([
    "@sugarmagic/domain",
    "@sugarmagic/io",
    "@sugarmagic/plugins",
    "@sugarmagic/productmodes",
    "@sugarmagic/runtime-core",
    "@sugarmagic/runtime-web",
    "@sugarmagic/shell",
    "@sugarmagic/ui"
  ])
};

const manifestFieldNames = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies"
];

const errors = [];
const packageByName = new Map();
const packageByDir = new Map();

for (const workspace of workspaces) {
  const manifestPath = path.join(repoRoot, workspace.dir, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  packageByName.set(manifest.name, { ...workspace, manifest });
  packageByDir.set(path.join(repoRoot, workspace.dir), { ...workspace, manifest });
}

const internalPackageNames = new Set(packageByName.keys());

for (const { kind, manifest } of packageByName.values()) {
  if (kind === "package") {
    const exportEntry = manifest.exports?.["."];

    if (exportEntry !== "./src/index.ts") {
      errors.push(
        `${manifest.name}: packages must expose only the public root entrypoint "./src/index.ts".`
      );
    }
  }

  const allowed = allowedInternalDeps[manifest.name] ?? new Set();

  for (const field of manifestFieldNames) {
    const deps = manifest[field] ?? {};

    for (const depName of Object.keys(deps)) {
      if (internalPackageNames.has(depName) && !allowed.has(depName)) {
        errors.push(
          `${manifest.name}: disallowed internal dependency on ${depName} in ${field}.`
        );
      }
    }
  }
}

for (const { dir, manifest } of packageByName.values()) {
  const packageRoot = path.join(repoRoot, dir);
  const sourceRoot = path.join(packageRoot, "src");
  const sourceFiles = await collectSourceFiles(sourceRoot);
  const allowed = allowedInternalDeps[manifest.name] ?? new Set();

  for (const filePath of sourceFiles) {
    const contents = await readFile(filePath, "utf8");
    const importSpecifiers = extractImportSpecifiers(contents);

    for (const specifier of importSpecifiers) {
      if (specifier.startsWith(".")) {
        const resolved = path.resolve(path.dirname(filePath), specifier);

        if (!resolved.startsWith(packageRoot + path.sep) && resolved !== packageRoot) {
          errors.push(
            `${relativePath(filePath)}: relative import "${specifier}" escapes package root.`
          );
        }
      }

      if (specifier.startsWith("@sugarmagic/")) {
        const [rootName] = specifier.split("/").slice(0, 2);
        const internalName = `${rootName}/${specifier.split("/")[1]}`;

        if (!internalPackageNames.has(internalName)) {
          continue;
        }

        if (specifier !== internalName) {
          const targetPkg = packageByName.get(internalName);
          const subpath = "./" + specifier.slice(internalName.length + 1);
          const isExportedSubpath =
            targetPkg?.manifest.exports?.[subpath] !== undefined;

          if (!isExportedSubpath) {
            errors.push(
              `${relativePath(filePath)}: deep import "${specifier}" is not allowed; use the public package entrypoint.`
            );
          }
        }

        if (!allowed.has(internalName)) {
          errors.push(
            `${relativePath(filePath)}: import of ${internalName} is not allowed for ${manifest.name}.`
          );
        }
      }
    }
  }
}

if (errors.length > 0) {
  console.error("Package boundary check failed:\n");

  for (const error of errors) {
    console.error(`- ${error}`);
  }

  process.exitCode = 1;
} else {
  console.log("Package boundary check passed.");
}

function extractImportSpecifiers(contents) {
  const specifiers = new Set();
  const fromPattern = /\bfrom\s+["']([^"']+)["']/g;
  const barePattern = /\bimport\s+["']([^"']+)["']/g;
  const exportPattern = /\bexport\s+\*\s+from\s+["']([^"']+)["']/g;

  for (const pattern of [fromPattern, barePattern, exportPattern]) {
    for (const match of contents.matchAll(pattern)) {
      specifiers.add(match[1]);
    }
  }

  return specifiers;
}

async function collectSourceFiles(directory) {
  const entries = await safeReadDir(directory);
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

async function safeReadDir(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

function relativePath(filePath) {
  return path.relative(repoRoot, filePath);
}
