/**
 * apps/studio/src/ManageScenesModal.tsx
 *
 * Purpose: Plan 058 §058.3 + §058.6 — the "Manage Scenes" panel
 * behind the top-bar Scene selector. Master-detail: the left list
 * creates / renames / reorders / deletes / activates Scenes; the
 * right pane edits the selected Scene's properties (description,
 * notes, unlock condition, environment override, transition
 * card) with a static card preview rendered from the SAME styling
 * constants the runtime card uses.
 *
 * Delete is guarded (last Scene undeletable; inline confirm
 * instead of a browser dialog per the Mantine-only rule).
 *
 * Implements: Plan 058 §058.3, §058.6
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
  QuestDefinition,
  Scene,
  SceneTransitionConfig,
  SceneUnlockCondition
} from "@sugarmagic/domain";
import {
  SCENE_CARD_FADE_BACKGROUNDS,
  SCENE_CARD_FADE_TEXT_COLORS,
  SCENE_CARD_FONT_FAMILY
} from "@sugarmagic/target-web";

export interface ManageScenesModalProps {
  opened: boolean;
  onClose: () => void;
  scenes: Scene[];
  activeSceneId: string | null;
  scenesUiLabel: string;
  questDefinitions: QuestDefinition[];
  environmentDefinitions: { definitionId: string; displayName: string }[];
  /** Region options for the per-Scene starting region. */
  regions: { regionId: string; displayName: string }[];
  /** Plan 059 §059.1 — options for the background-music override. */
  soundCueDefinitions: { definitionId: string; displayName: string }[];
  onAddScene: (displayName: string) => void;
  onRenameScene: (sceneId: string, displayName: string) => void;
  onUpdateScene: (
    sceneId: string,
    patch: Partial<
      Pick<
        Scene,
        | "description"
        | "notes"
        | "unlockCondition"
        | "startingRegionId"
        | "environmentOverride"
        | "audioOverride"
        | "transitionConfig"
      >
    >
  ) => void;
  onDeleteScene: (sceneId: string) => void;
  onReorderScene: (sceneId: string, direction: "up" | "down") => void;
  onSelectScene: (sceneId: string) => void;
}

type UnlockKind = "always" | "manual" | "questComplete" | "wallClock";

