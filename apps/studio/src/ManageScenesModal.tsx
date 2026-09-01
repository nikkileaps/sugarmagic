/**
 * apps/studio/src/ManageScenesModal.tsx
 *
 * Purpose: the "Manage Scenes" panel behind the top-bar selector.
 * Master-detail: the left column lists Episodes and Scenes and
 * creates / renames / reorders / deletes / activates them; the
 * right pane edits whichever is selected. The Scene pane renders a
 * static transition-card preview from the SAME styling constants
 * the runtime card uses.
 *
 * Delete is guarded on both levels (the last Scene and the last
 * Episode are undeletable, and an Episode cannot be emptied by
 * moving its final Scene out; inline confirm instead of a browser
 * dialog per the Mantine-only rule).
 *
 * STOPGAP. Epic 207 story 2 deliberately kept this a flat list
 * rather than the two-level disclosure tree the design calls for,
 * because `docs/proposals/011-build-story-authoring-split.md`
 * proposes a `Story` product mode that owns Episodes, Scenes,
 * quests and dialogue -- and retires this modal. Building the
 * fuller surface here would be work thrown away twice. Revisit
 * when an author has more than about five Episodes, or when moving
 * Scenes between them becomes routine.
 *
 * Status: active
 */

import { useState } from "react";
import {
  ActionIcon,
  Box,
  Button,
  Group,
  Modal,
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
  Scene,
  TransitionConfig
} from "@sugarmagic/domain";
import {
  TRANSITION_CARD_FADE_BACKGROUNDS,
  TRANSITION_CARD_FADE_TEXT_COLORS,
  TRANSITION_CARD_FONT_FAMILY
} from "@sugarmagic/target-web";

export interface ManageScenesModalProps {
  opened: boolean;
  onClose: () => void;
  episodes: Episode[];
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
  onAddEpisode: (displayName: string) => void;
  onUpdateEpisode: (
    episodeId: string,
    patch: Partial<
      Pick<Episode, "displayName" | "description" | "notes" | "unlockCondition">
    >
  ) => void;
  onDeleteEpisode: (episodeId: string) => void;
  onReorderEpisode: (episodeId: string, direction: "up" | "down") => void;
  onMoveSceneToEpisode: (sceneId: string, toEpisodeId: string) => void;
}

/** What the left column has selected — an Episode row or a Scene row. */
type Selection =
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
                      questDefinitionId:
                        questDefinitions[0]?.definitionId ?? ""
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

export function ManageScenesModal(props: ManageScenesModalProps) {
  const {
    opened,
    onClose,
    episodes,
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
    onMoveSceneToEpisode
  } = props;
  const [newSceneName, setNewSceneName] = useState("");
  const [newEpisodeName, setNewEpisodeName] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({});
  const [selection, setSelection] = useState<Selection | null>(null);

  const scenes = episodes.flatMap((episode) => episode.scenes);

  /** The Scene the right pane edits, or null when an Episode row
   *  is selected. Falls back to the ambient Scene so opening the
   *  modal always lands somewhere. */
  const selectedScene =
    selection?.kind === "episode"
      ? null
      : (scenes.find(
          (scene) =>
            selection?.kind === "scene" && scene.sceneId === selection.sceneId
        ) ??
        scenes.find((scene) => scene.sceneId === activeSceneId) ??
        scenes[0] ??
        null);

  /** The Episode the right pane edits: the selected one, or the
   *  one holding the selected Scene. */
  const selectedEpisode =
    (selection?.kind === "episode"
      ? episodes.find((episode) => episode.episodeId === selection.episodeId)
      : episodes.find((episode) =>
          episode.scenes.some(
            (scene) => scene.sceneId === selectedScene?.sceneId
          )
        )) ??
    episodes[0] ??
    null;

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
    if (!name || !selectedEpisode) return;
    onAddScene(name, selectedEpisode.episodeId);
    setNewSceneName("");
  };

  const submitNewEpisode = () => {
    const name = newEpisodeName.trim();
    if (!name) return;
    onAddEpisode(name);
    setNewEpisodeName("");
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
  const commitTransition = (
    scene: Scene,
    patch: Partial<TransitionConfig>
  ) => {
    const current = scene.transitionConfig;
    const next: TransitionConfig = {
      titleText: patch.titleText ?? current?.titleText ?? "",
      subtitleText:
        patch.subtitleText !== undefined
          ? patch.subtitleText
          : current?.subtitleText ?? null,
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
    <Modal
      opened={opened}
      onClose={() => {
        setPendingDeleteId(null);
        onClose();
      }}
      title="Manage Story"
      centered
      size="62rem"
      styles={{
        header: {
          background: "var(--sm-color-surface1)",
          borderBottom: "1px solid var(--sm-panel-border)"
        },
        title: { color: "var(--sm-color-text)", fontWeight: 600 },
        body: { background: "var(--sm-color-surface1)", padding: "20px" },
        content: { background: "var(--sm-color-surface1)" },
        close: {
          color: "var(--sm-color-overlay1)",
          "&:hover": { background: "var(--sm-active-bg)" }
        }
      }}
    >
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
            {episodes.map((episode, episodeIndex) => (
              <Stack key={episode.episodeId} gap={2}>
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
                    disabled={episodeIndex === episodes.length - 1}
                    onClick={() => onReorderEpisode(episode.episodeId, "down")}
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
                      disabled={episodes.length <= 1}
                      onClick={() => setPendingDeleteId(episode.episodeId)}
                      title={
                        episodes.length <= 1
                          ? "A project always has at least one Episode"
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
                        setSelection({ kind: "scene", sceneId: scene.sceneId })
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
                      {scene.sceneId === activeSceneId ? "Active" : "Activate"}
                    </Button>
                  </Group>
                ))}
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
              placeholder="New Episode name"
              value={newEpisodeName}
              onChange={(event) => setNewEpisodeName(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitNewEpisode();
              }}
            />
            <Button
              size="compact-sm"
              onClick={submitNewEpisode}
              disabled={!newEpisodeName.trim()}
            >
              + Add Episode
            </Button>
          </Group>
          <Text size="xs" c="var(--sm-color-overlay0)">
            A new Scene joins the Episode you have selected. Deleting a Scene
            removes its placements (NPCs, items, player spawns, Scene-scoped
            assets) in every region; base assets are unaffected. Deleting an
            Episode deletes every Scene in it.
          </Text>
        </Stack>

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
            <EpisodeGateFields
              episode={selectedEpisode}
              questDefinitions={questDefinitions}
              onUpdateEpisode={onUpdateEpisode}
            />
            <Text size="xs" c="var(--sm-color-overlay0)">
              Episodes are ordered and gated: the order says which comes after
              which, the gate says whether the player may go there yet. Scenes
              inside an Episode are ordered but not gated -- finishing one
              moves the player to the next.
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
            <Select
              size="xs"
              label="Move to Episode"
              placeholder="(stays where it is)"
              data={episodes
                .filter(
                  (episode) =>
                    episode.episodeId !== selectedEpisode?.episodeId
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
                  environmentOverride: value
                    ? { environmentId: value }
                    : null
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
              value={
                selectedScene.audioOverride?.backgroundMusicId ?? null
              }
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
                  selectedScene.transitionConfig?.fadeStyle ??
                  DEFAULT_CARD_FADE
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
    </Modal>
  );
}
