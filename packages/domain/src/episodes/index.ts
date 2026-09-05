/**
 * packages/domain/src/episodes/index.ts
 *
 * Purpose: The `Episode` container — an ordered, gated run of
 * Scenes.
 *
 * Two words, two independent things (docs/api/domain-model.md):
 *
 *   - Episodes are ORDERED and GATED. Order says which chapter
 *     comes after which. The unlock rule says whether the player
 *     may go there yet.
 *   - Scenes are ORDERED but NOT gated. Order says which Scene
 *     comes after which inside the chapter. Nothing holds the
 *     player back — finishing one moves them to the next.
 *
 * Order is list position in both cases. There is no order number
 * on either type: a stored ordinal beside an ordered list is the
 * same fact written twice, and the two drift the moment a delete
 * leaves a hole.
 *
 * An Episode HOLDS its Scenes rather than naming them by id, so a
 * Scene belongs to exactly one Episode by construction — it
 * cannot be orphaned or owned twice. Code that needs a Scene
 * without caring which Episode owns it uses `getAllScenes` /
 * `findSceneById` below.
 *
 * An Episode in turn belongs to exactly one Season, which holds
 * it the same way (`seasons/`). The lookups here take an Episode
 * list, so a caller holding a project reaches them through
 * `getAllEpisodes(project.seasons)`.
 *
 * Lives beside `scenes/` rather than inside it: an Episode
 * contains Scenes, and filing the container inside the contained
 * type is the confusion this module exists to remove.
 *
 * Status: active
 */

import { createScopedId } from "../shared/identity";
import {
  normalizeScenes,
  normalizeTransitionConfig,
  type Scene,
  type TransitionConfig
} from "../scenes";
import type { QuestDefinition } from "../quest-definition";

/**
 * Stable id for the Episode that the load-time migration
 * synthesizes from a pre-Episodes project. A LITERAL, not a
 * generated id, matching `DEFAULT_SCENE_ID`'s reasoning: a
 * migration that ran twice must land on the same id both times.
 */
export const DEFAULT_EPISODE_ID = "episode:default";

export function createEpisodeId(): string {
  return createScopedId("episode");
}

/**
 * The GATE: when an Episode becomes playable. Evaluated at boot
 * against the player's save.
 *
 *   - `"always"` — playable from the first boot. The default.
 *   - `manual` — only opened by an explicit `unlockEpisode` quest
 *     action.
 *   - `questComplete` — opens when the referenced quest is in the
 *     save's completed set.
 *   - `wallClock` — opens at/after an ISO timestamp. Compared
 *     against the caller's `now` at boot; a runtime read, never
 *     persisted (the no-wall-clock-in-a-slice rule covers save
 *     slices, not authored schedule data).
 *
 * Scenes have no equivalent. Inside an Episode they run in order
 * and advance by the `advanceToNextScene` action.
 */
export type EpisodeUnlockCondition =
  | "always"
  | { kind: "manual" }
  | { kind: "questComplete"; questDefinitionId: string }
  | { kind: "wallClock"; unlockAtIso: string };

/**
 * Where the player goes when an Episode ends. A per-GAME choice,
 * not an engine rule — see `GameProject.episodeEndRouting`.
 *
 * "Routing" here means the same thing it means at the site this
 * came from (`runtimeHost`'s exit sequence: "a filling Next
 * button auto-advancing, or a return button"): which way the
 * player goes next. Unrelated to sugaragent's `turnRouting`,
 * which picks a conversation path.
 */
export type EpisodeEndRouting = "episodes-screen" | "next-episode";

export const DEFAULT_EPISODE_END_ROUTING: EpisodeEndRouting = "episodes-screen";

export function normalizeEpisodeEndRouting(input: unknown): EpisodeEndRouting {
  return input === "next-episode"
    ? "next-episode"
    : DEFAULT_EPISODE_END_ROUTING;
}

export interface Episode {
  episodeId: string;
  displayName: string;
  description: string;
  /** Free-form author notes (design intent, TODOs). */
  notes: string;
  /** The gate — see `EpisodeUnlockCondition`. */
  unlockCondition: EpisodeUnlockCondition;
  /** Title card shown when the game enters this Episode. Null
   *  means hard cut, no card. Shares its shape with a Scene's
   *  card; the two differ only in who owns them and when they
   *  play. */
  transitionConfig: TransitionConfig | null;
  /** Ordered. Position in this list IS the narrative order —
   *  there is no order number. Reordering moves an entry;
   *  deleting one closes the gap. */
  scenes: Scene[];
}

