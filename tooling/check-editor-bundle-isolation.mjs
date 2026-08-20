/**
 * Keep React Flow out of the shipped game.
 *
 * The node editor is Studio-only. It reaches the browser through
 * `@sugarmagic/ui/node-editor`, a subpath export, so the `@sugarmagic/ui` barrel
 * never names it and the game's build drops it. That arrangement is easy to undo
 * by accident -- one `export * from "./NodeEditor"` in the graphs barrel puts a
 * 178KB library back in the game -- and nothing else catches it: the build
 * succeeds, the types check, the tests pass.
 *
 * Rather than resolve the import graph, this pins the three places the library
 * could cross over:
 *
 *   1. inside packages/ui, only the graphs directory may name React Flow
 *   2. the graphs barrel may not re-export the editor
 *   3. no package the game is built from may name React Flow or the subpath
 *
 * That covers it because the game can only reach the barrel through those
 * packages, and the barrel can only reach React Flow through a file in
 * packages/ui/src.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const errors = [];

const REACT_FLOW = "@xyflow/react";
const EDITOR_SUBPATH = "@sugarmagic/ui/node-editor";

/** The only directory allowed to import React Flow. */
const GRAPHS_DIR = path.join(repoRoot, "packages/ui/src/graphs");

/** The graphs barrel: reachable from the `@sugarmagic/ui` barrel, so it must not
 *  pull the editor in. */
const GRAPHS_BARREL = path.join(GRAPHS_DIR, "index.ts");

/**
 * Everything the game is built from. Studio and packages/workspaces are absent
 * on purpose: they are Studio-only and may use the editor freely.
 */
const GAME_DIRS = [
  "targets/web/src",
  "packages/domain/src",
  "packages/io/src",
  "packages/plugins/src",
  "packages/render-web/src",
  "packages/runtime-core/src"
];

async function collectSourceFiles(directory) {
  const files = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(full)));
    } else if (/\.(ts|tsx|css)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

const relative = (filePath) => path.relative(repoRoot, filePath);

// 1. Inside packages/ui, only the graphs directory may name React Flow. A CSS
//    import matters as much as a JS one here: an unused import is dropped from
//    the game's JavaScript, but a stylesheet side effect is not.
for (const filePath of await collectSourceFiles(
  path.join(repoRoot, "packages/ui/src")
)) {
  if (filePath.startsWith(`${GRAPHS_DIR}${path.sep}`)) continue;
  const contents = await readFile(filePath, "utf8");
  if (contents.includes(REACT_FLOW)) {
    errors.push(
      `${relative(filePath)}: names ${REACT_FLOW}. Only packages/ui/src/graphs may, or React Flow reaches the game through the @sugarmagic/ui barrel.`
    );
  }
}

// 2. The graphs barrel must not re-export the editor.
{
  const contents = await readFile(GRAPHS_BARREL, "utf8");
  const exportsEditor = contents
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .some((line) => /^\s*export .*NodeEditor/.test(line));
  if (exportsEditor) {
    errors.push(
      `${relative(GRAPHS_BARREL)}: re-exports NodeEditor. This barrel is reachable from the game; import it from ${EDITOR_SUBPATH} instead.`
    );
  }
}

// 3. Nothing the game is built from may name React Flow or the editor subpath.
for (const dir of GAME_DIRS) {
  for (const filePath of await collectSourceFiles(path.join(repoRoot, dir))) {
    const contents = await readFile(filePath, "utf8");
    for (const specifier of [REACT_FLOW, EDITOR_SUBPATH]) {
      if (contents.includes(specifier)) {
        errors.push(
          `${relative(filePath)}: names ${specifier}. The game is built from this package, so the node editor must not be reachable here.`
        );
      }
    }
  }
}

if (errors.length > 0) {
  console.error("Editor bundle isolation check failed:\n");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log("Editor bundle isolation check passed.");
}
