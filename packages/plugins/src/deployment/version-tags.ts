/**
 * packages/plugins/src/deployment/version-tags.ts
 *
 * Purpose: Pure parsing + auto-increment helpers for the
 * `v{major}.{minor}.{patch}` tag scheme used by the SugarDeploy
 * Release workspace. Used both by the host middleware that
 * actually runs `git tag` (story 46.12) and by the Studio
 * Release workspace UI that renders the version history with
 * releases as sub-rows under their major.
 *
 * Minor versions (2026-07-05, nikki): full semver. `Tag Minor`
 * bumps to `v{major}.{minor+1}.0`; `Tag Patch` increments the
 * patch WITHIN the highest existing minor for the major. The
 * cut-major base stays `v{major}.0.0`. Pre-046 history (always
 * minor 0) parses unchanged.
 *
 * Exports:
 *   - parseVersionTag(tag)
 *   - computeNextPatchTag(existingTags, major)
 *   - computeNextMinorTag(existingTags, major)
 *   - groupVersionTags(tags)
 *
 * Relationships:
 *   - Re-exported from ./index for cross-package import.
 *   - No I/O — git command + filesystem live in the host
 *     middleware that wraps this.
 *
 * Implements: Plan 046 §Story 46.12 (+ minor versions follow-up)
 *
 * Status: active
 */

/**
 * A version tag in the SugarDeploy scheme: `v{major}.{minor}.{patch}`.
 * Cut-major tags are `v{N}.0.0`; minor tags are `v{N}.{M}.0` with
 * M>=1; patch tags increment the third component within a minor.
 */
export interface ParsedVersionTag {
  major: number;
  minor: number;
  patch: number;
  tag: string;
}

const VERSION_TAG_REGEX = /^v(\d+)\.(\d+)\.(\d+)$/;

export function parseVersionTag(tag: string): ParsedVersionTag | null {
  if (typeof tag !== "string") return null;
  const trimmed = tag.trim();
  const match = VERSION_TAG_REGEX.exec(trimmed);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (!Number.isFinite(major) || major < 1) return null;
  if (!Number.isFinite(minor) || minor < 0) return null;
  if (!Number.isFinite(patch) || patch < 0) return null;
  return { major, minor, patch, tag: trimmed };
}

export interface ComputeNextTagResult {
  ok: boolean;
  reason?: string;
  nextTag?: string;
  /** The tag the increment was computed FROM (highest existing
   *  release for the major). */
  highestExistingTag?: string;
}

/** Back-compat alias — pre-minor callers/tests name this shape. */
export type ComputeNextPatchTagResult = ComputeNextTagResult;

function collectForMajor(
  existingTags: readonly string[],
  major: number
): ParsedVersionTag[] {
  const parsedForMajor: ParsedVersionTag[] = [];
  for (const raw of existingTags) {
    const parsed = parseVersionTag(raw);
    if (parsed && parsed.major === major) parsedForMajor.push(parsed);
  }
  return parsedForMajor;
}

function requireBase(
  parsedForMajor: ParsedVersionTag[],
  major: number
): string | null {
  const hasBase = parsedForMajor.some(
    (entry) => entry.minor === 0 && entry.patch === 0
  );
  if (hasBase) return null;
  return (
    `No v${major}.0.0 tag found. Cut major version ${major} first ` +
    `(releases are commits anchored to an existing major's slot).`
  );
}

function highestOf(parsedForMajor: ParsedVersionTag[]): ParsedVersionTag {
  let highest = parsedForMajor[0]!;
  for (const entry of parsedForMajor) {
    if (
      entry.minor > highest.minor ||
      (entry.minor === highest.minor && entry.patch > highest.patch)
    ) {
      highest = entry;
    }
  }
  return highest;
}

function validateMajor(major: number): string | null {
  if (!Number.isFinite(major) || major < 1 || Math.floor(major) !== major) {
    return `major must be a positive integer; got ${String(major)}.`;
  }
  return null;
}

/**
 * Auto-increments to the next patch tag for the given major,
 * WITHIN the highest existing minor. Fails when the base
 * `v{major}.0.0` tag doesn't exist. Gap-tolerant: highest + 1,
 * never reuses a freed number.
 */
export function computeNextPatchTag(
  existingTags: readonly string[],
  major: number
): ComputeNextTagResult {
  const majorError = validateMajor(major);
  if (majorError) return { ok: false, reason: majorError };
  const parsedForMajor = collectForMajor(existingTags, major);
  const baseError = requireBase(parsedForMajor, major);
  if (baseError) return { ok: false, reason: baseError };
  const highest = highestOf(parsedForMajor);
  return {
    ok: true,
    nextTag: `v${major}.${highest.minor}.${highest.patch + 1}`,
    highestExistingTag: highest.tag
  };
}

/**
 * Auto-increments to the next minor tag for the given major:
 * `v{major}.{highestMinor + 1}.0`. Same base requirement and
 * gap tolerance as patches.
 */
export function computeNextMinorTag(
  existingTags: readonly string[],
  major: number
): ComputeNextTagResult {
  const majorError = validateMajor(major);
  if (majorError) return { ok: false, reason: majorError };
  const parsedForMajor = collectForMajor(existingTags, major);
  const baseError = requireBase(parsedForMajor, major);
  if (baseError) return { ok: false, reason: baseError };
  const highest = highestOf(parsedForMajor);
  return {
    ok: true,
    nextTag: `v${major}.${highest.minor + 1}.0`,
    highestExistingTag: highest.tag
  };
}

export interface GroupedVersionMajor {
  major: number;
  baseTag: string;
  /** Every release after the base (`v{N}.0.0`), sorted ascending
   *  by (minor, patch) — minors and patches interleave in true
   *  release order. */
  patches: ParsedVersionTag[];
}

/**
 * Groups a flat tag list into majors + their releases, sorted
 * descending by major and ascending by (minor, patch) within
 * each major. Tags without a matching `v{N}.0.0` base are
 * skipped — they represent inconsistent history the Release
 * workspace doesn't render.
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
    const base = entries.find(
      (entry) => entry.minor === 0 && entry.patch === 0
    );
    if (!base) continue;
    const patches = entries
      .filter((entry) => entry.minor > 0 || entry.patch > 0)
      .sort((a, b) =>
        a.minor === b.minor ? a.patch - b.patch : a.minor - b.minor
      );
    result.push({ major, baseTag: base.tag, patches });
  }
  return result.sort((a, b) => b.major - a.major);
}
