/**
 * packages/domain/src/seasons/index.ts
 *
 * Purpose: The `Season` container — an ordered run of Episodes.
 *
 * A Season holds Episodes and nothing else. It does not gate, it
 * does not complete, and it shows no title card; those all live
 * on the Episode, which is the gated unit. A Season exists so a
 * serial run of Episodes has a name and a boundary.
 *
 * Order is list position, as it is for Episodes and Scenes. There
 * is no order number: a stored ordinal beside an ordered list is
 * the same fact written twice, and the two drift the moment a
 * delete leaves a hole.
 *
 * A Season HOLDS its Episodes rather than naming them by id, so
 * an Episode belongs to exactly one Season by construction. Code
 * that wants every Episode without caring which Season owns it
 * uses `getAllEpisodes`; code that REWRITES Episodes or Scenes
 * uses `mapEpisodes` / `mapScenes`, which preserve ownership.
 *
 * Narrative order across the whole story is the concatenation
 * of each Season's list, in Season order. Gating reads that flat
 * run and cannot observe the grouping.
 *
 * `mapScenes` lives here rather than in `episodes/` because its
 * signature names `Season`; the dependency runs seasons ->
 * episodes -> scenes and never back up.
 *
 * Status: active
 */

import {
  createDefaultEpisode,
  normalizeEpisodes,
  type Episode
} from "../episodes";
import { createDefaultScene } from "../scenes";
import type { Scene } from "../scenes";
import { createScopedId } from "../shared/identity";

/**
 * Stable id for the Season that the load-time migration
 * synthesizes when it wraps a pre-Seasons story. A LITERAL,
 * not a generated id, matching `DEFAULT_EPISODE_ID`'s reasoning:
 * a migration that ran twice must land on the same id both times.
 */
export const DEFAULT_SEASON_ID = "season:default";

export function createSeasonId(): string {
  return createScopedId("season");
}

export interface Season {
  seasonId: string;
  displayName: string;
  description: string;
  /** Free-form author notes (design intent, TODOs). */
  notes: string;
  /**
   * Ordered. Position in this list IS the narrative order — there
   * is no order number. Reordering moves an entry; deleting one
   * closes the gap.
   *
   * Never empty in an authored project: the session operations
   * that create, move and delete Episodes are the enforcers (a
   * Season is created holding one Episode, the last Episode
   * cannot be deleted or moved out). Load does not enforce it,
   * matching how an Episode's Scene list behaves.
   *
   * A Season carries no gate. Revisit when an author wants
   * Season 2 hidden until Season 1 finishes — today that is done
   * by gating Season 2's first Episode. Adding a real gate means
   * a SeasonUnlockCondition, an `unlockedSeasonIds` set in the
   * campaign.progression save slice, and a schema version bump.
   */
  episodes: Episode[];
}

export function createDefaultSeason(overrides: Partial<Season> = {}): Season {
  return {
    seasonId: overrides.seasonId ?? createSeasonId(),
    displayName: overrides.displayName ?? "Season 1",
    description: overrides.description ?? "",
    notes: overrides.notes ?? "",
    episodes: [...(overrides.episodes ?? [])]
  };
}

export function normalizeSeason(
  input: unknown,
  seenEpisodeIds: Set<string> = new Set(),
  seenSceneIds: Set<string> = new Set()
): Season | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  if (
    typeof record.seasonId !== "string" ||
    record.seasonId.trim().length === 0
  ) {
    return null;
  }
  return {
    seasonId: record.seasonId,
    displayName:
      typeof record.displayName === "string" ? record.displayName : "Season",
    description:
      typeof record.description === "string" ? record.description : "",
    notes: typeof record.notes === "string" ? record.notes : "",
    // Through `normalizeEpisodes`, not a local loop: that function owns
    // list-level normalization, including the first-wins dedupe. The seen
    // sets are threaded in so the dedupe spans the whole story.
    episodes: normalizeEpisodes(record.episodes, seenEpisodeIds, seenSceneIds)
  };
}

