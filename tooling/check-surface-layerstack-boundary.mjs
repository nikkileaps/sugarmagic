/**
 * Guard the Epic 036 surface-layer-stack authored boundary.
 *
 * Ensures two invariants keep holding:
 *
 * 1. `Surface` stays the canonical layer-stack shape (`layers` + `context`)
 *    instead of drifting back to a flat discriminated union.
 * 2. slot-shaped authored records bind surfaces through `SurfaceBinding`, not
 *    raw `Surface`.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const surfaceIndexPath = path.join(
  repoRoot,
  "packages/domain/src/surface/index.ts"
);
const authoredScanRoots = [
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

await verifyCanonicalSurfaceShape();

for (const root of authoredScanRoots) {
  const files = await collectSourceFiles(path.join(repoRoot, root));
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
  console.error("Surface layer-stack boundary check failed:\n");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log("Surface layer-stack boundary check passed.");
}

async function verifyCanonicalSurfaceShape() {
  const contents = await readFile(surfaceIndexPath, "utf8");
  const sourceFile = ts.createSourceFile(
    surfaceIndexPath,
    contents,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  let surfaceInterfaceFound = false;
  let layersFound = false;
  let contextFound = false;

  ts.forEachChild(sourceFile, (node) => {
    if (!ts.isInterfaceDeclaration(node) || node.name.text !== "Surface") {
      return;
    }
    surfaceInterfaceFound = true;
    for (const member of node.members) {
      if (!ts.isPropertySignature(member) || !member.name) {
        continue;
      }
      const propertyName = getPropertyName(member.name);
      if (propertyName === "layers") {
        layersFound = true;
      }
      if (propertyName === "context") {
        contextFound = true;
      }
    }
  });

  if (!surfaceInterfaceFound || !layersFound || !contextFound) {
    errors.push(
      "packages/domain/src/surface/index.ts: Surface must remain an interface with `layers` and `context`."
    );
  }
}

function visit(node, sourceFile) {
  if (ts.isInterfaceDeclaration(node) || ts.isTypeLiteralNode(node)) {
    const propertyNames = new Set(getTypeMemberNames(node));
    const declarationName =
      ts.isInterfaceDeclaration(node) && node.name ? node.name.text : null;
    const surfaceMember = findSurfaceMember(node);
    if (
      surfaceMember &&
      looksLikeSlotDeclaration(propertyNames, declarationName) &&
      !memberTextIncludesSurfaceBinding(surfaceMember, sourceFile)
    ) {
      errors.push(
        `${relativePath(sourceFile.fileName)}:${lineForNode(sourceFile, surfaceMember)}: ` +
          "slot-shaped type binds `surface` without SurfaceBinding."
      );
    }
  }

  if (ts.isObjectLiteralExpression(node)) {
    const propertyNames = new Set(getObjectLiteralPropertyNames(node));
    const surfaceProperty = findObjectProperty(node, "surface");
    if (
      surfaceProperty &&
      looksLikeSlotObjectLiteral(propertyNames) &&
      expressionLooksLikeRawSurface(surfaceProperty.initializer)
    ) {
      errors.push(
        `${relativePath(sourceFile.fileName)}:${lineForNode(sourceFile, surfaceProperty)}: ` +
          "slot-shaped object literal assigns a raw Surface; wrap it in SurfaceBinding."
      );
    }
  }

  ts.forEachChild(node, (child) => visit(child, sourceFile));
}

function looksLikeSlotDeclaration(propertyNames, declarationName = null) {
  if (
    propertyNames.has("slotName") ||
    propertyNames.has("slotIndex") ||
    propertyNames.has("channelId")
  ) {
    return propertyNames.has("surface");
  }
  return declarationName !== null && /SurfaceSlot/i.test(declarationName);
}

function looksLikeSlotObjectLiteral(propertyNames) {
  return (
    propertyNames.has("surface") &&
    (propertyNames.has("slotName") ||
      propertyNames.has("slotIndex") ||
      propertyNames.has("channelId"))
  );
}

function memberTextIncludesSurfaceBinding(member, sourceFile) {
  return member
    .getText(sourceFile)
    .includes("SurfaceBinding");
}

function expressionLooksLikeRawSurface(expression) {
  return (
    (ts.isCallExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === "createSurface") ||
    ts.isObjectLiteralExpression(expression)
  );
}

function findSurfaceMember(node) {
  for (const member of node.members) {
    if (
      (ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) &&
      member.name &&
      getPropertyName(member.name) === "surface"
    ) {
      return member;
    }
  }
  return null;
}

function findObjectProperty(node, name) {
  for (const property of node.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      property.name &&
      getPropertyName(property.name) === name
    ) {
      return property;
    }
  }
  return null;
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
