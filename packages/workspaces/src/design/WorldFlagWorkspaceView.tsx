/**
 * WorldFlagWorkspaceView: the Design view for the project's world flags.
 *
 * The registry is otherwise write-only -- the picker on a condition can add a
 * flag, and nothing could rename, describe, delete or even list one. This is
 * where a flag is owned.
 *
 * Project scoped, like every other Design tab: spells, dialogue conditions,
 * NPC behavior activation and containment volumes all reference flags, so this
 * is not a quest concern, and a flag outlasts the Scene it was set in.
 */

import { useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  Tooltip
} from "@mantine/core";
import {
  collectWorldFlagReferences,
  createWorldFlagDefinition,
  WORLD_FLAG_VALUE_TYPE_OPTIONS,
  isWorldFlagValueType,
  type GameProject,
  type RegionDocument,
  type SemanticCommand,
  type WorldFlagDefinition,
  type WorldFlagReference
} from "@sugarmagic/domain";
import { Inspector } from "@sugarmagic/ui";
import type { WorkspaceViewContribution } from "../workspace-view";
import type { WorkspaceNavigationTarget } from "../workspace-navigation";

export interface WorldFlagWorkspaceViewProps {
  isActive: boolean;
  gameProjectId: string | null;
  gameProject: GameProject | null;
  regions: RegionDocument[];
  onCommand: (command: SemanticCommand) => void;
  onNavigateToTarget?: (target: WorkspaceNavigationTarget) => void;
}

/**
 * The navigation target for content holding a reference, where one exists.
 * Quest nodes and behavior tasks are reachable; dialogue nodes, spells,
 * volumes and NPC placements have no navigation target yet, so those
 * references are listed without a jump.
 */
function navigationTargetFor(
  reference: WorldFlagReference
): WorkspaceNavigationTarget | null {
  if (reference.target.kind === "quest-node") {
    return {
      kind: "quest-stage",
      questDefinitionId: reference.target.questDefinitionId,
      stageId: reference.target.stageId
    };
  }
  if (reference.target.kind === "behavior-task") {
    return {
      kind: "behavior-task",
      regionId: reference.target.regionId,
      behaviorId: reference.target.behaviorId,
      taskId: reference.target.taskId
    };
  }
  return null;
}

