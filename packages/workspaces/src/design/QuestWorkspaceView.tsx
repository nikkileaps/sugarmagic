/**
 * packages/workspaces/src/design/QuestWorkspaceView.tsx
 *
 * Purpose: Renders the Design > Quests workspace, including the quest graph and inspector.
 *
 * Exports:
 *   - QuestWorkspaceViewProps
 *   - useQuestWorkspaceView
 *
 * Relationships:
 *   - Owns canonical quest authoring controls and graph editing.
 *   - Accepts plugin-owned inspector sections so quest-side hints can mount without forking the quest editor.
 *
 * Implements: Quest authoring workspace / Epic 12 plugin inspector section seam
 *
 * Status: active
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Menu,
  Modal,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  Tooltip
} from "@mantine/core";
import type {
  DialogueDefinition,
  ItemDefinition,
  NPCAnimationSlot,
  NPCDefinition,
  QuestActionDefinition,
  TimeOfDayBand,
  QuestConditionDefinition,
  QuestDefinition,
  QuestNodeBehavior,
  QuestNodeDefinition,
  QuestStageDefinition,
  RegionDocument,
  Episode,
  SoundCueDefinition,
  SpellDefinition,
  SemanticCommand
} from "@sugarmagic/domain";
import {
  NPC_ANIMATION_SLOT_LABELS,
  QUEST_ACTION_TYPE_OPTIONS,
  TIME_OF_DAY_BAND_OPTIONS,
  createQuestAction,
  validateQuest,
  isBlankWorldFlagValue,
  createDefaultDialogueDefinition,
  createDefaultQuestDefinition,
  createDefaultQuestNodeDefinition,
  createDefaultQuestStageDefinition,
  createNodeGroup,
  createQuestNodeId,
  getAllScenes,
  findSceneByQuestDefinitionId
} from "@sugarmagic/domain";
import { AddNodeMenu, Inspector } from "@sugarmagic/ui";
import { WorldFlagSelect } from "../world-flags";
import {
  NodeEditor,
  type GraphEditorConnection,
  type GraphEditorHandle,
  type GraphEditorNodeMove,
  type GraphEditorNodeRendererProps
} from "@sugarmagic/ui/node-editor";
import {
  addGroup,
  frameAround,
  membershipChanged,
  placeNodeInGroup,
  resolveMembership,
  shiftGroupMembers,
  toAbsolutePosition,
  toEditorGroups
} from "./node-group-layout";
import {
  QUEST_NODE_KIND,
  applyNodeMoves,
  connectNodes,
  deleteNodes,
  disconnectEdges,
  questStageToEditorEdges,
  questStageToEditorNodes
} from "./quest-graph";
import type {
  WorkspaceNavigationTarget,
  WorkspaceViewContribution
} from "../workspace-view";

const NODE_SPACING_Y = 150;

const NODE_BEHAVIOR_COLORS: Record<QuestNodeBehavior, string> = {
  objective: "#89b4fa",
  narrative: "#cba6f7",
  condition: "#f9e2af",
  branch: "#fab387"
};

const OBJECTIVE_TYPE_ICONS: Record<string, string> = {
  talk: "💬",
  location: "📍",
  collect: "📦",
  castSpell: "🔮",
  awaitEvent: "⭐"
};

export interface QuestWorkspaceViewProps {
  isActive: boolean;
  gameProjectId: string | null;
  questDefinitions: QuestDefinition[];
  regions: RegionDocument[];
  /** Plan 058 §058.5 — Scene picker source for the
   *  unlockScene / advanceToNextScene action editors. */
  episodes: Episode[];
  /** Cue picker source for the playCue action editor. */
  soundCueDefinitions: SoundCueDefinition[];
  dialogueDefinitions: DialogueDefinition[];
  itemDefinitions: ItemDefinition[];
  npcDefinitions: NPCDefinition[];
  spellDefinitions: SpellDefinition[];
  onCommand: (command: SemanticCommand) => void;
  navigationTarget?: WorkspaceNavigationTarget | null;
  onConsumeNavigationTarget?: () => void;
  onNavigateToTarget?: (target: WorkspaceNavigationTarget) => void;
  renderInspectorSections?: (context: {
    selectedQuest: QuestDefinition | null;
    updateQuest: (definition: QuestDefinition) => void;
    selectedQuestNode: QuestNodeDefinition | null;
  }) => ReactNode;
}

/**
 * A new flag condition. The value is spelled out rather than left blank so the
 * author sees what is being compared -- `createQuestAction` does the same for
 * the `setFlag` action, and the two have to agree for the condition to match.
 */
function createWorldFlagCondition(): QuestConditionDefinition {
  return { type: "hasFlag", worldFlagId: "", value: "true" };
}


/**
 * The body of a quest node on the graph. Ports and the selection ring are drawn
 * by the shared editor, so the border here always shows the node's behaviour --
 * an objective's blue is the same blue as the highlight, and switching between
 * them made selection invisible.
 */
function QuestNodeCard({ node }: GraphEditorNodeRendererProps) {
  const questNode = node.payload as QuestNodeDefinition;
  const behaviorColor = NODE_BEHAVIOR_COLORS[questNode.nodeBehavior];
  const description =
    questNode.description.length > 120
      ? `${questNode.description.slice(0, 120)}...`
      : questNode.description;

  return (
    <div
      style={{
        minWidth: 220,
        maxWidth: 300,
        background: "var(--sm-color-mantle)",
        border: `2px solid ${behaviorColor}`,
        borderRadius: 8,
        overflow: "hidden"
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          background: `${behaviorColor}22`,
          borderBottom: "1px solid var(--sm-color-surface0)",
          display: "flex",
          alignItems: "center",
          gap: 8
        }}
      >
        <span
          style={{
            fontSize: 12,
            color: "var(--sm-color-text)",
            flex: 1,
            fontWeight: 600
          }}
        >
          {nodeLabel(questNode)}
        </span>
        <span
          style={{
            fontSize: 10,
            padding: "2px 6px",
            borderRadius: 4,
            background: `${behaviorColor}22`,
            color: behaviorColor
          }}
        >
          {questNode.nodeBehavior.toUpperCase()}
        </span>
      </div>
      <div
        style={{
          padding: 12,
          fontSize: 12,
          color: "var(--sm-color-subtext)",
          lineHeight: 1.4
        }}
      >
        {description}
      </div>
    </div>
  );
}

const QUEST_NODE_RENDERERS = { [QUEST_NODE_KIND]: QuestNodeCard };

/** What the Add Node Menu offers, and the starting text for each kind. */
const QUEST_NODE_MENU_ITEMS: {
  id: QuestNodeBehavior;
  label: string;
  description: string;
}[] = [
  { id: "objective", label: "Objective", description: "Talk to someone" },
  {
    id: "narrative",
    label: "Narrative",
    description: "Trigger narrative content"
  },
  {
    id: "condition",
    label: "Condition",
    description: "Wait until a condition is true"
  },
  { id: "branch", label: "Branch", description: "Route to pass or fail" }
];

function createNextNodePosition(stage: QuestStageDefinition) {
  const maxY = stage.nodeDefinitions.reduce(
    (current, node) => Math.max(current, node.graphPosition.y),
    0
  );
  return {
    x: 80,
    y: maxY + NODE_SPACING_Y
  };
}

function nodeLabel(node: QuestNodeDefinition): string {
  if (node.nodeBehavior === "objective") {
    return `${OBJECTIVE_TYPE_ICONS[node.objectiveSubtype ?? "awaitEvent"] ?? "⭐"} ${node.displayName}`;
  }
  if (node.nodeBehavior === "narrative") {
    return `🎬 ${node.displayName}`;
  }
  if (node.nodeBehavior === "condition") {
    return `? ${node.displayName}`;
  }
  return `⑂ ${node.displayName}`;
}

function MiniStageGraph({ stage }: { stage: QuestStageDefinition }) {
  const nodeMap = new Map(
    stage.nodeDefinitions.map((node) => [node.nodeId, node])
  );
  let maxX = 0;
  let maxY = 0;
  for (const node of stage.nodeDefinitions) {
    maxX = Math.max(maxX, node.graphPosition.x);
    maxY = Math.max(maxY, node.graphPosition.y);
  }
  const width = Math.max(220, maxX * 0.4 + 80);
  const height = Math.max(90, maxY * 0.35 + 60);

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      {stage.nodeDefinitions.flatMap((node) =>
        node.prerequisiteNodeIds.map((prerequisiteNodeId) => {
          const from = nodeMap.get(prerequisiteNodeId);
          if (!from) return null;
          return (
            <line
              key={`${prerequisiteNodeId}:${node.nodeId}`}
              x1={from.graphPosition.x * 0.4 + 18}
              y1={from.graphPosition.y * 0.35 + 18}
              x2={node.graphPosition.x * 0.4 + 18}
              y2={node.graphPosition.y * 0.35 + 18}
              stroke="#89b4fa"
              strokeOpacity={0.6}
            />
          );
        })
      )}
      {stage.nodeDefinitions.map((node) => (
        <g key={node.nodeId}>
          <circle
            cx={node.graphPosition.x * 0.4 + 18}
            cy={node.graphPosition.y * 0.35 + 18}
            r={
              node.nodeBehavior === "branch" ||
              node.nodeBehavior === "condition"
                ? 10
                : 12
            }
            fill={NODE_BEHAVIOR_COLORS[node.nodeBehavior]}
            opacity={0.92}
          />
        </g>
      ))}
    </svg>
  );
}