function unlockKindOf(condition: SceneUnlockCondition): UnlockKind {
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

const DEFAULT_CARD_FADE: SceneTransitionConfig["fadeStyle"] = "black";
const DEFAULT_CARD_DURATION_MS = 2500;

export function ManageScenesModal(props: ManageScenesModalProps) {
  const {
    opened,
    onClose,
    scenes,
    activeSceneId,
    scenesUiLabel,
    questDefinitions,
    environmentDefinitions,
    regions,
    soundCueDefinitions,
    onAddScene,
    onRenameScene,
    onUpdateScene,
    onDeleteScene,
    onReorderScene,
    onSelectScene
  } = props;
  const [newSceneName, setNewSceneName] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({});
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);

  const selectedScene =
    scenes.find((scene) => scene.sceneId === selectedSceneId) ??
    scenes.find((scene) => scene.sceneId === activeSceneId) ??
    scenes[0] ??
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
    if (!name) return;
    onAddScene(name);
    setNewSceneName("");
  };

  // Plan 058 §058.6 — commit the transition card from the four UI
  // fields. Empty title = null config = hard cut (mirrors the
  // domain normalizer, which drops titleless configs on load).
  const commitTransition = (
    scene: Scene,
    patch: Partial<SceneTransitionConfig>
  ) => {
    const current = scene.transitionConfig;
    const next: SceneTransitionConfig = {
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

  const fieldLabelProps = {
    styles: { label: { color: "var(--sm-color-subtext)" } }
  };

  return (
    <Modal
      opened={opened}
      onClose={() => {
        setPendingDeleteId(null);
        onClose();
      }}
      title={`Manage ${scenesUiLabel}s`}
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
        {/* --- Left: Scene list -------------------------------- */}
        <Stack gap="md" style={{ width: 340, flexShrink: 0 }}>
          <Stack gap="xs">
            {scenes.map((scene, index) => (
              <Group
                key={scene.sceneId}
                gap="xs"
                wrap="nowrap"
                onClick={() => setSelectedSceneId(scene.sceneId)}
                style={{
                  padding: 4,
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
                  {index + 1}
                </Text>
                <TextInput
                  size="xs"
                  style={{ flex: 1 }}
                  value={renameDrafts[scene.sceneId] ?? scene.displayName}
                  onFocus={() => setSelectedSceneId(scene.sceneId)}
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
                  disabled={index === 0}
                  onClick={() => onReorderScene(scene.sceneId, "up")}
                  title="Move up"
                >
                  ↑
                </ActionIcon>
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  disabled={index === scenes.length - 1}
                  onClick={() => onReorderScene(scene.sceneId, "down")}
                  title="Move down"
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
                    disabled={scenes.length <= 1}
                    onClick={() => setPendingDeleteId(scene.sceneId)}
                    title={
                      scenes.length <= 1
                        ? `A project always has at least one ${scenesUiLabel}`
                        : `Delete this ${scenesUiLabel} and its placements`
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
          <Group gap="xs" wrap="nowrap">
            <TextInput
              size="xs"
              style={{ flex: 1 }}
              placeholder={`New ${scenesUiLabel} name`}
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
              + Add {scenesUiLabel}
            </Button>
          </Group>
          <Text size="xs" c="var(--sm-color-overlay0)">
            Deleting a {scenesUiLabel} removes its placements (NPCs, items,
            player spawns, {scenesUiLabel}-scoped assets) in every region.
            Base assets are unaffected.
          </Text>
        </Stack>

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
              label="Unlock condition"
              data={[
                { value: "always", label: "Always unlocked" },
                { value: "manual", label: "Unlocked by a quest action" },
                { value: "questComplete", label: "When a quest completes" },
                { value: "wallClock", label: "At a scheduled time" }
              ]}
              value={unlockKindOf(selectedScene.unlockCondition)}
              onChange={(value) => {
                if (!value) return;
                const kind = value as UnlockKind;
                const unlockCondition: SceneUnlockCondition =
                  kind === "always"
                    ? "always"
                    : kind === "manual"
                      ? { kind: "manual" }
                      : kind === "questComplete"
                        ? {
                            kind: "questComplete",
                            questDefinitionId:
                              questDefinitions[0]?.definitionId ?? ""
                          }
                        : {
                            kind: "wallClock",
                            unlockAtIso: new Date().toISOString()
                          };
                onUpdateScene(selectedScene.sceneId, { unlockCondition });
              }}
              {...fieldLabelProps}
            />
            {unlockKindOf(selectedScene.unlockCondition) ===
              "questComplete" && (
              <Select
                size="xs"
                label="Quest"
                data={questDefinitions.map((quest) => ({
                  value: quest.definitionId,
                  label: quest.displayName
                }))}
                value={
                  selectedScene.unlockCondition !== "always" &&
                  selectedScene.unlockCondition.kind === "questComplete"
                    ? selectedScene.unlockCondition.questDefinitionId
                    : null
                }
                onChange={(value) => {
                  if (!value) return;
                  onUpdateScene(selectedScene.sceneId, {
                    unlockCondition: {
                      kind: "questComplete",
                      questDefinitionId: value
                    }
                  });
                }}
                {...fieldLabelProps}
              />
            )}
            {unlockKindOf(selectedScene.unlockCondition) === "wallClock" && (
              <TextInput
                size="xs"
                label="Unlocks at"
                type="datetime-local"
                value={
                  selectedScene.unlockCondition !== "always" &&
                  selectedScene.unlockCondition.kind === "wallClock"
                    ? isoToLocalInputValue(
                        selectedScene.unlockCondition.unlockAtIso
                      )
                    : ""
                }
                onChange={(event) => {
                  const parsed = new Date(event.currentTarget.value);
                  if (Number.isNaN(parsed.getTime())) return;
                  onUpdateScene(selectedScene.sceneId, {
                    unlockCondition: {
                      kind: "wallClock",
                      unlockAtIso: parsed.toISOString()
                    }
                  });
                }}
                {...fieldLabelProps}
              />
            )}
            <Select
              size="xs"
              label="Starting region"
              placeholder="(first region)"
              clearable
              data={regions.map((region) => ({
                value: region.regionId,
                label: region.displayName
              }))}
              value={selectedScene.startingRegionId ?? null}
              onChange={(value) =>
                onUpdateScene(selectedScene.sceneId, {
                  startingRegionId: value ?? null
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
                    fadeStyle: value as SceneTransitionConfig["fadeStyle"]
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
                    SCENE_CARD_FADE_BACKGROUNDS[
                      selectedScene.transitionConfig.fadeStyle
                    ],
                  fontFamily: SCENE_CARD_FONT_FAMILY,
                  textAlign: "center",
                  padding: 12,
                  userSelect: "none"
                }}
              >
                <div
                  style={{
                    color:
                      SCENE_CARD_FADE_TEXT_COLORS[
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
                        SCENE_CARD_FADE_TEXT_COLORS[
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