/**
 * Normalize a project's `seasons` array. Drops malformed entries,
 * dedupes by seasonId (first wins), and PRESERVES input order
 * rather than sorting.
 *
 * One set of seen Episode ids and one of seen Scene ids threads
 * across every Season, so an id appearing in two Seasons is kept
 * only in the first. That is what makes single ownership true
 * after a hand-edited file: `unlockedEpisodeIds` in the save is a
 * flat set of Episode ids, and the Season an Episode belongs to
 * is derived by searching, so a duplicate would make both
 * ambiguous.
 */
export function normalizeSeasons(input: unknown): Season[] {
  if (!Array.isArray(input)) return [];
  const seenSeasonIds = new Set<string>();
  const seenEpisodeIds = new Set<string>();
  const seenSceneIds = new Set<string>();
  const seasons: Season[] = [];
  for (const candidate of input) {
    const season = normalizeSeason(candidate, seenEpisodeIds, seenSceneIds);
    if (!season || seenSeasonIds.has(season.seasonId)) continue;
    seenSeasonIds.add(season.seasonId);
    seasons.push(season);
  }
  return seasons;
}

/**
 * Wrap a pre-Seasons story — a flat Episode list — in one
 * Season. Used by the load path and by any boundary that reads a
 * payload baked before Seasons existed.
 */
export function wrapEpisodesInDefaultSeason(episodes: Episode[]): Season[] {
  return [
    createDefaultSeason({
      seasonId: DEFAULT_SEASON_ID,
      episodes
    })
  ];
}

/** Every Episode in the project, in narrative order across Seasons. */
export function getAllEpisodes(seasons: readonly Season[]): Episode[] {
  return seasons.flatMap((season) => season.episodes);
}

/** The Season with this id, or null. */
export function findSeasonById(
  seasons: readonly Season[],
  seasonId: string | null
): Season | null {
  if (!seasonId) return null;
  return seasons.find((season) => season.seasonId === seasonId) ?? null;
}

/** The Season holding this Episode, or null. */
export function findSeasonByEpisodeId(
  seasons: readonly Season[],
  episodeId: string | null
): Season | null {
  if (!episodeId) return null;
  return (
    seasons.find((season) =>
      season.episodes.some((episode) => episode.episodeId === episodeId)
    ) ?? null
  );
}

/**
 * Rewrite every Episode in place, preserving which Season owns
 * which. The write-side counterpart to `getAllEpisodes` — code
 * that used to map over a flat `episodes` array uses this so
 * Season membership and order survive the rewrite.
 */
export function mapEpisodes(
  seasons: readonly Season[],
  transform: (episode: Episode, season: Season) => Episode
): Season[] {
  return seasons.map((season) => ({
    ...season,
    episodes: season.episodes.map((episode) => transform(episode, season))
  }));
}

/**
 * Rewrite every Scene in the story, preserving which Episode
 * and which Season owns which. The write-side counterpart to
 * `getAllScenes(getAllEpisodes(seasons))`.
 */
export function mapScenes(
  seasons: readonly Season[],
  transform: (scene: Scene, episode: Episode) => Scene
): Season[] {
  return mapEpisodes(seasons, (episode) => ({
    ...episode,
    scenes: episode.scenes.map((scene) => transform(scene, episode))
  }));
}

/**
 * The story a project gets when its file carries no Seasons
 * and no Episodes: one of each, so Studio always has an active
 * Scene to author against and the runtime always has something to
 * boot into.
 */
export function createDefaultSeasons(defaults: {
  seasonId?: string;
  episodeId?: string;
  sceneId?: string;
  episodeDisplayName?: string;
}): Season[] {
  return [
    createDefaultSeason({
      seasonId: defaults.seasonId ?? DEFAULT_SEASON_ID,
      episodes: [
        createDefaultEpisode({
          episodeId: defaults.episodeId,
          displayName: defaults.episodeDisplayName,
          scenes: [createDefaultScene({ sceneId: defaults.sceneId })]
        })
      ]
    })
  ];
}