/**
 * Options for a picker whose current value may name content that has
 * since been deleted. The stale id stays on the list, labelled, so the
 * picker shows what the condition actually says rather than looking
 * like nothing was ever picked.
 */
function pickerOptions(
  available: { value: string; label: string }[],
  current: string
): { value: string; label: string }[] {
  if (!current || available.some((option) => option.value === current)) {
    return available;
  }
  return [...available, { value: current, label: `${current} (missing)` }];
}

/** Pick a quest from the project. The ids exist already; an author
 *  retyping one is how a condition ends up naming nothing. */
function QuestPicker({
  label,
  questDefinitions,
  value,
  excludeQuestDefinitionId,
  onChange
}: {
  label: string;
  questDefinitions: QuestDefinition[];
  value: string;
  /** A quest to leave off the list, where naming it would be a condition
   *  that can never come true. */
  excludeQuestDefinitionId?: string;
  onChange: (questDefinitionId: string) => void;
}) {
  const available = questDefinitions
    .filter((quest) => quest.definitionId !== excludeQuestDefinitionId)
    .map((quest) => ({
      value: quest.definitionId,
      label: quest.displayName
    }));

  return (
    <Select
      size="xs"
      label={label}
      searchable
      data={pickerOptions(available, value)}
      value={value || null}
      onChange={(next) => next && onChange(next)}
    />
  );
}

function QuestConditionEditor({
  condition,
  spellDefinitions,
  questDefinitions,
  excludeQuestDefinitionId,
  onChange
}: {
  condition: QuestConditionDefinition;
  spellDefinitions: SpellDefinition[];
  /** Every quest in the project: the conditions that name one pick from
   *  this rather than asking the author to type an id. */
  questDefinitions: QuestDefinition[];
  excludeQuestDefinitionId?: string;
  onChange: (condition: QuestConditionDefinition) => void;
}) {
  function handleTypeChange(type: string) {
    switch (type) {
      case "hasFlag":
        onChange(createWorldFlagCondition());
        break;
      case "hasSpell":
        onChange({ type: "hasSpell", spellDefinitionId: "" });
        break;
      case "canCastSpell":
        onChange({ type: "canCastSpell", spellDefinitionId: "" });
        break;
      case "questActive":
        onChange({ type: "questActive", questDefinitionId: "" });
        break;
      case "questCompleted":
        onChange({ type: "questCompleted", questDefinitionId: "" });
        break;
      case "questStage":
        onChange({
          type: "questStage",
          questDefinitionId: "",
          stageId: "",
          state: "active"
        });
        break;
      case "not":
        onChange({ type: "not", condition: createWorldFlagCondition() });
        break;
      default:
        break;
    }
  }

  if (condition.type === "not") {
    return (
      <Paper
        p="xs"
        style={{ background: "#f38ba822", borderLeft: "2px solid #f38ba8" }}
      >
        <Text size="xs" fw={600} mb="xs">
          NOT
        </Text>
        <QuestConditionEditor
          condition={condition.condition}
          spellDefinitions={spellDefinitions}
          questDefinitions={questDefinitions}
          excludeQuestDefinitionId={excludeQuestDefinitionId}
          onChange={(inner) => onChange({ type: "not", condition: inner })}
        />
      </Paper>
    );
  }

  return (
    <Stack gap="xs">
      <Select
        size="xs"
        label="Condition Type"
        value={condition.type}
        data={[
          { value: "hasFlag", label: "Flag" },
          { value: "hasSpell", label: "Has Spell" },
          { value: "canCastSpell", label: "Can Cast Spell" },
          { value: "questActive", label: "Quest Active" },
          { value: "questCompleted", label: "Quest Completed" },
          { value: "questStage", label: "Quest Stage" },
          { value: "not", label: "Not" }
        ]}
        onChange={(value) => value && handleTypeChange(value)}
      />
      {condition.type === "hasFlag" && (
        <>
          <WorldFlagSelect
            label="Flag"
            value={condition.worldFlagId || null}
            onChange={(worldFlagId) => onChange({ ...condition, worldFlagId: worldFlagId ?? "" })}
          />
          {/* Free text, so an author can type `5` against a flag declared as
              a string. The picked flag declares a valueType; this box could
              follow it -- a checkbox, a number input, or text. Worth doing
              once a non-boolean flag is authored for real, or the first time
              a value mismatch is reported. Tracked on issue #224. */}
          <TextInput
            size="xs"
            label="Expected Value"
            value={condition.value == null ? "" : String(condition.value)}
            error={
              isBlankWorldFlagValue(condition.value)
                ? "Required. A condition with no value never matches."
                : undefined
            }
            onChange={(event) =>
              onChange({ ...condition, value: event.currentTarget.value })
            }
          />
        </>
      )}
      {condition.type === "hasSpell" && (
        <Select
          size="xs"
          label="Spell"
          value={condition.spellDefinitionId}
          data={spellDefinitions.map((spell) => ({
            value: spell.definitionId,
            label: spell.displayName
          }))}
          onChange={(value) =>
            onChange({ ...condition, spellDefinitionId: value ?? "" })
          }
        />
      )}
      {condition.type === "canCastSpell" && (
        <Select
          size="xs"
          label="Spell"
          value={condition.spellDefinitionId}
          data={spellDefinitions.map((spell) => ({
            value: spell.definitionId,
            label: spell.displayName
          }))}
          onChange={(value) =>
            onChange({ ...condition, spellDefinitionId: value ?? "" })
          }
        />
      )}
      {(condition.type === "questActive" ||
        condition.type === "questCompleted") && (
        <QuestPicker
          label="Quest"
          questDefinitions={questDefinitions}
          value={condition.questDefinitionId}
          excludeQuestDefinitionId={excludeQuestDefinitionId}
          onChange={(questDefinitionId) =>
            onChange({ ...condition, questDefinitionId })
          }
        />
      )}
      {condition.type === "questStage" && (
        <>
          <QuestPicker
            label="Quest"
            questDefinitions={questDefinitions}
            value={condition.questDefinitionId}
            excludeQuestDefinitionId={excludeQuestDefinitionId}
            onChange={(questDefinitionId) =>
              onChange({
                ...condition,
                questDefinitionId,
                // The old stage belonged to the old quest. Move to the
                // new quest's first stage rather than keep an id that
                // names nothing in it.
                stageId:
                  questDefinitions.find(
                    (quest) => quest.definitionId === questDefinitionId
                  )?.startStageId ?? ""
              })
            }
          />
          <Select
            size="xs"
            label="Stage"
            searchable
            data={pickerOptions(
              (
                questDefinitions.find(
                  (quest) =>
                    quest.definitionId === condition.questDefinitionId
                )?.stageDefinitions ?? []
              ).map((stage) => ({
                value: stage.stageId,
                label: stage.displayName
              })),
              condition.stageId
            )}
            value={condition.stageId || null}
            placeholder={
              condition.questDefinitionId ? undefined : "Pick a quest first"
            }
            onChange={(value) =>
              value && onChange({ ...condition, stageId: value })
            }
          />
          <Select
            size="xs"
            label="State"
            value={condition.state}
            data={[
              { value: "active", label: "Active" },
              { value: "completed", label: "Completed" }
            ]}
            onChange={(value) =>
              value &&
              onChange({ ...condition, state: value as "active" | "completed" })
            }
          />
        </>
      )}
    </Stack>
  );
}

/**
 * Times a stage can be set at: every band except dawn and dusk, which are
 * deliberately not offered here and stay reachable through the set-time-of-day
 * quest action. Derived from the one band list rather than restating it.
 */
const STAGE_EXCLUDED_TIME_BANDS: TimeOfDayBand[] = ["dawn", "dusk"];
const STAGE_TIME_OF_DAY_OPTIONS = TIME_OF_DAY_BAND_OPTIONS.filter(
  (option) => !STAGE_EXCLUDED_TIME_BANDS.includes(option.value)
);

/**
 * The parameters one action takes. Each action type declares its own fields, so
 * this renders those and nothing else -- an action with no parameters shows no
 * inputs rather than an empty box the author has to ignore.
 */
