import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  SemanticCommand
} from "@sugarmagic/domain";
import {
  BUILT_IN_DIALOGUE_SPEAKERS,
  EXCERPT_SPEAKER,
  createDefaultDialogueDefinition,
  createDialogueNodeId
} from "@sugarmagic/domain";
import { Inspector, GraphCanvas, type GraphCanvasNode, type GraphCanvasEdge } from "@sugarmagic/ui";
import type { WorkspaceViewContribution } from "../workspace-view";

const NODE_SPACING_Y = 150;

export interface DialogueWorkspaceViewProps {
  isActive: boolean;
  gameProjectId: string | null;
  dialogueDefinitions: DialogueDefinition[];
  itemDefinitions: ItemDefinition[];
  npcDefinitions: NPCDefinition[];
  onCommand: (command: SemanticCommand) => void;
}

function getChoiceColor(index: number): string {
  const colors = ["#89b4fa", "#a6e3a1", "#f9e2af", "#f38ba8", "#cba6f7"];
  return colors[index % colors.length] ?? "#89b4fa";
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

function toGraphNodes(dialogue: DialogueDefinition): GraphCanvasNode[] {
  return dialogue.nodes.map((node) => ({
    id: node.nodeId,
    position: { ...node.graphPosition },
    outputs:
      node.next.length > 1
        ? node.next.map((_, index) => ({
            name: `choice-${index}`,
            color: getChoiceColor(index),
            yPercent: node.next.length === 1 ? 0.5 : (index + 1) / (node.next.length + 1)
          }))
        : undefined
  }));
}

function toGraphEdges(dialogue: DialogueDefinition): GraphCanvasEdge[] {
  const edges: GraphCanvasEdge[] = [];

  for (const node of dialogue.nodes) {
    if (node.next.length === 0) continue;
    const isChoice = node.next.length > 1;
    node.next.forEach((edge, index) => {
      edges.push({
        fromId: node.nodeId,
        toId: edge.targetNodeId,
        fromPort: isChoice ? `choice-${index}` : undefined,
        color: edge.condition
          ? "#f9e2af"
          : isChoice
            ? getChoiceColor(index)
            : "#45475a",
        dashed: Boolean(edge.condition)
      });
    });
  }

  return edges;
}

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
  const node = dialogue.nodes.find((candidate) => candidate.nodeId === currentNodeId);
  if (!node) return null;

  const hasChoices = node.next.length > 1;
  const hasNext = node.next.length === 1 && Boolean(node.next[0]?.targetNodeId);
  const isEnd = node.next.length === 0 || (node.next.length === 1 && !node.next[0]?.targetNodeId);

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
              onClick={() => onAdvance(dialogue.startNodeId)}
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
  onChange: (condition: DialogueCondition) => void;
}