export function createDefaultEpisode(
  overrides: Partial<Episode> = {}
): Episode {
  return {
    episodeId: overrides.episodeId ?? createEpisodeId(),
    displayName: overrides.displayName ?? "Episode 1",
    description: overrides.description ?? "",
    notes: overrides.notes ?? "",
    unlockCondition: overrides.unlockCondition ?? "always",
    transitionConfig: overrides.transitionConfig ?? null,
    scenes: [...(overrides.scenes ?? [])]
  };
}

function normalizeUnlockCondition(input: unknown): EpisodeUnlockCondition {
  if (input === "always") return "always";
  if (!input || typeof input !== "object") return "always";
  const record = input as Record<string, unknown>;
  if (record.kind === "manual") return { kind: "manual" };
  if (
    record.kind === "questComplete" &&
    typeof record.questDefinitionId === "string" &&
    record.questDefinitionId.trim().length > 0
  ) {
    return {
      kind: "questComplete",
      questDefinitionId: record.questDefinitionId.trim()
    };
  }
  if (
    record.kind === "wallClock" &&
    typeof record.unlockAtIso === "string" &&
    record.unlockAtIso.trim().length > 0
  ) {
    return { kind: "wallClock", unlockAtIso: record.unlockAtIso.trim() };
  }
  return "always";
}

/**
 * Defensive normalization for load paths. Shape coercion only.
 *
 * Scene order is INPUT ORDER — this never sorts. The load path is
 * the one place that could quietly reorder a narrative, and a
 * reorder here is unrecoverable rather than merely wrong.
 */
export function normalizeEpisode(input: unknown): Episode | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  if (
    typeof record.episodeId !== "string" ||
    record.episodeId.trim().length === 0
  ) {
    return null;
  }
  const scenes: Scene[] = [];
  // Through `normalizeScenes`, not a local loop over `normalizeScene`:
  // that function owns list-level normalization, including filling a Scene
  // that names no region from the Scene before it. A private loop here is
  // how that rule silently stopped applying to Scenes inside Episodes,
  // which is every Scene there is.
  scenes.push(...normalizeScenes(record.scenes));
  return {
    episodeId: record.episodeId.trim(),
    displayName:
      typeof record.displayName === "string" &&
      record.displayName.trim().length > 0
        ? record.displayName.trim()
        : "Episode",
    description:
      typeof record.description === "string" ? record.description : "",
    notes: typeof record.notes === "string" ? record.notes : "",
    unlockCondition: normalizeUnlockCondition(record.unlockCondition),
    transitionConfig: normalizeTransitionConfig(record.transitionConfig),
    scenes
  };
}

/**
 * Normalize a project's `episodes` array. Drops malformed
 * entries, dedupes by episodeId (first wins), and — like
 * `normalizeEpisode` — PRESERVES input order rather than sorting.
 * A Scene id appearing in two Episodes is kept only in the first,
 * which is what makes single ownership true after a hand-edited
 * file as well as after a migration.
 *
 * The caller may pass the sets of ids already claimed, so the
 * same first-wins rule spans every Episode list in the story
 * rather than restarting per Season. `normalizeSeasons` threads
 * them; a caller normalizing one list on its own gets fresh sets
 * and the behaviour above.
 */
export function normalizeEpisodes(
  input: unknown,
  seenEpisodeIds: Set<string> = new Set(),
  seenSceneIds: Set<string> = new Set()
): Episode[] {
  if (!Array.isArray(input)) return [];
  const episodes: Episode[] = [];
  for (const candidate of input) {
    const episode = normalizeEpisode(candidate);
    if (!episode || seenEpisodeIds.has(episode.episodeId)) continue;
    seenEpisodeIds.add(episode.episodeId);
    const scenes = episode.scenes.filter((scene) => {
      if (seenSceneIds.has(scene.sceneId)) return false;
      seenSceneIds.add(scene.sceneId);
      return true;
    });
    episodes.push({ ...episode, scenes });
  }
  return episodes;
}

