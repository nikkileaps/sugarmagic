import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Menu,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  Tooltip
} from "@mantine/core";
import type {
  DialogueCondition,
  DialogueDefinition,
  DialogueEdgeDefinition,
  DialogueNodeDefinition,
  ItemDefinition,
  NPCDefinition,
  SpellDefinition,
  SemanticCommand
} from "@sugarmagic/domain";
import {
  BUILT_IN_DIALOGUE_SPEAKERS,
  EXCERPT_SPEAKER,
  createDefaultDialogueDefinition,
  createDialogueNodeId,
  createNodeGroup
} from "@sugarmagic/domain";
import { AddNodeMenu, Inspector, WarnToast } from "@sugarmagic/ui";
import {
  NodeEditor,
  type GraphEditorConnection,
  type GraphEditorHandle,
  type GraphEditorNodeMove
} from "@sugarmagic/ui/node-editor";
import {
  DIALOGUE_NODE_KIND,
  applyDialogueNodeMoves,
  canDeleteDialogueNodes,
  connectDialogueNodes,
  deleteDialogueNodes,
  dialogueToEditorEdges,
  dialogueToEditorNodes,
  disconnectDialogueEdges
} from "./dialogue-graph";
import { DialogueNodeCard } from "./DialogueNodeCard";
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
import type { WorkspaceViewContribution } from "../workspace-view";

const NODE_SPACING_Y = 150;

export interface DialogueWorkspaceViewProps {
  isActive: boolean;
  gameProjectId: string | null;
  dialogueDefinitions: DialogueDefinition[];
  itemDefinitions: ItemDefinition[];
  npcDefinitions: NPCDefinition[];
  spellDefinitions: SpellDefinition[];
  onCommand: (command: SemanticCommand) => void;
  renderDialogueInspectorSections?: (context: {
    selectedDialogue: DialogueDefinition | null;
    selectedDialogueNode: DialogueNodeDefinition | null;
    updateDialogueNode: (node: DialogueNodeDefinition) => void;
  }) => ReactNode;
}

function createNextNodePosition(dialogue: DialogueDefinition) {
  const maxY = dialogue.nodes.reduce(
    (current, node) => Math.max(current, node.graphPosition.y),
    0
  );
  return {
    x: 80,
    y: maxY + NODE_SPACING_Y
  };
}

const DIALOGUE_NODE_RENDERERS = { [DIALOGUE_NODE_KIND]: DialogueNodeCard };

function speakerOptions(npcs: NPCDefinition[]) {
  return [
    ...BUILT_IN_DIALOGUE_SPEAKERS.map((speaker) => ({
      value: speaker.speakerId,
      label: speaker.displayName
    })),
    ...npcs.map((npc) => ({ value: npc.definitionId, label: npc.displayName }))
  ];
}

function nodeOptions(dialogue: DialogueDefinition, currentNodeId: string) {
  return dialogue.nodes
    .filter((node) => node.nodeId !== currentNodeId)
    .map((node) => ({
      value: node.nodeId,
      label: node.displayName || node.nodeId
    }));
}

interface PlaytestPanelProps {
  dialogue: DialogueDefinition;
  currentNodeId: string;
  resolveSpeakerName: (speakerId: string | undefined) => string;
  onAdvance: (nextNodeId: string) => void;
  onClose: () => void;
}

