/**
 * apps/studio/src/ManageScenesModal.tsx
 *
 * Purpose: Plan 058 §058.3 — the "Manage Scenes" panel behind the
 * top-bar Scene selector. Create / rename / reorder / delete
 * Scenes. Delete is guarded (last Scene undeletable; inline
 * confirm instead of a browser dialog per the Mantine-only rule).
 *
 * Implements: Plan 058 §058.3
 *
 * Status: active
 */

import { useState } from "react";
import {
  ActionIcon,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  TextInput
} from "@mantine/core";
import type { Scene } from "@sugarmagic/domain";

export interface ManageScenesModalProps {
  opened: boolean;
  onClose: () => void;
  scenes: Scene[];
  activeSceneId: string | null;
  scenesUiLabel: string;
  onAddScene: (displayName: string) => void;
  onRenameScene: (sceneId: string, displayName: string) => void;
  onDeleteScene: (sceneId: string) => void;
  onReorderScene: (sceneId: string, direction: "up" | "down") => void;
  onSelectScene: (sceneId: string) => void;
}

export function ManageScenesModal(props: ManageScenesModalProps) {
  const {
    opened,
    onClose,
    scenes,
    activeSceneId,
    scenesUiLabel,
    onAddScene,
    onRenameScene,
    onDeleteScene,
    onReorderScene,
    onSelectScene
  } = props;
  const [newSceneName, setNewSceneName] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({});

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

  return (
    <Modal
      opened={opened}
      onClose={() => {
        setPendingDeleteId(null);
        onClose();
      }}
      title={`Manage ${scenesUiLabel}s`}
      centered
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
      <Stack gap="md">
        <Stack gap="xs">
          {scenes.map((scene, index) => (
            <Group key={scene.sceneId} gap="xs" wrap="nowrap">
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
                onChange={(event) => {
                  // Read synchronously — currentTarget is null by
                  // the time the state updater callback runs.
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
                variant={scene.sceneId === activeSceneId ? "light" : "default"}
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
    </Modal>
  );
}
