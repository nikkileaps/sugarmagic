/**
 * packages/workspaces/src/render/shader-graph-mapping.ts
 *
 * Purpose: translates a shader graph into the shared node editor's nodes and
 * connections, and decides which connections are allowed. Pure functions, so the
 * translation and the type rules can be unit tested without a browser.
 *
 * Status: active
 */

import {
  areShaderPortTypesCompatible,
  getShaderNodeDefinition,
  shaderInputPortDataType,
  shaderOutputPortDataType,
  type ShaderDataType,
  type ShaderGraphDocument,
  type ShaderNodeInstance
} from "@sugarmagic/domain";
import type {
  GraphEditorConnection,
  GraphEditorEdge,
  GraphEditorNode,
  GraphEditorNodeMove,
  GraphEditorPort
} from "@sugarmagic/ui/node-editor";

export const SHADER_NODE_KIND = "shader-node";

/** What the shader node card needs in order to draw itself. */
export interface ShaderNodePayload {
  node: ShaderNodeInstance;
  displayName: string;
  category: string;
  inputPortNames: string[];
  outputPortNames: string[];
}

export function portColor(dataType: ShaderDataType | undefined): string {
  switch (dataType) {
    case "float":
      return "var(--sm-accent-yellow)";
    case "vec2":
      return "var(--sm-accent-sky)";
    case "vec3":
    case "color":
      return "var(--sm-accent-green)";
    case "vec4":
      return "var(--sm-accent-mauve)";
    case "texture2d":
      return "var(--sm-accent-red)";
    case "bool":
      return "var(--sm-accent-peach)";
    default:
      return "var(--sm-color-overlay2)";
  }
}

/**
 * The shader node card's geometry, shared with the card itself so a port dot and
 * its name land on the same line. The editor positions a port as a fraction of
 * the WHOLE node, so the header has to be accounted for here or the first port
 * sits on top of the node's title.
 */
export const SHADER_NODE_HEADER_HEIGHT = 34;
export const SHADER_NODE_PORT_ROW_HEIGHT = 26;

export function shaderPortYPercent(index: number, rowCount: number): number {
  const bodyHeight = Math.max(rowCount, 1) * SHADER_NODE_PORT_ROW_HEIGHT;
  const total = SHADER_NODE_HEADER_HEIGHT + bodyHeight;
  const centre =
    SHADER_NODE_HEADER_HEIGHT + (index + 0.5) * SHADER_NODE_PORT_ROW_HEIGHT;
  return centre / total;
}

function spreadPorts(
  ports: { portId: string; dataType: ShaderDataType }[],
  rowCount: number
): GraphEditorPort[] {
  return ports.map((port, index) => ({
    name: port.portId,
    color: portColor(port.dataType),
    yPercent: shaderPortYPercent(index, rowCount)
  }));
}

export function shaderToEditorNodes(
  shader: ShaderGraphDocument
): GraphEditorNode[] {
  return shader.nodes.map((node) => {
    const definition = getShaderNodeDefinition(node.nodeType);
    // Both columns share one row grid, so a node with 2 inputs and 1 output has
    // its output on the first row rather than floating mid-node.
    const rowCount = Math.max(
      definition?.inputPorts.length ?? 0,
      definition?.outputPorts.length ?? 0,
      1
    );
    return {
      id: node.nodeId,
      kind: SHADER_NODE_KIND,
      position: { ...node.position },
      payload: {
        node,
        displayName: definition?.displayName ?? node.nodeType,
        category: definition?.category ?? "",
        inputPortNames: (definition?.inputPorts ?? []).map(
          (port) => port.displayName
        ),
        outputPortNames: (definition?.outputPorts ?? []).map(
          (port) => port.displayName
        )
      } satisfies ShaderNodePayload,
      inputs: definition ? spreadPorts(definition.inputPorts, rowCount) : [],
      // Output dots use the resolved type, so a colour parameter reads as a
      // colour rather than as the registry's placeholder float.
      outputs: definition
        ? spreadPorts(
            definition.outputPorts.map((port) => ({
              ...port,
              dataType:
                shaderPortDataType(
                  shader,
                  node.nodeId,
                  port.portId,
                  "output"
                ) ?? port.dataType
            })),
            rowCount
          )
        : []
    };
  });
}

export function shaderToEditorEdges(
  shader: ShaderGraphDocument
): GraphEditorEdge[] {
  return shader.edges.map((edge) => ({
    id: edge.edgeId,
    fromId: edge.sourceNodeId,
    toId: edge.targetNodeId,
    fromPort: edge.sourcePortId,
    toPort: edge.targetPortId,
    color: portColor(
      getShaderNodeDefinition(
        shader.nodes.find((node) => node.nodeId === edge.sourceNodeId)
          ?.nodeType ?? ""
      )?.outputPorts.find((port) => port.portId === edge.sourcePortId)?.dataType
    )
  }));
}