function PlaytestPanel({
  dialogue,
  currentNodeId,
  resolveSpeakerName,
  onAdvance,
  onClose
}: PlaytestPanelProps) {
  const node = dialogue.nodes.find(
    (candidate) => candidate.nodeId === currentNodeId
  );
  if (!node) return null;

  const hasChoices = node.next.length > 1;
  const hasNext = node.next.length === 1 && Boolean(node.next[0]?.targetNodeId);
  const isEnd =
    node.next.length === 0 ||
    (node.next.length === 1 && !node.next[0]?.targetNodeId);

  return (
    <Paper
      shadow="xl"
      style={{
        position: "absolute",
        bottom: 20,
        left: "50%",
        transform: "translateX(-50%)",
        width: 450,
        maxWidth: "calc(100% - 40px)",
        border: "2px solid #89b4fa",
        background: "#181825",
        zIndex: 100
      }}
    >
      <Group
        p="sm"
        justify="space-between"
        style={{ background: "#89b4fa22", borderBottom: "1px solid #313244" }}
      >
        <Text size="sm" fw={600} c="#89b4fa">
          ▶ Playtest Mode
        </Text>
        <Button size="xs" variant="subtle" onClick={onClose}>
          ✕
        </Button>
      </Group>

      {node.speakerId && (
        <Text size="sm" fw={600} c="#89b4fa" px="md" pt="md">
          {node.speakerLabel || resolveSpeakerName(node.speakerId)}
        </Text>
      )}

      <Text size="sm" px="md" py="md" style={{ lineHeight: 1.6 }}>
        {node.text}
      </Text>

      <Stack gap="xs" p="md" style={{ borderTop: "1px solid #313244" }}>
        {hasChoices &&
          node.next.map((next, index) => (
            <Button
              key={`${node.nodeId}:${index}`}
              variant="default"
              fullWidth
              justify="flex-start"
              onClick={() => onAdvance(next.targetNodeId)}
            >
              {next.choiceText || `Choice ${index + 1}`}
            </Button>
          ))}

        {hasNext && (
          <Button
            variant="light"
            color="blue"
            fullWidth
            onClick={() => onAdvance(node.next[0]!.targetNodeId)}
          >
            Continue →
          </Button>
        )}

        {isEnd && (
          <>
            <Text size="sm" c="dimmed" fs="italic" ta="center">
              (End of dialogue)
            </Text>
            <Button
              variant="light"
              color="green"
              fullWidth
              disabled={!dialogue.startNodeId}
              onClick={() =>
                dialogue.startNodeId && onAdvance(dialogue.startNodeId)
              }
            >
              Restart
            </Button>
          </>
        )}
      </Stack>
    </Paper>
  );
}

interface DialogueConditionEditorProps {
  condition: DialogueCondition;
  itemDefinitions: ItemDefinition[];
  spellDefinitions: SpellDefinition[];
  onChange: (condition: DialogueCondition) => void;
}

