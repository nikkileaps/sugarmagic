import { describe, expect, it } from "vitest";
import type { ShaderGraphDocument } from "@sugarmagic/domain";
import {
  applyShaderNodeMoves,
  checkShaderConnection,
  shaderPortDataType,
  isValidShaderConnection,
  shaderToEditorEdges,
  shaderToEditorNodes
} from "@sugarmagic/workspaces";
import { expectEdgePortsExist } from "./graph-edge-ports";

/**
 * `math.add` and `math.multiply` each declare two float inputs (a, b) and one
 * float output (value); `input.world-position` outputs a vec3. That mix is what
 * makes the type rules testable.
 */
function shader(): ShaderGraphDocument {
  return {
    definitionId: "sh-1",
    displayName: "Test shader",
    targetKind: "mesh-surface",
    nodes: [
      { nodeId: "add", nodeType: "math.add", position: { x: 0, y: 0 }, settings: {} },
      { nodeId: "mul", nodeType: "math.multiply", position: { x: 300, y: 0 }, settings: {} },
      {
        nodeId: "pos",
        nodeType: "input.world-position",
        position: { x: 0, y: 200 },
        settings: {}
      }
    ],
    edges: [],
    parameters: [],
    metadata: {}
  } as unknown as ShaderGraphDocument;
}

