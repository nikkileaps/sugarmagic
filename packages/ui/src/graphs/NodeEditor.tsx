/**
 * packages/ui/src/graphs/NodeEditor.tsx
 *
 * Purpose: the shared node-graph editor used by the quest, dialogue, and shader
 * workspaces. Wraps React Flow behind types this package owns, so no React Flow
 * type reaches the workspaces that consume it.
 *
 * Status: active
 */

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useImperativeHandle,
  useMemo,
  useState,
  type ReactNode
} from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeChange,
  type EdgeChange,
  type Connection
} from "@xyflow/react";

export interface GraphEditorPosition {
  x: number;
  y: number;
}

/** A connection point on the side of a node. React Flow calls these handles; the
 *  word here stays "port" to match the rest of the repo. */
export interface GraphEditorPort {
  name: string;
  color?: string;
  /** 0 = top of the node, 1 = bottom. Defaults to centred. */
  yPercent?: number;
}

export interface GraphEditorNode {
  id: string;
  /** Which registered renderer draws this node. */
  kind: string;
  position: GraphEditorPosition;
  /** Handed back to the renderer untouched. The editor never reads it. */
  payload: unknown;
  outputs?: GraphEditorPort[];
}

export interface GraphEditorEdge {
  id: string;
  fromId: string;
  toId: string;
  fromPort?: string;
  color?: string;
  dashed?: boolean;
}

export interface GraphEditorNodeMove {
  id: string;
  position: GraphEditorPosition;
}

export interface GraphEditorConnection {
  fromId: string;
  toId: string;
  fromPort?: string;
}

export interface GraphEditorNodeRendererProps {
  node: GraphEditorNode;
  selected: boolean;
}

export type GraphEditorNodeRenderer = (
  props: GraphEditorNodeRendererProps
) => ReactNode;

export interface GraphEditorHandle {
  /** Frame every node. */
  fitToContent: () => void;
  centerOnNode: (nodeId: string) => void;
  selectNode: (nodeId: string | null) => void;
  /** Remove whatever is selected. Runs through onBeforeDelete like any other
   *  deletion, so guards apply wherever the request came from. */
  deleteSelection: () => void;
}

export interface NodeEditorProps {
  nodes: GraphEditorNode[];
  edges: GraphEditorEdge[];
  /** One renderer per node kind. */
  renderers: Record<string, GraphEditorNodeRenderer>;
  /** The node the inspector is showing. */
  primarySelectionId?: string | null;
  /** Fires when the selected node changes, including when selection is cleared. */
  onPrimarySelectionChange?: (nodeId: string | null) => void;
  /** Everything currently selected, so chrome can enable or disable its actions. */
  onSelectionChange?: (selection: {
    nodeIds: string[];
    edgeIds: string[];
  }) => void;
  /** Fires once when a drag finishes, carrying every node that moved. */
  onNodesMoved?: (moves: GraphEditorNodeMove[]) => void;
  onConnect?: (connection: GraphEditorConnection) => void;
  onNodesDeleted?: (nodeIds: string[]) => void;
  onEdgesDeleted?: (edgeIds: string[]) => void;
  /** Return false to refuse a deletion. Runs before anything is removed. */
  onBeforeDelete?: (removal: {
    nodeIds: string[];
    edgeIds: string[];
  }) => boolean | Promise<boolean>;
  /** Rendered in the top-left corner over the canvas. */
  chrome?: ReactNode;
  showMiniMap?: boolean;
}

const RendererContext = createContext<Record<string, GraphEditorNodeRenderer>>(
  {}
);

interface ShellData extends Record<string, unknown> {
  node: GraphEditorNode;
}

/**
 * The single React Flow node type. It looks up the renderer for this node's kind
 * and draws the ports; the renderer owns everything inside the node body.
 */
function NodeShell({
  data,
  selected
}: {
  data: ShellData;
  selected?: boolean;
}) {
  const renderers = useContext(RendererContext);
  const node = data.node;
  const renderer = renderers[node.kind];
  const outputs = node.outputs ?? [{ name: "out" }];

  return (
    <div
      className="sm-node-editor-node"
      data-selected={selected ? "true" : "false"}
    >
      <Handle type="target" position={Position.Left} id="in" />
      {renderer ? (
        renderer({ node, selected: Boolean(selected) })
      ) : (
        <div style={{ padding: 12, color: "var(--sm-accent-red)" }}>
          No renderer for node kind "{node.kind}"
        </div>
      )}
      {outputs.map((port) => (
        <Handle
          key={port.name}
          type="source"
          position={Position.Right}
          id={port.name}
          style={{
            top: `${(port.yPercent ?? 0.5) * 100}%`,
            ...(port.color
              ? { background: port.color, borderColor: port.color }
              : {})
          }}
        />
      ))}
    </div>
  );
}