function DialogueConditionEditor({
  condition,
  itemDefinitions,
  spellDefinitions,
  onChange
}: DialogueConditionEditorProps) {
  function handleTypeChange(type: string) {
    switch (type) {
      case "flag":
        onChange({ type: "flag", key: "" });
        break;
      case "hasItem":
        onChange({ type: "hasItem", itemId: "" });
        break;
      case "hasSpell":
        onChange({ type: "hasSpell", spellId: "" });
        break;
      case "canCastSpell":
        onChange({ type: "canCastSpell", spellId: "" });
        break;
      case "questActive":
        onChange({ type: "questActive", questId: "" });
        break;
      case "questCompleted":
        onChange({ type: "questCompleted", questId: "" });
        break;
      case "questStage":
        onChange({
          type: "questStage",
          questId: "",
          stageId: "",
          state: "active"
        });
        break;
      case "not":
        onChange({ type: "not", condition: { type: "flag", key: "" } });
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
        <Stack gap="xs">
          <Group justify="space-between">
            <Text size="xs" c="#f38ba8" fw={600}>
              NOT (negate)
            </Text>
            <Button
              size="xs"
              variant="subtle"
              onClick={() => onChange(condition.condition)}
            >
              Remove NOT
            </Button>
          </Group>
          <DialogueConditionEditor
            condition={condition.condition}
            itemDefinitions={itemDefinitions}
            spellDefinitions={spellDefinitions}
            onChange={(inner) => onChange({ type: "not", condition: inner })}
          />
        </Stack>
      </Paper>
    );
  }

  return (
    <Paper
      p="xs"
      style={{ background: "#f9e2af11", borderLeft: "2px solid #f9e2af" }}
    >
      <Stack gap="xs">
        <Group justify="space-between">
          <Text size="xs" c="#f9e2af" fw={600}>
            Condition
          </Text>
          <Tooltip label="Negate this condition">
            <ActionIcon
              size="xs"
              variant="subtle"
              color="red"
              onClick={() => onChange({ type: "not", condition })}
            >
              !
            </ActionIcon>
          </Tooltip>
        </Group>

        <Select
          size="xs"
          label="Type"
          data={[
            { value: "flag", label: "Has Flag" },
            { value: "hasItem", label: "Has Item" },
            { value: "hasSpell", label: "Has Spell" },
            { value: "canCastSpell", label: "Can Cast Spell" },
            { value: "questActive", label: "Quest Active" },
            { value: "questCompleted", label: "Quest Completed" },
            { value: "questStage", label: "Quest Stage" }
          ]}
          value={condition.type}
          onChange={(value) => value && handleTypeChange(value)}
        />

        {condition.type === "flag" && (
          <>
            <TextInput
              size="xs"
              label="Flag Key"
              value={condition.key}
              onChange={(event) =>
                onChange({ ...condition, key: event.currentTarget.value })
              }
            />
            <TextInput
              size="xs"
              label="Value (optional)"
              value={String(condition.value ?? "")}
              onChange={(event) =>
                onChange({
                  ...condition,
                  value: event.currentTarget.value || undefined
                })
              }
            />
          </>
        )}

        {condition.type === "hasItem" && (
          <>
            <Select
              size="xs"
              label="Item"
              data={itemDefinitions.map((item) => ({
                value: item.definitionId,
                label: item.displayName
              }))}
              value={condition.itemId}
              onChange={(value) =>
                onChange({ ...condition, itemId: value ?? "" })
              }
            />
            <TextInput
              size="xs"
              label="Count (optional)"
              value={condition.count?.toString() ?? ""}
              onChange={(event) =>
                onChange({
                  ...condition,
                  count: event.currentTarget.value
                    ? Number(event.currentTarget.value)
                    : undefined
                })
              }
            />
          </>
        )}

        {condition.type === "hasSpell" && (
          <Select
            size="xs"
            label="Spell"
            data={spellDefinitions.map((spell) => ({
              value: spell.definitionId,
              label: spell.displayName
            }))}
            value={condition.spellId}
            onChange={(value) =>
              onChange({ ...condition, spellId: value ?? "" })
            }
          />
        )}

        {condition.type === "canCastSpell" && (
          <Select
            size="xs"
            label="Spell"
            data={spellDefinitions.map((spell) => ({
              value: spell.definitionId,
              label: spell.displayName
            }))}
            value={condition.spellId}
            onChange={(value) =>
              onChange({ ...condition, spellId: value ?? "" })
            }
          />
        )}

        {condition.type === "questActive" && (
          <TextInput
            size="xs"
            label="Quest Id"
            value={condition.questId}
            onChange={(event) =>
              onChange({ ...condition, questId: event.currentTarget.value })
            }
          />
        )}

        {condition.type === "questCompleted" && (
          <TextInput
            size="xs"
            label="Quest Id"
            value={condition.questId}
            onChange={(event) =>
              onChange({ ...condition, questId: event.currentTarget.value })
            }
          />
        )}

        {condition.type === "questStage" && (
          <>
            <TextInput
              size="xs"
              label="Quest Id"
              value={condition.questId}
              onChange={(event) =>
                onChange({ ...condition, questId: event.currentTarget.value })
              }
            />
            <TextInput
              size="xs"
              label="Stage Id"
              value={condition.stageId}
              onChange={(event) =>
                onChange({ ...condition, stageId: event.currentTarget.value })
              }
            />
            <Select
              size="xs"
              label="State"
              data={[
                { value: "active", label: "Active" },
                { value: "completed", label: "Completed" }
              ]}
              value={condition.state}
              onChange={(value) =>
                onChange({
                  ...condition,
                  state: (value as "active" | "completed") ?? "active"
                })
              }
            />
          </>
        )}
      </Stack>
    </Paper>
  );
}

