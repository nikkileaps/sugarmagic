/**
 * apps/studio/src/StoryStructureView.tsx
 *
 * Purpose: the Story mode's structure workspace -- the Seasons a
 * project has, the Episodes each one holds, the Scenes inside those,
 * and everything about them an author edits. Master-detail: the left
 * column lists all three levels and creates / renames / reorders /
 * deletes / activates them; the right pane edits whichever is
 * selected. The Scene pane renders a static transition-card preview
 * from the SAME styling constants the runtime card uses.
 *
 * Delete is guarded on every level, and each guard counts the
 * container it belongs to rather than the project: the last Season,
 * a Season's last Episode, and an Episode's last Scene are all
 * undeletable, and neither a Season nor an Episode can be emptied by
 * moving its final child out. A project-wide count would allow the
 * last Episode of Season 2 to go and leave an empty Season behind.
 * Inline confirm instead of a browser dialog, per the Mantine-only
 * rule.
 *
 * Reorder arrows step within one container only. Changing which
 * Season owns an Episode, or which Episode owns a Scene, is a
 * separate "Move to" control on the right pane.
 *
 * This was a modal reached from a top-bar menu until epic #226 gave
 * the narrative its own product mode. The editing surface moved here
 * whole; what went away is its modal-ness and the menu item.
 *
 * Lives in the app rather than `@sugarmagic/workspaces` because it
 * shares the runtime's transition-card styling constants, and
 * workspaces may not import `@sugarmagic/target-web`. The Story mode
 * hook takes this rendered panel instead of importing it.
 *
 * Status: active
 */

import { useState } from "react";
import {
  ActionIcon,
  Box,
  Button,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput
} from "@mantine/core";
import type {
  Episode,
  EpisodeEndRouting,
  EpisodeUnlockCondition,
  QuestDefinition,
  Season,
  Scene,
  TransitionConfig
} from "@sugarmagic/domain";
import {
  TRANSITION_CARD_FADE_BACKGROUNDS,
  TRANSITION_CARD_FADE_TEXT_COLORS,
  TRANSITION_CARD_FONT_FAMILY
} from "@sugarmagic/target-web";

export interface StoryStructureViewProps {
  seasons: Season[];
  activeSceneId: string | null;
  questDefinitions: QuestDefinition[];
  environmentDefinitions: { definitionId: string; displayName: string }[];
  /** Region options for the per-Scene starting region. */
  regions: { regionId: string; displayName: string }[];
  /** Plan 059 §059.1 — options for the background-music override. */
  soundCueDefinitions: { definitionId: string; displayName: string }[];
  onAddScene: (displayName: string, episodeId: string) => void;
  onRenameScene: (sceneId: string, displayName: string) => void;
  onUpdateScene: (
    sceneId: string,
    patch: Partial<
      Pick<
        Scene,
        | "description"
        | "notes"
        | "regionId"
        | "environmentOverride"
        | "audioOverride"
        | "transitionConfig"
      >
    >
  ) => void;
  onDeleteScene: (sceneId: string) => void;
  onReorderScene: (sceneId: string, direction: "up" | "down") => void;
  onSelectScene: (sceneId: string) => void;
  /** Where the player goes when an Episode ends. Project-level. */
  episodeEndRouting: EpisodeEndRouting;
  onUpdateEpisodeEndRouting: (routing: EpisodeEndRouting) => void;
  /** Which Season the new Episode joins — the group its input sits under. */
  onAddEpisode: (displayName: string, seasonId: string) => void;
  onUpdateEpisode: (
    episodeId: string,
    patch: Partial<
      Pick<Episode, "displayName" | "description" | "notes" | "unlockCondition">
    >
  ) => void;
  onDeleteEpisode: (episodeId: string) => void;
  onReorderEpisode: (episodeId: string, direction: "up" | "down") => void;
  onMoveSceneToEpisode: (sceneId: string, toEpisodeId: string) => void;
  onMoveQuestToScene: (questDefinitionId: string, toSceneId: string) => void;
  onAddSeason: (displayName: string) => void;
  onUpdateSeason: (
    seasonId: string,
    patch: Partial<Pick<Season, "displayName" | "description" | "notes">>
  ) => void;
  onDeleteSeason: (seasonId: string) => void;
  onReorderSeason: (seasonId: string, direction: "up" | "down") => void;
  onMoveEpisodeToSeason: (episodeId: string, toSeasonId: string) => void;
}

/** What the left column has selected — a Season, Episode or Scene row. */
type Selection =
  | { kind: "season"; seasonId: string }
  | { kind: "episode"; episodeId: string }
  | { kind: "scene"; sceneId: string };

type UnlockKind = "always" | "manual" | "questComplete" | "wallClock";

function unlockKindOf(condition: EpisodeUnlockCondition): UnlockKind {
  return condition === "always" ? "always" : condition.kind;
}

