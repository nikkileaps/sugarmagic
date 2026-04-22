/**
 * Guard the Epic 034 surface/deform/effect authored boundary.
 *
 * The canonical authored slot-content model is `Surface` in
 * `packages/domain/src/surface/index.ts`. Asset and landscape slot records must
 * not grow a parallel direct `materialDefinitionId` field; doing so would
 * recreate the pre-Epic-034 split between surface slots and material-only
 * bindings.
 *
 * This check scans authored-layer source files and fails if it finds a
 * slot-shaped object or type that carries `materialDefinitionId` directly
 * instead of flowing through `Surface`.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const scanRoots = [
  "apps/studio/src",
  "packages/domain/src",
  "packages/io/src",
  "packages/workspaces/src"
];
const skippedPathFragments = [
  `${path.sep}tests${path.sep}`,
  `${path.sep}test${path.sep}`,
  `${path.sep}dist${path.sep}`
];
const errors = [];

for (const root of scanRoots) {
  const absoluteRoot = path.join(repoRoot, root);
  const files = await collectSourceFiles(absoluteRoot);
  for (const filePath of files) {
    if (skippedPathFragments.some((fragment) => filePath.includes(fragment))) {
      continue;
    }

    const contents = await readFile(filePath, "utf8");
    const sourceFile = ts.createSourceFile(
      filePath,
      contents,
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );

    visit(sourceFile, sourceFile);
  }
}

if (errors.length > 0) {
  console.error("Surface trait boundary check failed:\n");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log("Surface trait boundary check passed.");
}

function visit(node, sourceFile) {
  if (ts.isObjectLiteralExpression(node)) {
    const propertyNames = new Set(getObjectLiteralPropertyNames(node));
    if (looksLikeDirectSlotMaterialBinding(propertyNames)) {
      errors.push(
        `${relativePath(sourceFile.fileName)}:${lineForNode(sourceFile, node)}: ` +
          "slot-shaped object literal declares materialDefinitionId directly; " +
          "bind materials through Surface instead."
      );
    }
  }

  if (ts.isInterfaceDeclaration(node) || ts.isTypeLiteralNode(node)) {
    const propertyNames = new Set(getTypeMemberNames(node));
    const declarationName =
      ts.isInterfaceDeclaration(node) && node.name ? node.name.text : null;
    if (looksLikeDirectSlotMaterialBinding(propertyNames, declarationName)) {
      errors.push(
        `${relativePath(sourceFile.fileName)}:${lineForNode(sourceFile, node)}: ` +
          "slot-shaped type declares materialDefinitionId directly; " +
          "slot content must flow through Surface."
      );
    }
  }

  ts.forEachChild(node, (child) => visit(child, sourceFile));
}

function looksLikeDirectSlotMaterialBinding(propertyNames, declarationName = null) {
  if (!propertyNames.has("materialDefinitionId")) {
    return false;
  }

  if (
    propertyNames.has("slotName") ||
    propertyNames.has("slotIndex") ||
    propertyNames.has("channelId") ||
    propertyNames.has("tilingScale")
  ) {
    return true;
  }

  return declarationName !== null && /SurfaceSlot|Landscape.*Channel/i.test(declarationName);
}

function getObjectLiteralPropertyNames(node) {
  const names = [];
  for (const property of node.properties) {
    if (
      ts.isPropertyAssignment(property) ||
      ts.isShorthandPropertyAssignment(property) ||
      ts.isMethodDeclaration(property)
    ) {
      const name = getPropertyName(property.name);
      if (name) {
        names.push(name);
      }
    }
  }
  return names;
}

function getTypeMemberNames(node) {
  const names = [];
  for (const member of node.members) {
    if (
      ts.isPropertySignature(member) ||
      ts.isMethodSignature(member) ||
      ts.isPropertyDeclaration(member)
    ) {
      const name = getPropertyName(member.name);
      if (name) {
        names.push(name);
      }
    }
  }
  return names;
}

function getPropertyName(nameNode) {
  if (!nameNode) {
    return null;
  }
  if (ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode) || ts.isNumericLiteral(nameNode)) {
    return nameNode.text;
  }
  return null;
}

async function collectSourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(entryPath)));
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

function lineForNode(sourceFile, node) {
  return ts.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile)).line + 1;
}

function relativePath(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, "/");
}
