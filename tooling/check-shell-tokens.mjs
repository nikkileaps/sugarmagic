/**
 * Verify that shell chrome — both in apps/studio and in the shared
 * components inside packages/ui — uses approved shared tokens rather
 * than raw hex values, that shell layout surfaces are composed from
 * shared @sugarmagic/ui components backed by Mantine, and that icon
 * usage routes through the shared shellIcons token map.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const errors = [];

// Shell palette hex values that must only appear in the canonical
// token definitions (packages/ui/src/tokens/index.ts and
// packages/ui/src/theme/shell-variables.css), never in consuming code.
const rawShellHexValues = [
  "#cdd6f4", "#bac2de", "#9399b2", "#7f849c", "#6c7086",
  "#45475a", "#313244", "#242436", "#1e1e2e", "#181825", "#1a1a2e",
  "#89b4fa", "#a6e3a1", "#f9e2af", "#f38ba8", "#cba6f7",
  "#94e2d5", "#fab387"
];

// RGBA equivalents of palette colors that also indicate token bypass.
// rgb(r,g,b) values derived from the hex palette above.
const rawRgbPatterns = [
  "137, 180, 250", // #89b4fa blue
  "166, 227, 161", // #a6e3a1 green
  "249, 226, 175", // #f9e2af yellow
  "243, 139, 168", // #f38ba8 red
  "203, 166, 247", // #cba6f7 mauve
  "148, 226, 213", // #94e2d5 teal
  "250, 179, 135", // #fab387 peach
  "205, 214, 244", // #cdd6f4 text
  "186, 194, 222", // #bac2de subtext
  "69, 71, 90",    // #45475a surface2
  "49, 50, 68",    // #313244 surface1
  "30, 30, 46",    // #1e1e2e base
  "24, 24, 37",    // #181825 mantle
];

// Files that are allowed to define the raw hex values.
const tokenDefinitionFiles = new Set([
  path.join(repoRoot, "packages/ui/src/tokens/index.ts"),
  path.join(repoRoot, "packages/ui/src/theme/shell-variables.css"),
  path.join(repoRoot, "packages/ui/src/theme/index.ts")
]);

// Known emoji icons from shellIcons — if these appear as raw literals
// in files other than the token definition, that's a bypass.
const shellIconEmoji = [
  "💬", "📜", "👤", "🎒", "✨", "🦋", "🔥", "🧙", "🔍", "🗺️",
  "📦", "⚡"
];

// ---------------------------------------------------------------
// Check 1: No raw hex shell colors outside token definitions
// ---------------------------------------------------------------

async function collectTsFiles(directory) {
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
      files.push(...(await collectTsFiles(full)));
    } else if (/\.(ts|tsx|css)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

const checkDirs = [
  path.join(repoRoot, "apps/studio/src"),
  path.join(repoRoot, "packages/ui/src/components"),
  path.join(repoRoot, "packages/shell/src")
];

for (const dir of checkDirs) {
  const files = await collectTsFiles(dir);
  for (const filePath of files) {
    if (tokenDefinitionFiles.has(filePath)) continue;

    const contents = await readFile(filePath, "utf8");
    const rel = path.relative(repoRoot, filePath);

    for (const hex of rawShellHexValues) {
      if (contents.includes(hex)) {
        errors.push(
          `${rel}: contains raw shell color ${hex} — use CSS variables or shared token imports instead.`
        );
      }
    }

    for (const rgb of rawRgbPatterns) {
      if (contents.includes(rgb)) {
        errors.push(
          `${rel}: contains raw RGB palette value (${rgb}) — use CSS variables instead of rgba() with palette colors.`
        );
      }
    }
  }
}

// ---------------------------------------------------------------
// Check 2: Studio App must compose from shared @sugarmagic/ui
// ---------------------------------------------------------------

const appPath = path.join(repoRoot, "apps/studio/src/App.tsx");
const appContents = await readFile(appPath, "utf8");

const requiredUiImports = ["ShellFrame", "ModeBar", "StatusBar", "ViewportFrame"];

for (const component of requiredUiImports) {
  if (!appContents.includes(component)) {
    errors.push(
      `apps/studio/src/App.tsx: missing shared component "${component}" from @sugarmagic/ui — shell surfaces must use shared components.`
    );
  }
}

if (!appContents.includes("@sugarmagic/ui")) {
  errors.push(
    "apps/studio/src/App.tsx: does not import from @sugarmagic/ui — shell must compose from shared primitives."
  );
}

// ---------------------------------------------------------------
// Check 3: Shared shell components must be Mantine-backed
// ---------------------------------------------------------------

const uiComponentsDir = path.join(repoRoot, "packages/ui/src/components");
const uiComponentFiles = await collectTsFiles(uiComponentsDir);

for (const filePath of uiComponentFiles) {
  if (filePath.endsWith("index.ts")) continue;
  const contents = await readFile(filePath, "utf8");
  const rel = path.relative(repoRoot, filePath);

  if (!contents.includes("@mantine/core")) {
    errors.push(
      `${rel}: does not import from @mantine/core — shared shell components must be Mantine-backed.`
    );
  }
}

// ---------------------------------------------------------------
// Check 4: Icon usage must route through shared shellIcons
// ---------------------------------------------------------------

// In consuming code (studio app, shell components), raw emoji
// literals that match the shell icon set should come from the
// shellIcons import, not be inlined.

const iconCheckDirs = [
  path.join(repoRoot, "apps/studio/src")
];

for (const dir of iconCheckDirs) {
  const files = await collectTsFiles(dir);
  for (const filePath of files) {
    const contents = await readFile(filePath, "utf8");
    const rel = path.relative(repoRoot, filePath);

    // If the file imports shellIcons, it's using the approved path.
    if (contents.includes("shellIcons")) continue;

    for (const emoji of shellIconEmoji) {
      if (contents.includes(emoji)) {
        errors.push(
          `${rel}: contains raw shell icon emoji ${emoji} — import shellIcons from @sugarmagic/ui instead.`
        );
      }
    }
  }
}

// ---------------------------------------------------------------
// Report
// ---------------------------------------------------------------

if (errors.length > 0) {
  console.error("Shell token check failed:\n");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log("Shell token check passed.");
}