/**
 * Evaluate every Episode's gate against the player's save state
 * at boot. Pure; the caller supplies `now` (epoch ms) so the
 * wall-clock read stays at the seam and is never persisted.
 *
 * A manual unlock satisfies EVERY condition kind, not just
 * `manual`. That is deliberate: the advance path records the
 * Episode it moved into as manually unlocked, so a player who has
 * passed an Episode keeps it open even if the author later
 * retunes its gate.
 */
export function resolveUnlockedEpisodeIds(input: {
  episodes: readonly Episode[];
  /** Episode ids explicitly opened by gameplay (the
   *  `unlockEpisode` action) — from campaign.progression. */
  manuallyUnlockedEpisodeIds: readonly string[];
  /** From the quest.manager slice — drives `questComplete`. */
  completedQuestIds: readonly string[];
  now: number;
}): Set<string> {
  const manual = new Set(input.manuallyUnlockedEpisodeIds);
  const quests = new Set(input.completedQuestIds);
  const unlocked = new Set<string>();
  for (const episode of input.episodes) {
    const condition = episode.unlockCondition;
    if (condition === "always" || manual.has(episode.episodeId)) {
      unlocked.add(episode.episodeId);
    } else if (condition.kind === "questComplete") {
      if (quests.has(condition.questDefinitionId)) {
        unlocked.add(episode.episodeId);
      }
    } else if (condition.kind === "wallClock") {
      const unlockAt = Date.parse(condition.unlockAtIso);
      if (Number.isFinite(unlockAt) && input.now >= unlockAt) {
        unlocked.add(episode.episodeId);
      }
    }
  }
  return unlocked;
}

/**
 * Pick the Episode the runtime boots into.
 *
 * Precedence: the requested Episode (saved `currentEpisodeId`, or
 * Studio Preview's ambient selection) IF its gate is open; else
 * the first open Episode in order; else the first Episode
 * outright — a project whose every Episode is gated shut still
 * has to boot, because authors gate Episode 1 by accident and
 * players should not hit a black screen.
 */
export function resolveActiveEpisode(input: {
  episodes: readonly Episode[];
  unlockedEpisodeIds: ReadonlySet<string>;
  requestedEpisodeId: string | null;
  /**
   * Reads quest completion, so a finished Episode is not offered as the one
   * the player is in. Omit and every Episode counts as unfinished, which is
   * the pre-story-timeline behaviour.
   */
  isQuestCompleted?: QuestCompletionReader;
}): Episode | null {
  // An Episode with no Scenes cannot be entered -- `resolveActiveScene`
  // returns null for one -- so boot never lands on it. The session
  // functions cannot produce an empty Episode; a hand-edited file can.
  const { isQuestCompleted } = input;
  const open = input.episodes.filter(
    (episode) =>
      episode.scenes.length > 0 &&
      input.unlockedEpisodeIds.has(episode.episodeId) &&
      // No reader means the caller is not tracking completion, so nothing
      // is finished and every unlocked Episode is open -- the behaviour
      // before the story timeline existed.
      (!isQuestCompleted || !isEpisodeComplete(episode, isQuestCompleted))
  );
  const requested = open.find(
    (episode) => episode.episodeId === input.requestedEpisodeId
  );
  // NULL when nothing is open: every unlocked Episode is finished, or the
  // next is gated shut. That is a real position on the story timeline --
  // above the Episode tier -- not a failure to find one. The old fallback
  // to "the first Episode that exists" put the player back inside content
  // they had already played.
  return requested ?? open[0] ?? null;
}

/**
 * Pick the Scene the runtime boots into within an Episode.
 *
 * No gate is consulted — Scenes are ordered but not gated. The
 * requested Scene wins if the Episode holds it; otherwise the
 * Episode starts at its first Scene.
 */
export function resolveActiveScene(input: {
  episode: Episode | null;
  requestedSceneId: string | null;
  /** Same role as on `resolveActiveEpisode`: without it every Scene counts
   *  as unfinished and the first one wins, as it did before. */
  isQuestCompleted?: QuestCompletionReader;
}): Scene | null {
  if (!input.episode) return null;
  const { isQuestCompleted } = input;
  const open = input.episode.scenes.filter(
    (scene) => !isQuestCompleted || !isSceneComplete(scene, isQuestCompleted)
  );
  const requested = open.find(
    (scene) => scene.sceneId === input.requestedSceneId
  );
  // An Episode the caller resolved is unfinished, so it has an open Scene.
  // Null here means every Scene is done, which only happens when the caller
  // asked about an Episode it did not resolve.
  return requested ?? open[0] ?? null;
}