describe("shader graph mapping", () => {
  it("only emits edges whose ports exist on the nodes they attach to", () => {
    const withEdge = shader();
    withEdge.edges = [
      {
        edgeId: "e1",
        sourceNodeId: "add",
        sourcePortId: "value",
        targetNodeId: "mul",
        targetPortId: "a"
      }
    ];
    expectEdgePortsExist(
      shaderToEditorNodes(withEdge),
      shaderToEditorEdges(withEdge)
    );
  });

  it("gives a node one editor port per declared port", () => {
    const nodes = shaderToEditorNodes(shader());
    const add = nodes.find((node) => node.id === "add")!;
    expect(add.inputs?.map((port) => port.name)).toEqual(["a", "b"]);
    expect(add.outputs?.map((port) => port.name)).toEqual(["value"]);
  });

/**
 * The case from the shader editor: a Parameter node feeding Surface Output.
 * A Parameter's registry output type is a placeholder `float`; its real type is
 * whatever the shader parameter it points at declares.
 */
function shaderWithParameter(dataType: string) {
  return {
    definitionId: "sh-2",
    displayName: "Param shader",
    targetKind: "mesh-surface",
    nodes: [
      {
        nodeId: "param",
        nodeType: "input.parameter",
        position: { x: 0, y: 0 },
        settings: { parameterId: "tint" }
      },
      {
        nodeId: "out",
        nodeType: "output.surface",
        position: { x: 400, y: 0 },
        settings: {}
      }
    ],
    edges: [],
    parameters: [
      { parameterId: "tint", displayName: "Tint", dataType, defaultValue: [1, 1, 1] }
    ],
    metadata: {}
  } as unknown as ShaderGraphDocument;
}

describe("parameter node types", () => {
  it("resolves a parameter node's output type from the parameter it points at", () => {
    expect(shaderPortDataType(shaderWithParameter("color"), "param", "value", "output")).toBe("color");
    expect(shaderPortDataType(shaderWithParameter("float"), "param", "value", "output")).toBe("float");
  });

  it("allows a colour parameter into the Color input", () => {
    const check = checkShaderConnection(shaderWithParameter("color"), {
      fromId: "param",
      toId: "out",
      fromPort: "value",
      toPort: "color"
    });
    expect(check.allowed).toBe(true);
  });

  it("refuses a colour parameter into a float input, and says why", () => {
    const check = checkShaderConnection(shaderWithParameter("color"), {
      fromId: "param",
      toId: "out",
      fromPort: "value",
      toPort: "alpha"
    });
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/color output cannot connect to a float input/i);
  });

  it("allows an unbound parameter node to connect to anything", () => {
    const unbound = shaderWithParameter("color");
    unbound.nodes[0]!.settings = {};
    expect(
      checkShaderConnection(unbound, {
        fromId: "param",
        toId: "out",
        fromPort: "value",
        toPort: "color"
      }).allowed
    ).toBe(true);
  });

  it("explains an occupied input rather than refusing silently", () => {
    const occupied = shaderWithParameter("color");
    occupied.edges = [
      {
        edgeId: "e1",
        sourceNodeId: "param",
        sourcePortId: "value",
        targetNodeId: "out",
        targetPortId: "color"
      }
    ] as never;
    const check = checkShaderConnection(occupied, {
      fromId: "param",
      toId: "out",
      fromPort: "value",
      toPort: "color"
    });
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/already has a connection/i);
  });
});

  it("spreads several ports down the edge rather than stacking them", () => {
    const add = shaderToEditorNodes(shader()).find((node) => node.id === "add")!;
    const [a, b] = add.inputs!;
    expect(a!.yPercent).not.toEqual(b!.yPercent);
  });

  it("carries the display name and category for the node card", () => {
    const add = shaderToEditorNodes(shader()).find((node) => node.id === "add")!;
    expect(add.payload).toMatchObject({ displayName: "Add", category: "math" });
  });

  it("maps a connection to the exact ports on both ends", () => {
    const withEdge = shader();
    withEdge.edges = [
      {
        edgeId: "e1",
        sourceNodeId: "add",
        sourcePortId: "value",
        targetNodeId: "mul",
        targetPortId: "a"
      }
    ];
    const [edge] = shaderToEditorEdges(withEdge);
    expect(edge).toMatchObject({
      id: "e1",
      fromId: "add",
      toId: "mul",
      fromPort: "value",
      toPort: "a"
    });
  });

  it("allows a connection between matching port types", () => {
    expect(
      isValidShaderConnection(shader(), {
        fromId: "add",
        toId: "mul",
        fromPort: "value",
        toPort: "a"
      })
    ).toBe(true);
  });

  it("refuses a connection between mismatched port types", () => {
    // world-position's "value" output is vec3; math.multiply's inputs are float.
    expect(
      isValidShaderConnection(shader(), {
        fromId: "pos",
        toId: "mul",
        fromPort: "value",
        toPort: "a"
      })
    ).toBe(false);
  });

  // The editor must refuse exactly what the shader compiler refuses. It used to
  // demand identical types, which blocked wiring that compiles fine.
  it("allows the widening and aliasing the compiler allows", () => {
    const withSurface = shader();
    withSurface.nodes = [
      ...withSurface.nodes,
      {
        nodeId: "surface",
        nodeType: "output.surface",
        position: { x: 600, y: 0 },
        settings: {}
      }
    ] as typeof withSurface.nodes;

    // world-position "value" is vec3; the surface "color" input is color.
    expect(
      isValidShaderConnection(withSurface, {
        fromId: "pos",
        toId: "surface",
        fromPort: "value",
        toPort: "color"
      })
    ).toBe(true);

    // math.add "value" is float, which spreads across a color.
    expect(
      isValidShaderConnection(withSurface, {
        fromId: "add",
        toId: "surface",
        fromPort: "value",
        toPort: "color"
      })
    ).toBe(true);
  });

  it("refuses a port that does not exist on the node", () => {
    expect(
      isValidShaderConnection(shader(), {
        fromId: "add",
        toId: "mul",
        fromPort: "value",
        toPort: "not-a-port"
      })
    ).toBe(false);
  });

  it("refuses a node connecting to itself", () => {
    expect(
      isValidShaderConnection(shader(), {
        fromId: "add",
        toId: "add",
        fromPort: "value",
        toPort: "a"
      })
    ).toBe(false);
  });

  it("refuses a port that already has a connection", () => {
    const occupied = shader();
    occupied.edges = [
      {
        edgeId: "e1",
        sourceNodeId: "add",
        sourcePortId: "value",
        targetNodeId: "mul",
        targetPortId: "a"
      }
    ];
    expect(
      isValidShaderConnection(occupied, {
        fromId: "add",
        toId: "mul",
        fromPort: "value",
        toPort: "a"
      })
    ).toBe(false);
    // The other input is still free.
    expect(
      isValidShaderConnection(occupied, {
        fromId: "add",
        toId: "mul",
        fromPort: "value",
        toPort: "b"
      })
    ).toBe(true);
  });

  it("returns only the nodes that actually moved", () => {
    const moved = applyShaderNodeMoves(shader(), [
      { id: "mul", position: { x: -50, y: -80 } }
    ]);
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ nodeId: "mul", position: { x: -50, y: -80 } });
  });

});