export function applyShaderNodeMoves(
  shader: ShaderGraphDocument,
  moves: GraphEditorNodeMove[]
): ShaderNodeInstance[] {
  const byId = new Map(moves.map((move) => [move.id, move.position]));
  return shader.nodes
    .filter((node) => byId.has(node.nodeId))
    .map((node) => ({ ...node, position: { ...byId.get(node.nodeId)! } }));
}

/**
 * Whether the node declares this port at all. Separate from its data type: a
 * Parameter node's port exists even while its type is still unknown.
 */
export function shaderPortExists(
  shader: ShaderGraphDocument,
  nodeId: string,
  portId: string | undefined,
  side: "input" | "output"
): boolean {
  const node = shader.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (!node) return false;
  const definition = getShaderNodeDefinition(node.nodeType);
  const ports =
    side === "input" ? definition?.inputPorts : definition?.outputPorts;
  if (!ports || ports.length === 0) return false;
  if (!portId) return true;
  return ports.some((port) => port.portId === portId);
}

/**
 * The data type at one end of a connection. The resolution lives in the domain,
 * which knows that a Parameter node takes its bound parameter's type and a
 * Material Texture node's type depends on the channel; this only handles the
 * editor's case of a drag that has not named a port yet.
 */
export function shaderPortDataType(
  shader: ShaderGraphDocument,
  nodeId: string,
  portId: string | undefined,
  side: "input" | "output"
): ShaderDataType | undefined {
  const node = shader.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (!node) return undefined;

  if (!portId) {
    const definition = getShaderNodeDefinition(node.nodeType);
    const ports =
      side === "input" ? definition?.inputPorts : definition?.outputPorts;
    return ports?.[0]?.dataType;
  }

  return side === "output"
    ? shaderOutputPortDataType(shader, nodeId, portId)
    : shaderInputPortDataType(shader, nodeId, portId);
}

/**
 * A connection is allowed when both ends exist, it is not a node connecting to
 * itself, the target port is free, and the two port data types match.
 *
 * Previously the editor accepted any drop and picked a target port for the
 * author, falling back to the first input even when no type matched. Refusing
 * while dragging means a connection always lands where it was aimed.
 */
export interface ShaderConnectionCheck {
  allowed: boolean;
  /** Why it was refused, ready to show the author. */
  reason?: string;
}

export function checkShaderConnection(
  shader: ShaderGraphDocument,
  connection: GraphEditorConnection
): ShaderConnectionCheck {
  const { fromId, toId, fromPort, toPort } = connection;
  if (fromId === toId) {
    return { allowed: false, reason: "A node cannot connect to itself." };
  }
  if (
    !shader.nodes.some((node) => node.nodeId === fromId) ||
    !shader.nodes.some((node) => node.nodeId === toId)
  ) {
    return { allowed: false, reason: "That node is no longer in the graph." };
  }

  const occupied = shader.edges.some(
    (edge) => edge.targetNodeId === toId && edge.targetPortId === toPort
  );
  if (occupied) {
    return {
      allowed: false,
      reason:
        "That input already has a connection. Delete it before connecting another."
    };
  }

  if (
    !shaderPortExists(shader, fromId, fromPort, "output") ||
    !shaderPortExists(shader, toId, toPort, "input")
  ) {
    return { allowed: false, reason: "That port is not on this node." };
  }

  const sourceType = shaderPortDataType(shader, fromId, fromPort, "output");
  const targetType = shaderPortDataType(shader, toId, toPort, "input");
  // The port exists but its type is not settled yet -- an unbound Parameter
  // node. Allow it rather than making the node unusable until a parameter is
  // chosen; a port that does not exist at all was already refused above.
  if (!sourceType || !targetType) return { allowed: true };
  // The same rule the shader compiler applies, so the editor never refuses
  // wiring that would have compiled. It is wider than equality on purpose:
  // vec3 and color are interchangeable, a float spreads across a vector, and
  // vectors truncate and widen. NOTE: a widened or truncated connection is
  // silently reinterpreted rather than reported, so a wrong-looking shader can
  // come from a legal connection. If that becomes a real source of bugs, the
  // place to change it is `areShaderPortTypesCompatible` in
  // packages/domain/src/shader-graph, which both this and the compiler use.
  if (!areShaderPortTypesCompatible(sourceType, targetType)) {
    return {
      allowed: false,
      reason: `A ${sourceType} output cannot connect to a ${targetType} input.`
    };
  }
  return { allowed: true };
}

export function isValidShaderConnection(
  shader: ShaderGraphDocument,
  connection: GraphEditorConnection
): boolean {
  return checkShaderConnection(shader, connection).allowed;
}
