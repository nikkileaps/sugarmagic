import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Menu,
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
  NPCDefinition,
  QuestActionDefinition,
  QuestConditionDefinition,
  QuestDefinition,
  QuestNodeBehavior,
  QuestNodeDefinition,
  QuestStageDefinition,
  SemanticCommand
} from "@sugarmagic/domain";
import {
  createDefaultQuestDefinition,
  createDefaultQuestNodeDefinition,
  createDefaultQuestStageDefinition,
  createQuestNodeId
} from "@sugarmagic/domain";
import { GraphCanvas, Inspector, type GraphCanvasEdge, type GraphCanvasNode } from "@sugarmagic/ui";
import type { WorkspaceViewContribution } from "../workspace-view";

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
  trigger: "⚡",
  castSpell: "🔮",
  custom: "⭐"
};

export interface QuestWorkspaceViewProps {
  isActive: boolean;
  gameProjectId: string | null;
  questDefinitions: QuestDefinition[];
  dialogueDefinitions: DialogueDefinition[];
  npcDefinitions: NPCDefinition[];
  onCommand: (command: SemanticCommand) => void;
}

function validateQuest(quest: QuestDefinition): string[] {
  const warnings: string[] = [];
  const stageIds = new Set(quest.stageDefinitions.map((stage) => stage.stageId));
  if (!stageIds.has(quest.startStageId)) {
    warnings.push("Start stage is missing.");
  }

  for (const stage of quest.stageDefinitions) {
    if (stage.nextStageId && !stageIds.has(stage.nextStageId)) {
        warnings.push(`Stage "${stage.displayName}" points to a missing next stage.`);
    }
    if (stage.nodeDefinitions.length === 0) {
      warnings.push(`Stage "${stage.displayName}" has no nodes.`);
      continue;
    }

    const nodeIds = new Set(stage.nodeDefinitions.map((node) => node.nodeId));
    for (const node of stage.nodeDefinitions) {
      for (const prerequisiteNodeId of node.prerequisiteNodeIds) {
        if (!nodeIds.has(prerequisiteNodeId)) {
          warnings.push(`Node "${node.displayName}" has a missing prerequisite.`);
        }
      }
      for (const failTargetNodeId of node.failTargetNodeIds) {
        if (!nodeIds.has(failTargetNodeId)) {
          warnings.push(`Node "${node.displayName}" has a missing fail target.`);
        }
      }
      if (node.nodeBehavior === "condition" || node.nodeBehavior === "branch") {
        if (!node.condition) {
          warnings.push(`Node "${node.displayName}" is missing a condition.`);
        }
      }
      if (node.nodeBehavior === "objective" && node.objectiveSubtype === "talk" && !node.targetId) {
        warnings.push(`Talk node "${node.displayName}" has no NPC target.`);
      }
      if (node.nodeBehavior === "narrative" && node.narrativeSubtype === "dialogue" && !node.dialogueDefinitionId) {
        warnings.push(`Narrative node "${node.displayName}" has no dialogue selected.`);
      }
    }
  }

  return warnings;
}

function toGraphNodes(stage: QuestStageDefinition): GraphCanvasNode[] {
  return stage.nodeDefinitions.map((node) => ({
    id: node.nodeId,
    position: { ...node.graphPosition },
    outputs:
      node.nodeBehavior === "branch"
        ? [
            { name: "pass", color: "#89b4fa", yPercent: 0.35 },
            { name: "fail", color: "#f38ba8", yPercent: 0.65 }
          ]
        : undefined
  }));
}

