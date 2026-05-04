import { useMemo, useState } from "react";
import {
  ActionIcon,
  Box,
  Checkbox,
  Group,
  Menu,
  NumberInput,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  Tooltip
} from "@mantine/core";
import type {
  AssetDefinition,
  MechanicsDefinition,
  SemanticCommand,
  SpellDefinition,
  SpellEffectDefinition,
  SpellEffectType
} from "@sugarmagic/domain";
import {
  createDefaultSpellDefinition,
  createDefaultSpellEffectDefinition,
  type CastableDefinition,
  type CastableInput,
  type JsonValue
} from "@sugarmagic/domain";
import { Inspector } from "@sugarmagic/ui";
import type { WorkspaceViewContribution } from "../workspace-view";

export interface SpellWorkspaceViewProps {
  isActive: boolean;
  gameProjectId: string | null;
  spellDefinitions: SpellDefinition[];
  mechanics: MechanicsDefinition;
  assetDefinitions: AssetDefinition[];
  onCommand: (command: SemanticCommand) => void;
}

const effectTypeOptions: Array<{ value: SpellEffectType; label: string }> = [
  { value: "event", label: "Event" },
  { value: "unlock", label: "Unlock" },
  { value: "world-flag", label: "World Flag" },
  { value: "dialogue", label: "Dialogue" },
  { value: "heal", label: "Heal" },
  { value: "damage", label: "Damage" }
];