export function useDialogueWorkspaceView(
  props: DialogueWorkspaceViewProps
): WorkspaceViewContribution {
  const {
    isActive,
    gameProjectId,
    dialogueDefinitions,
    itemDefinitions,
    npcDefinitions,
    spellDefinitions,
    onCommand,
    renderDialogueInspectorSections
  } = props;
  const [selectedDialogueId, setSelectedDialogueId] = useState<string | null>(
    dialogueDefinitions[0]?.definitionId ?? null
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    definitionId: string;
  } | null>(null);
  const [isPlaytesting, setIsPlaytesting] = useState(false);
  const [playtestNodeId, setPlaytestNodeId] = useState<string | null>(null);
  const graphEditorRef = useRef<GraphEditorHandle | null>(null);
  const [graphSelection, setGraphSelection] = useState<{
    nodeIds: string[];
    groupIds: string[];
    edgeIds: string[];
  }>({ nodeIds: [], groupIds: [], edgeIds: [] });
  const [deleteRefusal, setDeleteRefusal] = useState<string | null>(null);

  const effectiveSelectedDialogueId = useMemo(() => {
    if (dialogueDefinitions.length === 0) return null;
    if (
      selectedDialogueId &&
      dialogueDefinitions.some(
        (definition) => definition.definitionId === selectedDialogueId
      )
    ) {
      return selectedDialogueId;
    }
    return dialogueDefinitions[0]!.definitionId;
  }, [dialogueDefinitions, selectedDialogueId]);

  const selectedDialogue = useMemo(
    () =>
      dialogueDefinitions.find(
        (definition) => definition.definitionId === effectiveSelectedDialogueId
      ) ?? null,
    [dialogueDefinitions, effectiveSelectedDialogueId]
  );

  const selectedNode = useMemo(
    () =>
      selectedDialogue?.nodes.find((node) => node.nodeId === selectedNodeId) ??
      null,
    [selectedDialogue, selectedNodeId]
  );

  const filteredDialogues = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return dialogueDefinitions;
    return dialogueDefinitions.filter(
      (definition) =>
        definition.displayName.toLowerCase().includes(query) ||
        definition.definitionId.toLowerCase().includes(query)
    );
  }, [dialogueDefinitions, searchQuery]);

  const dispatch = useCallback(
    (command: SemanticCommand) => {
      onCommand(command);
    },
    [onCommand]
  );

  const updateDialogue = useCallback(
    (nextDefinition: DialogueDefinition) => {
      if (!gameProjectId) return;
      dispatch({
        kind: "UpdateDialogueDefinition",
        target: {
          aggregateKind: "game-project",
          aggregateId: gameProjectId
        },
        subject: {
          subjectKind: "dialogue-definition",
          subjectId: nextDefinition.definitionId
        },
        payload: {
          definition: nextDefinition
        }
      });
    },
    [dispatch, gameProjectId]
  );

  function createDialogue() {
    if (!gameProjectId) return;
    const nextDefinition = createDefaultDialogueDefinition({
      displayName: `Dialogue ${dialogueDefinitions.length + 1}`
    });
    dispatch({
      kind: "CreateDialogueDefinition",
      target: {
        aggregateKind: "game-project",
        aggregateId: gameProjectId
      },
      subject: {
        subjectKind: "dialogue-definition",
        subjectId: nextDefinition.definitionId
      },
      payload: {
        definition: nextDefinition
      }
    });
    setSelectedDialogueId(nextDefinition.definitionId);
    setSelectedNodeId(nextDefinition.startNodeId);
  }

  function deleteDialogue(definitionId: string) {
    if (!gameProjectId) return;
    dispatch({
      kind: "DeleteDialogueDefinition",
      target: {
        aggregateKind: "game-project",
        aggregateId: gameProjectId
      },
      subject: {
        subjectKind: "dialogue-definition",
        subjectId: definitionId
      },
      payload: {
        definitionId
      }
    });
    setContextMenu(null);
    if (effectiveSelectedDialogueId === definitionId) {
      const remaining = dialogueDefinitions.filter(
        (definition) => definition.definitionId !== definitionId
      );
      setSelectedDialogueId(remaining[0]?.definitionId ?? null);
      setSelectedNodeId(null);
    }
  }

  const updateNode = useCallback(
    (nextNode: DialogueNodeDefinition) => {
      if (!selectedDialogue) return;
      updateDialogue({
        ...selectedDialogue,
        nodes: selectedDialogue.nodes.map((node) =>
          node.nodeId === nextNode.nodeId ? nextNode : node
        )
      });
    },
    [selectedDialogue, updateDialogue]
  );

  function addNode() {
    if (!selectedDialogue) return;
    const newNodeId = createDialogueNodeId();
    const newNode: DialogueNodeDefinition = {
      nodeId: newNodeId,
      displayName: `Node ${selectedDialogue.nodes.length + 1}`,
      text: "New dialogue...",
      next: [],
      graphPosition: createNextNodePosition(selectedDialogue)
    };

    updateDialogue({
      ...selectedDialogue,
      nodes: [...selectedDialogue.nodes, newNode]
    });
    setSelectedNodeId(newNodeId);
  }

  // The inspector's delete goes through the same rule and the same removal as
  // the canvas. Two copies of "may this node go?" gave different answers
  // depending on which button the author pressed.
  function deleteNode(nodeId: string) {
    if (!selectedDialogue) return;
    const refusal = canDeleteDialogueNodes(selectedDialogue, [nodeId]);
    if (!refusal.allowed) {
      setDeleteRefusal(refusal.reason ?? "That node cannot be deleted.");
      return;
    }

    updateDialogue(deleteDialogueNodes(selectedDialogue, [nodeId]));
    if (selectedNodeId === nodeId) {
      setSelectedNodeId(null);
    }
  }

  function updateNodeEdge(
    node: DialogueNodeDefinition,
    index: number,
    updates: Partial<DialogueEdgeDefinition>
  ) {
    const next = [...node.next];
    next[index] = {
      ...next[index]!,
      ...updates
    };
    updateNode({ ...node, next });
  }

  const resolveSpeakerName = useCallback(
    (speakerId: string | undefined): string => {
      if (!speakerId) return "";
      const builtIn = BUILT_IN_DIALOGUE_SPEAKERS.find(
        (speaker) => speaker.speakerId === speakerId
      );
      if (builtIn) return builtIn.displayName;
      return (
        npcDefinitions.find((npc) => npc.definitionId === speakerId)
          ?.displayName ?? speakerId
      );
    },
    [npcDefinitions]
  );

  const editorNodes = useMemo(
    () =>
      selectedDialogue
        ? dialogueToEditorNodes(selectedDialogue, playtestNodeId).map((node) =>
            placeNodeInGroup(node, selectedDialogue.groups)
          )
        : [],
    [selectedDialogue, playtestNodeId]
  );
  const editorGroups = useMemo(
    () => toEditorGroups(selectedDialogue?.groups),
    [selectedDialogue]
  );
  const editorEdges = useMemo(
    () => (selectedDialogue ? dialogueToEditorEdges(selectedDialogue) : []),
    [selectedDialogue]
  );

  // One drag, one write. Nodes and frames used to be recorded by two separate
  // calls built from the same starting dialogue, so whichever landed second
  // threw away the other's half. A node whose frame is also being dragged is
  // never reported as moved itself, so the two lists never overlap.
  const handleMoved = useCallback(
    (moved: {
      nodes: GraphEditorNodeMove[];
      groups: GraphEditorNodeMove[];
    }) => {
      if (!selectedDialogue) return;
      // A node inside a frame reports a position relative to it; the document
      // stores absolute positions.
      const absolute = moved.nodes.map((move) => ({
        id: move.id,
        position: toAbsolutePosition(
          move.position,
          move.parentId,
          selectedDialogue.groups
        )
      }));

      // A frame takes its members with it: the editor reports only the frame's
      // own new position, so the members are shifted by the same delta here or
      // they would spring back on the next load.
      let next = selectedDialogue;
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
          nodes: next.nodes.map((node) =>
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

      if (absolute.length > 0) {
        // Where a node was dropped decides which frame it belongs to.
        let groups = next.groups ?? [];
        for (const move of absolute) {
          groups = resolveMembership(groups, move.id, move.position);
        }
        const withNodes = applyDialogueNodeMoves(next, absolute);
        next = membershipChanged(next.groups, groups)
          ? { ...withNodes, groups }
          : withNodes;
      }

      updateDialogue(next);
    },
    [selectedDialogue, updateDialogue]
  );

  const handleGroupRenamed = useCallback(
    (groupId: string, label: string) => {
      if (!selectedDialogue) return;
      updateDialogue({
        ...selectedDialogue,
        groups: (selectedDialogue.groups ?? []).map((group) =>
          group.groupId === groupId ? { ...group, label } : group
        )
      });
    },
    [selectedDialogue, updateDialogue]
  );

  // Removing a frame leaves its members exactly where they are.
  const handleGroupsDeleted = useCallback(
    (groupIds: string[]) => {
      if (!selectedDialogue) return;
      updateDialogue({
        ...selectedDialogue,
        groups: (selectedDialogue.groups ?? []).filter(
          (group) => !groupIds.includes(group.groupId)
        )
      });
    },
    [selectedDialogue, updateDialogue]
  );

  const groupSelection = useCallback(() => {
    if (!selectedDialogue) return;
    const memberNodeIds = graphSelection.nodeIds;
    if (memberNodeIds.length < 2) return;
    const frame = frameAround(
      selectedDialogue.nodes
        .filter((node) => memberNodeIds.includes(node.nodeId))
        .map((node) => node.graphPosition)
    );
    updateDialogue({
      ...selectedDialogue,
      groups: addGroup(
        selectedDialogue.groups,
        createNodeGroup({
          label: "Group",
          memberNodeIds,
          position: frame.position,
          size: frame.size
        })
      )
    });
  }, [graphSelection.nodeIds, selectedDialogue, updateDialogue]);

  const handleGraphConnect = useCallback(
    (connection: GraphEditorConnection) => {
      if (!selectedDialogue) return;
      updateDialogue(connectDialogueNodes(selectedDialogue, connection));
    },
    [selectedDialogue, updateDialogue]
  );

  const handleEdgesDeleted = useCallback(
    (edgeIds: string[]) => {
      if (!selectedDialogue) return;
      updateDialogue(disconnectDialogueEdges(selectedDialogue, edgeIds));
    },
    [selectedDialogue, updateDialogue]
  );

  const handleNodesDeleted = useCallback(
    (nodeIds: string[]) => {
      if (!selectedDialogue) return;
      updateDialogue(deleteDialogueNodes(selectedDialogue, nodeIds));
      if (selectedNodeId && nodeIds.includes(selectedNodeId)) {
        setSelectedNodeId(null);
      }
    },
    [selectedDialogue, selectedNodeId, updateDialogue]
  );

  // Refusing a deletion is silent on its own, so the reason is surfaced.
  const handleBeforeDelete = useCallback(
    ({ nodeIds }: { nodeIds: string[]; edgeIds: string[] }) => {
      if (nodeIds.length === 0) return true;
      const dialogue = selectedDialogue;
      if (!dialogue) return false;
      const refusal = canDeleteDialogueNodes(dialogue, nodeIds);
      if (!refusal.allowed) {
        setDeleteRefusal(refusal.reason ?? "That node cannot be deleted.");
        return false;
      }
      return true;
    },
    [selectedDialogue]
  );

  const hasGraphSelection =
    graphSelection.nodeIds.length +
      graphSelection.groupIds.length +
      graphSelection.edgeIds.length >
    0;

  const dialogueGraphChrome = (
    <Group gap={6} align="center">
      <AddNodeMenu
        items={[
          { id: "node", label: "Node", description: "A line of dialogue" }
        ]}
        onSelect={addNode}
      />
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
          Dialogues
        </Text>
        <Tooltip label="Add Dialogue">
          <ActionIcon
            variant="subtle"
            size="sm"
            onClick={createDialogue}
            aria-label="Add Dialogue"
          >
            +
          </ActionIcon>
        </Tooltip>
      </Group>
      <Box p="sm" style={{ borderBottom: "1px solid var(--sm-panel-border)" }}>
        <TextInput
          size="xs"
          placeholder="Search dialogues..."
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.currentTarget.value)}
        />
      </Box>
      <ScrollArea style={{ flex: 1, minHeight: 0 }}>
        <Stack gap={4} p="xs">
          {filteredDialogues.map((definition) => {
            const isSelected =
              effectiveSelectedDialogueId === definition.definitionId;
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
                onClick={() => {
                  setSelectedDialogueId(definition.definitionId);
                  setSelectedNodeId(null);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setSelectedDialogueId(definition.definitionId);
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
                <Text size="xs" c="var(--sm-color-overlay0)">
                  {definition.nodes.length} nodes ·{" "}
                  {definition.definitionId.slice(0, 8)}
                </Text>
              </Box>
            );
          })}
          {filteredDialogues.length === 0 && (
            <Text size="xs" c="var(--sm-color-overlay0)" p="md" ta="center">
              No dialogues yet.
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
              deleteDialogue(contextMenu.definitionId);
            }}
          >
            Delete
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Stack>
  );

  const rightPanel = (
    <Inspector
      selectionLabel={
        selectedNode
          ? selectedNode.displayName || "Node"
          : (selectedDialogue?.displayName ?? "Dialogue")
      }
      selectionIcon="💬"
    >
      {selectedDialogue ? (
        selectedNode ? (
          <Stack gap="lg">
            <Group gap="xs">
              <Text
                size="xs"
                fw={600}
                tt="uppercase"
                c="var(--sm-color-subtext)"
              >
                Node Properties
              </Text>
              {selectedNode.nodeId === selectedDialogue.startNodeId && (
                <Badge size="xs" color="green">
                  Start
                </Badge>
              )}
            </Group>

            <TextInput
              label="Name"
              size="xs"
              value={selectedNode.displayName ?? ""}
              onChange={(event) =>
                updateNode({
                  ...selectedNode,
                  displayName: event.currentTarget.value || undefined
                })
              }
            />

            <Select
              label="Speaker"
              size="xs"
              data={speakerOptions(npcDefinitions)}
              value={selectedNode.speakerId ?? null}
              onChange={(value) =>
                updateNode({
                  ...selectedNode,
                  speakerId: value ?? undefined,
                  speakerLabel:
                    value === EXCERPT_SPEAKER.speakerId
                      ? selectedNode.speakerLabel
                      : undefined
                })
              }
              searchable
              clearable
            />

            {selectedNode.speakerId === EXCERPT_SPEAKER.speakerId && (
              <TextInput
                label="Source Title"
                size="xs"
                value={selectedNode.speakerLabel ?? ""}
                onChange={(event) =>
                  updateNode({
                    ...selectedNode,
                    speakerLabel: event.currentTarget.value || undefined
                  })
                }
              />
            )}

            <Textarea
              label="Dialogue Text"
              size="xs"
              minRows={4}
              autosize
              value={selectedNode.text}
              onChange={(event) =>
                updateNode({
                  ...selectedNode,
                  text: event.currentTarget.value
                })
              }
            />

            <TextInput
              label="On Enter Event"
              size="xs"
              value={selectedNode.onEnterEventId ?? ""}
              onChange={(event) =>
                updateNode({
                  ...selectedNode,
                  onEnterEventId: event.currentTarget.value || undefined
                })
              }
              description="Optional event triggered when shown"
            />

            <Stack gap="xs">
              <Group justify="space-between">
                <Text size="sm" fw={500}>
                  Next {selectedNode.next.length > 1 ? "(Choices)" : ""}
                </Text>
                <Button
                  size="xs"
                  variant="subtle"
                  onClick={() =>
                    updateNode({
                      ...selectedNode,
                      next: [...selectedNode.next, { targetNodeId: "" }]
                    })
                  }
                >
                  + Add
                </Button>
              </Group>

              {selectedNode.next.map((next, index) => (
                <Paper
                  key={`${selectedNode.nodeId}:${index}`}
                  p="xs"
                  withBorder
                  style={{ background: "#181825" }}
                >
                  <Stack gap="xs">
                    <Group justify="space-between">
                      <Text size="xs" c="dimmed">
                        {selectedNode.next.length > 1
                          ? `Choice ${index + 1}`
                          : "Next Node"}
                      </Text>
                      <Group gap={4}>
                        <Tooltip
                          label={
                            next.condition
                              ? "Remove condition"
                              : "Add condition"
                          }
                        >
                          <ActionIcon
                            size="xs"
                            variant={next.condition ? "filled" : "subtle"}
                            color={next.condition ? "yellow" : "gray"}
                            onClick={() =>
                              updateNodeEdge(selectedNode, index, {
                                condition: next.condition
                                  ? undefined
                                  : { type: "flag", key: "" }
                              })
                            }
                          >
                            ?
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Group>

                    <Select
                      size="xs"
                      placeholder="Select target node"
                      data={nodeOptions(selectedDialogue, selectedNode.nodeId)}
                      value={next.targetNodeId || null}
                      onChange={(value) =>
                        updateNodeEdge(selectedNode, index, {
                          targetNodeId: value ?? ""
                        })
                      }
                      searchable
                    />

                    {selectedNode.next.length > 1 && (
                      <TextInput
                        size="xs"
                        placeholder="Choice text..."
                        value={next.choiceText ?? ""}
                        onChange={(event) =>
                          updateNodeEdge(selectedNode, index, {
                            choiceText: event.currentTarget.value || undefined
                          })
                        }
                      />
                    )}

                    {next.condition && (
                      <DialogueConditionEditor
                        condition={next.condition}
                        itemDefinitions={itemDefinitions}
                        spellDefinitions={spellDefinitions}
                        onChange={(condition) =>
                          updateNodeEdge(selectedNode, index, { condition })
                        }
                      />
                    )}
                  </Stack>
                </Paper>
              ))}

              {selectedNode.next.length === 0 && (
                <Text size="xs" c="dimmed" fs="italic">
                  No connections - this is an end node
                </Text>
              )}
            </Stack>

            {/* Always shown: whether this node may go is `canDeleteDialogueNodes`'s
                call, and hiding the button here would be a second copy of that
                rule. Deleting the start node is allowed once it is the last one. */}
            <Button
              color="red"
              variant="subtle"
              onClick={() => deleteNode(selectedNode.nodeId)}
              fullWidth
            >
              Delete Node
            </Button>

            {renderDialogueInspectorSections?.({
              selectedDialogue,
              selectedDialogueNode: selectedNode,
              updateDialogueNode: updateNode
            })}
          </Stack>
        ) : (
          <Stack gap="lg">
            <Stack gap="xs">
              <Text
                size="xs"
                fw={600}
                tt="uppercase"
                c="var(--sm-color-subtext)"
              >
                Dialogue
              </Text>
              <TextInput
                label="Name"
                size="xs"
                value={selectedDialogue.displayName}
                onChange={(event) =>
                  updateDialogue({
                    ...selectedDialogue,
                    displayName: event.currentTarget.value
                  })
                }
              />
              <Select
                label="Interaction NPC"
                size="xs"
                clearable
                data={npcDefinitions.map((npc) => ({
                  value: npc.definitionId,
                  label: npc.displayName
                }))}
                value={selectedDialogue.interactionBinding.npcDefinitionId}
                onChange={(value) =>
                  updateDialogue({
                    ...selectedDialogue,
                    interactionBinding: {
                      npcDefinitionId: value
                    }
                  })
                }
                description="Optional NPC that starts this dialogue in gameplay."
              />
            </Stack>
          </Stack>
        )
      ) : (
        <Text size="xs" c="var(--sm-color-overlay0)">
          No dialogue selected.
        </Text>
      )}
    </Inspector>
  );

  const centerPanel = (
    <Box
      style={{ position: "relative", height: "100%", background: "#1e1e2e" }}
    >
      {selectedDialogue ? (
        <Box
          style={{ display: "flex", flexDirection: "column", height: "100%" }}
        >
          <Group
            p="xs"
            style={{
              background: "#181825",
              borderBottom: "1px solid #313244",
              flexShrink: 0
            }}
            justify="space-between"
          >
            <Group gap="sm">
              <Text size="sm" fw={600}>
                {selectedDialogue.displayName}
              </Text>
              <Badge size="sm" variant="light">
                Start: {selectedDialogue.startNodeId}
              </Badge>
            </Group>

            <Group gap="xs">
              <Button
                size="xs"
                variant="subtle"
                color="green"
                onClick={() => {
                  if (!selectedDialogue.startNodeId) return;
                  setIsPlaytesting(true);
                  setPlaytestNodeId(selectedDialogue.startNodeId);
                  graphEditorRef.current?.centerOnNode(
                    selectedDialogue.startNodeId
                  );
                }}
              >
                ▶ Playtest
              </Button>
            </Group>
          </Group>

          <Box style={{ flex: 1, minHeight: 0, position: "relative" }}>
            {isActive ? (
              <NodeEditor
                ref={graphEditorRef}
                nodes={editorNodes}
                edges={editorEdges}
                renderers={DIALOGUE_NODE_RENDERERS}
                primarySelectionId={selectedNodeId}
                onPrimarySelectionChange={setSelectedNodeId}
                groups={editorGroups}
                onMoved={handleMoved}
                onGroupRenamed={handleGroupRenamed}
                onGroupsDeleted={handleGroupsDeleted}
                onConnect={handleGraphConnect}
                onNodesDeleted={handleNodesDeleted}
                onEdgesDeleted={handleEdgesDeleted}
                onBeforeDelete={handleBeforeDelete}
                onSelectionChange={setGraphSelection}
                chrome={dialogueGraphChrome}
              />
            ) : null}
            {deleteRefusal ? (
              <WarnToast
                message={deleteRefusal}
                onDismiss={() => setDeleteRefusal(null)}
              />
            ) : null}
            {isPlaytesting && playtestNodeId && (
              <PlaytestPanel
                dialogue={selectedDialogue}
                currentNodeId={playtestNodeId}
                resolveSpeakerName={resolveSpeakerName}
                onAdvance={(nextNodeId) => {
                  setPlaytestNodeId(nextNodeId);
                  graphEditorRef.current?.centerOnNode(nextNodeId);
                  graphEditorRef.current?.selectNode(nextNodeId);
                }}
                onClose={() => {
                  setIsPlaytesting(false);
                  setPlaytestNodeId(null);
                }}
              />
            )}
          </Box>
        </Box>
      ) : (
        <Stack align="center" justify="center" h="100%" gap="md">
          <Text size="xl">💬</Text>
          <Text c="dimmed">Select a dialogue to edit</Text>
          <Text size="sm" c="dimmed" ta="center" maw={300}>
            Choose a dialogue from the list on the left, or create a new one
            with the + button.
          </Text>
        </Stack>
      )}
    </Box>
  );

  return {
    leftPanel,
    rightPanel,
    centerPanel,
    viewportOverlay: null
  };
}