function toGraphEdges(stage: QuestStageDefinition): GraphCanvasEdge[] {
  const edges: GraphCanvasEdge[] = [];
  for (const node of stage.nodeDefinitions) {
    for (const prerequisiteNodeId of node.prerequisiteNodeIds) {
      edges.push({
        fromId: prerequisiteNodeId,
        toId: node.nodeId,
        color: "#89b4fa"
      });
    }
    for (const failTargetNodeId of node.failTargetNodeIds) {
      edges.push({
        fromId: node.nodeId,
        toId: failTargetNodeId,
        fromPort: "fail",
        color: "#f38ba8",
        dashed: true
      });
    }
  }
  return edges;
}

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
    return `${OBJECTIVE_TYPE_ICONS[node.objectiveSubtype ?? "custom"] ?? "⭐"} ${node.displayName}`;
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
  const nodeMap = new Map(stage.nodeDefinitions.map((node) => [node.nodeId, node]));
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
            r={node.nodeBehavior === "branch" || node.nodeBehavior === "condition" ? 10 : 12}
            fill={NODE_BEHAVIOR_COLORS[node.nodeBehavior]}
            opacity={0.92}
          />
        </g>
      ))}
    </svg>
  );
}

function QuestConditionEditor({
  condition,
  onChange
}: {
  condition: QuestConditionDefinition;
  onChange: (condition: QuestConditionDefinition) => void;
}) {
  function handleTypeChange(type: string) {
    switch (type) {
      case "hasFlag":
        onChange({ type: "hasFlag", key: "" });
        break;
      case "questActive":
        onChange({ type: "questActive", questDefinitionId: "" });
        break;
      case "questCompleted":
        onChange({ type: "questCompleted", questDefinitionId: "" });
        break;
      case "questStage":
        onChange({ type: "questStage", questDefinitionId: "", stageId: "", state: "active" });
        break;
      case "not":
        onChange({ type: "not", condition: { type: "hasFlag", key: "" } });
        break;
      default:
        break;
    }
  }

  if (condition.type === "not") {
    return (
      <Paper p="xs" style={{ background: "#f38ba822", borderLeft: "2px solid #f38ba8" }}>
        <Text size="xs" fw={600} mb="xs">
          NOT
        </Text>
        <QuestConditionEditor condition={condition.condition} onChange={(inner) => onChange({ type: "not", condition: inner })} />
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
          { value: "questActive", label: "Quest Active" },
          { value: "questCompleted", label: "Quest Completed" },
          { value: "questStage", label: "Quest Stage" },
          { value: "not", label: "Not" }
        ]}
        onChange={(value) => value && handleTypeChange(value)}
      />
      {condition.type === "hasFlag" && (
        <>
          <TextInput
            size="xs"
            label="Flag Key"
            value={condition.key}
            onChange={(event) => onChange({ ...condition, key: event.currentTarget.value })}
          />
          <TextInput
            size="xs"
            label="Expected Value"
            value={condition.value == null ? "" : String(condition.value)}
            onChange={(event) => onChange({ ...condition, value: event.currentTarget.value })}
          />
        </>
      )}
      {condition.type === "questActive" && (
        <TextInput
          size="xs"
          label="Quest ID"
          value={condition.questDefinitionId}
          onChange={(event) => onChange({ ...condition, questDefinitionId: event.currentTarget.value })}
        />
      )}
      {condition.type === "questCompleted" && (
        <TextInput
          size="xs"
          label="Quest ID"
          value={condition.questDefinitionId}
          onChange={(event) => onChange({ ...condition, questDefinitionId: event.currentTarget.value })}
        />
      )}
      {condition.type === "questStage" && (
        <>
          <TextInput
            size="xs"
            label="Quest ID"
            value={condition.questDefinitionId}
            onChange={(event) => onChange({ ...condition, questDefinitionId: event.currentTarget.value })}
          />
          <TextInput
            size="xs"
            label="Stage ID"
            value={condition.stageId}
            onChange={(event) => onChange({ ...condition, stageId: event.currentTarget.value })}
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
              value && onChange({ ...condition, state: value as "active" | "completed" })
            }
          />
        </>
      )}
    </Stack>
  );
}

