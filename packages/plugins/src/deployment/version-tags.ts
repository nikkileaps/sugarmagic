/**
 * packages/plugins/src/deployment/version-tags.ts
 *
 * Purpose: Pure parsing + auto-increment helpers for the
 * `v{major}.0.{patch}` tag scheme used by the SugarDeploy
 * Release workspace. Used both by the host middleware that
 * actually runs `git tag` (story 46.12) and by the Studio
 * Release workspace UI that renders the version history with
 * patches as sub-rows under their major.
 *
 * Exports:
 *   - parseVersionTag(tag)
 *   - computeNextPatchTag(existingTags, major)
 *   - groupVersionTags(tags)
 *
 * Relationships:
 *   - Re-exported from ./index for cross-package import.
 *   - No I/O — git command + filesystem live in the host
 *     middleware that wraps this.
 *
 * Implements: Plan 046 §Story 46.12
 *
 * Status: active
 */

/**
 * A version tag in the SugarDeploy scheme: `v{major}.0.{patch}`.
 * Cut-major tags are `v{N}.0.0` (patch=0); patch tags are
 * `v{N}.0.M` with M>=1. The middle component is always literally
 * `0` — Plan 046 deliberately does not use semver minor.
 */
export interface ParsedVersionTag {
  major: number;
  patch: number;
  tag: string;
}

const VERSION_TAG_REGEX = /^v(\d+)\.0\.(\d+)$/;

export function parseVersionTag(tag: string): ParsedVersionTag | null {
  if (typeof tag !== "string") return null;
  const trimmed = tag.trim();
  const match = VERSION_TAG_REGEX.exec(trimmed);
  if (!match) return null;
  const major = Number(match[1]);
  const patch = Number(match[2]);
  if (!Number.isFinite(major) || major < 1) return null;
  if (!Number.isFinite(patch) || patch < 0) return null;
  return { major, patch, tag: trimmed };
}

export interface ComputeNextPatchTagResult {
  ok: boolean;
  reason?: string;
  nextTag?: string;
  highestExistingPatch?: number;
}

/**
 * Auto-increments to the next patch tag for the given major.
 * Fails when the base `v{major}.0.0` tag doesn't exist — patches
 * are commits anchored to a major's slot, so the major must be
 * cut first. Gap-tolerant: if patches are [0, 1, 3] the next is 4,
 * not 2 (highest + 1, never reuses a freed number).
 */
export function computeNextPatchTag(
  existingTags: readonly string[],
  major: number
): ComputeNextPatchTagResult {
  if (!Number.isFinite(major) || major < 1 || Math.floor(major) !== major) {
    return { ok: false, reason: `major must be a positive integer; got ${String(major)}.` };
  }
  const parsedForMajor: ParsedVersionTag[] = [];
  for (const raw of existingTags) {
    const parsed = parseVersionTag(raw);
    if (parsed && parsed.major === major) parsedForMajor.push(parsed);
  }
  const hasBase = parsedForMajor.some((entry) => entry.patch === 0);
  if (!hasBase) {
    return {
      ok: false,
      reason:
        `No v${major}.0.0 tag found. Cut major version ${major} first ` +
        `(patches are commits anchored to an existing major's slot).`
    };
  }
  let highest = 0;
  for (const entry of parsedForMajor) {
    if (entry.patch > highest) highest = entry.patch;
  }
  return {
    ok: true,
    nextTag: `v${major}.0.${highest + 1}`,
    highestExistingPatch: highest
  };
}

export interface GroupedVersionMajor {
  major: number;
  baseTag: string;
  patches: ParsedVersionTag[];
}

/**
 * Groups a flat tag list into majors + their patches, sorted
 * descending by major and ascending by patch within each major.
 * Tags without a matching `v{N}.0.0` base are skipped — they
 * represent inconsistent history the Release workspace doesn't
 * render.
 */
export function groupVersionTags(
  tags: readonly string[]
): GroupedVersionMajor[] {
  const byMajor = new Map<number, ParsedVersionTag[]>();
  for (const raw of tags) {
    const parsed = parseVersionTag(raw);
    if (!parsed) continue;
    const existing = byMajor.get(parsed.major) ?? [];
    existing.push(parsed);
    byMajor.set(parsed.major, existing);
  }
  const result: GroupedVersionMajor[] = [];
  for (const [major, entries] of byMajor.entries()) {
    const base = entries.find((entry) => entry.patch === 0);
    if (!base) continue;
    const patches = entries
      .filter((entry) => entry.patch > 0)
      .sort((a, b) => a.patch - b.patch);
    result.push({ major, baseTag: base.tag, patches });
  }
  return result.sort((a, b) => b.major - a.major);
}