function toAssetOptions(assetDefinitions: AssetDefinition[]) {
  return assetDefinitions.map((definition) => ({
    value: definition.definitionId,
    label: definition.displayName
  }));
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function defaultCastableArg(input: CastableInput): JsonValue {
  if (input.default !== undefined) return input.default;
  if (input.type === "number") return 0;
  if (input.type === "boolean") return false;
  if (input.type === "object") return {};
  return "";
}

function createDefaultCastableArgs(
  castable: CastableDefinition | null | undefined
): Record<string, JsonValue> {
  if (!castable) return {};
  return Object.fromEntries(
    castable.inputs.map((input) => [input.id, defaultCastableArg(input)])
  );
}

function formatInputLabel(input: CastableInput): string {
  return input.id
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function parseTagList(value: string): string[] {
  return value
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

export function useSpellWorkspaceView(
  props: SpellWorkspaceViewProps
): WorkspaceViewContribution {
  const {
    gameProjectId,
    spellDefinitions,
    mechanics,
    assetDefinitions,
    onCommand
  } = props;
  const [selectedSpellId, setSelectedSpellId] = useState<string | null>(
    spellDefinitions[0]?.definitionId ?? null
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    definitionId: string;
  } | null>(null);

  const effectiveSelectedSpellId = useMemo(() => {
    if (spellDefinitions.length === 0) return null;
    if (
      selectedSpellId &&
      spellDefinitions.some(
        (definition) => definition.definitionId === selectedSpellId
      )
    ) {
      return selectedSpellId;
    }
    return spellDefinitions[0]?.definitionId ?? null;
  }, [selectedSpellId, spellDefinitions]);

  const selectedSpell = useMemo(
    () =>
      spellDefinitions.find(
        (definition) => definition.definitionId === effectiveSelectedSpellId
      ) ?? null,
    [effectiveSelectedSpellId, spellDefinitions]
  );

  const filteredSpells = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return spellDefinitions;
    return spellDefinitions.filter(
      (definition) =>
        definition.displayName.toLowerCase().includes(query) ||
        definition.description.toLowerCase().includes(query) ||
        definition.tags.some((tag) => tag.toLowerCase().includes(query))
    );
  }, [searchQuery, spellDefinitions]);

  const assetOptions = useMemo(
    () => toAssetOptions(assetDefinitions),
    [assetDefinitions]
  );
  const castableOptions = useMemo(
    () =>
      mechanics.castables.map((definition) => ({
        value: definition.id,
        label: definition.displayName
      })),
    [mechanics.castables]
  );

  const selectedCastable = useMemo(
    () =>
      selectedSpell
        ? (mechanics.castables.find(
            (definition) => definition.id === selectedSpell.castable.id
          ) ?? null)
        : null,
    [mechanics.castables, selectedSpell]
  );

  function createSpell() {
    if (!gameProjectId) return;
    const castable = mechanics.castables[0] ?? null;
    const definition = createDefaultSpellDefinition({
      displayName: `Spell ${spellDefinitions.length + 1}`,
      castable: {
        id: castable?.id ?? "",
        args: createDefaultCastableArgs(castable)
      }
    });
    onCommand({
      kind: "CreateSpellDefinition",
      target: {
        aggregateKind: "game-project",
        aggregateId: gameProjectId
      },
      subject: {
        subjectKind: "spell-definition",
        subjectId: definition.definitionId
      },
      payload: { definition }
    });
    setSelectedSpellId(definition.definitionId);
  }

  function updateSpell(definition: SpellDefinition) {
    if (!gameProjectId) return;
    onCommand({
      kind: "UpdateSpellDefinition",
      target: {
        aggregateKind: "game-project",
        aggregateId: gameProjectId
      },
      subject: {
        subjectKind: "spell-definition",
        subjectId: definition.definitionId
      },
      payload: { definition }
    });
  }

  function deleteSpell(definitionId: string) {
    if (!gameProjectId) return;
    onCommand({
      kind: "DeleteSpellDefinition",
      target: {
        aggregateKind: "game-project",
        aggregateId: gameProjectId
      },
      subject: {
        subjectKind: "spell-definition",
        subjectId: definitionId
      },
      payload: { definitionId }
    });
    setContextMenu(null);
    if (effectiveSelectedSpellId === definitionId) {
      const remaining = spellDefinitions.filter(
        (definition) => definition.definitionId !== definitionId
      );
      setSelectedSpellId(remaining[0]?.definitionId ?? null);
    }
  }

  function updateEffectList(
    definition: SpellDefinition,
    key: "effects" | "chaosEffects",
    updater: (effects: SpellEffectDefinition[]) => SpellEffectDefinition[]
  ) {
    updateSpell({
      ...definition,
      [key]: updater(definition[key])
    });
  }

  function updateCastableArg(
    definition: SpellDefinition,
    input: CastableInput,
    value: JsonValue
  ) {
    updateSpell({
      ...definition,
      castable: {
        ...definition.castable,
        args: {
          ...definition.castable.args,
          [input.id]: value
        }
      }
    });
  }

  function renderCastableArgEditor(
    definition: SpellDefinition,
    input: CastableInput
  ) {
    const label = formatInputLabel(input);
    const description = input.description;
    const value = definition.castable.args[input.id];

    if (input.type === "number") {
      return (
        <NumberInput
          key={input.id}
          label={label}
          description={description}
          value={typeof value === "number" ? value : 0}
          onChange={(nextValue) => {
            if (typeof nextValue !== "number") return;
            updateCastableArg(definition, input, nextValue);
          }}
        />
      );
    }

    if (input.type === "boolean") {
      return (
        <Checkbox
          key={input.id}
          label={label}
          description={description}
          checked={value === true}
          onChange={(event) =>
            updateCastableArg(definition, input, event.currentTarget.checked)
          }
        />
      );
    }

    if (input.type === "object") {
      return (
        <Textarea
          key={input.id}
          label={label}
          description={description ?? "JSON object"}
          minRows={3}
          value={JSON.stringify(
            value && typeof value === "object" ? value : {},
            null,
            2
          )}
          onChange={(event) => {
            try {
              const parsed = JSON.parse(event.currentTarget.value) as JsonValue;
              updateCastableArg(definition, input, parsed);
            } catch {
              // Keep invalid JSON local in the text field until the author fixes it.
            }
          }}
        />
      );
    }

    return (
      <TextInput
        key={input.id}
        label={label}
        description={description}
        value={typeof value === "string" ? value : ""}
        onChange={(event) =>
          updateCastableArg(definition, input, event.currentTarget.value)
        }
      />
    );
  }

  function renderEffectEditor(
    definition: SpellDefinition,
    key: "effects" | "chaosEffects",
    label: string
  ) {
    const effects = definition[key];
    return (
      <Stack gap="xs">
        <Group justify="space-between" align="center">
          <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
            {label}
          </Text>
          <ActionIcon
            size="sm"
            variant="subtle"
            onClick={() =>
              updateEffectList(definition, key, (current) => [
                ...current,
                createDefaultSpellEffectDefinition()
              ])
            }
            aria-label={`Add ${label}`}
          >
            +
          </ActionIcon>
        </Group>
        {effects.length === 0 ? (
          <Text size="xs" c="var(--sm-color-overlay0)">
            No {label.toLowerCase()} yet.
          </Text>
        ) : (
          effects.map((effect) => (
            <Box
              key={effect.effectId}
              p="sm"
              style={{
                border: "1px solid var(--sm-panel-border)",
                borderRadius: 10,
                background: "rgba(255,255,255,0.02)"
              }}
            >
              <Stack gap="xs">
                <Group justify="space-between" align="center">
                  <Text size="xs" fw={600} c="var(--sm-color-subtext)">
                    {effect.type}
                  </Text>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="red"
                    onClick={() =>
                      updateEffectList(definition, key, (current) =>
                        current.filter(
                          (candidate) => candidate.effectId !== effect.effectId
                        )
                      )
                    }
                    aria-label="Delete effect"
                  >
                    ×
                  </ActionIcon>
                </Group>
                <Select
                  label="Effect Type"
                  size="xs"
                  data={effectTypeOptions}
                  value={effect.type}
                  onChange={(value) => {
                    if (!value) return;
                    updateEffectList(definition, key, (current) =>
                      current.map((candidate) =>
                        candidate.effectId === effect.effectId
                          ? { ...candidate, type: value as SpellEffectType }
                          : candidate
                      )
                    );
                  }}
                />
                <TextInput
                  label="Target Id"
                  size="xs"
                  value={effect.targetId ?? ""}
                  onChange={(event) =>
                    updateEffectList(definition, key, (current) =>
                      current.map((candidate) =>
                        candidate.effectId === effect.effectId
                          ? {
                              ...candidate,
                              targetId:
                                event.currentTarget.value.trim().length > 0
                                  ? event.currentTarget.value
                                  : undefined
                            }
                          : candidate
                      )
                    )
                  }
                />
                <TextInput
                  label="Value"
                  size="xs"
                  value={stringifyValue(effect.value)}
                  onChange={(event) =>
                    updateEffectList(definition, key, (current) =>
                      current.map((candidate) =>
                        candidate.effectId === effect.effectId
                          ? {
                              ...candidate,
                              value:
                                event.currentTarget.value.trim().length > 0
                                  ? event.currentTarget.value
                                  : undefined
                            }
                          : candidate
                      )
                    )
                  }
                />
              </Stack>
            </Box>
          ))
        )}
      </Stack>
    );
  }

  return {
    leftPanel: (
      <Stack
        gap={0}
        h="100%"
        style={{ minHeight: 0 }}
        onClick={() => setContextMenu(null)}
      >
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
            Spells
          </Text>
          <Tooltip label="Add Spell">
            <ActionIcon
              variant="subtle"
              size="sm"
              onClick={createSpell}
              aria-label="Add Spell"
            >
              +
            </ActionIcon>
          </Tooltip>
        </Group>
        <Box
          p="sm"
          style={{ borderBottom: "1px solid var(--sm-panel-border)" }}
        >
          <TextInput
            size="xs"
            placeholder="Search spells..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
          />
        </Box>
        <ScrollArea style={{ flex: 1, minHeight: 0 }}>
          <Stack gap={4} p="xs">
            {filteredSpells.map((definition) => {
              const isSelected =
                effectiveSelectedSpellId === definition.definitionId;
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
                  onClick={() => setSelectedSpellId(definition.definitionId)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setSelectedSpellId(definition.definitionId);
                    setContextMenu({
                      x: event.clientX,
                      y: event.clientY,
                      definitionId: definition.definitionId
                    });
                  }}
                >
                  <Text size="sm" fw={500} truncate>
                    {definition.displayName}
                  </Text>
                  <Text size="xs" c="var(--sm-color-overlay0)" truncate>
                    {definition.tags.join(", ") || "No tags"}
                  </Text>
                </Box>
              );
            })}
            {filteredSpells.length === 0 && (
              <Text size="xs" c="var(--sm-color-overlay0)" p="md" ta="center">
                No spells yet.
              </Text>
            )}
          </Stack>
        </ScrollArea>
        <Menu
          opened={Boolean(contextMenu)}
          onChange={(opened) => {
            if (!opened) setContextMenu(null);
          }}
          withinPortal
          closeOnItemClick
          closeOnClickOutside
          position="bottom-start"
          offset={4}
          shadow="md"
        >
          <Menu.Target>
            <Box
              style={{
                position: "fixed",
                left: contextMenu?.x ?? -9999,
                top: contextMenu?.y ?? -9999,
                width: 1,
                height: 1
              }}
            />
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              color="red"
              onClick={() => {
                if (!contextMenu) return;
                deleteSpell(contextMenu.definitionId);
              }}
            >
              Delete
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Stack>
    ),
    centerPanel: (
      <Box
        style={{
          height: "100%",
          background: "var(--sm-color-bg)",
          padding: 24,
          overflow: "auto"
        }}
      >
        {selectedSpell ? (
          <Box
            style={{
              maxWidth: 920,
              margin: "0 auto",
              minHeight: "100%",
              border: "1px solid var(--sm-panel-border)",
              borderRadius: 18,
              background:
                "linear-gradient(180deg, rgba(36,36,54,0.98), rgba(24,24,37,0.98))",
              padding: 28,
              boxShadow: "0 18px 48px rgba(0,0,0,0.22)"
            }}
          >
            <Stack gap="lg">
              <TextInput
                label="Name"
                value={selectedSpell.displayName}
                onChange={(event) =>
                  updateSpell({
                    ...selectedSpell,
                    displayName: event.currentTarget.value
                  })
                }
              />
              <Textarea
                label="Description"
                minRows={3}
                value={selectedSpell.description}
                onChange={(event) =>
                  updateSpell({
                    ...selectedSpell,
                    description: event.currentTarget.value
                  })
                }
              />
              <Group grow align="flex-start">
                <Select
                  label="Icon Asset"
                  clearable
                  data={assetOptions}
                  value={selectedSpell.iconAssetDefinitionId}
                  onChange={(value) =>
                    updateSpell({
                      ...selectedSpell,
                      iconAssetDefinitionId: value
                    })
                  }
                />
              </Group>
              <Select
                label="Castable"
                data={castableOptions}
                value={selectedSpell.castable.id}
                onChange={(value) => {
                  const nextCastable =
                    mechanics.castables.find(
                      (definition) => definition.id === value
                    ) ?? null;
                  updateSpell({
                    ...selectedSpell,
                    castable: {
                      id: value ?? "",
                      args: createDefaultCastableArgs(nextCastable)
                    }
                  });
                }}
              />
              {selectedCastable ? (
                <Stack gap="xs">
                  <Text size="xs" fw={600} c="var(--sm-color-subtext)">
                    Castable Args
                  </Text>
                  {selectedCastable.inputs.length === 0 ? (
                    <Text size="xs" c="var(--sm-color-overlay0)">
                      This castable does not require arguments.
                    </Text>
                  ) : (
                    selectedCastable.inputs.map((input) =>
                      renderCastableArgEditor(selectedSpell, input)
                    )
                  )}
                </Stack>
              ) : (
                <Text size="xs" c="var(--sm-color-red)">
                  Select a valid castable before saving or previewing.
                </Text>
              )}
              <TextInput
                label="Tags"
                description="Comma-separated tags"
                value={selectedSpell.tags.join(", ")}
                onChange={(event) =>
                  updateSpell({
                    ...selectedSpell,
                    tags: parseTagList(event.currentTarget.value)
                  })
                }
              />
              {renderEffectEditor(selectedSpell, "effects", "Effects")}
              {renderEffectEditor(
                selectedSpell,
                "chaosEffects",
                "Chaos Effects"
              )}
            </Stack>
          </Box>
        ) : (
          <Text size="sm" c="var(--sm-color-overlay0)">
            Create a spell to begin.
          </Text>
        )}
      </Box>
    ),
    rightPanel: (
      <Inspector
        selectionLabel={selectedSpell?.displayName ?? "Spell"}
        selectionIcon="✨"
      >
        {selectedSpell ? (
          <Stack gap="lg">
            <Stack gap="xs">
              <Text
                size="xs"
                fw={600}
                tt="uppercase"
                c="var(--sm-color-subtext)"
              >
                Summary
              </Text>
              <Text size="sm">
                {selectedSpell.description || "No description yet."}
              </Text>
            </Stack>
            <Stack gap="xs">
              <Text
                size="xs"
                fw={600}
                tt="uppercase"
                c="var(--sm-color-subtext)"
              >
                Casting
              </Text>
              <Text size="sm">
                Castable: {selectedCastable?.displayName ?? "Invalid"}
              </Text>
              {typeof selectedSpell.castable.args.batteryCost === "number" ? (
                <Text size="sm">
                  Battery Cost: {selectedSpell.castable.args.batteryCost}
                </Text>
              ) : null}
              <Text size="sm">
                Tags: {selectedSpell.tags.join(", ") || "None"}
              </Text>
            </Stack>
            <Stack gap="xs">
              <Text
                size="xs"
                fw={600}
                tt="uppercase"
                c="var(--sm-color-subtext)"
              >
                Effects
              </Text>
              <Text size="sm">Primary: {selectedSpell.effects.length}</Text>
              <Text size="sm">Chaos: {selectedSpell.chaosEffects.length}</Text>
            </Stack>
          </Stack>
        ) : (
          <Text size="xs" c="var(--sm-color-overlay0)">
            No spell selected.
          </Text>
        )}
      </Inspector>
    ),
    viewportOverlay: null
  };
}