function DialogueConditionEditor({
  condition,
  itemDefinitions,
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
      case "questActive":
        onChange({ type: "questActive", questId: "" });
        break;
      case "questCompleted":
        onChange({ type: "questCompleted", questId: "" });
        break;
      case "questStage":
        onChange({ type: "questStage", questId: "", stageId: "", state: "active" });
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
      <Paper p="xs" style={{ background: "#f38ba822", borderLeft: "2px solid #f38ba8" }}>
        <Stack gap="xs">
          <Group justify="space-between">
            <Text size="xs" c="#f38ba8" fw={600}>
              NOT (negate)
            </Text>
            <Button size="xs" variant="subtle" onClick={() => onChange(condition.condition)}>
              Remove NOT
            </Button>
          </Group>
          <DialogueConditionEditor
            condition={condition.condition}
            itemDefinitions={itemDefinitions}
            onChange={(inner) => onChange({ type: "not", condition: inner })}
          />
        </Stack>
      </Paper>
    );
  }

  return (
    <Paper p="xs" style={{ background: "#f9e2af11", borderLeft: "2px solid #f9e2af" }}>
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
              onChange={(value) => onChange({ ...condition, itemId: value ?? "" })}
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
    onCommand
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
  const graphContainerRef = useRef<HTMLDivElement | null>(null);
  const graphCanvasRef = useRef<GraphCanvas | null>(null);
  const selectedDialogueRef = useRef<DialogueDefinition | null>(null);
  const selectedNodeIdRef = useRef<string | null>(null);
  const playtestNodeIdRef = useRef<string | null>(null);

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
      selectedDialogue?.nodes.find((node) => node.nodeId === selectedNodeId) ?? null,
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

  const updateDialogue = useCallback((nextDefinition: DialogueDefinition) => {
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
  }, [dispatch, gameProjectId]);

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

  const updateNode = useCallback((nextNode: DialogueNodeDefinition) => {
    if (!selectedDialogue) return;
    updateDialogue({
      ...selectedDialogue,
      nodes: selectedDialogue.nodes.map((node) =>
        node.nodeId === nextNode.nodeId ? nextNode : node
      )
    });
  }, [selectedDialogue, updateDialogue]);

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

  function deleteNode(nodeId: string) {
    if (!selectedDialogue) return;
    if (selectedDialogue.nodes.length <= 1) {
      window.alert("Cannot delete the last node.");
      return;
    }
    if (nodeId === selectedDialogue.startNodeId) {
      window.alert("Cannot delete the start node.");
      return;
    }

    const nextNodes = selectedDialogue.nodes
      .filter((node) => node.nodeId !== nodeId)
      .map((node) => ({
        ...node,
        next: node.next.filter((edge) => edge.targetNodeId !== nodeId)
      }));

    updateDialogue({
      ...selectedDialogue,
      nodes: nextNodes
    });
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

  const resolveSpeakerName = useCallback((speakerId: string | undefined): string => {
    if (!speakerId) return "";
    const builtIn = BUILT_IN_DIALOGUE_SPEAKERS.find(
      (speaker) => speaker.speakerId === speakerId
    );
    if (builtIn) return builtIn.displayName;
    return (
      npcDefinitions.find((npc) => npc.definitionId === speakerId)?.displayName ??
      speakerId
    );
  }, [npcDefinitions]);

  const updateGraphCanvas = useCallback(() => {
    const graphCanvas = graphCanvasRef.current;
    const dialogue = selectedDialogueRef.current;
    if (!graphCanvas || !dialogue) return;
    graphCanvas.setNodes(toGraphNodes(dialogue));
    graphCanvas.setEdges(toGraphEdges(dialogue));
  }, []);

  useEffect(() => {
    selectedDialogueRef.current = selectedDialogue;
  }, [selectedDialogue]);

  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
  }, [selectedNodeId]);

  useEffect(() => {
    playtestNodeIdRef.current = playtestNodeId;
  }, [playtestNodeId]);

  useEffect(() => {
    if (!isActive || !graphContainerRef.current || !selectedDialogueRef.current) return;

    const graphCanvas = new GraphCanvas({
      onNodeSelect: (nodeId) => setSelectedNodeId(nodeId),
      onNodeMove: (nodeId, position) => {
        const dialogue = selectedDialogueRef.current;
        if (!dialogue) return;
        updateDialogue({
          ...dialogue,
          nodes: dialogue.nodes.map((node) =>
            node.nodeId === nodeId
              ? {
                  ...node,
                  graphPosition: position
                }
              : node
          )
        });
      },
      onCanvasClick: () => setSelectedNodeId(null),
      onConnect: (fromNodeId, toNodeId, fromPort) => {
        const dialogue = selectedDialogueRef.current;
        if (!dialogue) return;
        const fromNode = dialogue.nodes.find((node) => node.nodeId === fromNodeId);
        if (!fromNode) return;
        if (fromNode.next.some((edge) => edge.targetNodeId === toNodeId)) {
          return;
        }

        const next = [...fromNode.next];
        if (fromPort?.startsWith("choice-")) {
          next.push({
            targetNodeId: toNodeId,
            choiceText: `Choice ${next.length + 1}`
          });
        } else {
          next.push({ targetNodeId: toNodeId });
        }

        updateNode({
          ...fromNode,
          next
        });
      },
      renderNode: (canvasNode, element) => {
        const dialogue = selectedDialogueRef.current;
        const node = dialogue?.nodes.find((candidate) => candidate.nodeId === canvasNode.id);
        if (!dialogue || !node) {
          element.innerHTML =
            '<div style="padding: 12px; color: #f38ba8;">Node not found</div>';
          return;
        }

        const isStart = node.nodeId === dialogue.startNodeId;
        const isSelected = node.nodeId === selectedNodeIdRef.current;
        const isPlaytestActive = node.nodeId === playtestNodeIdRef.current;

        let borderColor = "#313244";
        if (isPlaytestActive) borderColor = "#f9e2af";
        else if (isSelected) borderColor = "#89b4fa";
        else if (isStart) borderColor = "#a6e3a1";

        element.style.minWidth = "220px";
        element.style.maxWidth = "300px";
        element.style.background = "#181825";
        element.style.border = `2px solid ${borderColor}`;
        element.style.borderRadius = "8px";
        element.style.overflow = "hidden";
        if (isPlaytestActive) {
          element.style.boxShadow = "0 0 20px #f9e2af44";
        }

        const header = document.createElement("div");
        header.style.cssText = `
          padding: 8px 12px;
          background: ${isPlaytestActive ? "#f9e2af22" : isStart ? "#a6e3a122" : "#313244"};
          border-bottom: 1px solid #313244;
          display: flex;
          align-items: center;
          gap: 8px;
        `;

        if (isStart) {
          const icon = document.createElement("span");
          icon.textContent = "▶";
          icon.style.cssText = "color: #a6e3a1; font-size: 10px;";
          header.appendChild(icon);
        }

        const nameSpan = document.createElement("span");
        nameSpan.textContent = node.displayName || node.nodeId;
        nameSpan.style.cssText = `font-size: 12px; color: ${isStart ? "#a6e3a1" : "#cdd6f4"}; flex: 1;`;
        header.appendChild(nameSpan);

        if (node.speakerId) {
          const speaker = document.createElement("span");
          speaker.textContent = resolveSpeakerName(node.speakerId);
          speaker.style.cssText = `
            font-size: 10px;
            padding: 2px 6px;
            background: #89b4fa22;
            color: #89b4fa;
            border-radius: 3px;
          `;
          header.appendChild(speaker);
        }

        element.appendChild(header);

        const content = document.createElement("div");
        content.style.cssText =
          "padding: 12px; font-size: 12px; color: #a6adc8; line-height: 1.4;";
        content.textContent =
          node.text.length > 120 ? `${node.text.slice(0, 120)}...` : node.text;
        element.appendChild(content);

        if (node.next.length > 0) {
          const footer = document.createElement("div");
          footer.style.cssText =
            "padding: 8px 12px; border-top: 1px solid #313244; background: #1e1e2e;";

          if (node.next.length > 1) {
            node.next.forEach((next, index) => {
              const choice = document.createElement("div");
              const color = next.condition ? "#f9e2af" : getChoiceColor(index);
              choice.style.cssText = `
                font-size: 11px;
                padding: 4px 8px;
                margin: 2px 0;
                background: ${color}22;
                color: ${color};
                border-radius: 4px;
                display: flex;
                align-items: center;
                gap: 4px;
              `;
              if (next.condition) {
                const badge = document.createElement("span");
                badge.textContent = "?";
                badge.style.cssText = `
                  display: inline-block;
                  width: 14px; height: 14px;
                  line-height: 14px;
                  text-align: center;
                  background: #f9e2af33;
                  border-radius: 3px;
                  font-size: 10px;
                  font-weight: 700;
                  flex-shrink: 0;
                `;
                choice.appendChild(badge);
              }
              const text = document.createElement("span");
              text.textContent = next.choiceText || `Choice ${index + 1}`;
              choice.appendChild(text);
              footer.appendChild(choice);
            });
          } else {
            const next = node.next[0]!;
            const nextNode = dialogue.nodes.find((candidate) => candidate.nodeId === next.targetNodeId);
            const nextLabel = document.createElement("div");
            nextLabel.style.cssText =
              "font-size: 10px; color: #6c7086; display: flex; align-items: center; gap: 4px;";
            if (next.condition) {
              const badge = document.createElement("span");
              badge.textContent = "?";
              badge.style.cssText = "color: #f9e2af; font-weight: 700;";
              nextLabel.appendChild(badge);
            }
            const text = document.createElement("span");
            text.textContent = `→ ${nextNode?.displayName || next.targetNodeId}`;
            nextLabel.appendChild(text);
            footer.appendChild(nextLabel);
          }

          element.appendChild(footer);
        }
      }
    });

    graphContainerRef.current.innerHTML = "";
    graphContainerRef.current.appendChild(graphCanvas.getElement());
    graphCanvasRef.current = graphCanvas;
    updateGraphCanvas();
    window.setTimeout(() => graphCanvas.fitToContent(), 100);

    return () => {
      graphCanvas.dispose();
      graphCanvasRef.current = null;
    };
  }, [
    isActive,
    resolveSpeakerName,
    selectedDialogue?.definitionId,
    updateDialogue,
    updateGraphCanvas,
    updateNode
  ]);

  useEffect(() => {
    if (!isActive || !selectedDialogue) return;
    updateGraphCanvas();
  }, [isActive, selectedDialogue, updateGraphCanvas]);

  useEffect(() => {
    graphCanvasRef.current?.setSelectedNode(selectedNodeId);
  }, [selectedNodeId]);

  useEffect(() => {
    updateGraphCanvas();
  }, [playtestNodeId, updateGraphCanvas]);

  const leftPanel = (
    <Stack gap={0} h="100%" style={{ minHeight: 0 }} onClick={() => setContextMenu(null)}>
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
          <ActionIcon variant="subtle" size="sm" onClick={createDialogue} aria-label="Add Dialogue">
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
            const isSelected = effectiveSelectedDialogueId === definition.definitionId;
            return (
              <Box
                key={definition.definitionId}
                px="sm"
                py="xs"
                style={{
                  borderRadius: 8,
                  cursor: "pointer",
                  background: isSelected ? "var(--sm-active-bg)" : "transparent",
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
                  {definition.nodes.length} nodes · {definition.definitionId.slice(0, 8)}
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
          : selectedDialogue?.displayName ?? "Dialogue"
      }
      selectionIcon="💬"
    >
      {selectedDialogue ? (
        selectedNode ? (
          <Stack gap="lg">
            <Group gap="xs">
              <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
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
                <Paper key={`${selectedNode.nodeId}:${index}`} p="xs" withBorder style={{ background: "#181825" }}>
                  <Stack gap="xs">
                    <Group justify="space-between">
                      <Text size="xs" c="dimmed">
                        {selectedNode.next.length > 1 ? `Choice ${index + 1}` : "Next Node"}
                      </Text>
                      <Group gap={4}>
                        <Tooltip label={next.condition ? "Remove condition" : "Add condition"}>
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
                        <Button
                          size="xs"
                          variant="subtle"
                          color="red"
                          onClick={() =>
                            updateNode({
                              ...selectedNode,
                              next: selectedNode.next.filter((_, nextIndex) => nextIndex !== index)
                            })
                          }
                          styles={{ root: { padding: "2px 6px" } }}
                        >
                          ✕
                        </Button>
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

            {selectedNode.nodeId !== selectedDialogue.startNodeId && (
              <Button
                color="red"
                variant="subtle"
                onClick={() => deleteNode(selectedNode.nodeId)}
                fullWidth
              >
                Delete Node
              </Button>
            )}
          </Stack>
        ) : (
          <Stack gap="lg">
            <Stack gap="xs">
              <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
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
    <Box style={{ position: "relative", height: "100%", background: "#1e1e2e" }}>
      {selectedDialogue ? (
        <Box style={{ display: "flex", flexDirection: "column", height: "100%" }}>
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
                  setIsPlaytesting(true);
                  setPlaytestNodeId(selectedDialogue.startNodeId);
                  graphCanvasRef.current?.centerOnNode(selectedDialogue.startNodeId);
                }}
              >
                ▶ Playtest
              </Button>
              <Button size="xs" variant="subtle" onClick={addNode}>
                + Add Node
              </Button>
              <Button
                size="xs"
                variant="subtle"
                onClick={() => graphCanvasRef.current?.fitToContent()}
              >
                Fit View
              </Button>
              <Button
                size="xs"
                variant="subtle"
                color="red"
                onClick={() => deleteDialogue(selectedDialogue.definitionId)}
              >
                Delete
              </Button>
            </Group>
          </Group>

          <Box style={{ flex: 1, minHeight: 0, position: "relative" }}>
            <div
              ref={graphContainerRef}
              style={{ position: "absolute", inset: 0, overflow: "hidden" }}
            />
            {isPlaytesting && playtestNodeId && (
              <PlaytestPanel
                dialogue={selectedDialogue}
                currentNodeId={playtestNodeId}
                resolveSpeakerName={resolveSpeakerName}
                onAdvance={(nextNodeId) => {
                  setPlaytestNodeId(nextNodeId);
                  graphCanvasRef.current?.centerOnNode(nextNodeId);
                  graphCanvasRef.current?.setSelectedNode(nextNodeId);
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
            Choose a dialogue from the list on the left, or create a new one with the + button.
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
