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
  SemanticCommand,
  ShaderDataType,
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
  duplicateShaderGraphDocument,
  getShaderNodeDefinition,
  listShaderNodeDefinitions
} from "@sugarmagic/domain";
import { BuildSubNav, GraphCanvas, Inspector, PanelSection, type GraphCanvasEdge, type GraphCanvasNode } from "@sugarmagic/ui";
import type { RenderWorkspaceKind } from "@sugarmagic/shell";
import type { WorkspaceNavigationTarget } from "../workspace-navigation";

const renderWorkspaceKinds = [{ id: "shaders", label: "Shaders", icon: "🎨" }];
const RENDER_WORKSPACE_DEBUG_STORAGE_KEY = "sugarmagic:debug:render-workspace";

function shouldDebugRenderWorkspace(): boolean {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(RENDER_WORKSPACE_DEBUG_STORAGE_KEY) === "true";
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

function createDefaultNode(definition: ShaderNodeDefinition): ShaderNodeInstance {
  return {
    nodeId: createNodeId(),
    nodeType: definition.nodeType,
    position: { x: 96, y: 96 },
    settings: Object.fromEntries(
      definition.settings.map((setting) => [setting.settingId, setting.defaultValue])
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

function portColor(dataType: ShaderDataType): string {
  switch (dataType) {
    case "float":
      return "#f9e2af";
    case "vec2":
      return "#89dceb";
    case "vec3":
    case "color":
      return "#a6e3a1";
    case "vec4":
      return "#cba6f7";
    case "texture2d":
      return "#f38ba8";
    case "bool":
      return "#fab387";
    default:
      return "#94a3b8";
  }
}

function toGraphNodes(definition: ShaderGraphDocument): GraphCanvasNode[] {
  return definition.nodes.map((node) => {
    const nodeDefinition = getShaderNodeDefinition(node.nodeType);
    return {
      id: node.nodeId,
      position: node.position,
      outputs:
        nodeDefinition?.outputPorts.map((port, index, ports) => ({
          name: port.portId,
          color: portColor(port.dataType),
          hoverColor: portColor(port.dataType),
          yPercent: ports.length === 1 ? 0.5 : (index + 1) / (ports.length + 1)
        })) ?? []
    };
  });
}

function toGraphEdges(definition: ShaderGraphDocument): GraphCanvasEdge[] {
  return definition.edges.map((edge) => ({
    fromId: edge.sourceNodeId,
    toId: edge.targetNodeId,
    fromPort: edge.sourcePortId,
    color: "#89b4fa"
  }));
}

function compatibleInputPort(
  shader: ShaderGraphDocument,
  sourceNodeId: string,
  targetNodeId: string,
  sourcePortId: string
): string | null {
  const targetNode = shader.nodes.find((node) => node.nodeId === targetNodeId) ?? null;
  if (!targetNode) {
    return null;
  }

  const targetDefinition = getShaderNodeDefinition(targetNode.nodeType);
  const sourceNode =
    shader.nodes.find((node) => node.nodeId === sourceNodeId) ?? null;
  const sourceDefinition = sourceNode ? getShaderNodeDefinition(sourceNode.nodeType) : null;
  const sourcePort =
    sourceDefinition?.outputPorts.find((port) => port.portId === sourcePortId) ?? null;
  const sourceType = sourcePort?.dataType ?? null;

  for (const port of targetDefinition?.inputPorts ?? []) {
    const existing = shader.edges.some(
      (edge) => edge.targetNodeId === targetNodeId && edge.targetPortId === port.portId
    );
    if (existing) {
      continue;
    }
    if (!sourceType || sourceType === port.dataType) {
      return port.portId;
    }
  }

  return targetDefinition?.inputPorts[0]?.portId ?? null;
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
  const [nodePaletteOpen, setNodePaletteOpen] = useState(false);
  const [graphContainerElement, setGraphContainerElement] =
    useState<HTMLDivElement | null>(null);
  const graphCanvasRef = useRef<GraphCanvas | null>(null);
  const selectedShaderRef = useRef<ShaderGraphDocument | null>(null);
  const selectedNodeIdRef = useRef<string | null>(null);

  const selectedShader = useMemo(
    () =>
      shaderDefinitions.find(
        (definition) => definition.shaderDefinitionId === selectedShaderId
      ) ?? shaderDefinitions[0] ?? null,
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
      selectedShader?.nodes.find((node) => node.nodeId === selectedNodeId) ?? null,
    [selectedNodeId, selectedShader]
  );

  const availableNodeDefinitions = useMemo(
    () =>
      listShaderNodeDefinitions().filter((definition) =>
        selectedShader ? definition.validTargetKinds.includes(selectedShader.targetKind) : true
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
    if (shaderDefinitions.length === 0 && selectedShaderId === null && !selectedShader) {
      return;
    }
    debugRenderWorkspace("selected-shader-changed", {
      selectedShaderId,
      resolvedShaderId: selectedShader?.shaderDefinitionId ?? null,
      nodeCount: selectedShader?.nodes.length ?? 0,
      edgeCount: selectedShader?.edges.length ?? 0
    });
  }, [selectedShader, selectedShaderId]);

  const updateGraphCanvas = useCallback(() => {
    const graphCanvas = graphCanvasRef.current;
    const shader = selectedShaderRef.current;
    if (!graphCanvas) {
      debugRenderWorkspace("graph-populate-skipped", {
        reason: "graph-canvas-missing"
      });
      return;
    }

    if (!shader) {
      debugRenderWorkspace("graph-populate-empty", {
        reason: "shader-missing"
      });
      graphCanvas.setNodes([]);
      graphCanvas.setEdges([]);
      return;
    }

    debugRenderWorkspace("graph-populate", {
      shaderDefinitionId: shader.shaderDefinitionId,
      displayName: shader.displayName,
      targetKind: shader.targetKind,
      nodeCount: shader.nodes.length,
      edgeCount: shader.edges.length
    });
    graphCanvas.setNodes(toGraphNodes(shader));
    graphCanvas.setEdges(toGraphEdges(shader));
  }, []);

  useEffect(() => {
    debugRenderWorkspace("graph-setup-effect", {
      activeRenderKind,
      hasContainer: graphContainerElement !== null,
      resolvedShaderId: selectedShaderRef.current?.shaderDefinitionId ?? null,
      resolvedNodeCount: selectedShaderRef.current?.nodes.length ?? 0
    });
    if (!graphContainerElement || activeRenderKind !== "shaders") {
      debugRenderWorkspace("graph-setup-skipped", {
        reason: !graphContainerElement ? "container-missing" : "inactive-render-kind",
        activeRenderKind
      });
      return;
    }

    const graphCanvas = new GraphCanvas({
      showMinimap: true,
      onNodeSelect: (nodeId) => setSelectedNodeId(nodeId),
      onCanvasClick: () => setSelectedNodeId(null),
      onNodeMove: (nodeId, position) => {
        const shader = selectedShaderRef.current;
        const node = shader?.nodes.find((candidate) => candidate.nodeId === nodeId);
        if (!shader || !node) {
          return;
        }

        onCommand({
          kind: "UpdateShaderNode",
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
            node: {
              ...node,
              position
            }
          }
        });
      },
      onConnect: (fromNodeId, toNodeId, fromPortId) => {
        const shader = selectedShaderRef.current;
        if (!shader || fromNodeId === toNodeId) {
          return;
        }

        const sourceNode = shader.nodes.find((node) => node.nodeId === fromNodeId) ?? null;
        const sourceDefinition = sourceNode ? getShaderNodeDefinition(sourceNode.nodeType) : null;
        const effectiveFromPortId =
          fromPortId ?? sourceDefinition?.outputPorts[0]?.portId ?? "value";
        const targetPortId = compatibleInputPort(
          shader,
          fromNodeId,
          toNodeId,
          effectiveFromPortId
        );
        if (!targetPortId) {
          return;
        }

        onCommand({
          kind: "AddShaderEdge",
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
            edge: {
              edgeId: createEdgeId(),
              sourceNodeId: fromNodeId,
              sourcePortId: effectiveFromPortId,
              targetNodeId: toNodeId,
              targetPortId
            }
          }
        });
      },
      renderNode: (canvasNode, element) => {
        const shader = selectedShaderRef.current;
        const node = shader?.nodes.find((candidate) => candidate.nodeId === canvasNode.id);
        const nodeDefinition = node ? getShaderNodeDefinition(node.nodeType) : null;
        if (!node || !nodeDefinition) {
          element.innerHTML = '<div style="padding:12px;color:#f38ba8;">Node not found</div>';
          return;
        }

        const isSelected = node.nodeId === selectedNodeIdRef.current;
        const borderColor = isSelected ? "#89b4fa" : "#45475a";
        element.style.minWidth = "220px";
        element.style.maxWidth = "280px";
        element.style.background = "#181825";
        element.style.border = `2px solid ${borderColor}`;
        element.style.borderRadius = "8px";
        element.style.overflow = "hidden";

        const header = document.createElement("div");
        header.style.cssText =
          "padding:8px 12px;background:#1e1e2e;border-bottom:1px solid #313244;display:flex;flex-direction:column;gap:4px;";
        const name = document.createElement("span");
        name.textContent = nodeDefinition.displayName;
        name.style.cssText = "font-size:12px;color:#cdd6f4;font-weight:600;";
        header.appendChild(name);
        const subtype = document.createElement("span");
        subtype.textContent = node.nodeType;
        subtype.style.cssText = "font-size:10px;color:#94a3b8;";
        header.appendChild(subtype);
        element.appendChild(header);

        const content = document.createElement("div");
        content.style.cssText = "padding:12px;font-size:11px;color:#a6adc8;display:flex;flex-direction:column;gap:6px;";
        const inputs = document.createElement("div");
        inputs.textContent = `Inputs: ${nodeDefinition.inputPorts.map((port) => port.displayName).join(", ") || "None"}`;
        content.appendChild(inputs);
        const outputs = document.createElement("div");
        outputs.textContent = `Outputs: ${nodeDefinition.outputPorts.map((port) => port.displayName).join(", ") || "None"}`;
        content.appendChild(outputs);
        element.appendChild(content);
      }
    });

    graphContainerElement.innerHTML = "";
    graphContainerElement.appendChild(graphCanvas.getElement());
    graphCanvasRef.current = graphCanvas;
    debugRenderWorkspace("graph-canvas-mounted", {
      containerWidth: graphContainerElement.clientWidth,
      containerHeight: graphContainerElement.clientHeight,
      childCount: graphContainerElement.childElementCount
    });
    updateGraphCanvas();
    window.setTimeout(() => {
      debugRenderWorkspace("graph-fit", {
        shaderDefinitionId: selectedShaderRef.current?.shaderDefinitionId ?? null
      });
      graphCanvas.fitToContent();
    }, 100);

    return () => {
      graphCanvas.dispose();
      graphCanvasRef.current = null;
    };
  }, [activeRenderKind, graphContainerElement, onCommand, updateGraphCanvas]);

  useEffect(() => {
    if (!graphCanvasRef.current) {
      return;
    }

    updateGraphCanvas();
    window.setTimeout(() => {
      debugRenderWorkspace("graph-refit-on-selection", {
        shaderDefinitionId: selectedShader?.shaderDefinitionId ?? null
      });
      graphCanvasRef.current?.fitToContent();
    }, 100);
  }, [selectedShader, updateGraphCanvas]);

  useEffect(() => {
    graphCanvasRef.current?.setSelectedNode(selectedNodeId);
  }, [selectedNodeId]);

  const createShader = useCallback(
    (targetKind: ShaderTargetKind) => {
      if (!gameProjectId) {
        return;
      }
      const definition = createDefaultShaderGraphDocument(gameProjectId, {
        displayName: targetKind === "post-process" ? "Post Process Shader" : "Shader Graph",
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
      setNodePaletteOpen(false);
    },
    [onCommand, selectedShader]
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
                const isSelected = definition.shaderDefinitionId === selectedShader?.shaderDefinitionId;
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
                        background: isSelected ? "var(--sm-active-bg)" : "transparent",
                        color: isSelected ? "var(--sm-accent-blue)" : "var(--sm-color-text)",
                        border: isSelected
                          ? "1px solid var(--sm-accent-blue)"
                          : "1px solid transparent"
                      }
                    }}
                  >
                    <Group justify="space-between" align="center" wrap="nowrap" w="100%">
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
      <Inspector selectionLabel={selectedShader?.displayName ?? null} selectionIcon="🎨">
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
        <div
          ref={(element) => {
            setGraphContainerElement(element);
            debugRenderWorkspace("graph-container-ref", {
              attached: element !== null,
              width: element?.clientWidth ?? 0,
              height: element?.clientHeight ?? 0
            });
          }}
          style={{
            height: "100%",
            minHeight: 0,
            borderRadius: "var(--sm-radius-md)",
            overflow: "hidden",
            border: "1px solid var(--sm-panel-border)"
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            zIndex: 20,
            display: "flex",
            flexDirection: "column",
            gap: 8
          }}
        >
          <ActionIcon
            size="lg"
            radius="xl"
            variant="filled"
            color="blue"
            onClick={() => setNodePaletteOpen((open) => !open)}
            aria-label="Add node"
            style={{
              boxShadow: "var(--sm-shadow-md)"
            }}
          >
            +
          </ActionIcon>
          {nodePaletteOpen ? (
            <div
              style={{
                width: 280,
                maxHeight: 420,
                background: "var(--sm-color-surface1)",
                border: "1px solid var(--sm-panel-border)",
                borderRadius: "var(--sm-radius-md)",
                boxShadow: "var(--sm-shadow-lg)",
                overflow: "hidden"
              }}
            >
              <div
                style={{
                  padding: "10px 12px",
                  borderBottom: "1px solid var(--sm-panel-border)"
                }}
              >
                <Text size="xs" fw={700} tt="uppercase" c="var(--sm-color-subtext)">
                  Add Node
                </Text>
                <Text size="xs" c="var(--sm-color-overlay0)">
                  {selectedShader ? `${selectedShader.nodes.length} nodes in graph` : "No shader selected"}
                </Text>
              </div>
              <ScrollArea h={360}>
                <Stack gap={4} p="xs">
                  {availableNodeDefinitions.map((definition) => (
                    <Button
                      key={definition.nodeType}
                      size="xs"
                      variant="subtle"
                      justify="flex-start"
                      onClick={() => addNodeDefinition(definition)}
                    >
                      {definition.displayName}
                    </Button>
                  ))}
                </Stack>
              </ScrollArea>
            </div>
          ) : null}
        </div>
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
  const { shader, selectedNode, textureDefinitions, onCommand, onDeleteSelectedNode } = props;
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
            target: { aggregateKind: "content-definition", aggregateId: shaderId },
            subject: { subjectKind: "shader-definition", subjectId: shaderId },
            payload: {
              shaderDefinitionId: shaderId,
              parameter: { ...parameter, displayName: event.currentTarget.value }
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
            target: { aggregateKind: "content-definition", aggregateId: shaderId },
            subject: { subjectKind: "shader-definition", subjectId: shaderId },
            payload: {
              shaderDefinitionId: shaderId,
              parameter: {
                ...parameter,
                dataType: value as ShaderParameter["dataType"],
                defaultValue: defaultValueForDataType(value as ShaderParameter["dataType"])
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
            typeof parameter.defaultValue === "string" && parameter.defaultValue.length > 0
              ? parameter.defaultValue
              : "__none__"
          }
          onChange={(value) => {
            const nextValue = value === null || value === "__none__" ? null : value;
            onCommand({
              kind: "UpdateShaderParameter",
              target: { aggregateKind: "content-definition", aggregateId: shaderId },
              subject: { subjectKind: "shader-definition", subjectId: shaderId },
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
            const nextValue = parseParameterValue(parameter.dataType, event.currentTarget.value);
            if (nextValue === null) {
              return;
            }
            onCommand({
              kind: "UpdateShaderParameter",
              target: { aggregateKind: "content-definition", aggregateId: shaderId },
              subject: { subjectKind: "shader-definition", subjectId: shaderId },
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
              target: { aggregateKind: "content-definition", aggregateId: shaderId },
              subject: { subjectKind: "shader-definition", subjectId: shaderId },
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
            target: { aggregateKind: "content-definition", aggregateId: shaderId },
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
      {nodeDefinition.settings.map((setting) => (
        setting.dataType === "color" ? (
          <ColorSettingInput
            key={setting.settingId}
            label={setting.displayName}
            value={node.settings[setting.settingId] ?? setting.defaultValue}
            onChange={(nextValue) =>
              onCommand({
                kind: "UpdateShaderNode",
                target: { aggregateKind: "content-definition", aggregateId: shaderId },
                subject: { subjectKind: "shader-definition", subjectId: shaderId },
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
            value={String(node.settings[setting.settingId] ?? setting.defaultValue)}
            onChange={(event) =>
              onCommand({
                kind: "UpdateShaderNode",
                target: { aggregateKind: "content-definition", aggregateId: shaderId },
                subject: { subjectKind: "shader-definition", subjectId: shaderId },
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
      ))}
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
          onChange={(event) => onChange(hexToRgbArray(event.currentTarget.value))}
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
            const nextValue = parseParameterValue("color", event.currentTarget.value);
            if (nextValue && Array.isArray(nextValue) && nextValue.length === 3) {
              onChange(nextValue as [number, number, number]);
            }
          }}
        />
      </Group>
    </Stack>
  );
}

function parseSettingValue(dataType: string, raw: string): ShaderParameterValue | string | boolean {
  if (dataType === "bool") {
    return raw === "true";
  }
  if (dataType === "int" || dataType === "float") {
    return Number(raw || 0);
  }
  return raw;
}

function defaultValueForDataType(dataType: ShaderParameter["dataType"]): ShaderParameterValue {
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
    .map((channel) => Math.round(clampUnit(channel) * 255).toString(16).padStart(2, "0"))
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
  if (dataType === "vec2" || dataType === "vec3" || dataType === "vec4" || dataType === "color") {
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