export function useWorldFlagWorkspaceView(
  props: WorldFlagWorkspaceViewProps
): WorkspaceViewContribution {
  const {
    gameProjectId,
    gameProject,
    regions,
    onCommand,
    onNavigateToTarget
  } = props;

  const worldFlagDefinitions = gameProject?.worldFlagDefinitions ?? [];
  const [selectedFlagId, setSelectedFlagId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    if (needle.length === 0) return worldFlagDefinitions;
    return worldFlagDefinitions.filter(
      (definition) =>
        definition.displayName.toLowerCase().includes(needle) ||
        definition.name.toLowerCase().includes(needle)
    );
  }, [worldFlagDefinitions, searchQuery]);

  const effectiveSelectedId =
    selectedFlagId &&
    worldFlagDefinitions.some(
      (definition) => definition.definitionId === selectedFlagId
    )
      ? selectedFlagId
      : (filtered[0]?.definitionId ?? null);

  const selectedFlag =
    worldFlagDefinitions.find(
      (definition) => definition.definitionId === effectiveSelectedId
    ) ?? null;

  // Every reference in the project, grouped by flag. Computed once rather than
  // per row -- the walk covers the whole project and both file formats.
  const referencesByFlagId = useMemo(() => {
    const grouped = new Map<string, WorldFlagReference[]>();
    if (!gameProject) return grouped;
    for (const reference of collectWorldFlagReferences(gameProject, regions)) {
      const existing = grouped.get(reference.worldFlagId);
      if (existing) {
        existing.push(reference);
      } else {
        grouped.set(reference.worldFlagId, [reference]);
      }
    }
    return grouped;
  }, [gameProject, regions]);

  const selectedReferences = selectedFlag
    ? (referencesByFlagId.get(selectedFlag.definitionId) ?? [])
    : [];

  function nameTaken(name: string, exceptDefinitionId?: string): boolean {
    return worldFlagDefinitions.some(
      (definition) =>
        definition.name === name &&
        definition.definitionId !== exceptDefinitionId
    );
  }

  function createFlag() {
    if (!gameProjectId) return;
    // Unique by construction: two entries with one name share a slot in the
    // runtime store, so a new flag never lands on a name already in use.
    let name = "newFlag";
    let suffix = 2;
    while (nameTaken(name)) {
      name = `newFlag${suffix}`;
      suffix += 1;
    }
    const definition = createWorldFlagDefinition({
      name,
      displayName: name
    });
    onCommand({
      kind: "CreateWorldFlagDefinition",
      target: { aggregateKind: "game-project", aggregateId: gameProjectId },
      subject: {
        subjectKind: "world-flag-definition",
        subjectId: definition.definitionId
      },
      payload: { definition }
    });
    setSelectedFlagId(definition.definitionId);
  }

  function updateFlag(
    definitionId: string,
    changes: Partial<Omit<WorldFlagDefinition, "definitionId">>
  ) {
    if (!gameProjectId) return;
    onCommand({
      kind: "UpdateWorldFlagDefinition",
      target: { aggregateKind: "game-project", aggregateId: gameProjectId },
      subject: { subjectKind: "world-flag-definition", subjectId: definitionId },
      payload: { definitionId, changes }
    });
  }

  function deleteFlag(definition: WorldFlagDefinition) {
    if (!gameProjectId) return;
    const references = referencesByFlagId.get(definition.definitionId) ?? [];
    if (references.length > 0) {
      // Deleting orphans every reference at once, and the save is then refused
      // until they are repointed. Say so before it happens, not after.
      const listed = references
        .slice(0, 10)
        .map((reference) => `- ${reference.where}`)
        .join("\n");
      const more =
        references.length > 10
          ? `\n...and ${references.length - 10} more.`
          : "";
      const confirmed = window.confirm(
        `"${definition.displayName}" is used by ${references.length} ${
          references.length === 1 ? "place" : "places"
        }:\n\n${listed}${more}\n\nDeleting it leaves those references pointing at nothing, and the project will not save until each one is repointed.\n\nDelete anyway?`
      );
      if (!confirmed) return;
    }
    onCommand({
      kind: "DeleteWorldFlagDefinition",
      target: { aggregateKind: "game-project", aggregateId: gameProjectId },
      subject: {
        subjectKind: "world-flag-definition",
        subjectId: definition.definitionId
      },
      payload: { definitionId: definition.definitionId }
    });
    setSelectedFlagId(null);
  }

  const renameError =
    selectedFlag && selectedFlag.name.trim().length === 0
      ? "Required. This is the flag's key at runtime."
      : selectedFlag && nameTaken(selectedFlag.name, selectedFlag.definitionId)
        ? "Another flag already uses this name."
        : undefined;

  return {
    leftPanel: (
      <Stack gap={0} h="100%" style={{ minHeight: 0 }}>
        <Group
          justify="space-between"
          px="md"
          py="sm"
          style={{
            borderBottom: "1px solid var(--sm-panel-border)",
            color: "var(--sm-color-subtext)"
          }}
        >
          <Text size="xs" fw={600} tt="uppercase">
            World Flags
          </Text>
          <Tooltip label="Add World Flag">
            <ActionIcon
              variant="subtle"
              size="sm"
              onClick={createFlag}
              aria-label="Add World Flag"
            >
              +
            </ActionIcon>
          </Tooltip>
        </Group>
        <Box p="sm" style={{ borderBottom: "1px solid var(--sm-panel-border)" }}>
          <TextInput
            size="xs"
            placeholder="Search flags..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
          />
        </Box>
        <ScrollArea style={{ flex: 1, minHeight: 0 }}>
          <Stack gap={4} p="xs">
            {filtered.length === 0 && (
              <Text size="xs" c="dimmed" p="sm">
                {worldFlagDefinitions.length === 0
                  ? "No world flags yet."
                  : "No flags match that search."}
              </Text>
            )}
            {filtered.map((definition) => {
              const isSelected =
                effectiveSelectedId === definition.definitionId;
              const referenceCount = (
                referencesByFlagId.get(definition.definitionId) ?? []
              ).length;
              return (
                <Box
                  key={definition.definitionId}
                  px="sm"
                  py="xs"
                  style={{
                    borderRadius: 8,
                    cursor: "pointer",
                    background: isSelected
                      ? "var(--sm-active-bg)"
                      : "transparent",
                    color: isSelected
                      ? "var(--sm-accent-blue)"
                      : "var(--sm-color-text)"
                  }}
                  onClick={() => setSelectedFlagId(definition.definitionId)}
                >
                  <Group justify="space-between" wrap="nowrap" gap="xs">
                    <Stack gap={0} style={{ minWidth: 0 }}>
                      <Text size="sm" fw={500} truncate>
                        {definition.displayName}
                      </Text>
                      {/* The runtime key, and what shows up in the quest
                          debug dump -- so what is authored here can be
                          matched against what is seen in play. */}
                      <Text size="xs" c="dimmed" truncate>
                        {definition.name}
                      </Text>
                    </Stack>
                    <Badge
                      size="xs"
                      variant="light"
                      color={referenceCount === 0 ? "gray" : "blue"}
                    >
                      {referenceCount}
                    </Badge>
                  </Group>
                </Box>
              );
            })}
          </Stack>
        </ScrollArea>
      </Stack>
    ),
    rightPanel: (
      <Inspector
        selectionLabel={selectedFlag?.displayName ?? "World Flag"}
        selectionIcon="🚩"
      >
        {selectedFlag ? (
          <Stack gap="lg">
            <Stack gap="xs">
              <Text
                size="xs"
                fw={600}
                tt="uppercase"
                c="var(--sm-color-subtext)"
              >
                Identity
              </Text>
              <TextInput
                label="Display Name"
                size="xs"
                description="What you read in Studio."
                value={selectedFlag.displayName}
                onChange={(event) =>
                  updateFlag(selectedFlag.definitionId, {
                    displayName: event.currentTarget.value
                  })
                }
              />
              <TextInput
                label="Name"
                size="xs"
                description="The flag's key at runtime. Content follows a rename; saves taken before it do not."
                value={selectedFlag.name}
                error={renameError}
                onChange={(event) =>
                  updateFlag(selectedFlag.definitionId, {
                    name: event.currentTarget.value
                  })
                }
              />
              <Select
                label="Value Type"
                size="xs"
                data={WORLD_FLAG_VALUE_TYPE_OPTIONS.map((option) => ({
                  ...option
                }))}
                value={selectedFlag.valueType}
                onChange={(value) =>
                  isWorldFlagValueType(value) &&
                  updateFlag(selectedFlag.definitionId, { valueType: value })
                }
              />
              <Textarea
                label="Description"
                size="xs"
                minRows={2}
                autosize
                value={selectedFlag.description}
                onChange={(event) =>
                  updateFlag(selectedFlag.definitionId, {
                    description: event.currentTarget.value
                  })
                }
              />
            </Stack>

            <Stack gap="xs">
              <Text
                size="xs"
                fw={600}
                tt="uppercase"
                c="var(--sm-color-subtext)"
              >
                Used By
              </Text>
              {selectedReferences.length === 0 ? (
                <Text size="xs" c="dimmed">
                  Nothing references this flag.
                </Text>
              ) : (
                selectedReferences.map((reference, index) => {
                  const target = navigationTargetFor(reference);
                  return (
                    <Group
                      key={`${reference.where}:${index}`}
                      justify="space-between"
                      wrap="nowrap"
                      gap="xs"
                    >
                      <Text size="xs" style={{ minWidth: 0 }}>
                        {reference.where}
                      </Text>
                      {target && (
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          onClick={() => onNavigateToTarget?.(target)}
                        >
                          Open
                        </Button>
                      )}
                    </Group>
                  );
                })
              )}
            </Stack>

            <Button
              size="xs"
              variant="light"
              color="red"
              onClick={() => deleteFlag(selectedFlag)}
            >
              Delete Flag
            </Button>
          </Stack>
        ) : (
          <Text size="xs" c="dimmed">
            Select a world flag.
          </Text>
        )}
      </Inspector>
    ),
    viewportOverlay: null
  };
}