/** ISO timestamp -> the local "YYYY-MM-DDTHH:mm" a
 *  datetime-local input wants. Empty on unparseable input. */
function isoToLocalInputValue(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-` +
    `${pad(parsed.getDate())}T${pad(parsed.getHours())}:` +
    `${pad(parsed.getMinutes())}`
  );
}

const DEFAULT_CARD_FADE: TransitionConfig["fadeStyle"] = "black";
const DEFAULT_CARD_DURATION_MS = 2500;

/** Shared label styling for every field in this modal. */
const fieldLabelProps = {
  styles: {
    label: { color: "var(--sm-color-subtext)" },
    description: { color: "var(--sm-color-overlay0)" }
  }
} as const;

/** The Episode gate: which of the four kinds, plus the extra
 *  field two of them need. */
function EpisodeGateFields(props: {
  episode: Episode;
  questDefinitions: QuestDefinition[];
  onUpdateEpisode: (
    episodeId: string,
    patch: Partial<Pick<Episode, "unlockCondition">>
  ) => void;
}) {
  const { episode, questDefinitions, onUpdateEpisode } = props;
  const kind = unlockKindOf(episode.unlockCondition);
  return (
    <>
      <Select
        size="xs"
        label="Unlocks"
        data={[
          { value: "always", label: "Always unlocked" },
          { value: "manual", label: "Unlocked by a quest action" },
          { value: "questComplete", label: "When a quest completes" },
          { value: "wallClock", label: "At a scheduled time" }
        ]}
        value={kind}
        onChange={(value) => {
          if (!value) return;
          const next = value as UnlockKind;
          const unlockCondition: EpisodeUnlockCondition =
            next === "always"
              ? "always"
              : next === "manual"
                ? { kind: "manual" }
                : next === "questComplete"
                  ? {
                      kind: "questComplete",
                      questDefinitionId: questDefinitions[0]?.definitionId ?? ""
                    }
                  : {
                      kind: "wallClock",
                      unlockAtIso: new Date().toISOString()
                    };
          onUpdateEpisode(episode.episodeId, { unlockCondition });
        }}
        {...fieldLabelProps}
      />
      {kind === "questComplete" && (
        <Select
          size="xs"
          label="Quest"
          data={questDefinitions.map((quest) => ({
            value: quest.definitionId,
            label: quest.displayName
          }))}
          value={
            episode.unlockCondition !== "always" &&
            episode.unlockCondition.kind === "questComplete"
              ? episode.unlockCondition.questDefinitionId
              : null
          }
          onChange={(value) => {
            if (!value) return;
            onUpdateEpisode(episode.episodeId, {
              unlockCondition: {
                kind: "questComplete",
                questDefinitionId: value
              }
            });
          }}
          {...fieldLabelProps}
        />
      )}
      {kind === "wallClock" && (
        <TextInput
          size="xs"
          label="Unlocks at"
          type="datetime-local"
          value={
            episode.unlockCondition !== "always" &&
            episode.unlockCondition.kind === "wallClock"
              ? isoToLocalInputValue(episode.unlockCondition.unlockAtIso)
              : ""
          }
          onChange={(event) => {
            const parsed = new Date(event.currentTarget.value);
            if (Number.isNaN(parsed.getTime())) return;
            onUpdateEpisode(episode.episodeId, {
              unlockCondition: {
                kind: "wallClock",
                unlockAtIso: parsed.toISOString()
              }
            });
          }}
          {...fieldLabelProps}
        />
      )}
    </>
  );
}

export function StoryStructureView(props: StoryStructureViewProps) {
  const {
    seasons,
    activeSceneId,
    questDefinitions,
    environmentDefinitions,
    regions,
    soundCueDefinitions,
    onAddScene,
    onRenameScene,
    onUpdateScene,
    onDeleteScene,
    onReorderScene,
    onSelectScene,
    episodeEndRouting,
    onUpdateEpisodeEndRouting,
    onAddEpisode,
    onUpdateEpisode,
    onDeleteEpisode,
    onReorderEpisode,
    onMoveSceneToEpisode,
    onMoveQuestToScene,
    onAddSeason,
    onUpdateSeason,
    onDeleteSeason,
    onReorderSeason,
    onMoveEpisodeToSeason
  } = props;
  const [newSceneName, setNewSceneName] = useState("");
  // Keyed by Season: each Season's group has its own Episode input, so
  // one shared draft would type into every group at once.
  const [newEpisodeNames, setNewEpisodeNames] = useState<
    Record<string, string>
  >({});
  const [newSeasonName, setNewSeasonName] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({});
  const [selection, setSelection] = useState<Selection | null>(null);

  const episodes = seasons.flatMap((season) => season.episodes);
  const scenes = episodes.flatMap((episode) => episode.scenes);

  /** The Scene the right pane edits, or null when an Episode row
   *  is selected. Falls back to the ambient Scene so opening the
   *  modal always lands somewhere. */
  /**
   * The Season the right pane edits, when a Season row is selected.
   *
   * Resolved before the other two because a selection can name a
   * Season that has since been deleted. Finding nothing here makes
   * the rows below fall back to their defaults, the same as a fresh
   * panel -- otherwise deleting the selected Season leaves all three
   * panes empty until the author clicks something.
   */
  const selectedSeason =
    selection?.kind === "season"
      ? (seasons.find((season) => season.seasonId === selection.seasonId) ??
        null)
      : null;
  const seasonRowSelected = selectedSeason !== null;

  const selectedScene =
    selection?.kind === "episode" || seasonRowSelected
      ? null
      : (scenes.find(
          (scene) =>
            selection?.kind === "scene" && scene.sceneId === selection.sceneId
        ) ??
        scenes.find((scene) => scene.sceneId === activeSceneId) ??
        scenes[0] ??
        null);

  /** The Episode the right pane edits: the selected one, or the
   *  one holding the selected Scene. Null while a Season row is
   *  selected — that row has its own pane. */
  const selectedEpisode = seasonRowSelected
    ? null
    : ((selection?.kind === "episode"
        ? episodes.find((episode) => episode.episodeId === selection.episodeId)
        : episodes.find((episode) =>
            episode.scenes.some(
              (scene) => scene.sceneId === selectedScene?.sceneId
            )
          )) ??
      episodes[0] ??
      null);

  /** The Season holding the Episode the right pane edits. */
  const selectedEpisodeSeason =
    seasons.find((season) =>
      season.episodes.some(
        (episode) => episode.episodeId === selectedEpisode?.episodeId
      )
    ) ?? null;

  /**
   * Where "+ Add Scene" puts the Scene. Selecting a Season clears
   * `selectedEpisode` on purpose, so without a target of its own the
   * button would silently do nothing the moment an author clicked
   * into a Season's name field -- which is also how that field is
   * renamed.
   */
  const newSceneEpisode =
    selectedEpisode ?? selectedSeason?.episodes[0] ?? episodes[0] ?? null;

  const commitRename = (scene: Scene) => {
    const draft = renameDrafts[scene.sceneId];
    if (draft !== undefined && draft.trim() && draft !== scene.displayName) {
      onRenameScene(scene.sceneId, draft.trim());
    }
    setRenameDrafts((drafts) => {
      const { [scene.sceneId]: _committed, ...rest } = drafts;
      return rest;
    });
  };

  const submitNewScene = () => {
    const name = newSceneName.trim();
    if (!name || !newSceneEpisode) return;
    onAddScene(name, newSceneEpisode.episodeId);
    setNewSceneName("");
  };

  const submitNewEpisode = (seasonId: string) => {
    const name = (newEpisodeNames[seasonId] ?? "").trim();
    if (!name) return;
    onAddEpisode(name, seasonId);
    setNewEpisodeNames((drafts) => ({ ...drafts, [seasonId]: "" }));
  };

  const submitNewSeason = () => {
    const name = newSeasonName.trim();
    if (!name) return;
    onAddSeason(name);
    setNewSeasonName("");
  };

  const commitSeasonRename = (season: Season) => {
    const draft = renameDrafts[season.seasonId];
    if (draft !== undefined && draft.trim() && draft !== season.displayName) {
      onUpdateSeason(season.seasonId, { displayName: draft.trim() });
    }
    setRenameDrafts((drafts) => {
      const { [season.seasonId]: _committed, ...rest } = drafts;
      return rest;
    });
  };

  const commitEpisodeRename = (episode: Episode) => {
    const draft = renameDrafts[episode.episodeId];
    if (draft !== undefined && draft.trim() && draft !== episode.displayName) {
      onUpdateEpisode(episode.episodeId, { displayName: draft.trim() });
    }
    setRenameDrafts((drafts) => {
      const { [episode.episodeId]: _committed, ...rest } = drafts;
      return rest;
    });
  };

  // Plan 058 §058.6 — commit the transition card from the four UI
  // fields. Empty title = null config = hard cut (mirrors the
  // domain normalizer, which drops titleless configs on load).
  const commitTransition = (scene: Scene, patch: Partial<TransitionConfig>) => {
    const current = scene.transitionConfig;
    const next: TransitionConfig = {
      titleText: patch.titleText ?? current?.titleText ?? "",
      subtitleText:
        patch.subtitleText !== undefined
          ? patch.subtitleText
          : (current?.subtitleText ?? null),
      durationMs:
        patch.durationMs ?? current?.durationMs ?? DEFAULT_CARD_DURATION_MS,
      fadeStyle: patch.fadeStyle ?? current?.fadeStyle ?? DEFAULT_CARD_FADE
    };
    onUpdateScene(
      scene.sceneId,
      next.titleText.trim().length === 0
        ? { transitionConfig: null }
        : { transitionConfig: next }
    );
  };

  return (
    <Group align="flex-start" gap="lg" wrap="nowrap">
      {/* --- Left: Episodes, each with its Scenes ------------ */}
      <Stack gap="md" style={{ width: 380, flexShrink: 0 }}>
        <Select
          size="xs"
          label="When an Episode ends"
          data={[
            {
              value: "episodes-screen",
              label: "Go back to the Episodes screen"
            },
            { value: "next-episode", label: "Continue to the next Episode" }
          ]}
          value={episodeEndRouting}
          onChange={(value) => {
            if (value === "episodes-screen" || value === "next-episode") {
              onUpdateEpisodeEndRouting(value);
            }
          }}
          {...fieldLabelProps}
        />
        <Stack gap="xs">
          {seasons.map((season, seasonIndex) => (
            <Stack key={season.seasonId} gap={2}>
              {/* Season row */}
              <Group
                gap="xs"
                wrap="nowrap"
                onClick={() =>
                  setSelection({ kind: "season", seasonId: season.seasonId })
                }
                style={{
                  padding: 4,
                  borderRadius: 6,
                  cursor: "pointer",
                  background:
                    selection?.kind === "season" &&
                    selection.seasonId === season.seasonId
                      ? "var(--sm-active-bg)"
                      : "transparent"
                }}
              >
                <TextInput
                  size="xs"
                  style={{ flex: 1 }}
                  value={renameDrafts[season.seasonId] ?? season.displayName}
                  onFocus={() =>
                    setSelection({
                      kind: "season",
                      seasonId: season.seasonId
                    })
                  }
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setRenameDrafts((drafts) => ({
                      ...drafts,
                      [season.seasonId]: value
                    }));
                  }}
                  onBlur={() => commitSeasonRename(season)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitSeasonRename(season);
                  }}
                  styles={{ input: { fontWeight: 700 } }}
                />
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  disabled={seasonIndex === 0}
                  onClick={() => onReorderSeason(season.seasonId, "up")}
                  title="Move up"
                >
                  ↑
                </ActionIcon>
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  disabled={seasonIndex === seasons.length - 1}
                  onClick={() => onReorderSeason(season.seasonId, "down")}
                  title="Move down"
                >
                  ↓
                </ActionIcon>
                {pendingDeleteId === season.seasonId ? (
                  <Group gap={4} wrap="nowrap">
                    <Button
                      size="compact-xs"
                      color="red"
                      onClick={() => {
                        onDeleteSeason(season.seasonId);
                        setPendingDeleteId(null);
                      }}
                    >
                      Delete
                    </Button>
                    <Button
                      size="compact-xs"
                      variant="default"
                      onClick={() => setPendingDeleteId(null)}
                    >
                      Keep
                    </Button>
                  </Group>
                ) : (
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    color="red"
                    disabled={seasons.length <= 1}
                    onClick={() => setPendingDeleteId(season.seasonId)}
                    title={
                      seasons.length <= 1
                        ? "A project always has at least one Season"
                        : "Delete this Season and every Episode in it"
                    }
                  >
                    🗑
                  </ActionIcon>
                )}
              </Group>

              {/* Its Episodes */}
              {season.episodes.map((episode, episodeIndex) => (
                <Stack
                  key={episode.episodeId}
                  gap={2}
                  style={{ paddingLeft: 16 }}
                >
                  {/* Episode row */}
                  <Group
                    gap="xs"
                    wrap="nowrap"
                    onClick={() =>
                      setSelection({
                        kind: "episode",
                        episodeId: episode.episodeId
                      })
                    }
                    style={{
                      padding: 4,
                      borderRadius: 6,
                      cursor: "pointer",
                      background:
                        selection?.kind === "episode" &&
                        selection.episodeId === episode.episodeId
                          ? "var(--sm-active-bg)"
                          : "transparent"
                    }}
                  >
                    <TextInput
                      size="xs"
                      style={{ flex: 1 }}
                      value={
                        renameDrafts[episode.episodeId] ?? episode.displayName
                      }
                      onFocus={() =>
                        setSelection({
                          kind: "episode",
                          episodeId: episode.episodeId
                        })
                      }
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setRenameDrafts((drafts) => ({
                          ...drafts,
                          [episode.episodeId]: value
                        }));
                      }}
                      onBlur={() => commitEpisodeRename(episode)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") commitEpisodeRename(episode);
                      }}
                      styles={{ input: { fontWeight: 600 } }}
                    />
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      disabled={episodeIndex === 0}
                      onClick={() => onReorderEpisode(episode.episodeId, "up")}
                      title="Move up"
                    >
                      ↑
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      // Bounded by this Season's list, not the project's: a
                      // step never crosses a Season. Use "Move to Season" for
                      // that.
                      disabled={episodeIndex === season.episodes.length - 1}
                      onClick={() =>
                        onReorderEpisode(episode.episodeId, "down")
                      }
                      title="Move down"
                    >
                      ↓
                    </ActionIcon>
                    {pendingDeleteId === episode.episodeId ? (
                      <Group gap={4} wrap="nowrap">
                        <Button
                          size="compact-xs"
                          color="red"
                          onClick={() => {
                            onDeleteEpisode(episode.episodeId);
                            setPendingDeleteId(null);
                          }}
                        >
                          Delete
                        </Button>
                        <Button
                          size="compact-xs"
                          variant="default"
                          onClick={() => setPendingDeleteId(null)}
                        >
                          Keep
                        </Button>
                      </Group>
                    ) : (
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        color="red"
                        // Guarded on THIS Season's count. A project-wide count
                        // would let the last Episode of Season 2 go and leave
                        // an empty Season behind.
                        disabled={season.episodes.length <= 1}
                        onClick={() => setPendingDeleteId(episode.episodeId)}
                        title={
                          season.episodes.length <= 1
                            ? "A Season always has at least one Episode"
                            : "Delete this Episode and every Scene in it"
                        }
                      >
                        🗑
                      </ActionIcon>
                    )}
                  </Group>

                  {/* Its Scenes */}
                  {episode.scenes.map((scene, sceneIndex) => (
                    <Group
                      key={scene.sceneId}
                      gap="xs"
                      wrap="nowrap"
                      onClick={() =>
                        setSelection({ kind: "scene", sceneId: scene.sceneId })
                      }
                      style={{
                        padding: 4,
                        paddingLeft: 16,
                        borderRadius: 6,
                        cursor: "pointer",
                        background:
                          scene.sceneId === selectedScene?.sceneId
                            ? "var(--sm-active-bg)"
                            : "transparent"
                      }}
                    >
                      <Text
                        size="xs"
                        c="var(--sm-color-subtext)"
                        style={{ width: 18, textAlign: "right" }}
                      >
                        {sceneIndex + 1}
                      </Text>
                      <TextInput
                        size="xs"
                        style={{ flex: 1 }}
                        value={renameDrafts[scene.sceneId] ?? scene.displayName}
                        onFocus={() =>
                          setSelection({
                            kind: "scene",
                            sceneId: scene.sceneId
                          })
                        }
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          setRenameDrafts((drafts) => ({
                            ...drafts,
                            [scene.sceneId]: value
                          }));
                        }}
                        onBlur={() => commitRename(scene)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") commitRename(scene);
                        }}
                        rightSection={
                          scene.sceneId === activeSceneId ? (
                            <Text size="xs" c="var(--sm-accent-blue)">
                              ✓
                            </Text>
                          ) : undefined
                        }
                      />
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        disabled={sceneIndex === 0}
                        onClick={() => onReorderScene(scene.sceneId, "up")}
                        title="Move up within this Episode"
                      >
                        ↑
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        disabled={sceneIndex === episode.scenes.length - 1}
                        onClick={() => onReorderScene(scene.sceneId, "down")}
                        title="Move down within this Episode"
                      >
                        ↓
                      </ActionIcon>
                      {pendingDeleteId === scene.sceneId ? (
                        <Group gap={4} wrap="nowrap">
                          <Button
                            size="compact-xs"
                            color="red"
                            onClick={() => {
                              onDeleteScene(scene.sceneId);
                              setPendingDeleteId(null);
                            }}
                          >
                            Delete
                          </Button>
                          <Button
                            size="compact-xs"
                            variant="default"
                            onClick={() => setPendingDeleteId(null)}
                          >
                            Keep
                          </Button>
                        </Group>
                      ) : (
                        <ActionIcon
                          variant="subtle"
                          size="sm"
                          color="red"
                          disabled={
                            scenes.length <= 1 || episode.scenes.length <= 1
                          }
                          onClick={() => setPendingDeleteId(scene.sceneId)}
                          title={
                            scenes.length <= 1
                              ? "A project always has at least one Scene"
                              : episode.scenes.length <= 1
                                ? "An Episode always has at least one Scene -- delete the Episode instead"
                                : "Delete this Scene and its placements"
                          }
                        >
                          🗑
                        </ActionIcon>
                      )}
                      <Button
                        size="compact-xs"
                        variant={
                          scene.sceneId === activeSceneId ? "light" : "default"
                        }
                        disabled={scene.sceneId === activeSceneId}
                        onClick={() => onSelectScene(scene.sceneId)}
                      >
                        {scene.sceneId === activeSceneId
                          ? "Active"
                          : "Activate"}
                      </Button>
                    </Group>
                  ))}
                </Stack>
              ))}

              {/* One Episode input per Season, so the new Episode lands
                    where the author is looking rather than in whichever
                    Season the code picked. */}
              <Group gap="xs" wrap="nowrap" style={{ paddingLeft: 16 }}>
                <TextInput
                  size="xs"
                  style={{ flex: 1 }}
                  placeholder={`New Episode in ${season.displayName}`}
                  value={newEpisodeNames[season.seasonId] ?? ""}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setNewEpisodeNames((drafts) => ({
                      ...drafts,
                      [season.seasonId]: value
                    }));
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter")
                      submitNewEpisode(season.seasonId);
                  }}
                />
                <Button
                  size="compact-sm"
                  onClick={() => submitNewEpisode(season.seasonId)}
                  disabled={!(newEpisodeNames[season.seasonId] ?? "").trim()}
                >
                  + Add Episode
                </Button>
              </Group>
            </Stack>
          ))}
        </Stack>

        <Group gap="xs" wrap="nowrap">
          <TextInput
            size="xs"
            style={{ flex: 1 }}
            placeholder={
              selectedEpisode
                ? `New Scene in ${selectedEpisode.displayName}`
                : "New Scene name"
            }
            value={newSceneName}
            onChange={(event) => setNewSceneName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitNewScene();
            }}
          />
          <Button
            size="compact-sm"
            onClick={submitNewScene}
            disabled={!newSceneName.trim()}
          >
            + Add Scene
          </Button>
        </Group>
        <Group gap="xs" wrap="nowrap">
          <TextInput
            size="xs"
            style={{ flex: 1 }}
            placeholder="New Season name"
            value={newSeasonName}
            onChange={(event) => setNewSeasonName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitNewSeason();
            }}
          />
          <Button
            size="compact-sm"
            onClick={submitNewSeason}
            disabled={!newSeasonName.trim()}
          >
            + Add Season
          </Button>
        </Group>
        <Text size="xs" c="var(--sm-color-overlay0)">
          A new Scene joins the Episode you have selected. Deleting a Scene
          removes its placements (NPCs, items, player spawns, Scene-scoped
          assets) in every region; base assets are unaffected. Deleting an
          Episode deletes every Scene in it, and deleting a Season deletes every
          Episode in it.
        </Text>
      </Stack>

      {/* --- Right: Season properties ------------------------ */}
      {selectedSeason && (
        <Stack
          gap="sm"
          key={selectedSeason.seasonId}
          style={{
            flex: 1,
            borderLeft: "1px solid var(--sm-panel-border)",
            paddingLeft: 20
          }}
        >
          <Text size="sm" fw={600}>
            {selectedSeason.displayName}
          </Text>
          <Textarea
            size="xs"
            label="Description"
            autosize
            minRows={2}
            value={selectedSeason.description}
            onChange={(event) =>
              onUpdateSeason(selectedSeason.seasonId, {
                description: event.currentTarget.value
              })
            }
          />
          <Textarea
            size="xs"
            label="Notes"
            autosize
            minRows={2}
            value={selectedSeason.notes}
            onChange={(event) =>
              onUpdateSeason(selectedSeason.seasonId, {
                notes: event.currentTarget.value
              })
            }
          />
          <Text size="xs" c="var(--sm-color-overlay0)">
            A Season groups Episodes. It has no unlock rule of its own — gate
            its first Episode instead.
          </Text>
        </Stack>
      )}

      {/* --- Right: Episode properties ----------------------- */}
      {!selectedScene && selectedEpisode && (
        <Stack
          gap="sm"
          key={selectedEpisode.episodeId}
          style={{
            flex: 1,
            borderLeft: "1px solid var(--sm-panel-border)",
            paddingLeft: 20
          }}
        >
          <Text size="sm" fw={600}>
            {selectedEpisode.displayName}
          </Text>
          <Textarea
            size="xs"
            label="Description"
            autosize
            minRows={2}
            value={selectedEpisode.description}
            onChange={(event) =>
              onUpdateEpisode(selectedEpisode.episodeId, {
                description: event.currentTarget.value
              })
            }
            {...fieldLabelProps}
          />
          <Textarea
            size="xs"
            label="Notes"
            autosize
            minRows={2}
            value={selectedEpisode.notes}
            onChange={(event) =>
              onUpdateEpisode(selectedEpisode.episodeId, {
                notes: event.currentTarget.value
              })
            }
            {...fieldLabelProps}
          />
          {/* The only way to change which Season owns an Episode. The
                reorder arrows deliberately stop at a Season's edges. */}
          <Select
            size="xs"
            label="Move to Season"
            placeholder="(stays where it is)"
            data={seasons
              .filter(
                (season) => season.seasonId !== selectedEpisodeSeason?.seasonId
              )
              .map((season) => ({
                value: season.seasonId,
                label: season.displayName
              }))}
            value={null}
            disabled={
              seasons.length <= 1 ||
              (selectedEpisodeSeason?.episodes.length ?? 0) <= 1
            }
            description={
              (selectedEpisodeSeason?.episodes.length ?? 0) <= 1
                ? "A Season cannot be left empty"
                : undefined
            }
            onChange={(value) => {
              if (!value) return;
              onMoveEpisodeToSeason(selectedEpisode.episodeId, value);
              setSelection({
                kind: "episode",
                episodeId: selectedEpisode.episodeId
              });
            }}
            {...fieldLabelProps}
          />
          <EpisodeGateFields
            episode={selectedEpisode}
            questDefinitions={questDefinitions}
            onUpdateEpisode={onUpdateEpisode}
          />
          <Text size="xs" c="var(--sm-color-overlay0)">
            Episodes are ordered and gated: the order says which comes after
            which, the gate says whether the player may go there yet. Scenes
            inside an Episode are ordered but not gated -- finishing one moves
            the player to the next.
          </Text>
        </Stack>
      )}

      {/* --- Right: Scene properties (Plan 058 §058.6) ------- */}
      {selectedScene && (
        <Stack
          gap="sm"
          key={selectedScene.sceneId}
          style={{
            flex: 1,
            borderLeft: "1px solid var(--sm-panel-border)",
            paddingLeft: 20
          }}
        >
          <Text size="sm" fw={600}>
            {selectedScene.displayName}
          </Text>
          <Textarea
            size="xs"
            label="Description"
            autosize
            minRows={2}
            value={selectedScene.description}
            onChange={(event) =>
              onUpdateScene(selectedScene.sceneId, {
                description: event.currentTarget.value
              })
            }
            {...fieldLabelProps}
          />
          <Textarea
            size="xs"
            label="Notes"
            autosize
            minRows={2}
            value={selectedScene.notes}
            onChange={(event) =>
              onUpdateScene(selectedScene.sceneId, {
                notes: event.currentTarget.value
              })
            }
            {...fieldLabelProps}
          />
          {/* Paired on one row: both answer "where does this Scene
                happen", one in the story and one in the world. */}
          <Group gap="xs" grow align="flex-start">
            <Select
              size="xs"
              label="Move to Episode"
              placeholder="(stays where it is)"
              data={episodes
                .filter(
                  (episode) => episode.episodeId !== selectedEpisode?.episodeId
                )
                .map((episode) => ({
                  value: episode.episodeId,
                  label: episode.displayName
                }))}
              value={null}
              disabled={
                episodes.length <= 1 ||
                (selectedEpisode?.scenes.length ?? 0) <= 1
              }
              description={
                (selectedEpisode?.scenes.length ?? 0) <= 1
                  ? "An Episode cannot be left empty"
                  : undefined
              }
              onChange={(value) => {
                if (!value) return;
                onMoveSceneToEpisode(selectedScene.sceneId, value);
                setSelection({ kind: "scene", sceneId: selectedScene.sceneId });
              }}
              {...fieldLabelProps}
            />
            <Select
              size="xs"
              label="Region"
              data={regions.map((region) => ({
                value: region.regionId,
                label: region.displayName
              }))}
              value={selectedScene.regionId || null}
              onChange={(value) =>
                onUpdateScene(selectedScene.sceneId, {
                  regionId: value ?? ""
                })
              }
              {...fieldLabelProps}
            />
          </Group>
          {/* Paired on one row: both are Scene-scoped atmosphere. */}
          <Group gap="xs" grow align="flex-start">
            <Select
              size="xs"
              label="Environment override"
              placeholder="(region default)"
              clearable
              data={environmentDefinitions.map((definition) => ({
                value: definition.definitionId,
                label: definition.displayName
              }))}
              value={selectedScene.environmentOverride?.environmentId ?? null}
              onChange={(value) =>
                onUpdateScene(selectedScene.sceneId, {
                  environmentOverride: value ? { environmentId: value } : null
                })
              }
              {...fieldLabelProps}
            />
            {/* Plan 059 §059.1 — per-Scene background music. */}
            <Select
              size="xs"
              label="Background music override"
              placeholder="(project default)"
              clearable
              data={soundCueDefinitions.map((cue) => ({
                value: cue.definitionId,
                label: cue.displayName
              }))}
              value={selectedScene.audioOverride?.backgroundMusicId ?? null}
              onChange={(value) =>
                onUpdateScene(selectedScene.sceneId, {
                  audioOverride: value
                    ? {
                        backgroundMusicId: value,
                        ambientSoundId:
                          selectedScene.audioOverride?.ambientSoundId ?? null
                      }
                    : selectedScene.audioOverride?.ambientSoundId
                      ? {
                          backgroundMusicId: null,
                          ambientSoundId:
                            selectedScene.audioOverride.ambientSoundId
                        }
                      : null
                })
              }
              {...fieldLabelProps}
            />
          </Group>

          {/* Epic #226 -- a Scene HOLDS its quests, so this is where an
                author sees which ones and moves them. The list is the
                Scene's own `questDefinitions`, not a filter over a
                project-wide list. */}
          <Text size="xs" fw={600}>
            Quests in this Scene
          </Text>
          {selectedScene.questDefinitions.length === 0 ? (
            <Text size="xs" c="var(--sm-color-overlay0)">
              None yet. A quest authored here happens in this Scene.
            </Text>
          ) : (
            <Stack gap={6}>
              {selectedScene.questDefinitions.map((quest) => (
                <Group
                  key={quest.definitionId}
                  gap="xs"
                  wrap="nowrap"
                  align="center"
                >
                  <Text size="xs" style={{ flex: 1 }}>
                    {quest.displayName}
                  </Text>
                  <Select
                    size="xs"
                    placeholder="Move to Scene..."
                    style={{ width: 180 }}
                    data={scenes
                      .filter(
                        (scene) => scene.sceneId !== selectedScene.sceneId
                      )
                      .map((scene) => ({
                        value: scene.sceneId,
                        label: scene.displayName
                      }))}
                    value={null}
                    disabled={scenes.length <= 1}
                    onChange={(value) => {
                      if (!value) return;
                      onMoveQuestToScene(quest.definitionId, value);
                    }}
                    {...fieldLabelProps}
                  />
                </Group>
              ))}
            </Stack>
          )}

          <Text
            size="xs"
            fw={600}
            tt="uppercase"
            c="var(--sm-color-subtext)"
            mt="xs"
          >
            Transition card
          </Text>
          <TextInput
            size="xs"
            label="Title"
            placeholder="Empty = hard cut (no card)"
            value={selectedScene.transitionConfig?.titleText ?? ""}
            onChange={(event) =>
              commitTransition(selectedScene, {
                titleText: event.currentTarget.value
              })
            }
            {...fieldLabelProps}
          />
          <Group gap="xs" grow>
            <TextInput
              size="xs"
              label="Subtitle"
              disabled={!selectedScene.transitionConfig}
              value={selectedScene.transitionConfig?.subtitleText ?? ""}
              onChange={(event) =>
                commitTransition(selectedScene, {
                  subtitleText: event.currentTarget.value || null
                })
              }
              {...fieldLabelProps}
            />
            <Select
              size="xs"
              label="Fade"
              disabled={!selectedScene.transitionConfig}
              data={[
                { value: "black", label: "Fade to black" },
                { value: "white", label: "Fade to white" },
                { value: "cross", label: "Cross fade" }
              ]}
              value={
                selectedScene.transitionConfig?.fadeStyle ?? DEFAULT_CARD_FADE
              }
              onChange={(value) => {
                if (!value) return;
                commitTransition(selectedScene, {
                  fadeStyle: value as TransitionConfig["fadeStyle"]
                });
              }}
              {...fieldLabelProps}
            />
            <NumberInput
              size="xs"
              label="Duration (ms)"
              disabled={!selectedScene.transitionConfig}
              min={250}
              step={250}
              value={
                selectedScene.transitionConfig?.durationMs ??
                DEFAULT_CARD_DURATION_MS
              }
              onChange={(value) => {
                if (typeof value !== "number") return;
                commitTransition(selectedScene, { durationMs: value });
              }}
              {...fieldLabelProps}
            />
          </Group>
          {/* Static card preview — same styling constants as the
                runtime card (imported from target-web). */}
          {selectedScene.transitionConfig ? (
            <Box
              style={{
                height: 150,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                borderRadius: 8,
                border: "1px solid var(--sm-panel-border)",
                background:
                  TRANSITION_CARD_FADE_BACKGROUNDS[
                    selectedScene.transitionConfig.fadeStyle
                  ],
                fontFamily: TRANSITION_CARD_FONT_FAMILY,
                textAlign: "center",
                padding: 12,
                userSelect: "none"
              }}
            >
              <div
                style={{
                  color:
                    TRANSITION_CARD_FADE_TEXT_COLORS[
                      selectedScene.transitionConfig.fadeStyle
                    ],
                  fontSize: 26,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase"
                }}
              >
                {selectedScene.transitionConfig.titleText}
              </div>
              {selectedScene.transitionConfig.subtitleText && (
                <div
                  style={{
                    color:
                      TRANSITION_CARD_FADE_TEXT_COLORS[
                        selectedScene.transitionConfig.fadeStyle
                      ],
                    fontSize: 12,
                    letterSpacing: "0.3em",
                    opacity: 0.75,
                    textTransform: "uppercase"
                  }}
                >
                  {selectedScene.transitionConfig.subtitleText}
                </div>
              )}
            </Box>
          ) : (
            <Box
              style={{
                height: 150,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 8,
                border: "1px dashed var(--sm-panel-border)"
              }}
            >
              <Text size="xs" c="var(--sm-color-overlay0)">
                Hard cut — no title card. Add a title to preview one.
              </Text>
            </Box>
          )}
        </Stack>
      )}
    </Group>
  );
}