const NODE_TYPES = { sugarNode: NodeShell };

function toFlowNode(node: GraphEditorNode): FlowNode<ShellData> {
  return {
    id: node.id,
    type: "sugarNode",
    position: { ...node.position },
    data: { node }
  };
}

function toFlowEdge(edge: GraphEditorEdge): FlowEdge {
  return {
    id: edge.id,
    source: edge.fromId,
    target: edge.toId,
    sourceHandle: edge.fromPort ?? "out",
    targetHandle: "in",
    animated: false,
    style: {
      // The authored colour rides as a custom property rather than a `stroke`
      // declaration: an inline stroke would beat React Flow's own rule for a
      // selected edge, so selection would never show. See node-editor.css.
      ...(edge.color ? { "--sm-edge-color": edge.color } : {}),
      ...(edge.dashed ? { strokeDasharray: "6 4" } : {})
    } as FlowEdge["style"]
  };
}

function NodeEditorInner(
  props: NodeEditorProps,
  ref: React.ForwardedRef<GraphEditorHandle>
) {
  const {
    nodes,
    edges,
    primarySelectionId = null,
    onPrimarySelectionChange,
    onSelectionChange,
    onNodesMoved,
    onConnect,
    onNodesDeleted,
    onEdgesDeleted,
    onBeforeDelete,
    chrome,
    showMiniMap = true
  } = props;

  const [flowNodes, setFlowNodes] = useState<FlowNode<ShellData>[]>(() =>
    nodes.map(toFlowNode)
  );
  const [flowEdges, setFlowEdges] = useState<FlowEdge[]>(() =>
    edges.map(toFlowEdge)
  );
  // Whether a pointer drag is in flight. Held as state, not a ref, because the
  // resync guards below read it while rendering. It flips twice per drag, so it
  // costs one render at the start and one at the end.
  const [isDragging, setIsDragging] = useState(false);
  const reactFlow = useReactFlow();

  // Incoming data is folded into local state during render rather than in an
  // effect, which is React's documented way to adjust state when props change and
  // avoids the extra render pass an effect would cause. The editor keeps the parts
  // it owns -- which nodes are selected, and what React Flow measured them to be.
  // A resync mid-drag would fight the pointer, so it waits until the drag ends.
  const [syncedNodes, setSyncedNodes] = useState(nodes);
  const [syncedEdges, setSyncedEdges] = useState(edges);
  const [syncedSelection, setSyncedSelection] = useState(primarySelectionId);

  if (nodes !== syncedNodes && !isDragging) {
    setSyncedNodes(nodes);
    setFlowNodes((current) => {
      const byId = new Map(current.map((node) => [node.id, node]));
      return nodes.map((node) => {
        const existing = byId.get(node.id);
        const next = toFlowNode(node);
        if (!existing) return next;
        return {
          ...next,
          selected: existing.selected,
          measured: existing.measured,
          width: existing.width,
          height: existing.height
        };
      });
    });
  }

  if (edges !== syncedEdges && !isDragging) {
    setSyncedEdges(edges);
    setFlowEdges(edges.map(toFlowEdge));
  }

  // Selection driven from outside: the inspector, or playtest highlighting.
  if (primarySelectionId !== syncedSelection) {
    setSyncedSelection(primarySelectionId);
    setFlowNodes((current) =>
      current.map((node) =>
        Boolean(node.selected) === (node.id === primarySelectionId)
          ? node
          : { ...node, selected: node.id === primarySelectionId }
      )
    );
  }

  useImperativeHandle(
    ref,
    () => ({
      fitToContent: () => {
        void reactFlow.fitView({ padding: 0.2 });
      },
      centerOnNode: (nodeId: string) => {
        const node = reactFlow.getNode(nodeId);
        if (!node) return;
        void reactFlow.setCenter(
          node.position.x + (node.measured?.width ?? 0) / 2,
          node.position.y + (node.measured?.height ?? 0) / 2,
          { duration: 200 }
        );
      },
      selectNode: (nodeId: string | null) => {
        onPrimarySelectionChange?.(nodeId);
      },
      deleteSelection: () => {
        void reactFlow.deleteElements({
          nodes: reactFlow.getNodes().filter((node) => node.selected),
          edges: reactFlow.getEdges().filter((edge) => edge.selected)
        });
      }
    }),
    [onPrimarySelectionChange, reactFlow]
  );

  // Reads through the React Flow store rather than local state, because local
  // state updates are queued and would report the selection one step behind.
  const reportSelection = useCallback(() => {
    if (!onSelectionChange) return;
    queueMicrotask(() => {
      onSelectionChange({
        nodeIds: reactFlow
          .getNodes()
          .filter((node) => node.selected)
          .map((node) => node.id),
        edgeIds: reactFlow
          .getEdges()
          .filter((edge) => edge.selected)
          .map((edge) => edge.id)
      });
    });
  }, [onSelectionChange, reactFlow]);

  const handleNodesChange = useCallback(
    (changes: NodeChange<FlowNode<ShellData>>[]) => {
      for (const change of changes) {
        if (change.type === "position" && change.dragging === true) {
          setIsDragging(true);
        }
      }

      setFlowNodes((current) => applyNodeChanges(changes, current));

      // A finished drag is the commit point: React Flow reports dragging=false
      // once per moved node when the pointer is released. Keyboard node movement
      // is disabled, so nothing else produces a settled position change.
      const settled = changes.filter(
        (change): change is Extract<NodeChange, { type: "position" }> =>
          change.type === "position" && change.dragging === false
      );
      if (settled.length > 0) {
        setIsDragging(false);
        const moves = settled
          .filter((change) => change.position)
          .map((change) => ({
            id: change.id,
            position: { x: change.position!.x, y: change.position!.y }
          }));
        if (moves.length > 0) onNodesMoved?.(moves);
      }

      const selection = changes.filter(
        (change): change is Extract<NodeChange, { type: "select" }> =>
          change.type === "select"
      );
      if (selection.length > 0) {
        const selected = selection.filter((change) => change.selected);
        if (selected.length > 0) {
          onPrimarySelectionChange?.(selected[selected.length - 1]!.id);
        } else if (selection.every((change) => !change.selected)) {
          onPrimarySelectionChange?.(null);
        }
        reportSelection();
      }
    },
    [onNodesMoved, onPrimarySelectionChange, reportSelection]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<FlowEdge>[]) => {
      setFlowEdges((current) => applyEdgeChanges(changes, current));
      if (changes.some((change) => change.type === "select")) {
        reportSelection();
      }
    },
    [reportSelection]
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      onConnect?.({
        fromId: connection.source,
        toId: connection.target,
        fromPort: connection.sourceHandle ?? undefined
      });
    },
    [onConnect]
  );

  const handleBeforeDelete = useCallback(
    async ({
      nodes: deletedNodes,
      edges: deletedEdges
    }: {
      nodes: FlowNode[];
      edges: FlowEdge[];
    }) => {
      if (!onBeforeDelete) return true;
      return onBeforeDelete({
        nodeIds: deletedNodes.map((node) => node.id),
        edgeIds: deletedEdges.map((edge) => edge.id)
      });
    },
    [onBeforeDelete]
  );

  const handleNodesDelete = useCallback(
    (deleted: FlowNode[]) => {
      if (deleted.length > 0) onNodesDeleted?.(deleted.map((node) => node.id));
    },
    [onNodesDeleted]
  );

  const handleEdgesDelete = useCallback(
    (deleted: FlowEdge[]) => {
      if (deleted.length > 0) onEdgesDeleted?.(deleted.map((edge) => edge.id));
    },
    [onEdgesDeleted]
  );

  const proOptions = useMemo(() => ({ hideAttribution: true }), []);

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={flowEdges}
      nodeTypes={NODE_TYPES}
      onNodesChange={handleNodesChange}
      onEdgesChange={handleEdgesChange}
      onConnect={handleConnect}
      onBeforeDelete={handleBeforeDelete}
      onNodesDelete={handleNodesDelete}
      onEdgesDelete={handleEdgesDelete}
      // Arrow keys must not move nodes; this also turns off tab-cycling node focus.
      disableKeyboardA11y
      deleteKeyCode={["Backspace", "Delete"]}
      proOptions={proOptions}
      fitView
      minZoom={0.2}
      maxZoom={3}
    >
      <Background variant={"dots" as never} gap={20} size={1} />
      <Controls showInteractive={false} />
      {showMiniMap ? <MiniMap pannable zoomable /> : null}
      {chrome ? (
        // 12px matches the shader editor's existing graph chrome, which is the
        // in-repo precedent for controls over a graph viewport.
        <Panel position="top-left" style={{ margin: 12 }}>
          {chrome}
        </Panel>
      ) : null}
    </ReactFlow>
  );
}

const NodeEditorWithRef = forwardRef<GraphEditorHandle, NodeEditorProps>(
  NodeEditorInner
);

/**
 * Mounts the editor with its own React Flow provider so several editors can live
 * in one Studio session without sharing state. The parent element must have a
 * width and a height.
 */
export const NodeEditor = forwardRef<GraphEditorHandle, NodeEditorProps>(
  function NodeEditor(props, ref) {
    return (
      <RendererContext.Provider value={props.renderers}>
        <ReactFlowProvider>
          <NodeEditorWithRef {...props} ref={ref} />
        </ReactFlowProvider>
      </RendererContext.Provider>
    );
  }
);