function QuestActionsEditor({
  actions,
  onChange,
  label
}: {
  actions: QuestActionDefinition[];
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
            {[
              "setFlag",
              "emitEvent",
              "giveItem",
              "removeItem",
              "playSound",
              "spawnVfx",
              "teleportNpc",
              "moveNpc",
              "setNpcState",
              "custom"
            ].map((type) => (
              <Menu.Item
                key={type}
                onClick={() => onChange([...actions, { type: type as QuestActionDefinition["type"] }])}
              >
                {type}
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
          <Paper key={`${action.type}:${index}`} p="xs" style={{ background: "#181825" }}>
            <Stack gap="xs">
              <Group justify="space-between" align="center">
                <Select
                  size="xs"
                  value={action.type}
                  data={[
                    "setFlag",
                    "emitEvent",
                    "giveItem",
                    "removeItem",
                    "playSound",
                    "spawnVfx",
                    "teleportNpc",
                    "moveNpc",
                    "setNpcState",
                    "custom"
                  ].map((value) => ({ value, label: value }))}
                  onChange={(value) => {
                    if (!value) return;
                    const next = [...actions];
                    next[index] = { type: value as QuestActionDefinition["type"] };
                    onChange(next);
                  }}
                />
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="red"
                  onClick={() => onChange(actions.filter((_, candidate) => candidate !== index))}
                >
                  ×
                </ActionIcon>
              </Group>
              <TextInput
                size="xs"
                label="Target ID"
                value={action.targetId ?? ""}
                onChange={(event) => {
                  const next = [...actions];
                  next[index] = { ...action, targetId: event.currentTarget.value || undefined };
                  onChange(next);
                }}
              />
              <TextInput
                size="xs"
                label="Value"
                value={action.value == null ? "" : String(action.value)}
                onChange={(event) => {
                  const next = [...actions];
                  next[index] = { ...action, value: event.currentTarget.value || undefined };
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
  dialogueDefinitions,
  npcDefinitions,
  onCommand
}: QuestWorkspaceViewProps): WorkspaceViewContribution {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedQuestId, setSelectedQuestId] = useState<string | null>(
    questDefinitions[0]?.definitionId ?? null
  );
  const [graphStageId, setGraphStageId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [contextMenuQuestId, setContextMenuQuestId] = useState<string | null>(null);

  const graphContainerRef = useRef<HTMLDivElement | null>(null);
  const graphCanvasRef = useRef<GraphCanvas | null>(null);
  const selectedQuestRef = useRef<QuestDefinition | null>(null);
  const selectedNodeIdRef = useRef<string | null>(null);

  const effectiveSelectedQuestId =
    selectedQuestId && questDefinitions.some((quest) => quest.definitionId === selectedQuestId)
      ? selectedQuestId
      : questDefinitions[0]?.definitionId ?? null;

  const filteredQuests = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return questDefinitions;
    return questDefinitions.filter((quest) =>
      quest.displayName.toLowerCase().includes(query) ||
      quest.definitionId.toLowerCase().includes(query)
    );
  }, [questDefinitions, searchQuery]);

  const selectedQuest = useMemo(
    () => questDefinitions.find((quest) => quest.definitionId === effectiveSelectedQuestId) ?? null,
    [effectiveSelectedQuestId, questDefinitions]
  );
  const selectedStage = useMemo(
    () => selectedQuest?.stageDefinitions.find((stage) => stage.stageId === graphStageId) ?? null,
    [selectedQuest, graphStageId]
  );
  const selectedNode = useMemo(
    () => selectedStage?.nodeDefinitions.find((node) => node.nodeId === selectedNodeId) ?? null,
    [selectedStage, selectedNodeId]
  );

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
        subject: { subjectKind: "quest-definition", subjectId: quest.definitionId },
        payload: { definition: quest }
      });
    },
    [gameProjectId, onCommand]
  );

  const createQuest = useCallback(() => {
    if (!gameProjectId) return;
    const definition = createDefaultQuestDefinition();
    onCommand({
      kind: "CreateQuestDefinition",
      target: { aggregateKind: "game-project", aggregateId: gameProjectId },
      subject: { subjectKind: "quest-definition", subjectId: definition.definitionId },
      payload: { definition }
    });
    setSelectedQuestId(definition.definitionId);
    setGraphStageId(null);
    setSelectedNodeId(null);
  }, [gameProjectId, onCommand]);

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
    (stageId: string, updater: (stage: QuestStageDefinition) => QuestStageDefinition) => {
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

  const updateGraphCanvas = useCallback(() => {
    const graphCanvas = graphCanvasRef.current;
    const stage = selectedQuestRef.current?.stageDefinitions.find(
      (candidate) => candidate.stageId === graphStageId
    );
    if (!graphCanvas || !stage) return;
    graphCanvas.setNodes(toGraphNodes(stage));
    graphCanvas.setEdges(toGraphEdges(stage));
  }, [graphStageId]);

  useEffect(() => {
    if (!isActive || !graphContainerRef.current || !selectedStage) return;

    const graphCanvas = new GraphCanvas({
      onNodeSelect: (nodeId) => setSelectedNodeId(nodeId),
      onNodeMove: (nodeId, position) => {
        const quest = selectedQuestRef.current;
        const stage = quest?.stageDefinitions.find((candidate) => candidate.stageId === graphStageId);
        const node = stage?.nodeDefinitions.find((candidate) => candidate.nodeId === nodeId);
        if (!node) return;
        updateNode({ ...node, graphPosition: position });
      },
      onCanvasClick: () => setSelectedNodeId(null),
      onConnect: (fromNodeId, toNodeId, fromPort) => {
        if (!selectedStage) return;
        const fromNode = selectedStage.nodeDefinitions.find((candidate) => candidate.nodeId === fromNodeId);
        if (!fromNode || fromNodeId === toNodeId) return;
        if (fromPort === "fail") {
          if (fromNode.failTargetNodeIds.includes(toNodeId)) return;
          updateNode({
            ...fromNode,
            failTargetNodeIds: [...fromNode.failTargetNodeIds, toNodeId]
          });
          return;
        }

        updateStage(selectedStage.stageId, (stage) => ({
          ...stage,
          nodeDefinitions: stage.nodeDefinitions.map((candidate) =>
            candidate.nodeId === toNodeId && !candidate.prerequisiteNodeIds.includes(fromNodeId)
              ? {
                  ...candidate,
                  prerequisiteNodeIds: [...candidate.prerequisiteNodeIds, fromNodeId]
                }
              : candidate
          )
        }));
      },
      renderNode: (canvasNode, element) => {
        const stage = selectedQuestRef.current?.stageDefinitions.find((candidate) => candidate.stageId === graphStageId);
        const node = stage?.nodeDefinitions.find((candidate) => candidate.nodeId === canvasNode.id);
        if (!node) {
          element.innerHTML = '<div style="padding:12px;color:#f38ba8;">Node not found</div>';
          return;
        }

        const isSelected = node.nodeId === selectedNodeIdRef.current;
        const borderColor = isSelected ? "#89b4fa" : NODE_BEHAVIOR_COLORS[node.nodeBehavior];
        element.style.minWidth = "220px";
        element.style.maxWidth = "300px";
        element.style.background = "#181825";
        element.style.border = `2px solid ${borderColor}`;
        element.style.borderRadius = "8px";
        element.style.overflow = "hidden";

        const header = document.createElement("div");
        header.style.cssText = `padding:8px 12px;background:${borderColor}22;border-bottom:1px solid #313244;display:flex;align-items:center;gap:8px;`;
        const name = document.createElement("span");
        name.textContent = nodeLabel(node);
        name.style.cssText = "font-size:12px;color:#cdd6f4;flex:1;font-weight:600;";
        header.appendChild(name);
        const badge = document.createElement("span");
        badge.textContent = node.nodeBehavior.toUpperCase();
        badge.style.cssText = `font-size:10px;padding:2px 6px;border-radius:4px;background:${borderColor}22;color:${borderColor};`;
        header.appendChild(badge);
        element.appendChild(header);

        const content = document.createElement("div");
        content.style.cssText = "padding:12px;font-size:12px;color:#a6adc8;line-height:1.4;";
        content.textContent =
          node.description.length > 120 ? `${node.description.slice(0, 120)}...` : node.description;
        element.appendChild(content);
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
  }, [graphStageId, isActive, selectedStage, updateGraphCanvas, updateNode, updateStage]);

  useEffect(() => {
    if (!isActive || !selectedStage) return;
    updateGraphCanvas();
  }, [isActive, selectedStage, updateGraphCanvas]);

  useEffect(() => {
    graphCanvasRef.current?.setSelectedNode(selectedNodeId);
  }, [selectedNodeId]);

  const leftPanel = (
    <Stack gap={0} h="100%" style={{ minHeight: 0 }} onClick={() => setContextMenuQuestId(null)}>
      <Group justify="space-between" px="md" py="sm" style={{ borderBottom: "1px solid var(--sm-panel-border)" }}>
        <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
          Quests
        </Text>
        <Tooltip label="Add Quest">
          <ActionIcon variant="subtle" size="sm" onClick={createQuest} aria-label="Add Quest">
            +
          </ActionIcon>
        </Tooltip>
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
              <Menu key={quest.definitionId} opened={opened} onChange={(next) => setContextMenuQuestId(next ? quest.definitionId : null)} withinPortal>
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
                    <Group justify="space-between" align="flex-start" gap="xs" wrap="nowrap">
                      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                        <Text size="sm" fw={500} truncate>
                          {quest.displayName}
                        </Text>
                        <Group gap={6}>
                          <Text size="xs" c="dimmed">{quest.stageDefinitions.length} stages</Text>
                          {warnings.length > 0 && <Badge size="xs" color="red">{warnings.length}</Badge>}
                        </Group>
                      </Stack>
                    </Group>
                  </Paper>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item color="red" onClick={() => deleteQuest(quest.definitionId)}>
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
        <Group justify="space-between" px="md" py="sm" style={{ borderBottom: "1px solid var(--sm-panel-border)", background: "#181825" }}>
          <Group gap="xs">
            <Button size="xs" variant="subtle" onClick={() => { setGraphStageId(null); setSelectedNodeId(null); }}>
              ← Back
            </Button>
            <Text size="sm" fw={600}>{selectedQuest.displayName} / {selectedStage.displayName}</Text>
          </Group>
          <Group gap="xs">
            <Menu withinPortal>
              <Menu.Target>
                <Button size="xs" variant="light">+ Add Node</Button>
              </Menu.Target>
              <Menu.Dropdown>
                {[
                  { behavior: "objective", label: "Objective" },
                  { behavior: "narrative", label: "Narrative" },
                  { behavior: "condition", label: "Condition" },
                  { behavior: "branch", label: "Branch" }
                ].map((item) => (
                  <Menu.Item
                    key={item.behavior}
                    onClick={() => {
                      const position = createNextNodePosition(selectedStage);
                      const node = createDefaultQuestNodeDefinition({
                        nodeId: createQuestNodeId(),
                        nodeBehavior: item.behavior as QuestNodeBehavior,
                        displayName:
                          item.behavior === "objective"
                            ? "Objective"
                            : item.behavior === "narrative"
                              ? "Narrative"
                              : item.behavior === "condition"
                                ? "Condition"
                                : "Branch",
                        description:
                          item.behavior === "objective"
                            ? "Talk to someone"
                            : item.behavior === "narrative"
                              ? "Trigger narrative content"
                              : item.behavior === "condition"
                                ? "Wait until a condition is true"
                                : "Route to pass or fail",
                        graphPosition: position
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
                    }}
                  >
                    {item.label}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
            <Button size="xs" variant="subtle" onClick={() => graphCanvasRef.current?.fitToContent()}>
              Fit View
            </Button>
          </Group>
        </Group>
        <Box ref={graphContainerRef} style={{ flex: 1, minHeight: 0 }} />
      </Stack>
    ) : (
      <Stack gap={0} h="100%" style={{ minHeight: 0 }}>
        <Paper p="lg" radius={0} style={{ background: "linear-gradient(135deg, #1e1e2e 0%, #181825 100%)", borderBottom: "1px solid #313244" }}>
          <Group justify="space-between" align="flex-start">
            <Stack gap={4}>
              <Text size="xl" fw={700}>{selectedQuest.displayName}</Text>
              <Text size="sm" c="dimmed">{selectedQuest.description}</Text>
              <Group gap="xs">
                <Badge size="sm" variant="light" color="blue">{selectedQuest.stageDefinitions.length} stages</Badge>
                <Badge size="sm" variant="light" color="grape">{selectedQuest.rewardDefinitions.length} rewards</Badge>
              </Group>
            </Stack>
            <Button
              size="xs"
              variant="light"
              onClick={() => {
                const stage = createDefaultQuestStageDefinition({ displayName: `Stage ${selectedQuest.stageDefinitions.length + 1}` });
                const previousLastStage = selectedQuest.stageDefinitions[selectedQuest.stageDefinitions.length - 1] ?? null;
                commitQuest({
                  ...selectedQuest,
                  stageDefinitions: selectedQuest.stageDefinitions.map((candidate) =>
                    previousLastStage && candidate.stageId === previousLastStage.stageId && !candidate.nextStageId
                      ? { ...candidate, nextStageId: stage.stageId }
                      : candidate
                  ).concat(stage)
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
              <Paper key={stage.stageId} p="md" style={{ background: "#181825", border: selectedQuest.startStageId === stage.stageId ? "2px solid #a6e3a1" : "1px solid #313244" }}>
                <Group justify="space-between" align="flex-start">
                  <Stack gap={4} style={{ flex: 1 }}>
                    <Group gap="xs">
                      {selectedQuest.startStageId === stage.stageId && <Text c="#a6e3a1">▶</Text>}
                      <Text fw={600}>{stage.displayName}</Text>
                      <Badge size="xs" variant="light">{stage.nodeDefinitions.length} nodes</Badge>
                    </Group>
                    <MiniStageGraph stage={stage} />
                    {stage.nextStageId && <Text size="xs" c="dimmed">Next → {selectedQuest.stageDefinitions.find((candidate) => candidate.stageId === stage.nextStageId)?.displayName ?? stage.nextStageId}</Text>}
                  </Stack>
                  <Group gap="xs">
                    <Button size="xs" variant="subtle" onClick={() => { setGraphStageId(stage.stageId); setSelectedNodeId(null); }}>
                      Open Graph
                    </Button>
                    <Button size="xs" variant="subtle" onClick={() => { setGraphStageId(null); setSelectedNodeId(null); }}>
                      Select
                    </Button>
                  </Group>
                </Group>
                {index < selectedQuest.stageDefinitions.length - 1 && (
                  <Text mt="sm" c="dimmed">→</Text>
                )}
              </Paper>
            ))}

            {validateQuest(selectedQuest).length > 0 && (
              <Paper p="md" style={{ background: "#f38ba822", border: "1px solid #f38ba8" }}>
                <Text size="sm" fw={600} c="#f38ba8" mb="xs">Validation</Text>
                <Stack gap={4}>
                  {validateQuest(selectedQuest).map((warning, index) => (
                    <Text key={`${warning}:${index}`} size="sm" c="#f38ba8">• {warning}</Text>
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
        Choose a quest from the left panel, or create a new one with the + button.
      </Text>
    </Stack>
  );

  const rightPanel = (
    <Inspector
      selectionLabel={
        selectedNode
          ? selectedNode.displayName
          : selectedStage
            ? selectedStage.displayName
            : selectedQuest?.displayName ?? null
      }
      selectionIcon={selectedNode ? "🧩" : selectedStage ? "🪜" : "📜"}
    >
      {selectedQuest && !selectedStage && !selectedNode && (
        <Stack gap="md">
          <TextInput
            label="Name"
            value={selectedQuest.displayName}
            onChange={(event) => commitQuest({ ...selectedQuest, displayName: event.currentTarget.value })}
          />
          <Textarea
            label="Description"
            value={selectedQuest.description}
            autosize
            minRows={4}
            onChange={(event) => commitQuest({ ...selectedQuest, description: event.currentTarget.value })}
          />
          <Switch
            label="Repeatable"
            checked={selectedQuest.repeatable}
            onChange={(event) => commitQuest({ ...selectedQuest, repeatable: event.currentTarget.checked })}
          />
        </Stack>
      )}

      {selectedQuest && selectedStage && !selectedNode && (
        <Stack gap="md">
          <TextInput
            label="Stage Name"
            value={selectedStage.displayName}
            onChange={(event) =>
              updateStage(selectedStage.stageId, (stage) => ({ ...stage, displayName: event.currentTarget.value }))
            }
          />
          <Select
            label="Next Stage"
            clearable
            value={selectedStage.nextStageId}
            data={selectedQuest.stageDefinitions
              .filter((stage) => stage.stageId !== selectedStage.stageId)
              .map((stage) => ({ value: stage.stageId, label: stage.displayName }))}
            onChange={(value) => updateStage(selectedStage.stageId, (stage) => ({ ...stage, nextStageId: value ?? null }))}
          />
          <Switch
            label="Start Stage"
            checked={selectedQuest.startStageId === selectedStage.stageId}
            onChange={(event) => {
              if (!event.currentTarget.checked) return;
              commitQuest({ ...selectedQuest, startStageId: selectedStage.stageId });
            }}
          />
          <Button
            color="red"
            variant="light"
            disabled={selectedQuest.stageDefinitions.length <= 1}
            onClick={() => {
              const remainingStages = selectedQuest.stageDefinitions.filter((stage) => stage.stageId !== selectedStage.stageId);
              const nextStartStageId =
                selectedQuest.startStageId === selectedStage.stageId
                  ? remainingStages[0]?.stageId ?? selectedQuest.startStageId
                  : selectedQuest.startStageId;
              commitQuest({
                ...selectedQuest,
                startStageId: nextStartStageId,
                stageDefinitions: remainingStages.map((stage) => ({
                  ...stage,
                  nextStageId: stage.nextStageId === selectedStage.stageId ? null : stage.nextStageId
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
            onChange={(event) => updateNode({ ...selectedNode, displayName: event.currentTarget.value })}
          />
          <Textarea
            label="Description"
            value={selectedNode.description}
            autosize
            minRows={3}
            onChange={(event) => updateNode({ ...selectedNode, description: event.currentTarget.value })}
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
                objectiveSubtype: value === "objective" ? selectedNode.objectiveSubtype ?? "talk" : undefined,
                narrativeSubtype: value === "narrative" ? selectedNode.narrativeSubtype ?? "dialogue" : undefined,
                condition: value === "condition" || value === "branch" ? selectedNode.condition ?? { type: "hasFlag", key: "" } : undefined,
                failTargetNodeIds: value === "branch" ? selectedNode.failTargetNodeIds : []
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
                  { value: "trigger", label: "Trigger" },
                  { value: "castSpell", label: "Cast Spell" },
                  { value: "custom", label: "Custom" }
                ]}
                onChange={(value) => value && updateNode({ ...selectedNode, objectiveSubtype: value as QuestNodeDefinition["objectiveSubtype"] })}
              />
              <Select
                label="Target NPC"
                clearable
                value={selectedNode.targetId ?? null}
                data={npcDefinitions.map((npc) => ({ value: npc.definitionId, label: npc.displayName }))}
                onChange={(value) => updateNode({ ...selectedNode, targetId: value ?? undefined })}
              />
              <Select
                label="Dialogue"
                clearable
                value={selectedNode.dialogueDefinitionId ?? null}
                data={dialogueDefinitions.map((dialogue) => ({ value: dialogue.definitionId, label: dialogue.displayName }))}
                onChange={(value) => updateNode({ ...selectedNode, dialogueDefinitionId: value ?? undefined })}
              />
              <TextInput
                label="Complete On"
                placeholder="dialogueEnd or node id"
                value={selectedNode.completeOn ?? ""}
                onChange={(event) => updateNode({ ...selectedNode, completeOn: event.currentTarget.value || undefined })}
              />
              <NumberInput
                label="Count"
                min={1}
                value={selectedNode.count ?? 1}
                onChange={(value) => updateNode({ ...selectedNode, count: typeof value === "number" ? value : 1 })}
              />
              <Switch
                label="Optional"
                checked={selectedNode.optional ?? false}
                onChange={(event) => updateNode({ ...selectedNode, optional: event.currentTarget.checked })}
              />
              <Switch
                label="Show In HUD"
                checked={selectedNode.showInHud}
                onChange={(event) => updateNode({ ...selectedNode, showInHud: event.currentTarget.checked })}
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
                  { value: "event", label: "Event" },
                  { value: "cutscene", label: "Cutscene" }
                ]}
                onChange={(value) => value && updateNode({ ...selectedNode, narrativeSubtype: value as QuestNodeDefinition["narrativeSubtype"] })}
              />
              {selectedNode.narrativeSubtype === "dialogue" && (
                <Select
                  label="Dialogue"
                  clearable
                  value={selectedNode.dialogueDefinitionId ?? null}
                  data={dialogueDefinitions.map((dialogue) => ({ value: dialogue.definitionId, label: dialogue.displayName }))}
                  onChange={(value) => updateNode({ ...selectedNode, dialogueDefinitionId: value ?? undefined })}
                />
              )}
              {selectedNode.narrativeSubtype === "event" && (
                <TextInput
                  label="Event Name"
                  value={selectedNode.eventName ?? ""}
                  onChange={(event) => updateNode({ ...selectedNode, eventName: event.currentTarget.value || undefined })}
                />
              )}
              {selectedNode.narrativeSubtype === "voiceover" && (
                <Textarea
                  label="Voiceover Text"
                  value={selectedNode.voiceoverText ?? ""}
                  autosize
                  minRows={3}
                  onChange={(event) => updateNode({ ...selectedNode, voiceoverText: event.currentTarget.value || undefined })}
                />
              )}
            </>
          )}

          {(selectedNode.nodeBehavior === "condition" || selectedNode.nodeBehavior === "branch") && (
            <QuestConditionEditor
              condition={selectedNode.condition ?? { type: "hasFlag", key: "" }}
              onChange={(condition) => updateNode({ ...selectedNode, condition })}
            />
          )}

          {selectedNode.nodeBehavior === "branch" && (
            <Text size="xs" c="dimmed">
              Drag from the branch node's fail port to create dashed fail edges.
            </Text>
          )}

          <QuestActionsEditor
            label="On Enter"
            actions={selectedNode.onEnterActions}
            onChange={(onEnterActions) => updateNode({ ...selectedNode, onEnterActions })}
          />
          <QuestActionsEditor
            label="On Complete"
            actions={selectedNode.onCompleteActions}
            onChange={(onCompleteActions) => updateNode({ ...selectedNode, onCompleteActions })}
          />

          <Button
            color="red"
            variant="light"
            disabled={selectedStage.nodeDefinitions.length <= 1}
            onClick={() => {
              updateStage(selectedStage.stageId, (stage) => ({
                ...stage,
                nodeDefinitions: stage.nodeDefinitions.filter((candidate) => candidate.nodeId !== selectedNode.nodeId).map((candidate) => ({
                  ...candidate,
                  prerequisiteNodeIds: candidate.prerequisiteNodeIds.filter((nodeId) => nodeId !== selectedNode.nodeId),
                  failTargetNodeIds: candidate.failTargetNodeIds.filter((nodeId) => nodeId !== selectedNode.nodeId)
                })),
                entryNodeIds: stage.entryNodeIds.filter((nodeId) => nodeId !== selectedNode.nodeId)
              }));
              setSelectedNodeId(null);
            }}
          >
            Delete Node
          </Button>
        </Stack>
      )}
    </Inspector>
  );

  return {
    leftPanel,
    rightPanel,
    centerPanel,
    viewportOverlay: null
  };
}