function QuestActionFields({
  action,
  itemDefinitions,
  npcDefinitions,
  episodes,
  soundCueDefinitions,
  onChange
}: {
  action: QuestActionDefinition;
  itemDefinitions: ItemDefinition[];
  npcDefinitions: NPCDefinition[];
  episodes: Episode[];
  soundCueDefinitions: SoundCueDefinition[];
  onChange: (action: QuestActionDefinition) => void;
}) {
  switch (action.type) {
    case "setFlag":
      return (
        <>
          <WorldFlagSelect
            label="Flag"
            value={action.worldFlagId || null}
            onChange={(worldFlagId) => onChange({ ...action, worldFlagId: worldFlagId ?? "" })}
          />
          <TextInput
            size="xs"
            label="Value"
            value={action.value == null ? "" : String(action.value)}
            error={
              isBlankWorldFlagValue(action.value)
                ? "Required. Conditions compare against this value."
                : undefined
            }
            onChange={(event) =>
              onChange({ ...action, value: event.currentTarget.value })
            }
          />
        </>
      );

    case "emitEvent":
      return (
        <TextInput
          size="xs"
          label="Event Name"
          value={action.eventName}
          onChange={(event) =>
            onChange({ ...action, eventName: event.currentTarget.value })
          }
        />
      );

    case "giveItem":
    case "removeItem":
      return (
        <>
          <Select
            size="xs"
            label="Item"
            clearable
            searchable
            placeholder="Pick an item"
            data={itemDefinitions.map((item) => ({
              value: item.definitionId,
              label: item.displayName
            }))}
            value={action.itemDefinitionId}
            onChange={(value) =>
              onChange({ ...action, itemDefinitionId: value })
            }
          />
          <NumberInput
            size="xs"
            label="Count"
            min={1}
            value={action.count}
            onChange={(value) =>
              onChange({
                ...action,
                count: typeof value === "number" ? Math.max(1, value) : 1
              })
            }
          />
        </>
      );

    case "unlockEpisode":
      return (
        <Select
          size="xs"
          label="Episode"
          clearable
          placeholder="Pick an Episode"
          data={episodes.map((episode) => ({
            value: episode.episodeId,
            label: episode.displayName
          }))}
          value={action.episodeId}
          onChange={(value) => onChange({ ...action, episodeId: value })}
        />
      );

    case "advanceToNextScene":
      return (
        <Select
          size="xs"
          label="Scene"
          clearable
          placeholder="(next in this Episode)"
          data={getAllScenes(episodes).map((scene) => ({
            value: scene.sceneId,
            label: scene.displayName
          }))}
          value={action.sceneId}
          onChange={(value) => onChange({ ...action, sceneId: value })}
        />
      );

    case "playCue":
    case "stopCue":
      return (
        <Select
          size="xs"
          label="Sound Cue"
          clearable
          searchable
          placeholder="Pick a cue"
          data={soundCueDefinitions.map((cue) => ({
            value: cue.definitionId,
            label: cue.displayName
          }))}
          value={action.cueDefinitionId}
          onChange={(value) => onChange({ ...action, cueDefinitionId: value })}
        />
      );

    case "playAnimation": {
      // Only the slots this NPC has a clip bound to. A slot with no clip would
      // play nothing, so it is not offered.
      const npc = npcDefinitions.find(
        (candidate) => candidate.definitionId === action.npcDefinitionId
      );
      const boundSlots = npc
        ? (
            Object.entries(npc.presentation.animationAssetBindings) as Array<
              [NPCAnimationSlot, string | null]
            >
          )
            .filter(([, bindingId]) => Boolean(bindingId))
            .map(([slot]) => slot)
        : [];
      return (
        <>
          <Select
            size="xs"
            label="NPC"
            clearable
            searchable
            placeholder="Pick an NPC"
            data={npcDefinitions.map((definition) => ({
              value: definition.definitionId,
              label: definition.displayName
            }))}
            value={action.npcDefinitionId}
            onChange={(value) =>
              // The slot list belongs to the NPC, so changing the NPC clears it.
              onChange({ ...action, npcDefinitionId: value, slot: null })
            }
          />
          <Select
            size="xs"
            label="Animation"
            clearable
            disabled={!npc}
            placeholder={
              !npc
                ? "Pick an NPC first"
                : boundSlots.length === 0
                  ? "This NPC has no animations bound"
                  : "Pick an animation"
            }
            data={boundSlots.map((slot) => ({
              value: slot,
              label: NPC_ANIMATION_SLOT_LABELS[slot]
            }))}
            value={action.slot}
            onChange={(value) =>
              onChange({
                ...action,
                slot: (value as NPCAnimationSlot | null) ?? null
              })
            }
          />
          <NumberInput
            size="xs"
            label="Times to Play"
            min={1}
            value={action.repeatCount}
            onChange={(value) =>
              onChange({
                ...action,
                repeatCount: typeof value === "number" ? Math.max(1, value) : 1
              })
            }
          />
        </>
      );
    }

    case "set-time-of-day":
      return (
        <Select
          size="xs"
          label="Time of Day"
          data={TIME_OF_DAY_BAND_OPTIONS}
          value={action.band}
          onChange={(value) => {
            if (!value) return;
            onChange({ ...action, band: value as TimeOfDayBand });
          }}
        />
      );

    case "learn-fact":
      return (
        <>
          <TextInput
            size="xs"
            label="Fact ID"
            value={action.factId ?? ""}
            onChange={(event) =>
              onChange({
                ...action,
                factId: event.currentTarget.value || null
              })
            }
          />
          <TextInput
            size="xs"
            label="Display Text"
            value={action.displayText}
            onChange={(event) =>
              onChange({ ...action, displayText: event.currentTarget.value })
            }
          />
        </>
      );

    case "setNpcInteractionMode":
      return (
        <>
          <Select
            size="xs"
            label="NPC"
            clearable
            placeholder="Pick an NPC"
            data={npcDefinitions.map((npc) => ({
              value: npc.definitionId,
              label: npc.displayName
            }))}
            value={action.npcDefinitionId}
            onChange={(value) =>
              onChange({ ...action, npcDefinitionId: value })
            }
          />
          <Select
            size="xs"
            label="Becomes"
            clearable
            // Clearing means "back to whatever the NPC is authored as",
            // which is why this is clearable rather than a two-value
            // toggle.
            placeholder="(back to its own setting)"
            data={[
              { value: "scripted", label: "Scripted" },
              { value: "agent", label: "Agent" }
            ]}
            value={action.mode}
            onChange={(value) =>
              onChange({
                ...action,
                mode:
                  value === "scripted" || value === "agent" ? value : null
              })
            }
          />
        </>
      );

    // Takes no parameters.
    case "advance-day":
      return null;

    default: {
      const exhaustive: never = action;
      void exhaustive;
      return null;
    }
  }
}

