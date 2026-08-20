/**
 * RenderProductModeView: shader graph authoring host.
 *
 * Owns Render sub-nav, shader-definition selection, node-palette actions, and
 * the graph-canvas/editor surface for canonical shader graph documents.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Menu,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  UnstyledButton
} from "@mantine/core";
import type {
  NodeGroup,
  SemanticCommand,
  ShaderGraphDocument,
  ShaderNodeDefinition,
  ShaderNodeInstance,
  ShaderParameter,
  ShaderParameterValue,
  ShaderTargetKind,
  TextureDefinition
} from "@sugarmagic/domain";
import {
  createDefaultShaderGraphDocument,
  createNodeGroup,
  duplicateShaderGraphDocument,
  getShaderNodeDefinition,
  listShaderNodeDefinitions
} from "@sugarmagic/domain";
import {
  AddNodeMenu,
  BuildSubNav,
  Inspector,
  PanelSection,
  WarnToast
} from "@sugarmagic/ui";
import {
  NodeEditor,
  type GraphEditorConnection,
  type GraphEditorHandle,
  type GraphEditorNodeMove
} from "@sugarmagic/ui/node-editor";
import {
  SHADER_NODE_KIND,
  applyShaderNodeMoves,
  checkShaderConnection,
  shaderEdgeIdsFor,
  shaderToEditorEdges,
  shaderToEditorNodes
} from "./shader-graph-mapping";
import { ShaderNodeCard } from "./ShaderNodeCard";
import {
  frameAround,
  membershipChanged,
  placeNodeInGroup,
  resolveMembership,
  shiftGroupMembers,
  toAbsolutePosition,
  toEditorGroups
} from "../design/node-group-layout";

const SHADER_NODE_RENDERERS = { [SHADER_NODE_KIND]: ShaderNodeCard };
import type { RenderWorkspaceKind } from "@sugarmagic/shell";
import type { WorkspaceNavigationTarget } from "../workspace-navigation";

const renderWorkspaceKinds = [{ id: "shaders", label: "Shaders", icon: "🎨" }];
const RENDER_WORKSPACE_DEBUG_STORAGE_KEY = "sugarmagic:debug:render-workspace";

function shouldDebugRenderWorkspace(): boolean {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return false;
  }

  try {
    return (
      window.localStorage.getItem(RENDER_WORKSPACE_DEBUG_STORAGE_KEY) === "true"
    );
  } catch {
    return false;
  }
}

function debugRenderWorkspace(
  event: string,
  payload: Record<string, unknown>
): void {
  if (!shouldDebugRenderWorkspace()) {
    return;
  }
  console.debug(`[render-workspace] ${event}`, payload);
}

function createNodeId(): string {
  return `shader-node:${crypto.randomUUID()}`;
}

function createEdgeId(): string {
  return `shader-edge:${crypto.randomUUID()}`;
}

function createParameterId(): string {
  return `shader-parameter:${crypto.randomUUID()}`;
}

function createDefaultNode(
  definition: ShaderNodeDefinition
): ShaderNodeInstance {
  return {
    nodeId: createNodeId(),
    nodeType: definition.nodeType,
    position: { x: 96, y: 96 },
    settings: Object.fromEntries(
      definition.settings.map((setting) => [
        setting.settingId,
        setting.defaultValue
      ])
    )
  };
}

function createDefaultParameter(): ShaderParameter {
  return {
    parameterId: createParameterId(),
    displayName: "Parameter",
    dataType: "float",
    defaultValue: 0
  };
}

export interface RenderProductModeViewProps {
  activeRenderKind: RenderWorkspaceKind;
  gameProjectId: string | null;
  shaderDefinitions: ShaderGraphDocument[];
  textureDefinitions: TextureDefinition[];
  onSelectKind: (kind: RenderWorkspaceKind) => void;
  onCommand: (command: SemanticCommand) => void;
  navigationTarget?: WorkspaceNavigationTarget | null;
  onConsumeNavigationTarget?: () => void;
}

export interface RenderProductModeViewResult {
  subHeaderPanel: React.ReactNode;
  leftPanel: React.ReactNode | null;
  rightPanel: React.ReactNode;
  centerPanel?: React.ReactNode;
  viewportOverlay: React.ReactNode;
}

export function useRenderProductModeView(
  props: RenderProductModeViewProps
): RenderProductModeViewResult {
  const {
    activeRenderKind,
    gameProjectId,
    shaderDefinitions,
    textureDefinitions,
    onSelectKind,
    onCommand,
    navigationTarget,
    onConsumeNavigationTarget
  } = props;
  const [selectedShaderId, setSelectedShaderId] = useState<string | null>(
    shaderDefinitions[0]?.shaderDefinitionId ?? null
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [shaderContextMenu, setShaderContextMenu] = useState<{
    x: number;
    y: number;
    shaderDefinitionId: string;
  } | null>(null);
  const graphEditorRef = useRef<GraphEditorHandle | null>(null);
  const [graphSelection, setGraphSelection] = useState<{
    nodeIds: string[];
    groupIds: string[];
    edgeIds: string[];
  }>({ nodeIds: [], groupIds: [], edgeIds: [] });
  const [connectionRefusal, setConnectionRefusal] = useState<string | null>(
    null
  );
  const selectedShaderRef = useRef<ShaderGraphDocument | null>(null);
  const selectedNodeIdRef = useRef<string | null>(null);

  const selectedShader = useMemo(
    () =>
      shaderDefinitions.find(
        (definition) => definition.shaderDefinitionId === selectedShaderId
      ) ??
      shaderDefinitions[0] ??
      null,
    [selectedShaderId, shaderDefinitions]
  );

  useEffect(() => {
    selectedShaderRef.current = selectedShader;
  }, [selectedShader]);

  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
  }, [selectedNodeId]);

  const selectedNode = useMemo(
    () =>
      selectedShader?.nodes.find((node) => node.nodeId === selectedNodeId) ??
      null,
    [selectedNodeId, selectedShader]
  );

  const availableNodeDefinitions = useMemo(
    () =>
      listShaderNodeDefinitions().filter((definition) =>
        selectedShader
          ? definition.validTargetKinds.includes(selectedShader.targetKind)
          : true
      ),
    [selectedShader]
  );

  useEffect(() => {
    if (shaderDefinitions.length === 0 && selectedShaderId === null) {
      return;
    }
    debugRenderWorkspace("mounted", {
      activeRenderKind,
      shaderDefinitionCount: shaderDefinitions.length,
      selectedShaderId
    });
    return () => {
      debugRenderWorkspace("unmounted", {
        activeRenderKind,
        selectedShaderId: selectedShaderRef.current?.shaderDefinitionId ?? null
      });
    };
  }, [activeRenderKind, selectedShaderId, shaderDefinitions.length]);

  useEffect(() => {
    if (navigationTarget?.kind !== "shader-graph") {
      return;
    }
    setSelectedShaderId(navigationTarget.shaderDefinitionId);
    onConsumeNavigationTarget?.();
  }, [navigationTarget, onConsumeNavigationTarget]);

  useEffect(() => {
    if (
      shaderDefinitions.length === 0 &&
      selectedShaderId === null &&
      !selectedShader
    ) {
      return;
    }
    debugRenderWorkspace("selected-shader-changed", {
      selectedShaderId,
      resolvedShaderId: selectedShader?.shaderDefinitionId ?? null,
      nodeCount: selectedShader?.nodes.length ?? 0,
      edgeCount: selectedShader?.edges.length ?? 0
    });
  }, [selectedShader, selectedShaderId]);

  const createShader = useCallback(
    (targetKind: ShaderTargetKind) => {
      if (!gameProjectId) {
        return;
      }
      const definition = createDefaultShaderGraphDocument(gameProjectId, {
        displayName:
          targetKind === "post-process"
            ? "Post Process Shader"
            : "Shader Graph",
        targetKind
      });
      onCommand({
        kind: "CreateShaderGraph",
        target: {
          aggregateKind: "content-definition",
          aggregateId: definition.shaderDefinitionId
        },
        subject: {
          subjectKind: "shader-definition",
          subjectId: definition.shaderDefinitionId
        },
        payload: {
          definition
        }
      });
      setSelectedShaderId(definition.shaderDefinitionId);
      setSelectedNodeId(null);
    },
    [gameProjectId, onCommand]
  );

  const duplicateShaderById = useCallback(
    (sourceShaderId: string) => {
      if (!gameProjectId) {
        return;
      }
      const source = shaderDefinitions.find(
        (definition) => definition.shaderDefinitionId === sourceShaderId
      );
      if (!source) {
        return;
      }
      const definition = duplicateShaderGraphDocument(source, gameProjectId);
      onCommand({
        kind: "CreateShaderGraph",
        target: {
          aggregateKind: "content-definition",
          aggregateId: definition.shaderDefinitionId
        },
        subject: {
          subjectKind: "shader-definition",
          subjectId: definition.shaderDefinitionId
        },
        payload: {
          definition,
          insertAfterShaderDefinitionId: source.shaderDefinitionId
        }
      });
      setSelectedShaderId(definition.shaderDefinitionId);
      setSelectedNodeId(null);
    },
    [gameProjectId, onCommand, shaderDefinitions]
  );

  const deleteShaderById = useCallback(
    (shaderDefinitionId: string) => {
      onCommand({
        kind: "DeleteShaderGraph",
        target: {
          aggregateKind: "content-definition",
          aggregateId: shaderDefinitionId
        },
        subject: {
          subjectKind: "shader-definition",
          subjectId: shaderDefinitionId
        },
        payload: {
          shaderDefinitionId
        }
      });
      if (selectedShaderId === shaderDefinitionId) {
        setSelectedShaderId(null);
        setSelectedNodeId(null);
      }
    },
    [onCommand, selectedShaderId]
  );

  const addNodeDefinition = useCallback(
    (definition: ShaderNodeDefinition) => {
      if (!selectedShader) {
        return;
      }
      const node = createDefaultNode(definition);
      onCommand({
        kind: "UpdateShaderNode",
        target: {
          aggregateKind: "content-definition",
          aggregateId: selectedShader.shaderDefinitionId
        },
        subject: {
          subjectKind: "shader-definition",
          subjectId: selectedShader.shaderDefinitionId
        },
        payload: {
          shaderDefinitionId: selectedShader.shaderDefinitionId,
          node: {
            ...node,
            position: {
              x: 80 + selectedShader.nodes.length * 24,
              y: 80 + selectedShader.nodes.length * 18
            }
          }
        }
      });
      setSelectedNodeId(node.nodeId);
    },
    [onCommand, selectedShader]
  );

  const editorNodes = useMemo(
    () =>
      selectedShader
        ? shaderToEditorNodes(selectedShader).map((node) =>
            placeNodeInGroup(node, selectedShader.groups)
          )
        : [],
    [selectedShader]
  );
  const editorGroups = useMemo(
    () => toEditorGroups(selectedShader?.groups),
    [selectedShader]
  );
  const editorEdges = useMemo(
    () => (selectedShader ? shaderToEditorEdges(selectedShader) : []),
    [selectedShader]
  );

  const commandTarget = useCallback(
    (shaderDefinitionId: string) => ({
      target: {
        aggregateKind: "content-definition" as const,
        aggregateId: shaderDefinitionId
      },
      subject: {
        subjectKind: "shader-definition" as const,
        subjectId: shaderDefinitionId
      }
    }),
    []
  );

  const setGroups = useCallback(
    (shader: ShaderGraphDocument, groups: NodeGroup[]) => {
      onCommand({
        kind: "SetShaderGraphNodeGroups",
        ...commandTarget(shader.shaderDefinitionId),
        payload: {
          shaderDefinitionId: shader.shaderDefinitionId,
          groups
        }
      });
    },
    [commandTarget, onCommand]
  );

  // Moving a frame moves its members with it, so the frame's new position and
  // each member's shifted position go out together.
  const handleGroupsMoved = useCallback(
    (moves: GraphEditorNodeMove[]) => {
      if (!selectedShader) return;
      const groups = selectedShader.groups ?? [];
      const nextGroups = groups.map((group) => {
        const move = moves.find((candidate) => candidate.id === group.groupId);
        return move ? { ...group, position: { ...move.position } } : group;
      });
      setGroups(selectedShader, nextGroups);

      for (const move of moves) {
        const group = groups.find((candidate) => candidate.groupId === move.id);
        if (!group) continue;
        const { dx, dy } = shiftGroupMembers(group, move.position);
        for (const node of selectedShader.nodes) {
          if (!group.memberNodeIds.includes(node.nodeId)) continue;
          onCommand({
            kind: "UpdateShaderNode",
            ...commandTarget(selectedShader.shaderDefinitionId),
            payload: {
              shaderDefinitionId: selectedShader.shaderDefinitionId,
              node: {
                ...node,
                position: {
                  x: node.position.x + dx,
                  y: node.position.y + dy
                }
              }
            }
          });
        }
      }
    },
    [commandTarget, onCommand, selectedShader, setGroups]
  );

  const handleGroupRenamed = useCallback(
    (groupId: string, label: string) => {
      if (!selectedShader) return;
      setGroups(
        selectedShader,
        (selectedShader.groups ?? []).map((group) =>
          group.groupId === groupId ? { ...group, label } : group
        )
      );
    },
    [selectedShader, setGroups]
  );

  // Removing a frame leaves its members exactly where they are.
  const handleGroupsDeleted = useCallback(
    (groupIds: string[]) => {
      if (!selectedShader) return;
      setGroups(
        selectedShader,
        (selectedShader.groups ?? []).filter(
          (group) => !groupIds.includes(group.groupId)
        )
      );
    },
    [selectedShader, setGroups]
  );

  const groupSelection = useCallback(() => {
    if (!selectedShader) return;
    const memberNodeIds = graphSelection.nodeIds;
    if (memberNodeIds.length < 2) return;
    const frame = frameAround(
      selectedShader.nodes
        .filter((node) => memberNodeIds.includes(node.nodeId))
        .map((node) => node.position)
    );
    setGroups(selectedShader, [
      ...(selectedShader.groups ?? []),
      createNodeGroup({
        label: "Group",
        memberNodeIds,
        position: frame.position,
        size: frame.size
      })
    ]);
  }, [graphSelection.nodeIds, selectedShader, setGroups]);

  // Shader commands are per node, so a multi-node drag sends one command each.
  const handleNodesMoved = useCallback(
    (moves: GraphEditorNodeMove[]) => {
      if (!selectedShader) return;
      // A node inside a frame reports a position relative to it; the document
      // stores absolute positions.
      const absolute = moves.map((move) => ({
        id: move.id,
        position: toAbsolutePosition(
          move.position,
          move.parentId,
          selectedShader.groups
        )
      }));
      // Where a node was dropped decides which frame it belongs to.
      let groups = selectedShader.groups ?? [];
      for (const move of absolute) {
        groups = resolveMembership(groups, move.id, move.position);
      }
      if (membershipChanged(selectedShader.groups, groups)) {
        setGroups(selectedShader, groups);
      }

      for (const node of applyShaderNodeMoves(selectedShader, absolute)) {
        onCommand({
          kind: "UpdateShaderNode",
          ...commandTarget(selectedShader.shaderDefinitionId),
          payload: {
            shaderDefinitionId: selectedShader.shaderDefinitionId,
            node
          }
        });
      }
    },
    [commandTarget, onCommand, selectedShader, setGroups]
  );

  // A refusal has to say why. A connection that silently springs back reads as
  // the editor being broken.
  const handleIsValidConnection = useCallback(
    (connection: GraphEditorConnection) => {
      if (!selectedShader) return false;
      const check = checkShaderConnection(selectedShader, connection);
      if (!check.allowed && check.reason) {
        setConnectionRefusal(check.reason);
      }
      return check.allowed;
    },
    [selectedShader]
  );

  const handleGraphConnect = useCallback(
    (connection: GraphEditorConnection) => {
      if (!selectedShader) return;
      if (!connection.fromPort || !connection.toPort) return;
      onCommand({
        kind: "AddShaderEdge",
        ...commandTarget(selectedShader.shaderDefinitionId),
        payload: {
          shaderDefinitionId: selectedShader.shaderDefinitionId,
          edge: {
            edgeId: createEdgeId(),
            sourceNodeId: connection.fromId,
            sourcePortId: connection.fromPort,
            targetNodeId: connection.toId,
            targetPortId: connection.toPort
          }
        }
      });
    },
    [commandTarget, onCommand, selectedShader]
  );

  const handleEdgesDeleted = useCallback(
    (edgeIds: string[]) => {
      if (!selectedShader) return;
      for (const edgeId of edgeIds) {
        onCommand({
          kind: "RemoveShaderEdge",
          ...commandTarget(selectedShader.shaderDefinitionId),
          payload: {
            shaderDefinitionId: selectedShader.shaderDefinitionId,
            edgeId
          }
        });
      }
    },
    [commandTarget, onCommand, selectedShader]
  );

  // Removing a node leaves its connections dangling, so they go first.
  const handleNodesDeleted = useCallback(
    (nodeIds: string[]) => {
      if (!selectedShader) return;
      handleEdgesDeleted(shaderEdgeIdsFor(selectedShader, nodeIds));
      for (const nodeId of nodeIds) {
        onCommand({
          kind: "RemoveShaderNode",
          ...commandTarget(selectedShader.shaderDefinitionId),
          payload: {
            shaderDefinitionId: selectedShader.shaderDefinitionId,
            nodeId
          }
        });
      }
      if (selectedNodeId && nodeIds.includes(selectedNodeId)) {
        setSelectedNodeId(null);
      }
    },
    [
      commandTarget,
      handleEdgesDeleted,
      onCommand,
      selectedNodeId,
      selectedShader
    ]
  );

  const hasGraphSelection =
    graphSelection.nodeIds.length +
      graphSelection.groupIds.length +
      graphSelection.edgeIds.length >
    0;

  const shaderGraphChrome = (
    <Group gap={6} align="center">
      <AddNodeMenu
        items={availableNodeDefinitions.map((definition) => ({
          id: definition.nodeType,
          label: definition.displayName,
          description: definition.category
        }))}
        disabled={!selectedShader}
        onSelect={(nodeType) => {
          const definition = availableNodeDefinitions.find(
            (candidate) => candidate.nodeType === nodeType
          );
          if (definition) addNodeDefinition(definition);
        }}
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

  return {
    subHeaderPanel: (
      <BuildSubNav
        workspaceKinds={renderWorkspaceKinds}
        activeKindId={activeRenderKind}
        onSelectKind={(id) => onSelectKind(id as RenderWorkspaceKind)}
      />
    ),
    leftPanel: (
      <>
        <PanelSection
          title="Shaders"
          icon="🎨"
          actions={
            <Menu withinPortal position="bottom-end" offset={4}>
              <Menu.Target>
                <ActionIcon size="sm" variant="subtle" aria-label="Add shader">
                  +
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item onClick={() => createShader("mesh-surface")}>
                  New Surface
                </Menu.Item>
                <Menu.Item onClick={() => createShader("mesh-deform")}>
                  New Deform
                </Menu.Item>
                <Menu.Item onClick={() => createShader("post-process")}>
                  New Post
                </Menu.Item>
                <Menu.Item onClick={() => createShader("billboard-surface")}>
                  New Billboard
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          }
        >
          <ScrollArea h="calc(100vh - 220px)" type="auto">
            <Stack gap={4}>
              {shaderDefinitions.map((definition) => {
                const isSelected =
                  definition.shaderDefinitionId ===
                  selectedShader?.shaderDefinitionId;
                return (
                  <UnstyledButton
                    key={definition.shaderDefinitionId}
                    onClick={() => {
                      debugRenderWorkspace("shader-row-click", {
                        shaderDefinitionId: definition.shaderDefinitionId,
                        displayName: definition.displayName,
                        nodeCount: definition.nodes.length,
                        edgeCount: definition.edges.length
                      });
                      setSelectedShaderId(definition.shaderDefinitionId);
                      setSelectedNodeId(null);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setSelectedShaderId(definition.shaderDefinitionId);
                      setSelectedNodeId(null);
                      setShaderContextMenu({
                        x: event.clientX,
                        y: event.clientY,
                        shaderDefinitionId: definition.shaderDefinitionId
                      });
                    }}
                    styles={{
                      root: {
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-start",
                        gap: 2,
                        padding: "8px 10px",
                        borderRadius: "var(--sm-radius-sm)",
                        background: isSelected
                          ? "var(--sm-active-bg)"
                          : "transparent",
                        color: isSelected
                          ? "var(--sm-accent-blue)"
                          : "var(--sm-color-text)",
                        border: isSelected
                          ? "1px solid var(--sm-accent-blue)"
                          : "1px solid transparent"
                      }
                    }}
                  >
                    <Group
                      justify="space-between"
                      align="center"
                      wrap="nowrap"
                      w="100%"
                    >
                      <Text size="xs" fw={isSelected ? 700 : 500}>
                        {definition.displayName}
                      </Text>
                      {isSelected ? (
                        <Badge size="xs" variant="light" color="blue">
                          Open
                        </Badge>
                      ) : null}
                    </Group>
                    <Text size="xs" c="var(--sm-color-overlay0)">
                      {definition.targetKind}
                    </Text>
                  </UnstyledButton>
                );
              })}
            </Stack>
          </ScrollArea>
        </PanelSection>
        <Menu
          opened={Boolean(shaderContextMenu)}
          onChange={(opened) => {
            if (!opened) setShaderContextMenu(null);
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
                left: shaderContextMenu?.x ?? -9999,
                top: shaderContextMenu?.y ?? -9999,
                width: 1,
                height: 1
              }}
            />
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              onClick={() => {
                if (!shaderContextMenu) return;
                duplicateShaderById(shaderContextMenu.shaderDefinitionId);
              }}
            >
              Duplicate
            </Menu.Item>
            <Menu.Item
              color="red"
              onClick={() => {
                if (!shaderContextMenu) return;
                deleteShaderById(shaderContextMenu.shaderDefinitionId);
              }}
            >
              Delete
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </>
    ),
    rightPanel: (
      <Inspector
        selectionLabel={selectedShader?.displayName ?? null}
        selectionIcon="🎨"
      >
        {selectedShader ? (
          <ShaderInspector
            shader={selectedShader}
            selectedNode={selectedNode}
            textureDefinitions={textureDefinitions}
            onCommand={onCommand}
            onDeleteSelectedNode={() => {
              if (!selectedNode) {
                return;
              }
              onCommand({
                kind: "RemoveShaderNode",
                target: {
                  aggregateKind: "content-definition",
                  aggregateId: selectedShader.shaderDefinitionId
                },
                subject: {
                  subjectKind: "shader-definition",
                  subjectId: selectedShader.shaderDefinitionId
                },
                payload: {
                  shaderDefinitionId: selectedShader.shaderDefinitionId,
                  nodeId: selectedNode.nodeId
                }
              });
              setSelectedNodeId(null);
            }}
          />
        ) : (
          <Text size="xs" c="var(--sm-color-overlay0)">
            Create or select a shader graph to edit it.
          </Text>
        )}
      </Inspector>
    ),
    centerPanel: (
      <div
        style={{
          position: "relative",
          height: "100%",
          minHeight: 0
        }}
      >
        <NodeEditor
          ref={graphEditorRef}
          nodes={editorNodes}
          edges={editorEdges}
          renderers={SHADER_NODE_RENDERERS}
          primarySelectionId={selectedNodeId}
          onPrimarySelectionChange={setSelectedNodeId}
          groups={editorGroups}
          onSelectionChange={setGraphSelection}
          onNodesMoved={handleNodesMoved}
          onGroupsMoved={handleGroupsMoved}
          onGroupRenamed={handleGroupRenamed}
          onGroupsDeleted={handleGroupsDeleted}
          onConnect={handleGraphConnect}
          isValidConnection={handleIsValidConnection}
          onNodesDeleted={handleNodesDeleted}
          onEdgesDeleted={handleEdgesDeleted}
          chrome={shaderGraphChrome}
        />
        {connectionRefusal ? (
          <WarnToast
            message={connectionRefusal}
            onDismiss={() => setConnectionRefusal(null)}
          />
        ) : null}
      </div>
    ),
    viewportOverlay: null
  };
}

function ShaderInspector(props: {
  shader: ShaderGraphDocument;
  selectedNode: ShaderNodeInstance | null;
  textureDefinitions: TextureDefinition[];
  onCommand: (command: SemanticCommand) => void;
  onDeleteSelectedNode: () => void;
}) {
  const {
    shader,
    selectedNode,
    textureDefinitions,
    onCommand,
    onDeleteSelectedNode
  } = props;
  const [draftName, setDraftName] = useState(shader.displayName);

  useEffect(() => {
    setDraftName(shader.displayName);
  }, [shader.displayName]);

  return (
    <Stack gap="md">
      <TextInput
        label="Shader Name"
        value={draftName}
        onChange={(event) => setDraftName(event.currentTarget.value)}
        size="xs"
      />
      <Button
        size="xs"
        variant="light"
        disabled={!draftName.trim() || draftName.trim() === shader.displayName}
        onClick={() =>
          onCommand({
            kind: "RenameShaderGraph",
            target: {
              aggregateKind: "content-definition",
              aggregateId: shader.shaderDefinitionId
            },
            subject: {
              subjectKind: "shader-definition",
              subjectId: shader.shaderDefinitionId
            },
            payload: {
              shaderDefinitionId: shader.shaderDefinitionId,
              displayName: draftName.trim()
            }
          })
        }
      >
        Save Shader Name
      </Button>
      <Stack gap={4}>
        <Text size="xs" fw={600} c="var(--sm-color-subtext)" tt="uppercase">
          Target
        </Text>
        <Text size="xs">{shader.targetKind}</Text>
      </Stack>
      <Stack gap={4}>
        <Group justify="space-between" align="center">
          <Text size="xs" fw={600} c="var(--sm-color-subtext)" tt="uppercase">
            Parameters
          </Text>
          <Button
            size="compact-xs"
            variant="subtle"
            onClick={() =>
              onCommand({
                kind: "UpdateShaderParameter",
                target: {
                  aggregateKind: "content-definition",
                  aggregateId: shader.shaderDefinitionId
                },
                subject: {
                  subjectKind: "shader-definition",
                  subjectId: shader.shaderDefinitionId
                },
                payload: {
                  shaderDefinitionId: shader.shaderDefinitionId,
                  parameter: createDefaultParameter()
                }
              })
            }
          >
            Add
          </Button>
        </Group>
        {shader.parameters.length === 0 ? (
          <Text size="xs" c="var(--sm-color-overlay0)">
            No parameters yet.
          </Text>
        ) : (
          shader.parameters.map((parameter) => (
            <ShaderParameterEditor
              key={parameter.parameterId}
              shaderId={shader.shaderDefinitionId}
              parameter={parameter}
              textureDefinitions={textureDefinitions}
              onCommand={onCommand}
            />
          ))
        )}
      </Stack>
      <Stack gap={4}>
        <Text size="xs" fw={600} c="var(--sm-color-subtext)" tt="uppercase">
          Selected Node
        </Text>
        {selectedNode ? (
          <ShaderNodeEditor
            shaderId={shader.shaderDefinitionId}
            node={selectedNode}
            onCommand={onCommand}
            onDelete={onDeleteSelectedNode}
          />
        ) : (
          <Text size="xs" c="var(--sm-color-overlay0)">
            Select a node in the graph to edit it.
          </Text>
        )}
      </Stack>
    </Stack>
  );
}

function ShaderParameterEditor(props: {
  shaderId: string;
  parameter: ShaderParameter;
  textureDefinitions: TextureDefinition[];
  onCommand: (command: SemanticCommand) => void;
}) {
  const { shaderId, parameter, textureDefinitions, onCommand } = props;
  const isTexture = parameter.dataType === "texture2d";
  return (
    <Stack
      gap={6}
      p="xs"
      style={{
        border: "1px solid var(--sm-panel-border)",
        borderRadius: "var(--sm-radius-sm)"
      }}
    >
      <TextInput
        label="Name"
        size="xs"
        value={parameter.displayName}
        onChange={(event) =>
          onCommand({
            kind: "UpdateShaderParameter",
            target: {
              aggregateKind: "content-definition",
              aggregateId: shaderId
            },
            subject: { subjectKind: "shader-definition", subjectId: shaderId },
            payload: {
              shaderDefinitionId: shaderId,
              parameter: {
                ...parameter,
                displayName: event.currentTarget.value
              }
            }
          })
        }
      />
      <Select
        label="Type"
        size="xs"
        value={parameter.dataType}
        data={[
          { value: "float", label: "Float" },
          { value: "vec2", label: "Vec2" },
          { value: "vec3", label: "Vec3" },
          { value: "vec4", label: "Vec4" },
          { value: "color", label: "Color" },
          { value: "bool", label: "Bool" },
          { value: "texture2d", label: "Texture" }
        ]}
        onChange={(value) => {
          if (!value) return;
          onCommand({
            kind: "UpdateShaderParameter",
            target: {
              aggregateKind: "content-definition",
              aggregateId: shaderId
            },
            subject: { subjectKind: "shader-definition", subjectId: shaderId },
            payload: {
              shaderDefinitionId: shaderId,
              parameter: {
                ...parameter,
                dataType: value as ShaderParameter["dataType"],
                defaultValue: defaultValueForDataType(
                  value as ShaderParameter["dataType"]
                )
              }
            }
          });
        }}
      />
      {isTexture ? (
        <Select
          label="Texture"
          size="xs"
          placeholder="Select texture..."
          data={[
            { value: "__none__", label: "(none)" },
            ...textureDefinitions.map((definition) => ({
              value: definition.definitionId,
              label: definition.displayName
            }))
          ]}
          value={
            typeof parameter.defaultValue === "string" &&
            parameter.defaultValue.length > 0
              ? parameter.defaultValue
              : "__none__"
          }
          onChange={(value) => {
            const nextValue =
              value === null || value === "__none__" ? null : value;
            onCommand({
              kind: "UpdateShaderParameter",
              target: {
                aggregateKind: "content-definition",
                aggregateId: shaderId
              },
              subject: {
                subjectKind: "shader-definition",
                subjectId: shaderId
              },
              payload: {
                shaderDefinitionId: shaderId,
                parameter: { ...parameter, defaultValue: nextValue }
              }
            });
          }}
          allowDeselect={false}
        />
      ) : (
        <TextInput
          label="Default"
          size="xs"
          value={formatParameterValue(parameter.defaultValue)}
          onChange={(event) => {
            const nextValue = parseParameterValue(
              parameter.dataType,
              event.currentTarget.value
            );
            if (nextValue === null) {
              return;
            }
            onCommand({
              kind: "UpdateShaderParameter",
              target: {
                aggregateKind: "content-definition",
                aggregateId: shaderId
              },
              subject: {
                subjectKind: "shader-definition",
                subjectId: shaderId
              },
              payload: {
                shaderDefinitionId: shaderId,
                parameter: { ...parameter, defaultValue: nextValue }
              }
            });
          }}
        />
      )}
      {parameter.dataType === "color" ? (
        <ColorSettingInput
          label="Pick Color"
          value={parameter.defaultValue}
          onChange={(nextValue) =>
            onCommand({
              kind: "UpdateShaderParameter",
              target: {
                aggregateKind: "content-definition",
                aggregateId: shaderId
              },
              subject: {
                subjectKind: "shader-definition",
                subjectId: shaderId
              },
              payload: {
                shaderDefinitionId: shaderId,
                parameter: { ...parameter, defaultValue: nextValue }
              }
            })
          }
        />
      ) : null}
      <Button
        size="compact-xs"
        color="red"
        variant="subtle"
        onClick={() =>
          onCommand({
            kind: "RemoveShaderParameter",
            target: {
              aggregateKind: "content-definition",
              aggregateId: shaderId
            },
            subject: { subjectKind: "shader-definition", subjectId: shaderId },
            payload: {
              shaderDefinitionId: shaderId,
              parameterId: parameter.parameterId
            }
          })
        }
      >
        Remove Parameter
      </Button>
    </Stack>
  );
}

function ShaderNodeEditor(props: {
  shaderId: string;
  node: ShaderNodeInstance;
  onCommand: (command: SemanticCommand) => void;
  onDelete: () => void;
}) {
  const { shaderId, node, onCommand, onDelete } = props;
  const nodeDefinition = getShaderNodeDefinition(node.nodeType);
  if (!nodeDefinition) {
    return (
      <Button size="xs" color="red" variant="subtle" onClick={onDelete}>
        Remove Broken Node
      </Button>
    );
  }

  return (
    <Stack gap="xs">
      <Text size="xs" fw={600}>
        {nodeDefinition.displayName}
      </Text>
      {nodeDefinition.settings.map((setting) =>
        setting.dataType === "color" ? (
          <ColorSettingInput
            key={setting.settingId}
            label={setting.displayName}
            value={node.settings[setting.settingId] ?? setting.defaultValue}
            onChange={(nextValue) =>
              onCommand({
                kind: "UpdateShaderNode",
                target: {
                  aggregateKind: "content-definition",
                  aggregateId: shaderId
                },
                subject: {
                  subjectKind: "shader-definition",
                  subjectId: shaderId
                },
                payload: {
                  shaderDefinitionId: shaderId,
                  node: {
                    ...node,
                    settings: {
                      ...node.settings,
                      [setting.settingId]: nextValue
                    }
                  }
                }
              })
            }
          />
        ) : (
          <TextInput
            key={setting.settingId}
            label={setting.displayName}
            size="xs"
            value={String(
              node.settings[setting.settingId] ?? setting.defaultValue
            )}
            onChange={(event) =>
              onCommand({
                kind: "UpdateShaderNode",
                target: {
                  aggregateKind: "content-definition",
                  aggregateId: shaderId
                },
                subject: {
                  subjectKind: "shader-definition",
                  subjectId: shaderId
                },
                payload: {
                  shaderDefinitionId: shaderId,
                  node: {
                    ...node,
                    settings: {
                      ...node.settings,
                      [setting.settingId]: parseSettingValue(
                        setting.dataType,
                        event.currentTarget.value
                      )
                    }
                  }
                }
              })
            }
          />
        )
      )}
      <Button size="xs" color="red" variant="subtle" onClick={onDelete}>
        Delete Node
      </Button>
    </Stack>
  );
}

function ColorSettingInput(props: {
  label: string;
  value: unknown;
  onChange: (value: [number, number, number]) => void;
}) {
  const { label, value, onChange } = props;
  const normalizedValue = normalizeColorValue(value);
  return (
    <Stack gap={4}>
      <Text size="xs" fw={500}>
        {label}
      </Text>
      <Group gap="xs" wrap="nowrap">
        <input
          aria-label={label}
          type="color"
          value={rgbArrayToHex(normalizedValue)}
          onChange={(event) =>
            onChange(hexToRgbArray(event.currentTarget.value))
          }
          style={{
            width: 36,
            height: 28,
            padding: 0,
            border: "1px solid var(--sm-panel-border)",
            borderRadius: 6,
            background: "transparent",
            cursor: "pointer"
          }}
        />
        <TextInput
          size="xs"
          value={formatParameterValue(normalizedValue)}
          onChange={(event) => {
            const nextValue = parseParameterValue(
              "color",
              event.currentTarget.value
            );
            if (
              nextValue &&
              Array.isArray(nextValue) &&
              nextValue.length === 3
            ) {
              onChange(nextValue as [number, number, number]);
            }
          }}
        />
      </Group>
    </Stack>
  );
}

function parseSettingValue(
  dataType: string,
  raw: string
): ShaderParameterValue | string | boolean {
  if (dataType === "bool") {
    return raw === "true";
  }
  if (dataType === "int" || dataType === "float") {
    return Number(raw || 0);
  }
  return raw;
}

function defaultValueForDataType(
  dataType: ShaderParameter["dataType"]
): ShaderParameterValue {
  switch (dataType) {
    case "float":
      return 0;
    case "vec2":
      return [0, 0];
    case "vec3":
    case "color":
      return [0, 0, 0];
    case "vec4":
      return [0, 0, 0, 0];
    case "bool":
      return false;
    case "texture2d":
      return null;
    default:
      return 0;
  }
}

function formatParameterValue(value: ShaderParameterValue): string {
  return Array.isArray(value) ? value.join(", ") : String(value);
}

function normalizeColorValue(value: unknown): [number, number, number] {
  if (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  ) {
    return [
      clampUnit(value[0] as number),
      clampUnit(value[1] as number),
      clampUnit(value[2] as number)
    ];
  }
  return [0, 0, 0];
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function rgbArrayToHex(value: [number, number, number]): string {
  return `#${value
    .map((channel) =>
      Math.round(clampUnit(channel) * 255)
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
}

function hexToRgbArray(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) {
    return [0, 0, 0];
  }
  return [
    Number.parseInt(normalized.slice(0, 2), 16) / 255,
    Number.parseInt(normalized.slice(2, 4), 16) / 255,
    Number.parseInt(normalized.slice(4, 6), 16) / 255
  ];
}

function parseParameterValue(
  dataType: ShaderParameter["dataType"],
  raw: string
): ShaderParameterValue | null {
  if (dataType === "bool") {
    return raw === "true";
  }
  if (dataType === "float") {
    return Number(raw || 0);
  }
  if (
    dataType === "vec2" ||
    dataType === "vec3" ||
    dataType === "vec4" ||
    dataType === "color"
  ) {
    const values = raw
      .split(",")
      .map((entry) => Number(entry.trim()))
      .filter((entry) => Number.isFinite(entry));
    if (
      (dataType === "vec2" && values.length === 2) ||
      ((dataType === "vec3" || dataType === "color") && values.length === 3) ||
      (dataType === "vec4" && values.length === 4)
    ) {
      return values as ShaderParameterValue;
    }
    return null;
  }
  return raw;
}
