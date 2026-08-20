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
  useOnSelectionChange,
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
  /**
   * For a member of a group: the group's id, and `position` is relative to the
   * group rather than to the canvas. The mapping converts; nothing outside the
   * editor stores relative positions.
   */
  parentId?: string;
  position: GraphEditorPosition;
  /** Handed back to the renderer untouched. The editor never reads it. */
  payload: unknown;
  /** Named input ports. Omit for a single unnamed input on the left edge. */
  inputs?: GraphEditorPort[];
  outputs?: GraphEditorPort[];
}

export interface GraphEditorEdge {
  id: string;
  fromId: string;
  toId: string;
  fromPort?: string;
  toPort?: string;
  color?: string;
  dashed?: boolean;
}

export interface GraphEditorNodeMove {
  id: string;
  position: GraphEditorPosition;
  /** Set when the node moved inside a group, so the caller can convert back. */
  parentId?: string;
}

/**
 * A labelled box drawn behind its members. Rendered as a node so the library
 * moves members with it; kept separate here so a workspace never has to know
 * that.
 */
export interface GraphEditorGroup {
  id: string;
  label: string;
  position: GraphEditorPosition;
  size: { width: number; height: number };
}

export interface GraphEditorConnection {
  fromId: string;
  toId: string;
  fromPort?: string;
  /** Which input port it lands on, when the target declares named inputs. */
  toPort?: string;
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
  groups?: GraphEditorGroup[];
  onGroupsMoved?: (moves: GraphEditorNodeMove[]) => void;
  onGroupRenamed?: (groupId: string, label: string) => void;
  onGroupsDeleted?: (groupIds: string[]) => void;
  /** One renderer per node kind. */
  renderers: Record<string, GraphEditorNodeRenderer>;
  /** The node the inspector is showing. */
  primarySelectionId?: string | null;
  /** Fires when the selected node changes, including when selection is cleared. */
  onPrimarySelectionChange?: (nodeId: string | null) => void;
  /** Everything currently selected, so chrome can enable or disable its actions.
   *  Frames are reported as `groupIds`, never as `nodeIds`. */
  onSelectionChange?: (selection: {
    nodeIds: string[];
    groupIds: string[];
    edgeIds: string[];
  }) => void;
  /** Fires once when a drag finishes, carrying every node that moved. */
  onNodesMoved?: (moves: GraphEditorNodeMove[]) => void;
  onConnect?: (connection: GraphEditorConnection) => void;
  /** Return false to refuse a connection while it is being dragged, so an
   *  invalid one never lands. */
  isValidConnection?: (connection: GraphEditorConnection) => boolean;
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
  const inputs = node.inputs ?? [{ name: "in" }];