export function QuestActionsEditor({
  actions,
  itemDefinitions,
  npcDefinitions,
  episodes,
  soundCueDefinitions,
  onChange,
  label
}: {
  actions: QuestActionDefinition[];
  itemDefinitions: ItemDefinition[];
  npcDefinitions: NPCDefinition[];
  episodes: Episode[];
  soundCueDefinitions: SoundCueDefinition[];
  onChange: (actions: QuestActionDefinition[]) => void;
  label: string;
}) {
  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
          {label}
        </Text>
        <Menu withinPortal>
          <Menu.Target>
            <ActionIcon size="sm" variant="subtle" aria-label={`Add ${label}`}>
              +
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            {QUEST_ACTION_TYPE_OPTIONS.map((option) => (
              <Menu.Item
                key={option.value}
                onClick={() =>
                  onChange([...actions, createQuestAction(option.value)])
                }
              >
                {option.label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      </Group>
      {actions.length === 0 ? (
        <Text size="xs" c="dimmed">
          No actions configured.
        </Text>
      ) : (
        actions.map((action, index) => (
          <Paper
            key={`${action.type}:${index}`}
            p="xs"
            style={{ background: "#181825" }}
          >
            <Stack gap="xs">
              <Group justify="space-between" align="center">
                <Select
                  size="xs"
                  value={action.type}
                  data={QUEST_ACTION_TYPE_OPTIONS}
                  onChange={(value) => {
                    if (!value) return;
                    const next = [...actions];
                    // Changing the type replaces the parameters: the old
                    // action's fields do not exist on the new one.
                    next[index] = createQuestAction(
                      value as QuestActionDefinition["type"]
                    );
                    onChange(next);
                  }}
                />
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="red"
                  onClick={() =>
                    onChange(
                      actions.filter((_, candidate) => candidate !== index)
                    )
                  }
                >
                  ×
                </ActionIcon>
              </Group>
              <QuestActionFields
                action={action}
                itemDefinitions={itemDefinitions}
                npcDefinitions={npcDefinitions}
                episodes={episodes}
                soundCueDefinitions={soundCueDefinitions}
                onChange={(updated) => {
                  const next = [...actions];
                  next[index] = updated;
                  onChange(next);
                }}
              />
            </Stack>
          </Paper>
        ))
      )}
    </Stack>
  );
}

export function useQuestWorkspaceView({
  isActive,
  gameProjectId,
  questDefinitions,
  regions,
  episodes,
  soundCueDefinitions,
  dialogueDefinitions,
  itemDefinitions,
  npcDefinitions,
  spellDefinitions,
  onCommand,
  navigationTarget = null,
  onConsumeNavigationTarget,
  onNavigateToTarget,
  renderInspectorSections
}: QuestWorkspaceViewProps): WorkspaceViewContribution {
  const [searchQuery, setSearchQuery] = useState("");
  /** Every Scene a quest could happen in, in narrative order. */
  const storyScenes = useMemo(() => getAllScenes(episodes), [episodes]);
  const [newQuestSceneId, setNewQuestSceneId] = useState<string | null>(null);
  // Follow the project: default to the first Scene, and recover if the
  // chosen one is deleted while this workspace is open.
  useEffect(() => {
    setNewQuestSceneId((current) =>
      current && storyScenes.some((scene) => scene.sceneId === current)
        ? current
        : (storyScenes[0]?.sceneId ?? null)
    );
  }, [storyScenes]);
  const [selectedQuestId, setSelectedQuestId] = useState<string | null>(
    questDefinitions[0]?.definitionId ?? null
  );
  const [graphStageId, setGraphStageId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [contextMenuQuestId, setContextMenuQuestId] = useState<string | null>(
    null
  );
  // Paper cut #1 modal state — target node the picker was on when
  // "+ Add New Dialogue" fired, and the pending name the author is
  // typing. Null target means the modal is closed.
  const [newDialogueForNode, setNewDialogueForNode] =
    useState<QuestNodeDefinition | null>(null);
  const [newDialogueName, setNewDialogueName] = useState("");

  const graphEditorRef = useRef<GraphEditorHandle | null>(null);
  const selectedQuestRef = useRef<QuestDefinition | null>(null);
  const selectedNodeIdRef = useRef<string | null>(null);

  const effectiveSelectedQuestId =
    selectedQuestId &&
    questDefinitions.some((quest) => quest.definitionId === selectedQuestId)
      ? selectedQuestId
      : (questDefinitions[0]?.definitionId ?? null);

  const filteredQuests = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return questDefinitions;
    return questDefinitions.filter(
      (quest) =>
        quest.displayName.toLowerCase().includes(query) ||
        quest.definitionId.toLowerCase().includes(query)
    );
  }, [questDefinitions, searchQuery]);

  const selectedQuest = useMemo(
    () =>
      questDefinitions.find(
        (quest) => quest.definitionId === effectiveSelectedQuestId
      ) ?? null,
    [effectiveSelectedQuestId, questDefinitions]
  );
  const selectedStage = useMemo(
    () =>
      selectedQuest?.stageDefinitions.find(
        (stage) => stage.stageId === graphStageId
      ) ?? null,
    [selectedQuest, graphStageId]
  );
  const selectedNode = useMemo(
    () =>
      selectedStage?.nodeDefinitions.find(
        (node) => node.nodeId === selectedNodeId
      ) ?? null,
    [selectedStage, selectedNodeId]
  );

  const linkedBehaviorsByStageId = useMemo(() => {
    const links = new Map<
      string,
      Array<{
        regionId: string;
        regionDisplayName: string;
        behaviorId: string;
        behaviorDisplayName: string;
        taskId: string;
        taskDisplayName: string;
        npcDisplayName: string;
      }>
    >();

    for (const region of regions) {
      for (const behavior of region.behaviors) {
        const npcDisplayName =
          npcDefinitions.find(
            (npc) => npc.definitionId === behavior.npcDefinitionId
          )?.displayName ?? "NPC";
        for (const task of behavior.tasks) {
          if (task.activation.questDefinitionId !== effectiveSelectedQuestId) {
            continue;
          }
          const stageKey = task.activation.questStageId ?? "__quest__";
          const stageLinks = links.get(stageKey) ?? [];
          stageLinks.push({
            regionId: region.identity.id,
            regionDisplayName: region.displayName,
            behaviorId: behavior.behaviorId,
            behaviorDisplayName: behavior.displayName,
            taskId: task.taskId,
            taskDisplayName: task.displayName,
            npcDisplayName
          });
          links.set(stageKey, stageLinks);
        }
      }
    }

    return links;
  }, [effectiveSelectedQuestId, npcDefinitions, regions]);

  // Areas across every region, grouped by region, for a location objective's
  // target. A quest is not scoped to one region, so the picker is not either.
  const areaOptionGroups = useMemo(
    () =>
      regions
        .map((region) => ({
          group: region.displayName,
          items: region.areas.map((area) => ({
            value: area.areaId,
            label: area.displayName
          }))
        }))
        .filter((entry) => entry.items.length > 0),
    [regions]
  );

  // Plan 079.7 -- every NPC presence an author can bind a quest stage to:
  // the regions' own residents plus every Scene's overlay placements.
  // Deduped by presenceId; tracks which region owns each and the presence's
  // current condition (to derive checked state in the picker).
  const allNpcPresences = useMemo(() => {
    const seen = new Set<string>();
    const items: Array<{
      presenceId: string;
      regionId: string;
      regionDisplayName: string;
      displayLabel: string;
      condition: {
        questDefinitionId: string | null;
        questStageId: string | null;
      } | null;
    }> = [];
    const addPresence = (
      presence: {
        presenceId: string;
        npcDefinitionId: string;
        placementLabel?: string | null;
        condition?: {
          questDefinitionId: string | null;
          questStageId: string | null;
        } | null;
      },
      regionId: string,
      regionDisplayName: string
    ): void => {
      if (seen.has(presence.presenceId)) return;
      seen.add(presence.presenceId);
      const npcDef = npcDefinitions.find(
        (n) => n.definitionId === presence.npcDefinitionId
      );
      const baseName = npcDef?.displayName ?? presence.npcDefinitionId;
      items.push({
        presenceId: presence.presenceId,
        regionId,
        regionDisplayName,
        displayLabel: presence.placementLabel ?? baseName,
        condition: presence.condition
          ? {
              questDefinitionId: presence.condition.questDefinitionId,
              questStageId: presence.condition.questStageId
            }
          : null
      });
    };
    // Residents first: they are present in every Scene, so they are the
    // most bindable thing in the list.
    for (const region of regions) {
      for (const presence of region.npcPresences) {
        addPresence(presence, region.identity.id, region.displayName);
      }
    }
    for (const scene of getAllScenes(episodes)) {
      const region = regions.find((r) => r.identity.id === scene.regionId);
      const regionDisplayName = region?.displayName ?? scene.regionId;
      for (const presence of scene.overlay.npcPresences) {
        addPresence(presence, scene.regionId, regionDisplayName);
      }
    }
    return items;
  }, [episodes, regions, npcDefinitions]);

  const handleToggleNPCPresence = useCallback(
    (
      presenceId: string,
      regionId: string,
      questDefinitionId: string,
      stageId: string,
      checked: boolean
    ) => {
      onCommand({
        kind: "SetNPCPresenceCondition",
        target: { aggregateKind: "region-document", aggregateId: regionId },
        subject: { subjectKind: "npc-presence", subjectId: presenceId },
        payload: {
          presenceId,
          condition: checked
            ? {
                questDefinitionId,
                questStageId: stageId,
                worldFlagEquals: null
              }
            : null
        }
      });
    },
    [onCommand]
  );

  useEffect(() => {
    if (navigationTarget?.kind !== "quest-stage") {
      return;
    }

    queueMicrotask(() => {
      setSelectedQuestId(navigationTarget.questDefinitionId);
      setGraphStageId(navigationTarget.stageId);
      setSelectedNodeId(null);
      onConsumeNavigationTarget?.();
    });
  }, [navigationTarget, onConsumeNavigationTarget]);

  useEffect(() => {
    selectedQuestRef.current = selectedQuest;
  }, [selectedQuest]);
  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
  }, [selectedNodeId]);

  const commitQuest = useCallback(
    (quest: QuestDefinition) => {
      if (!gameProjectId) return;
      onCommand({
        kind: "UpdateQuestDefinition",
        target: { aggregateKind: "game-project", aggregateId: gameProjectId },
        subject: {
          subjectKind: "quest-definition",
          subjectId: quest.definitionId
        },
        payload: { definition: quest }
      });
    },
    [gameProjectId, onCommand]
  );

  const createQuest = useCallback(() => {
    // A quest happens somewhere: no Scene to put it in means no quest,
    // and the button is disabled rather than creating one that vanishes.
    if (!gameProjectId || !newQuestSceneId) return;
    const definition = createDefaultQuestDefinition();
    onCommand({
      kind: "CreateQuestDefinition",
      target: { aggregateKind: "game-project", aggregateId: gameProjectId },
      subject: {
        subjectKind: "quest-definition",
        subjectId: definition.definitionId
      },
      payload: { definition, sceneId: newQuestSceneId }
    });
    setSelectedQuestId(definition.definitionId);
    setGraphStageId(null);
    setSelectedNodeId(null);
  }, [gameProjectId, newQuestSceneId, onCommand]);

  const deleteQuest = useCallback(
    (definitionId: string) => {
      if (!gameProjectId) return;
      onCommand({
        kind: "DeleteQuestDefinition",
        target: { aggregateKind: "game-project", aggregateId: gameProjectId },
        subject: { subjectKind: "quest-definition", subjectId: definitionId },
        payload: { definitionId }
      });
      if (selectedQuestId === definitionId) {
        setSelectedQuestId(null);
        setGraphStageId(null);
        setSelectedNodeId(null);
      }
    },
    [gameProjectId, onCommand, selectedQuestId]
  );

  const updateStage = useCallback(
    (
      stageId: string,
      updater: (stage: QuestStageDefinition) => QuestStageDefinition
    ) => {
      if (!selectedQuest) return;
      commitQuest({
        ...selectedQuest,
        stageDefinitions: selectedQuest.stageDefinitions.map((stage) =>
          stage.stageId === stageId ? updater(stage) : stage
        )
      });
    },
    [commitQuest, selectedQuest]
  );

  const updateNode = useCallback(
    (node: QuestNodeDefinition) => {
      if (!selectedStage) return;
      updateStage(selectedStage.stageId, (stage) => ({
        ...stage,
        nodeDefinitions: stage.nodeDefinitions.map((candidate) =>
          candidate.nodeId === node.nodeId ? node : candidate
        )
      }));
    },
    [selectedStage, updateStage]
  );

  // Paper cut #1 (docs/backlog/002-authoring-ux-paper-cuts.md) —
  // smooth-flow shortcut for the required Dialogue picker on talk
  // objectives. Opens a modal for naming the placeholder dialogue
  // (default suggestion is NPC-based so hitting Enter accepts).
  // On confirm, creates a dialogue bound to the NPC as its ambient
  // interaction and points the objective node at it. Cancel bails
  // without creating anything. Author stays in the quest graph
  // editor; goes over to the dialogue editor to write actual
  // content whenever.
  const suggestedDialogueName = useMemo(() => {
    if (!newDialogueForNode) return "New Dialogue";
    const npc = newDialogueForNode.targetId
      ? npcDefinitions.find(
          (candidate) => candidate.definitionId === newDialogueForNode.targetId
        )
      : null;
    return npc ? `Talk to ${npc.displayName}` : "New Dialogue";
  }, [newDialogueForNode, npcDefinitions]);

  const openCreateDialogueModal = useCallback(
    (node: QuestNodeDefinition) => {
      const npc = node.targetId
        ? npcDefinitions.find(
            (candidate) => candidate.definitionId === node.targetId
          )
        : null;
      setNewDialogueName(npc ? `Talk to ${npc.displayName}` : "New Dialogue");
      setNewDialogueForNode(node);
    },
    [npcDefinitions]
  );

  const closeCreateDialogueModal = useCallback(() => {
    setNewDialogueForNode(null);
    setNewDialogueName("");
  }, []);

  const confirmCreateDialogueForTalkObjective = useCallback(() => {
    if (!gameProjectId || !newDialogueForNode) return;
    const npc = newDialogueForNode.targetId
      ? npcDefinitions.find(
          (candidate) => candidate.definitionId === newDialogueForNode.targetId
        )
      : null;
    const displayName = newDialogueName.trim() || suggestedDialogueName;
    const definition = createDefaultDialogueDefinition({
      displayName,
      npcDefinitionId: npc?.definitionId ?? null
    });
    onCommand({
      kind: "CreateDialogueDefinition",
      target: { aggregateKind: "game-project", aggregateId: gameProjectId },
      subject: {
        subjectKind: "dialogue-definition",
        subjectId: definition.definitionId
      },
      payload: { definition }
    });
    updateNode({
      ...newDialogueForNode,
      dialogueDefinitionId: definition.definitionId
    });
    closeCreateDialogueModal();
  }, [
    closeCreateDialogueModal,
    gameProjectId,
    newDialogueForNode,
    newDialogueName,
    npcDefinitions,
    onCommand,
    suggestedDialogueName,
    updateNode
  ]);

  const editorNodes = useMemo(
    () =>
      selectedStage
        ? questStageToEditorNodes(selectedStage).map((node) =>
            placeNodeInGroup(node, selectedStage.groups)
          )
        : [],
    [selectedStage]
  );
  const editorGroups = useMemo(
    () => toEditorGroups(selectedStage?.groups),
    [selectedStage]
  );
  const editorEdges = useMemo(
    () => (selectedStage ? questStageToEditorEdges(selectedStage) : []),
    [selectedStage]
  );

  // One drag, one write. Nodes and frames used to be recorded by two separate
  // calls built from the same starting stage, so whichever landed second threw
  // away the other's half. A node whose frame is also being dragged is never
  // reported as moved itself, so the two lists never overlap.
  const handleMoved = useCallback(
    (moved: {
      nodes: GraphEditorNodeMove[];
      groups: GraphEditorNodeMove[];
    }) => {
      if (!selectedStage) return;
      // A node inside a frame reports a position relative to it; the document
      // stores absolute positions.
      const absolute = moved.nodes.map((move) => ({
        id: move.id,
        position: toAbsolutePosition(
          move.position,
          move.parentId,
          selectedStage.groups
        )
      }));

      updateStage(selectedStage.stageId, (stage) => {
        // A frame takes its members with it: the editor reports only the frame's
        // own new position, so the members are shifted by the same delta here or
        // they would spring back on the next load.
        let next = stage;
        for (const move of moved.groups) {
          const group = (next.groups ?? []).find(
            (candidate) => candidate.groupId === move.id
          );
          if (!group) continue;
          const { dx, dy } = shiftGroupMembers(group, move.position);
          next = {
            ...next,
            groups: (next.groups ?? []).map((candidate) =>
              candidate.groupId === move.id
                ? { ...candidate, position: { ...move.position } }
                : candidate
            ),
            nodeDefinitions: next.nodeDefinitions.map((node) =>
              group.memberNodeIds.includes(node.nodeId)
                ? {
                    ...node,
                    graphPosition: {
                      x: node.graphPosition.x + dx,
                      y: node.graphPosition.y + dy
                    }
                  }
                : node
            )
          };
        }

        if (absolute.length === 0) return next;

        // Where a node was dropped decides which frame it belongs to.
        let groups = next.groups ?? [];
        for (const move of absolute) {
          groups = resolveMembership(groups, move.id, move.position);
        }
        const withNodes = applyNodeMoves(next, absolute);
        return membershipChanged(next.groups, groups)
          ? { ...withNodes, groups }
          : withNodes;
      });
    },
    [selectedStage, updateStage]
  );

  const handleGroupRenamed = useCallback(
    (groupId: string, label: string) => {
      if (!selectedStage) return;
      updateStage(selectedStage.stageId, (stage) => ({
        ...stage,
        groups: (stage.groups ?? []).map((group) =>
          group.groupId === groupId ? { ...group, label } : group
        )
      }));
    },
    [selectedStage, updateStage]
  );

  // Removing a frame leaves its members exactly where they are.
  const handleGroupsDeleted = useCallback(
    (groupIds: string[]) => {
      if (!selectedStage) return;
      updateStage(selectedStage.stageId, (stage) => ({
        ...stage,
        groups: (stage.groups ?? []).filter(
          (group) => !groupIds.includes(group.groupId)
        )
      }));
    },
    [selectedStage, updateStage]
  );

  const handleGraphConnect = useCallback(
    (connection: GraphEditorConnection) => {
      if (!selectedStage) return;
      updateStage(selectedStage.stageId, (stage) =>
        connectNodes(stage, connection)
      );
    },
    [selectedStage, updateStage]
  );

  const handleEdgesDeleted = useCallback(
    (edgeIds: string[]) => {
      if (!selectedStage) return;
      updateStage(selectedStage.stageId, (stage) =>
        disconnectEdges(stage, edgeIds)
      );
    },
    [selectedStage, updateStage]
  );

  const handleNodesDeleted = useCallback(
    (nodeIds: string[]) => {
      if (!selectedStage) return;
      updateStage(selectedStage.stageId, (stage) =>
        deleteNodes(stage, nodeIds)
      );
      if (selectedNodeId && nodeIds.includes(selectedNodeId)) {
        setSelectedNodeId(null);
      }
    },
    [selectedNodeId, selectedStage, updateStage]
  );

  const [graphSelection, setGraphSelection] = useState<{
    nodeIds: string[];
    groupIds: string[];
    edgeIds: string[];
  }>({ nodeIds: [], groupIds: [], edgeIds: [] });

  const addNode = useCallback(
    (behavior: string) => {
      if (!selectedStage) return;
      const item = QUEST_NODE_MENU_ITEMS.find(
        (candidate) => candidate.id === behavior
      );
      if (!item) return;
      const node = createDefaultQuestNodeDefinition({
        nodeId: createQuestNodeId(),
        nodeBehavior: item.id,
        displayName: item.label,
        description: item.description,
        graphPosition: createNextNodePosition(selectedStage)
      });
      updateStage(selectedStage.stageId, (stage) => ({
        ...stage,
        nodeDefinitions: [...stage.nodeDefinitions, node],
        entryNodeIds:
          node.prerequisiteNodeIds.length === 0
            ? [...stage.entryNodeIds, node.nodeId]
            : stage.entryNodeIds
      }));
      setSelectedNodeId(node.nodeId);
    },
    [selectedStage, updateStage]
  );

  // No delete guard here: a stage can be emptied completely. Entry nodes are
  // derived from whatever has no prerequisites, so removing any node leaves a
  // stage that still means something. The quest inspector's validation panel
  // reports an empty stage as a warning.

  const groupSelection = useCallback(() => {
    if (!selectedStage) return;
    const memberNodeIds = graphSelection.nodeIds;
    if (memberNodeIds.length < 2) return;
    const positions = selectedStage.nodeDefinitions
      .filter((node) => memberNodeIds.includes(node.nodeId))
      .map((node) => node.graphPosition);
    const frame = frameAround(positions);
    updateStage(selectedStage.stageId, (stage) => ({
      ...stage,
      groups: addGroup(
        stage.groups,
        createNodeGroup({
          label: "Group",
          memberNodeIds,
          position: frame.position,
          size: frame.size
        })
      )
    }));
  }, [graphSelection.nodeIds, selectedStage, updateStage]);

  const hasGraphSelection =
    graphSelection.nodeIds.length +
      graphSelection.groupIds.length +
      graphSelection.edgeIds.length >
    0;

  const questGraphChrome = (
    <Group gap={6} align="center">
      <AddNodeMenu items={QUEST_NODE_MENU_ITEMS} onSelect={addNode} />
      <Button
        size="xs"
        variant="light"
        disabled={graphSelection.nodeIds.length < 2}
        onClick={groupSelection}
      >
        Group
      </Button>
      <Button
        size="xs"
        variant="light"
        color="red"
        disabled={!hasGraphSelection}
        onClick={() => graphEditorRef.current?.deleteSelection()}
      >
        Delete
      </Button>
    </Group>
  );

  const leftPanel = (
    <Stack
      gap={0}
      h="100%"
      style={{ minHeight: 0 }}
      onClick={() => setContextMenuQuestId(null)}
    >
      <Group
        justify="space-between"
        px="md"
        py="sm"
        style={{ borderBottom: "1px solid var(--sm-panel-border)" }}
      >
        <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
          Quests
        </Text>
        <Group gap={6} wrap="nowrap">
          {/* Which Scene a new quest happens in -- shown, not inferred
              from whatever was last selected elsewhere. */}
          <Select
            size="xs"
            aria-label="New quest in Scene"
            placeholder="No Scenes"
            style={{ width: 150 }}
            data={storyScenes.map((scene) => ({
              value: scene.sceneId,
              label: scene.displayName
            }))}
            value={newQuestSceneId}
            disabled={storyScenes.length === 0}
            onChange={(value) => setNewQuestSceneId(value)}
          />
          <Tooltip
            label={
              storyScenes.length === 0
                ? "Add a Scene first -- a quest happens in one"
                : "Add Quest"
            }
          >
            <ActionIcon
              variant="subtle"
              size="sm"
              onClick={createQuest}
              disabled={!newQuestSceneId}
              aria-label="Add Quest"
            >
              +
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      <Box p="sm" style={{ borderBottom: "1px solid var(--sm-panel-border)" }}>
        <TextInput
          size="xs"
          placeholder="Search quests..."
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.currentTarget.value)}
        />
      </Box>
      <ScrollArea style={{ flex: 1, minHeight: 0 }}>
        <Stack gap={4} p="xs">
          {filteredQuests.map((quest) => {
            const warnings = validateQuest(quest);
            const opened = contextMenuQuestId === quest.definitionId;
            return (
              <Menu
                key={quest.definitionId}
                opened={opened}
                onChange={(next) =>
                  setContextMenuQuestId(next ? quest.definitionId : null)
                }
                withinPortal
              >
                <Menu.Target>
                  <Paper
                    p="sm"
                    onClick={() => {
                      setSelectedQuestId(quest.definitionId);
                      setGraphStageId(null);
                      setSelectedNodeId(null);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setSelectedQuestId(quest.definitionId);
                      setContextMenuQuestId(quest.definitionId);
                    }}
                    style={{
                      cursor: "pointer",
                      background:
                        effectiveSelectedQuestId === quest.definitionId
                          ? "var(--sm-active-bg)"
                          : "#1e1e2e",
                      border:
                        effectiveSelectedQuestId === quest.definitionId
                          ? "1px solid var(--sm-accent-blue)"
                          : "1px solid transparent"
                    }}
                  >
                    <Group
                      justify="space-between"
                      align="flex-start"
                      gap="xs"
                      wrap="nowrap"
                    >
                      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                        <Text size="sm" fw={500} truncate>
                          {quest.displayName}
                        </Text>
                        <Group gap={6}>
                          <Text size="xs" c="dimmed">
                            {quest.stageDefinitions.length} stages
                          </Text>
                          {warnings.length > 0 && (
                            <Badge size="xs" color="red">
                              {warnings.length}
                            </Badge>
                          )}
                        </Group>
                      </Stack>
                    </Group>
                  </Paper>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item
                    color="red"
                    onClick={() => deleteQuest(quest.definitionId)}
                  >
                    Delete
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            );
          })}
        </Stack>
      </ScrollArea>
    </Stack>
  );

  const centerPanel = selectedQuest ? (
    graphStageId && selectedStage ? (
      <Stack gap={0} h="100%" style={{ minHeight: 0 }}>
        <Group
          justify="space-between"
          px="md"
          py="sm"
          style={{
            borderBottom: "1px solid var(--sm-panel-border)",
            background: "#181825"
          }}
        >
          <Group gap="xs">
            <Button
              size="xs"
              variant="subtle"
              onClick={() => {
                setGraphStageId(null);
                setSelectedNodeId(null);
              }}
            >
              ← Back
            </Button>
            <Text size="sm" fw={600}>
              {selectedQuest.displayName} / {selectedStage.displayName}
            </Text>
          </Group>
        </Group>
        <Box style={{ flex: 1, minHeight: 0, position: "relative" }}>
          {/* Only mounted while this workspace is the active one, matching what
              the previous canvas did -- an inactive workspace should not hold a
              live editor. */}
          {isActive ? (
            <NodeEditor
              ref={graphEditorRef}
              nodes={editorNodes}
              edges={editorEdges}
              renderers={QUEST_NODE_RENDERERS}
              primarySelectionId={selectedNodeId}
              onPrimarySelectionChange={setSelectedNodeId}
              groups={editorGroups}
              onMoved={handleMoved}
              onGroupRenamed={handleGroupRenamed}
              onGroupsDeleted={handleGroupsDeleted}
              onConnect={handleGraphConnect}
              onNodesDeleted={handleNodesDeleted}
              onEdgesDeleted={handleEdgesDeleted}
              onSelectionChange={setGraphSelection}
              chrome={questGraphChrome}
            />
          ) : null}
        </Box>
      </Stack>
    ) : (
      <Stack gap={0} h="100%" style={{ minHeight: 0 }}>
        <Paper
          p="lg"
          radius={0}
          style={{
            background: "linear-gradient(135deg, #1e1e2e 0%, #181825 100%)",
            borderBottom: "1px solid #313244"
          }}
        >
          <Group justify="space-between" align="flex-start">
            <Stack gap={4}>
              <Text size="xl" fw={700}>
                {selectedQuest.displayName}
              </Text>
              <Text size="sm" c="dimmed">
                {selectedQuest.description}
              </Text>
              <Group gap="xs">
                <Badge size="sm" variant="light" color="blue">
                  {selectedQuest.stageDefinitions.length} stages
                </Badge>
                <Badge size="sm" variant="light" color="grape">
                  {selectedQuest.rewardDefinitions.length} rewards
                </Badge>
              </Group>
            </Stack>
            <Button
              size="xs"
              variant="light"
              onClick={() => {
                const stage = createDefaultQuestStageDefinition({
                  displayName: `Stage ${selectedQuest.stageDefinitions.length + 1}`
                });
                const previousLastStage =
                  selectedQuest.stageDefinitions[
                    selectedQuest.stageDefinitions.length - 1
                  ] ?? null;
                commitQuest({
                  ...selectedQuest,
                  stageDefinitions: selectedQuest.stageDefinitions
                    .map((candidate) =>
                      previousLastStage &&
                      candidate.stageId === previousLastStage.stageId &&
                      !candidate.nextStageId
                        ? { ...candidate, nextStageId: stage.stageId }
                        : candidate
                    )
                    .concat(stage)
                });
              }}
            >
              + Add Stage
            </Button>
          </Group>
        </Paper>
        <ScrollArea style={{ flex: 1, minHeight: 0 }}>
          <Stack p="lg" gap="md">
            {selectedQuest.stageDefinitions.map((stage, index) => (
              <Paper
                key={stage.stageId}
                p="md"
                style={{
                  background: "#181825",
                  border:
                    selectedQuest.startStageId === stage.stageId
                      ? "2px solid #a6e3a1"
                      : "1px solid #313244"
                }}
              >
                <Group justify="space-between" align="flex-start">
                  <Stack gap={4} style={{ flex: 1 }}>
                    <Group gap="xs">
                      {selectedQuest.startStageId === stage.stageId && (
                        <Text c="#a6e3a1">▶</Text>
                      )}
                      <Text fw={600}>{stage.displayName}</Text>
                      <Badge size="xs" variant="light">
                        {stage.nodeDefinitions.length} nodes
                      </Badge>
                      {(linkedBehaviorsByStageId.get(stage.stageId)?.length ??
                        0) > 0 && (
                        <Badge size="xs" variant="light" color="grape">
                          {linkedBehaviorsByStageId.get(stage.stageId)?.length}{" "}
                          linked tasks
                        </Badge>
                      )}
                    </Group>
                    <MiniStageGraph stage={stage} />
                    {stage.nextStageId && (
                      <Text size="xs" c="dimmed">
                        Next →{" "}
                        {selectedQuest.stageDefinitions.find(
                          (candidate) => candidate.stageId === stage.nextStageId
                        )?.displayName ?? stage.nextStageId}
                      </Text>
                    )}
                  </Stack>
                  <Group gap="xs">
                    <Button
                      size="xs"
                      variant="subtle"
                      onClick={() => {
                        setGraphStageId(stage.stageId);
                        setSelectedNodeId(null);
                      }}
                    >
                      Open Graph
                    </Button>
                    <Button
                      size="xs"
                      variant="subtle"
                      onClick={() => {
                        setGraphStageId(null);
                        setSelectedNodeId(null);
                      }}
                    >
                      Select
                    </Button>
                    {(linkedBehaviorsByStageId.get(stage.stageId)?.length ??
                      0) > 0 && (
                      <Button
                        size="xs"
                        variant="subtle"
                        onClick={() => {
                          const firstLinkedTask = linkedBehaviorsByStageId.get(
                            stage.stageId
                          )?.[0];
                          if (!firstLinkedTask) {
                            return;
                          }
                          onNavigateToTarget?.({
                            kind: "behavior-task",
                            regionId: firstLinkedTask.regionId,
                            behaviorId: firstLinkedTask.behaviorId,
                            taskId: firstLinkedTask.taskId
                          });
                        }}
                      >
                        Open Linked Task
                      </Button>
                    )}
                  </Group>
                </Group>
                {index < selectedQuest.stageDefinitions.length - 1 && (
                  <Text mt="sm" c="dimmed">
                    →
                  </Text>
                )}
              </Paper>
            ))}

            {validateQuest(selectedQuest).length > 0 && (
              <Paper
                p="md"
                style={{ background: "#f38ba822", border: "1px solid #f38ba8" }}
              >
                <Text size="sm" fw={600} c="#f38ba8" mb="xs">
                  Validation
                </Text>
                <Stack gap={4}>
                  {validateQuest(selectedQuest).map((issue, index) => (
                    <Text key={`${issue.message}:${index}`} size="sm" c="#f38ba8">
                      • {issue.message}
                    </Text>
                  ))}
                </Stack>
              </Paper>
            )}
          </Stack>
        </ScrollArea>
      </Stack>
    )
  ) : (
    <Stack align="center" justify="center" h="100%" gap="md">
      <Text size="xl">📜</Text>
      <Text c="dimmed">Select a quest to edit</Text>
      <Text size="sm" c="dimmed" ta="center" maw={320}>
        Choose a quest from the left panel, or create a new one with the +
        button.
      </Text>
    </Stack>
  );

  const rightPanel = (
    <>
      <Modal
        opened={newDialogueForNode !== null}
        onClose={closeCreateDialogueModal}
        title="Create placeholder dialogue"
        size="sm"
      >
        <Stack gap="sm">
          <TextInput
            label="Dialogue name"
            placeholder={suggestedDialogueName}
            value={newDialogueName}
            onChange={(event) => setNewDialogueName(event.currentTarget.value)}
            data-autofocus
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                confirmCreateDialogueForTalkObjective();
              }
            }}
          />
          <Text size="xs" c="var(--sm-color-subtext)">
            A placeholder dialogue with this name will be created and linked.
            Edit the actual dialogue content over in the Dialogue workspace
            whenever.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={closeCreateDialogueModal}>
              Cancel
            </Button>
            <Button onClick={confirmCreateDialogueForTalkObjective}>
              Create
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Inspector
        selectionLabel={
          selectedNode
            ? selectedNode.displayName
            : selectedStage
              ? selectedStage.displayName
              : (selectedQuest?.displayName ?? null)
        }
        selectionIcon={selectedNode ? "🧩" : selectedStage ? "🪜" : "📜"}
      >
        {selectedQuest && !selectedStage && !selectedNode && (
          <Stack gap="md">
            <TextInput
              label="Name"
              value={selectedQuest.displayName}
              onChange={(event) =>
                commitQuest({
                  ...selectedQuest,
                  displayName: event.currentTarget.value
                })
              }
            />
            {/* Where this quest happens. The Scene HOLDS its quests
                (epic #226), so this is the same operation the Scene's
                own quest list performs -- one command, two doors. */}
            <Select
              label="Scene"
              description="The Scene this quest happens in"
              data={storyScenes.map((scene) => ({
                value: scene.sceneId,
                label: scene.displayName
              }))}
              value={
                findSceneByQuestDefinitionId(
                  episodes,
                  selectedQuest.definitionId
                )?.sceneId ?? null
              }
              allowDeselect={false}
              onChange={(value) => {
                if (!value || !gameProjectId) return;
                onCommand({
                  kind: "MoveQuestToScene",
                  target: {
                    aggregateKind: "game-project",
                    aggregateId: gameProjectId
                  },
                  subject: {
                    subjectKind: "quest-definition",
                    subjectId: selectedQuest.definitionId
                  },
                  payload: {
                    questDefinitionId: selectedQuest.definitionId,
                    toSceneId: value
                  }
                });
              }}
            />
            {/* When this quest starts on its own. Unticked means at boot,
                which is what every quest did before conditions existed. */}
            <Checkbox
              size="xs"
              label="Starts on a condition"
              checked={selectedQuest.startCondition !== undefined}
              onChange={(event) =>
                commitQuest({
                  ...selectedQuest,
                  startCondition: event.currentTarget.checked
                    ? createWorldFlagCondition()
                    : undefined
                })
              }
            />
            {selectedQuest.startCondition && (
              <QuestConditionEditor
                condition={selectedQuest.startCondition}
                spellDefinitions={spellDefinitions}
                questDefinitions={questDefinitions}
                excludeQuestDefinitionId={selectedQuest.definitionId}
                onChange={(startCondition) =>
                  commitQuest({ ...selectedQuest, startCondition })
                }
              />
            )}
            <Textarea
              label="Description"
              value={selectedQuest.description}
              autosize
              minRows={4}
              onChange={(event) =>
                commitQuest({
                  ...selectedQuest,
                  description: event.currentTarget.value
                })
              }
            />
            <Stack gap="xs">
              <Text
                size="xs"
                fw={600}
                tt="uppercase"
                c="var(--sm-color-subtext)"
              >
                Linked Behavior Tasks
              </Text>
              {(linkedBehaviorsByStageId.get("__quest__")?.length ?? 0) ===
              0 ? (
                <Text size="xs" c="dimmed">
                  No region behavior tasks currently reference this quest
                  outside a specific stage.
                </Text>
              ) : (
                linkedBehaviorsByStageId.get("__quest__")!.map((link) => (
                  <Paper
                    key={`${link.regionId}:${link.behaviorId}:${link.taskId}`}
                    p="xs"
                    style={{ background: "#181825" }}
                  >
                    <Group justify="space-between" align="center" gap="xs">
                      <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                        <Text size="xs" fw={600} truncate>
                          {link.taskDisplayName}
                        </Text>
                        <Text size="xs" c="dimmed" truncate>
                          {link.npcDisplayName} · {link.regionDisplayName}
                        </Text>
                      </Stack>
                      <Button
                        size="xs"
                        variant="subtle"
                        onClick={() =>
                          onNavigateToTarget?.({
                            kind: "behavior-task",
                            regionId: link.regionId,
                            behaviorId: link.behaviorId,
                            taskId: link.taskId
                          })
                        }
                      >
                        Open
                      </Button>
                    </Group>
                  </Paper>
                ))
              )}
            </Stack>
          </Stack>
        )}

        {selectedQuest && selectedStage && !selectedNode && (
          <Stack gap="md">
            <TextInput
              label="Stage Name"
              value={selectedStage.displayName}
              onChange={(event) =>
                updateStage(selectedStage.stageId, (stage) => ({
                  ...stage,
                  displayName: event.currentTarget.value
                }))
              }
            />
            <Select
              label="Next Stage"
              clearable
              value={selectedStage.nextStageId}
              data={selectedQuest.stageDefinitions
                .filter((stage) => stage.stageId !== selectedStage.stageId)
                .map((stage) => ({
                  value: stage.stageId,
                  label: stage.displayName
                }))}
              onChange={(value) =>
                updateStage(selectedStage.stageId, (stage) => ({
                  ...stage,
                  nextStageId: value ?? null
                }))
              }
            />
            <Select
              label="Time of Day"
              clearable
              placeholder="Leave the clock alone"
              value={selectedStage.timeOfDay}
              data={STAGE_TIME_OF_DAY_OPTIONS}
              onChange={(value) =>
                updateStage(selectedStage.stageId, (stage) => ({
                  ...stage,
                  timeOfDay: (value as TimeOfDayBand | null) ?? null
                }))
              }
            />
            <Switch
              label="Start Stage"
              checked={selectedQuest.startStageId === selectedStage.stageId}
              onChange={(event) => {
                if (!event.currentTarget.checked) return;
                commitQuest({
                  ...selectedQuest,
                  startStageId: selectedStage.stageId
                });
              }}
            />
            <Stack gap="xs">
              <Text
                size="xs"
                fw={600}
                tt="uppercase"
                c="var(--sm-color-subtext)"
              >
                Linked Behavior Tasks
              </Text>
              {(linkedBehaviorsByStageId.get(selectedStage.stageId)?.length ??
                0) === 0 ? (
                <Text size="xs" c="dimmed">
                  No NPC behavior tasks currently reference this quest stage.
                </Text>
              ) : (
                linkedBehaviorsByStageId
                  .get(selectedStage.stageId)!
                  .map((link) => (
                    <Paper
                      key={`${link.regionId}:${link.behaviorId}:${link.taskId}`}
                      p="xs"
                      style={{ background: "#181825" }}
                    >
                      <Group justify="space-between" align="center" gap="xs">
                        <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                          <Text size="xs" fw={600} truncate>
                            {link.taskDisplayName}
                          </Text>
                          <Text size="xs" c="dimmed" truncate>
                            {link.npcDisplayName} · {link.regionDisplayName}
                          </Text>
                        </Stack>
                        <Button
                          size="xs"
                          variant="subtle"
                          onClick={() =>
                            onNavigateToTarget?.({
                              kind: "behavior-task",
                              regionId: link.regionId,
                              behaviorId: link.behaviorId,
                              taskId: link.taskId
                            })
                          }
                        >
                          Open
                        </Button>
                      </Group>
                    </Paper>
                  ))
              )}
            </Stack>
            {allNpcPresences.length > 0 && (
              <Stack gap="xs">
                <Text
                  size="xs"
                  fw={600}
                  tt="uppercase"
                  c="var(--sm-color-subtext)"
                >
                  NPCs visible in this stage
                </Text>
                {allNpcPresences.map((item) => {
                  const isChecked =
                    item.condition?.questDefinitionId ===
                      selectedQuest.definitionId &&
                    item.condition?.questStageId === selectedStage.stageId;
                  return (
                    <Group key={item.presenceId} gap="xs" wrap="nowrap">
                      <Checkbox
                        checked={isChecked}
                        onChange={(e) =>
                          handleToggleNPCPresence(
                            item.presenceId,
                            item.regionId,
                            selectedQuest.definitionId,
                            selectedStage.stageId,
                            e.currentTarget.checked
                          )
                        }
                      />
                      <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                        <Text size="xs" fw={600} truncate>
                          {item.displayLabel}
                        </Text>
                        <Text size="xs" c="dimmed" truncate>
                          {item.regionDisplayName}
                        </Text>
                      </Stack>
                    </Group>
                  );
                })}
              </Stack>
            )}
            <Button
              color="red"
              variant="light"
              disabled={selectedQuest.stageDefinitions.length <= 1}
              onClick={() => {
                const remainingStages = selectedQuest.stageDefinitions.filter(
                  (stage) => stage.stageId !== selectedStage.stageId
                );
                const nextStartStageId =
                  selectedQuest.startStageId === selectedStage.stageId
                    ? (remainingStages[0]?.stageId ??
                      selectedQuest.startStageId)
                    : selectedQuest.startStageId;
                commitQuest({
                  ...selectedQuest,
                  startStageId: nextStartStageId,
                  stageDefinitions: remainingStages.map((stage) => ({
                    ...stage,
                    nextStageId:
                      stage.nextStageId === selectedStage.stageId
                        ? null
                        : stage.nextStageId
                  }))
                });
                setGraphStageId(null);
                setSelectedNodeId(null);
              }}
            >
              Delete Stage
            </Button>
          </Stack>
        )}

        {selectedQuest && selectedStage && selectedNode && (
          <Stack gap="md">
            <TextInput
              label="Node Name"
              value={selectedNode.displayName}
              onChange={(event) =>
                updateNode({
                  ...selectedNode,
                  displayName: event.currentTarget.value
                })
              }
            />
            <Textarea
              label="Description"
              value={selectedNode.description}
              autosize
              minRows={3}
              onChange={(event) =>
                updateNode({
                  ...selectedNode,
                  description: event.currentTarget.value
                })
              }
            />
            <Select
              label="Node Behavior"
              value={selectedNode.nodeBehavior}
              data={[
                { value: "objective", label: "Objective" },
                { value: "narrative", label: "Narrative" },
                { value: "condition", label: "Condition" },
                { value: "branch", label: "Branch" }
              ]}
              onChange={(value) => {
                if (!value) return;
                updateNode({
                  ...selectedNode,
                  nodeBehavior: value as QuestNodeBehavior,
                  showInHud: value === "objective",
                  objectiveSubtype:
                    value === "objective"
                      ? (selectedNode.objectiveSubtype ?? "talk")
                      : undefined,
                  narrativeSubtype:
                    value === "narrative"
                      ? (selectedNode.narrativeSubtype ?? "dialogue")
                      : undefined,
                  condition:
                    value === "condition" || value === "branch"
                      ? (selectedNode.condition ?? createWorldFlagCondition())
                      : undefined,
                  failTargetNodeIds:
                    value === "branch" ? selectedNode.failTargetNodeIds : []
                });
              }}
            />

            {selectedNode.nodeBehavior === "objective" && (
              <>
                <Select
                  label="Objective Type"
                  value={selectedNode.objectiveSubtype ?? "talk"}
                  data={[
                    { value: "talk", label: "Talk" },
                    { value: "location", label: "Location" },
                    { value: "collect", label: "Collect" },
                    { value: "castSpell", label: "Cast Spell" },
                    { value: "assessment", label: "Assessment" },
                    { value: "awaitEvent", label: "Await Event" }
                  ]}
                  onChange={(value) =>
                    value &&
                    updateNode({
                      ...selectedNode,
                      objectiveSubtype:
                        value as QuestNodeDefinition["objectiveSubtype"]
                    })
                  }
                />
                {selectedNode.objectiveSubtype === "location" ? (
                  <Select
                    label="Target Area"
                    clearable
                    searchable
                    placeholder="Pick an area"
                    data={areaOptionGroups}
                    value={selectedNode.targetAreaId ?? null}
                    onChange={(value) =>
                      updateNode({
                        ...selectedNode,
                        targetAreaId: value ?? undefined
                      })
                    }
                  />
                ) : (
                <Select
                  label={
                    selectedNode.objectiveSubtype === "collect"
                      ? "Target Item"
                      : selectedNode.objectiveSubtype === "castSpell"
                        ? "Target Spell"
                        : "Target NPC"
                  }
                  clearable
                  value={selectedNode.targetId ?? null}
                  data={
                    selectedNode.objectiveSubtype === "collect"
                      ? itemDefinitions.map((item) => ({
                          value: item.definitionId,
                          label: item.displayName
                        }))
                      : selectedNode.objectiveSubtype === "castSpell"
                        ? spellDefinitions.map((spell) => ({
                            value: spell.definitionId,
                            label: spell.displayName
                          }))
                        : npcDefinitions.map((npc) => ({
                            value: npc.definitionId,
                            label: npc.displayName
                          }))
                  }
                  onChange={(value) =>
                    updateNode({
                      ...selectedNode,
                      targetId: value ?? undefined
                    })
                  }
                />
                )}
                {selectedNode.objectiveSubtype === "awaitEvent" && (
                  <TextInput
                    label="Completes On Event"
                    description="An emitEvent action firing this name completes the objective."
                    value={selectedNode.eventName ?? ""}
                    onChange={(event) =>
                      updateNode({
                        ...selectedNode,
                        eventName: event.currentTarget.value || undefined
                      })
                    }
                  />
                )}
                {selectedNode.objectiveSubtype === "talk" && (
                  <>
                    <Select
                      label="Dialogue"
                      required
                      value={selectedNode.dialogueDefinitionId ?? null}
                      error={
                        selectedNode.dialogueDefinitionId
                          ? undefined
                          : "Pick a dialogue or create one below."
                      }
                      data={[
                        { value: "__add_new__", label: "+ Add New Dialogue" },
                        ...dialogueDefinitions.map((dialogue) => ({
                          value: dialogue.definitionId,
                          label: dialogue.displayName
                        }))
                      ]}
                      onChange={(value) => {
                        if (value === "__add_new__") {
                          openCreateDialogueModal(selectedNode);
                          return;
                        }
                        updateNode({
                          ...selectedNode,
                          dialogueDefinitionId: value ?? undefined
                        });
                      }}
                    />
                    <TextInput
                      label="Complete On"
                      placeholder="dialogueEnd or node id"
                      value={selectedNode.completeOn ?? ""}
                      onChange={(event) =>
                        updateNode({
                          ...selectedNode,
                          completeOn: event.currentTarget.value || undefined
                        })
                      }
                    />
                  </>
                )}
                <NumberInput
                  label="Count"
                  min={1}
                  value={selectedNode.count ?? 1}
                  onChange={(value) =>
                    updateNode({
                      ...selectedNode,
                      count: typeof value === "number" ? value : 1
                    })
                  }
                />
                <Switch
                  label="Optional"
                  checked={selectedNode.optional ?? false}
                  onChange={(event) =>
                    updateNode({
                      ...selectedNode,
                      optional: event.currentTarget.checked
                    })
                  }
                />
                <Switch
                  label="Show In HUD"
                  checked={selectedNode.showInHud}
                  onChange={(event) =>
                    updateNode({
                      ...selectedNode,
                      showInHud: event.currentTarget.checked
                    })
                  }
                />
              </>
            )}

            {selectedNode.nodeBehavior === "narrative" && (
              <>
                <Select
                  label="Narrative Type"
                  value={selectedNode.narrativeSubtype ?? "dialogue"}
                  data={[
                    { value: "dialogue", label: "Dialogue" },
                    { value: "voiceover", label: "Voiceover" },
                    { value: "cutscene", label: "Cutscene" }
                  ]}
                  onChange={(value) =>
                    value &&
                    updateNode({
                      ...selectedNode,
                      narrativeSubtype:
                        value as QuestNodeDefinition["narrativeSubtype"]
                    })
                  }
                />
                {selectedNode.narrativeSubtype === "dialogue" && (
                  <Select
                    label="Dialogue"
                    clearable
                    value={selectedNode.dialogueDefinitionId ?? null}
                    data={dialogueDefinitions.map((dialogue) => ({
                      value: dialogue.definitionId,
                      label: dialogue.displayName
                    }))}
                    onChange={(value) =>
                      updateNode({
                        ...selectedNode,
                        dialogueDefinitionId: value ?? undefined
                      })
                    }
                  />
                )}
                {selectedNode.narrativeSubtype === "voiceover" && (
                  <Textarea
                    label="Voiceover Text"
                    value={selectedNode.voiceoverText ?? ""}
                    autosize
                    minRows={3}
                    onChange={(event) =>
                      updateNode({
                        ...selectedNode,
                        voiceoverText: event.currentTarget.value || undefined
                      })
                    }
                  />
                )}
              </>
            )}

            {(selectedNode.nodeBehavior === "condition" ||
              selectedNode.nodeBehavior === "branch") && (
              <QuestConditionEditor
                condition={
                  selectedNode.condition ?? createWorldFlagCondition()
                }
                spellDefinitions={spellDefinitions}
                questDefinitions={questDefinitions}
                onChange={(condition) =>
                  updateNode({ ...selectedNode, condition })
                }
              />
            )}

            {selectedNode.nodeBehavior === "branch" && (
              <Text size="xs" c="dimmed">
                Drag from the branch node's fail port to create dashed fail
                edges.
              </Text>
            )}

            <QuestActionsEditor
              label="On Enter"
              actions={selectedNode.onEnterActions}
              itemDefinitions={itemDefinitions}
              npcDefinitions={npcDefinitions}
              episodes={episodes}
              soundCueDefinitions={soundCueDefinitions}
              onChange={(onEnterActions) =>
                updateNode({ ...selectedNode, onEnterActions })
              }
            />
            <QuestActionsEditor
              label="On Complete"
              actions={selectedNode.onCompleteActions}
              itemDefinitions={itemDefinitions}
              npcDefinitions={npcDefinitions}
              episodes={episodes}
              soundCueDefinitions={soundCueDefinitions}
              onChange={(onCompleteActions) =>
                updateNode({ ...selectedNode, onCompleteActions })
              }
            />
          </Stack>
        )}

        {renderInspectorSections?.({
          selectedQuest,
          updateQuest: commitQuest,
          selectedQuestNode: selectedNode
        }) ?? null}
      </Inspector>
    </>
  );

  return {
    leftPanel,
    rightPanel,
    centerPanel,
    viewportOverlay: null
  };
}
