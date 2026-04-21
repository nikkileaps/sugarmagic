/**
 * Guard against imperative viewport mutation APIs returning to the shared
 * workspace interface.
 *
 * Epic 033 moves viewport updates onto shell-store subscriptions. This check
 * enforces that the public viewport contract does not quietly grow the old
 * mutation surface back.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const viewportContractPath = path.join(
  repoRoot,
  "packages/workspaces/src/viewport.ts"
);

const contents = await readFile(viewportContractPath, "utf8");

const bannedTokens = [
  "updateFromRegion",
  "previewLandscape",
  "paintLandscapeAt",
  "renderLandscapeMask",
  "serializeLandscapePaintPayload",
  "previewTransform",
  "updateFromPlayer",
  "updateFromNPC",
  "updateFromItem",
  "scene:",
  "camera:",
  "authoredRoot:",
  "overlayRoot:",
  "surfaceRoot:"
];

const failures = bannedTokens.filter((token) => contents.includes(token));

if (failures.length > 0) {
  console.error("Viewport imperative API check failed:\n");
  for (const token of failures) {
    console.error(`- packages/workspaces/src/viewport.ts still exposes "${token}"`);
  }
  process.exitCode = 1;
} else {
  console.log("Viewport imperative API check passed.");
}