  return (
    <div
      className="sm-node-editor-node"
      data-selected={selected ? "true" : "false"}
    >
      {inputs.map((port) => (
        <Handle
          key={port.name}
          type="target"
          position={Position.Left}
          id={port.name}
          style={{
            top: `${(port.yPercent ?? 0.5) * 100}%`,
            ...(port.color
              ? { background: port.color, borderColor: port.color }
              : {})
          }}
        />
      ))}
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

interface GroupData extends Record<string, unknown> {
  group: GraphEditorGroup;
  onRename?: (groupId: string, label: string) => void;
}

/**
 * The frame behind a set of nodes. The label is an input so it can be renamed in
 * place; React Flow ignores key presses while an input has focus, so typing here
 * cannot delete the group.
 */
function GroupShell({
  data,
  selected
}: {
  data: GroupData;
  selected?: boolean;
}) {
  const { group, onRename } = data;
  return (
    <div
      className="sm-node-editor-group"
      data-selected={selected ? "true" : "false"}
      style={{ width: group.size.width, height: group.size.height }}
    >
      <input
        className="sm-node-editor-group-label"
        value={group.label}
        aria-label="Group name"
        onChange={(event) => onRename?.(group.id, event.target.value)}
      />
    </div>
  );
}

const NODE_TYPES = { sugarNode: NodeShell, sugarGroup: GroupShell };

function toFlowNode(node: GraphEditorNode): FlowNode<ShellData> {
  return {
    id: node.id,
    type: "sugarNode",
    position: { ...node.position },
    // No `extent: "parent"`: a member has to be draggable out of its frame,
    // which is how an author removes a node from a group. The caller decides
    // membership from where the node was dropped.
    ...(node.parentId ? { parentId: node.parentId } : {}),
    data: { node }
  };
}

function toFlowGroup(
  group: GraphEditorGroup,
  onRename?: (groupId: string, label: string) => void
): FlowNode<GroupData> {
  return {
    id: group.id,
    type: "sugarGroup",
    position: { ...group.position },
    // Behind its members, and not selectable by rubber-band so selecting a set
    // of nodes does not also pick up the frame around them.
    zIndex: -1,
    selectable: true,
    data: { group, onRename }
  };
}

/**
 * Splits a deletion into the graph's own nodes and the frames around them.
 *
 * React Flow deletes a parent's children along with it, so deleting a frame
 * arrives here as the frame PLUS every node inside it. Deleting a frame is meant
 * to remove only the frame, so a node whose frame is also being deleted is
 * dropped from the node list.
 */
export function splitDeletedNodes(deleted: FlowNode[]): {
  nodeIds: string[];
  groupIds: string[];
} {
  const groupIds = deleted
    .filter((node) => node.type === "sugarGroup")
    .map((node) => node.id);
  const deletedGroupIds = new Set(groupIds);
  const nodeIds = deleted
    .filter(
      (node) =>
        node.type !== "sugarGroup" &&
        !(node.parentId && deletedGroupIds.has(node.parentId))
    )
    .map((node) => node.id);
  return { nodeIds, groupIds };
}

function toFlowEdge(edge: GraphEditorEdge): FlowEdge {
  return {
    id: edge.id,
    source: edge.fromId,
    target: edge.toId,
    sourceHandle: edge.fromPort ?? "out",
    targetHandle: edge.toPort ?? "in",
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
    groups,
    onGroupsMoved,
    onGroupRenamed,
    onGroupsDeleted,
    primarySelectionId = null,
    onPrimarySelectionChange,
    onSelectionChange,
    onNodesMoved,
    onConnect,
    isValidConnection,
    onNodesDeleted,
    onEdgesDeleted,
    onBeforeDelete,
    chrome,
    showMiniMap = true
  } = props;

  const buildFlowNodes = useCallback(
    (
      nextNodes: GraphEditorNode[],
      nextGroups: GraphEditorGroup[] | undefined
    ): FlowNode[] => [
      ...(nextGroups ?? []).map((group) => toFlowGroup(group, onGroupRenamed)),
      ...nextNodes.map(toFlowNode)
    ],
    [onGroupRenamed]
  );

  const [flowNodes, setFlowNodes] = useState<FlowNode[]>(() =>
    buildFlowNodes(nodes, groups)
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
  const [syncedGroups, setSyncedGroups] = useState(groups);
  const [syncedEdges, setSyncedEdges] = useState(edges);
  const [syncedSelection, setSyncedSelection] = useState(primarySelectionId);

  if ((nodes !== syncedNodes || groups !== syncedGroups) && !isDragging) {
    setSyncedNodes(nodes);
    setSyncedGroups(groups);
    setFlowNodes((current) => {
      const byId = new Map(current.map((node) => [node.id, node]));
      return buildFlowNodes(nodes, groups).map((next) => {
        const existing = byId.get(next.id);
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
  // Selecting one node from outside means selecting ONLY that node, which would
  // cut a multi-node selection down to one. So it only runs when the node is not
  // already selected -- the canvas reports its own selection up through
  // `primarySelectionId`, and that round trip must not disturb what is selected.
  if (primarySelectionId !== syncedSelection) {
    setSyncedSelection(primarySelectionId);
    const alreadySelected = flowNodes.some(
      (node) => node.id === primarySelectionId && node.selected
    );
    if (!alreadySelected) {
      setFlowNodes((current) =>
        current.map((node) =>
          Boolean(node.selected) === (node.id === primarySelectionId)
            ? node
            : { ...node, selected: node.id === primarySelectionId }
        )
      );
    }
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

  // React Flow's own selection callback, rather than working the selection out
  // from the change stream: it delivers the whole selection at once, already
  // settled. Frames are nodes to the library but not to the caller, so they are
  // reported separately -- a selected frame must not count as a selected node.
  // The handler has to be memoized or the hook re-subscribes on every render.
  const handleSelectionChange = useCallback(
    ({
      nodes: selectedNodes,
      edges: selectedEdges
    }: {
      nodes: FlowNode[];
      edges: FlowEdge[];
    }) => {
      onSelectionChange?.({
        nodeIds: selectedNodes
          .filter((node) => node.type !== "sugarGroup")
          .map((node) => node.id),
        groupIds: selectedNodes
          .filter((node) => node.type === "sugarGroup")
          .map((node) => node.id),
        edgeIds: selectedEdges.map((edge) => edge.id)
      });
    },
    [onSelectionChange]
  );

  useOnSelectionChange({ onChange: handleSelectionChange });

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
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
        // A group and its members arrive through the same change stream, so they
        // are split here rather than making every workspace work out which is
        // which. A member's position is relative to its group; `parentId` rides
        // along so the caller can convert it back.
        const groupIds = new Set((groups ?? []).map((group) => group.id));
        const positioned = settled.filter((change) => change.position);
        const nodeMoves = positioned
          .filter((change) => !groupIds.has(change.id))
          .map((change) => ({
            id: change.id,
            position: { x: change.position!.x, y: change.position!.y },
            ...(reactFlow.getNode(change.id)?.parentId
              ? { parentId: reactFlow.getNode(change.id)!.parentId }
              : {})
          }));
        const groupMoves = positioned
          .filter((change) => groupIds.has(change.id))
          .map((change) => ({
            id: change.id,
            position: { x: change.position!.x, y: change.position!.y }
          }));
        if (nodeMoves.length > 0) onNodesMoved?.(nodeMoves);
        if (groupMoves.length > 0) onGroupsMoved?.(groupMoves);
      }

      const selection = changes.filter(
        (change): change is Extract<NodeChange, { type: "select" }> =>
          change.type === "select"
      );
      if (selection.length > 0) {
        const groupIds = new Set((groups ?? []).map((group) => group.id));
        const selected = selection.filter(
          (change) => change.selected && !groupIds.has(change.id)
        );
        if (selected.length > 0) {
          onPrimarySelectionChange?.(selected[selected.length - 1]!.id);
        } else if (selection.every((change) => !change.selected)) {
          onPrimarySelectionChange?.(null);
        }
      }
    },
    [groups, onGroupsMoved, onNodesMoved, onPrimarySelectionChange, reactFlow]
  );

  const handleEdgesChange = useCallback((changes: EdgeChange<FlowEdge>[]) => {
    setFlowEdges((current) => applyEdgeChanges(changes, current));
  }, []);

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      onConnect?.({
        fromId: connection.source,
        toId: connection.target,
        fromPort: connection.sourceHandle ?? undefined,
        toPort: connection.targetHandle ?? undefined
      });
    },
    [onConnect]
  );

  const handleIsValidConnection = useCallback(
    (connection: Connection | FlowEdge) => {
      if (!isValidConnection) return true;
      if (!connection.source || !connection.target) return false;
      return isValidConnection({
        fromId: connection.source,
        toId: connection.target,
        fromPort: connection.sourceHandle ?? undefined,
        toPort: connection.targetHandle ?? undefined
      });
    },
    [isValidConnection]
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
      const { nodeIds } = splitDeletedNodes(deletedNodes);
      return onBeforeDelete({
        nodeIds,
        edgeIds: deletedEdges.map((edge) => edge.id)
      });
    },
    [onBeforeDelete]
  );

  const handleNodesDelete = useCallback(
    (deleted: FlowNode[]) => {
      const { nodeIds, groupIds } = splitDeletedNodes(deleted);
      if (nodeIds.length > 0) onNodesDeleted?.(nodeIds);
      if (groupIds.length > 0) onGroupsDeleted?.(groupIds);
    },
    [onGroupsDeleted, onNodesDeleted]
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
      isValidConnection={handleIsValidConnection}
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