/**
 * Whether a quest has been finished. Supplied by the caller because the
 * answer lives in the player's save, and this package is pure.
 */
export type QuestCompletionReader = (questDefinitionId: string) => boolean;

/**
 * A Scene is complete when every quest it holds is.
 *
 * [LAW:one-source-of-truth] Derived, never stored. Quest completion is the
 * one recorded fact; everything above it on the story timeline is
 * arithmetic over containment.
 *
 * A Scene with no quests is complete: every one of its quests is done,
 * vacuously. Note the consequence -- an Episode made only of quest-less
 * Scenes is complete the moment it exists, so it can never be entered.
 * Authoring a Scene as pure dressing is a real thing to want; making it
 * the only Scene in an Episode is not.
 */
export function isSceneComplete(
  scene: Scene,
  isQuestCompleted: QuestCompletionReader
): boolean {
  return scene.questDefinitions.every((quest) =>
    isQuestCompleted(quest.definitionId)
  );
}

/**
 * An Episode is complete when every Scene it holds is.
 *
 * An Episode with no Scenes is NOT complete -- it cannot be entered
 * (`resolveActiveScene` returns null for one), so calling it finished would
 * claim the player did something they had no way to do.
 */
export function isEpisodeComplete(
  episode: Episode,
  isQuestCompleted: QuestCompletionReader
): boolean {
  if (episode.scenes.length === 0) return false;
  return episode.scenes.every((scene) =>
    isSceneComplete(scene, isQuestCompleted)
  );
}

/** Every Scene in the project, in narrative order across Episodes. */
export function getAllScenes(episodes: readonly Episode[]): Scene[] {
  return episodes.flatMap((episode) => episode.scenes);
}

/**
 * Every quest in the project, in narrative order (epic #226).
 *
 * Quests are HELD BY the Scene they happen in, but most consumers -- the
 * runtime's quest manager, the deploy bundle, validation -- want them all
 * and do not care which Scene owns which. This is that flat view, derived
 * on read. Containment is the storage; this is the projection.
 */
export function getAllQuestDefinitionsInEpisodes(
  episodes: readonly Episode[]
): QuestDefinition[] {
  return getAllScenes(episodes).flatMap((scene) => scene.questDefinitions);
}

/** The quest with this id, or null. */
export function findQuestDefinitionById(
  episodes: readonly Episode[],
  questDefinitionId: string | null
): QuestDefinition | null {
  if (!questDefinitionId) return null;
  return (
    getAllQuestDefinitionsInEpisodes(episodes).find(
      (quest) => quest.definitionId === questDefinitionId
    ) ?? null
  );
}

/** The Scene holding this quest, or null. */
export function findSceneByQuestDefinitionId(
  episodes: readonly Episode[],
  questDefinitionId: string | null
): Scene | null {
  if (!questDefinitionId) return null;
  return (
    getAllScenes(episodes).find((scene) =>
      scene.questDefinitions.some(
        (quest) => quest.definitionId === questDefinitionId
      )
    ) ?? null
  );
}

/** The Scene with this id, or null. */
export function findSceneById(
  episodes: readonly Episode[],
  sceneId: string | null
): Scene | null {
  if (!sceneId) return null;
  for (const episode of episodes) {
    const scene = episode.scenes.find((entry) => entry.sceneId === sceneId);
    if (scene) return scene;
  }
  return null;
}

/** The Episode holding this Scene, or null. */
export function findEpisodeBySceneId(
  episodes: readonly Episode[],
  sceneId: string | null
): Episode | null {
  if (!sceneId) return null;
  return (
    episodes.find((episode) =>
      episode.scenes.some((scene) => scene.sceneId === sceneId)
    ) ?? null
  );
}

/**
 * Rewrite every Scene in one Episode list, preserving which
 * Episode owns which.
 *
 * Story-wide code wants `mapScenes` in `seasons/` instead:
 * that one preserves Season ownership too, and rebuilding a
 * story from a flat Episode list is how Season membership gets
 * silently collapsed.
 */
export function mapScenesInEpisodes(
  episodes: readonly Episode[],
  transform: (scene: Scene, episode: Episode) => Scene
): Episode[] {
  return episodes.map((episode) => ({
    ...episode,
    scenes: episode.scenes.map((scene) => transform(scene, episode))
  }));
}
