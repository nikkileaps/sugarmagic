/**
 * The rule every graph mapping has to satisfy: an edge may only name a port that
 * exists on the node it attaches to.
 *
 * The graph library resolves a handle by exact id and silently draws nothing when
 * it misses, so breaking this loses the connection on screen while the document
 * still holds it. Quest branch nodes hit exactly that: their outputs are named
 * "pass" and "fail", and a prerequisite edge that named neither was dropped.
 *
 * Shared because all three mappings can make the same mistake.
 */

import { expect } from "vitest";
import {
  DEFAULT_INPUT_PORT,
  DEFAULT_OUTPUT_PORT,
  type GraphEditorEdge,
  type GraphEditorNode
} from "@sugarmagic/ui/node-editor";

export function expectEdgePortsExist(
  nodes: GraphEditorNode[],
  edges: GraphEditorEdge[]
): void {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  for (const edge of edges) {
    const source = nodesById.get(edge.fromId);
    const target = nodesById.get(edge.toId);
    expect(source, `edge ${edge.id} has no source node`).toBeDefined();
    expect(target, `edge ${edge.id} has no target node`).toBeDefined();

    const outputs = source!.outputs?.map((port) => port.name) ?? [
      DEFAULT_OUTPUT_PORT
    ];
    const inputs = target!.inputs?.map((port) => port.name) ?? [
      DEFAULT_INPUT_PORT
    ];

    expect(
      outputs,
      `edge ${edge.id} leaves port "${edge.fromPort ?? DEFAULT_OUTPUT_PORT}" of node ${edge.fromId}, which has ports ${outputs.join(", ")}`
    ).toContain(edge.fromPort ?? DEFAULT_OUTPUT_PORT);

    expect(
      inputs,
      `edge ${edge.id} enters port "${edge.toPort ?? DEFAULT_INPUT_PORT}" of node ${edge.toId}, which has ports ${inputs.join(", ")}`
    ).toContain(edge.toPort ?? DEFAULT_INPUT_PORT);
  }
}
