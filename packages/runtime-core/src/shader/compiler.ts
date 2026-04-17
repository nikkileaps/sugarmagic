/**
 * Shader semantic compiler.
 *
 * Converts canonical authored shader graphs into ordered platform-agnostic IR,
 * validating graph structure and type compatibility along the way. This module
 * is pure and has no renderer dependencies.
 */

import type {
  ShaderDataType,
  ShaderEdge,
  ShaderGraphDocument,
  ShaderNodeInstance,
  ShaderPortDefinition,
  ShaderTargetKind
} from "@sugarmagic/domain";
import {
  getShaderNodeDefinition,
  validateShaderGraphDocument
} from "@sugarmagic/domain";
import type { RuntimeCompileProfile } from "../materials";
import type {
  ShaderIR,
  ShaderIRBuiltinName,
  ShaderIRDiagnostic,
  ShaderIROp,
  ShaderIRValue
} from "./ir";

interface CompileContext {
  document: ShaderGraphDocument;
  compileProfile: RuntimeCompileProfile;
  diagnostics: ShaderIRDiagnostic[];
  incomingEdgesByPort: Map<string, ShaderEdge>;
  nodesById: Map<string, ShaderNodeInstance>;
  valuesByNodePort: Map<string, ShaderIRValue>;
  currentOps: ShaderIROp[];
  opCounter: number;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function asBuiltin(
  name: ShaderIRBuiltinName,
  dataType: ShaderDataType,
  settings?: Record<string, unknown>
): ShaderIRValue {
  return { kind: "builtin", name, dataType, ...(settings ? { settings } : {}) };
}

function literalValue(dataType: ShaderDataType, value: unknown): ShaderIRValue {
  return { kind: "literal", dataType, value };
}

function referenceValue(dataType: ShaderDataType, opId: string): ShaderIRValue {
  return { kind: "reference", dataType, opId };
}

function parameterValue(dataType: ShaderDataType, parameterId: string): ShaderIRValue {
  return { kind: "parameter", dataType, parameterId };
}

function createContext(
  document: ShaderGraphDocument,
  compileProfile: RuntimeCompileProfile
): CompileContext {
  return {
    document,
    compileProfile,
    diagnostics: [],
    incomingEdgesByPort: new Map(
      document.edges.map((edge) => [`${edge.targetNodeId}:${edge.targetPortId}`, edge])
    ),
    nodesById: new Map(document.nodes.map((node) => [node.nodeId, node])),
    valuesByNodePort: new Map(),
    currentOps: [],
    opCounter: 0
  };
}

function nextOpId(context: CompileContext, prefix: string): string {
  context.opCounter += 1;
  return `${prefix}:${context.opCounter}`;
}

function isAliasType(source: ShaderDataType, target: ShaderDataType): boolean {
  return (
    (source === "vec3" && target === "color") ||
    (source === "color" && target === "vec3")
  );
}

function coerceValue(
  context: CompileContext,
  value: ShaderIRValue,
  targetType: ShaderDataType,
  nodeId?: string
): ShaderIRValue {
  if (value.dataType === targetType || isAliasType(value.dataType, targetType)) {
    return targetType === "color" && value.dataType === "vec3"
      ? { ...value, dataType: "color" }
      : targetType === "vec3" && value.dataType === "color"
        ? { ...value, dataType: "vec3" }
        : value;
  }

  if (
    value.dataType === "float" &&
    (targetType === "vec2" ||
      targetType === "vec3" ||
      targetType === "vec4" ||
      targetType === "color")
  ) {
    const opId = nextOpId(context, "splat");
    context.currentOps.push({
      opId,
      opKind: "splat",
      dataType: targetType,
      nodeId,
      inputs: { input: value }
    });
    return referenceValue(targetType, opId);
  }

  if (
    (value.dataType === "vec4" && targetType === "vec3") ||
    (value.dataType === "vec3" && targetType === "vec2")
  ) {
    context.diagnostics.push({
      severity: "warning",
      nodeId,
      message: `Implicit vector truncation from ${value.dataType} to ${targetType}.`
    });
    const opId = nextOpId(context, "truncate");
    context.currentOps.push({
      opId,
      opKind: "truncate",
      dataType: targetType,
      nodeId,
      inputs: { input: value }
    });
    return referenceValue(targetType, opId);
  }

  context.diagnostics.push({
    severity: "error",
    nodeId,
    message: `Cannot coerce ${value.dataType} to ${targetType}.`
  });
  return literalValue(targetType, targetType === "bool" ? false : 0);
}

function constantFoldBinary(
  opKind: string,
  dataType: ShaderDataType,
  a: ShaderIRValue,
  b: ShaderIRValue
): ShaderIRValue | null {
  if (a.kind !== "literal" || b.kind !== "literal") {
    return null;
  }
  if (!isNumber(a.value) || !isNumber(b.value)) {
    return null;
  }

  if (opKind === "math.add") {
    return literalValue(dataType, a.value + b.value);
  }
  if (opKind === "math.subtract") {
    return literalValue(dataType, a.value - b.value);
  }
  if (opKind === "math.multiply") {
    return literalValue(dataType, a.value * b.value);
  }
  if (opKind === "math.divide") {
    return literalValue(dataType, b.value === 0 ? 0 : a.value / b.value);
  }
  if (opKind === "math.pow") {
    return literalValue(dataType, Math.pow(a.value, b.value));
  }
  if (opKind === "math.min") {
    return literalValue(dataType, Math.min(a.value, b.value));
  }
  if (opKind === "math.max") {
    return literalValue(dataType, Math.max(a.value, b.value));
  }
  return null;
}

function incomingValue(
  context: CompileContext,
  node: ShaderNodeInstance,
  port: ShaderPortDefinition
): ShaderIRValue {
  const edge = context.incomingEdgesByPort.get(`${node.nodeId}:${port.portId}`) ?? null;
  if (!edge) {
    if (!port.optional) {
      context.diagnostics.push({
        severity: "error",
        nodeId: node.nodeId,
        message: `Missing required input "${port.displayName}".`
      });
    }

    return literalValue(
      port.dataType,
      port.defaultValue ?? (port.dataType === "bool" ? false : 0)
    );
  }

  const sourceDefinition = getShaderNodeDefinition(
    context.nodesById.get(edge.sourceNodeId)?.nodeType ?? ""
  );
  const sourcePort =
    sourceDefinition?.outputPorts.find((candidate) => candidate.portId === edge.sourcePortId) ??
    null;
  const sourceValue = compileNodePort(context, edge.sourceNodeId, edge.sourcePortId);
  if (!sourcePort || !sourceValue) {
    context.diagnostics.push({
      severity: "error",
      edgeId: edge.edgeId,
      nodeId: node.nodeId,
      message: `Input "${port.displayName}" references a missing source value.`
    });
    return literalValue(port.dataType, 0);
  }

  return coerceValue(context, sourceValue, port.dataType, node.nodeId);
}

function outputTargetKind(document: ShaderGraphDocument): {
  opList: "vertexOps" | "fragmentOps" | "postProcessOps";
} {
  if (document.targetKind === "mesh-deform") {
    return { opList: "vertexOps" };
  }
  if (document.targetKind === "post-process") {
    return { opList: "postProcessOps" };
  }
  return { opList: "fragmentOps" };
}

function builtinForNodeType(
  nodeType: string,
  settings: Record<string, unknown>
): ShaderIRValue | null {
  switch (nodeType) {
    case "input.time":
      return asBuiltin("time", "float");
    case "input.delta-time":
      return asBuiltin("deltaTime", "float");
    case "input.world-position":
      return asBuiltin("worldPosition", "vec3");
    case "input.local-position":
      return asBuiltin("localPosition", "vec3");
    case "input.world-normal":
      return asBuiltin("worldNormal", "vec3");
    case "input.local-normal":
      return asBuiltin("localNormal", "vec3");
    case "input.uv":
      return asBuiltin("uv", "vec2");
    case "input.vertex-color":
      return asBuiltin("vertexColor", "vec4");
    case "input.vertex-wind-mask":
      return asBuiltin("vertexWindMask", "float", settings);
    case "input.camera-position":
      return asBuiltin("cameraPosition", "vec3");
    case "input.view-direction":
      return asBuiltin("viewDirection", "vec3");
    case "input.sun-direction":
      return asBuiltin("sunDirection", "vec3");
    case "input.screen-uv":
      return asBuiltin("screenUV", "vec2");
    case "input.scene-color":
      return asBuiltin("sceneColor", "vec3");
    case "input.scene-depth":
      return asBuiltin("sceneDepth", "float");
    default:
      return null;
  }
}

function compileOutputNode(
  context: CompileContext,
  node: ShaderNodeInstance,
  requestedPortId: string
): ShaderIRValue | null {
  const definition = getShaderNodeDefinition(node.nodeType);
  if (!definition) {
    return null;
  }

  const port =
    definition.inputPorts.find((candidate) => candidate.portId === requestedPortId) ??
    null;
  if (!port) {
    return null;
  }

  return incomingValue(context, node, port);
}

function compileNodePort(
  context: CompileContext,
  nodeId: string,
  requestedPortId: string
): ShaderIRValue | null {
  const cacheKey = `${nodeId}:${requestedPortId}`;
  if (context.valuesByNodePort.has(cacheKey)) {
    return context.valuesByNodePort.get(cacheKey)!;
  }

  const node = context.nodesById.get(nodeId) ?? null;
  const definition = node ? getShaderNodeDefinition(node.nodeType) : null;
  if (!node || !definition) {
    return null;
  }

  const builtin = builtinForNodeType(node.nodeType, node.settings);
  if (builtin) {
    context.valuesByNodePort.set(cacheKey, builtin);
    return builtin;
  }

  if (node.nodeType === "input.parameter") {
    const parameterId = String(node.settings.parameterId ?? "").trim();
    const parameter =
      context.document.parameters.find((candidate) => candidate.parameterId === parameterId) ??
      null;
    if (!parameter) {
      context.diagnostics.push({
        severity: "error",
        nodeId,
        message: "Parameter node references a missing parameter."
      });
      return null;
    }

    const value = parameterValue(
      parameter.dataType === "texture2d" ? "texture2d" : parameter.dataType,
      parameter.parameterId
    );
    context.valuesByNodePort.set(cacheKey, value);
    return value;
  }

  if (node.nodeType === "input.material-texture") {
    const value =
      requestedPortId === "alpha"
        ? asBuiltin("materialTextureAlpha", "float")
        : asBuiltin("materialTextureColor", "color");
    context.valuesByNodePort.set(cacheKey, value);
    return value;
  }

  if (node.nodeType === "input.constant-float") {
    const value =
      typeof node.settings.value === "number" && Number.isFinite(node.settings.value)
        ? node.settings.value
        : 0;
    const literal = literalValue("float", value);
    context.valuesByNodePort.set(cacheKey, literal);
    return literal;
  }

  if (node.nodeType === "input.constant-color") {
    const value: ShaderIRValue = {
      kind: "literal",
      dataType: "color",
      value: Array.isArray(node.settings.color) ? node.settings.color : [0.72, 0.92, 0.56]
    };
    context.valuesByNodePort.set(cacheKey, value);
    return value;
  }

  if (node.nodeType.startsWith("output.")) {
    const outputValue = compileOutputNode(context, node, requestedPortId);
    if (outputValue) {
      context.valuesByNodePort.set(cacheKey, outputValue);
    }
    return outputValue;
  }

  const outputPort =
    definition.outputPorts.find((candidate) => candidate.portId === requestedPortId) ??
    definition.outputPorts[0] ??
    null;
  if (!outputPort) {
    return null;
  }

  const resolvedInputs: Record<string, ShaderIRValue> = {};
  for (const port of definition.inputPorts) {
    resolvedInputs[port.portId] = incomingValue(context, node, port);
  }

  if (resolvedInputs.a && resolvedInputs.b) {
    const binaryFold = constantFoldBinary(
      node.nodeType,
      outputPort.dataType,
      resolvedInputs.a,
      resolvedInputs.b
    );
    if (binaryFold) {
      context.valuesByNodePort.set(cacheKey, binaryFold);
      return binaryFold;
    }
  }

  const opId = nextOpId(context, node.nodeType);
  const opKind =
    node.nodeType === "math.add" ||
    node.nodeType === "math.subtract" ||
    node.nodeType === "math.multiply" ||
    node.nodeType === "math.divide" ||
    node.nodeType === "math.pow" ||
    node.nodeType === "math.exp" ||
    node.nodeType === "math.min" ||
    node.nodeType === "math.max" ||
    node.nodeType === "math.saturate" ||
    node.nodeType === "math.smoothstep" ||
    node.nodeType === "math.distance" ||
    node.nodeType === "math.sin" ||
    node.nodeType === "math.cos" ||
    node.nodeType === "math.abs" ||
    node.nodeType === "math.clamp" ||
    node.nodeType === "math.lerp" ||
    node.nodeType === "color.luminance" ||
    node.nodeType === "color.add" ||
    node.nodeType === "color.multiply" ||
    node.nodeType === "color.divide" ||
    node.nodeType === "color.pow" ||
    node.nodeType === "math.dot" ||
    node.nodeType === "math.normalize" ||
    node.nodeType === "math.length" ||
    node.nodeType === "math.combine-vector" ||
    node.nodeType === "math.split-vector" ||
    node.nodeType.startsWith("effect.")
      ? node.nodeType
      : node.nodeType;

  const op: ShaderIROp = {
    opId,
    opKind,
    dataType: outputPort.dataType,
    nodeId: node.nodeId,
    inputs: resolvedInputs,
    settings: {
      ...node.settings,
      outputPortId: requestedPortId
    }
  };
  context.currentOps.push(op);
  const value = referenceValue(outputPort.dataType, opId);
  context.valuesByNodePort.set(cacheKey, value);
  return value;
}

function detectCycles(document: ShaderGraphDocument): ShaderIRDiagnostic[] {
  const diagnostics: ShaderIRDiagnostic[] = [];
  const edgesBySource = new Map<string, ShaderEdge[]>();
  for (const edge of document.edges) {
    const next = edgesBySource.get(edge.sourceNodeId) ?? [];
    next.push(edge);
    edgesBySource.set(edge.sourceNodeId, next);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(nodeId: string) {
    if (visited.has(nodeId)) {
      return;
    }
    if (visiting.has(nodeId)) {
      diagnostics.push({
        severity: "error",
        nodeId,
        message: "Shader graph contains a cycle."
      });
      return;
    }
    visiting.add(nodeId);
    for (const edge of edgesBySource.get(nodeId) ?? []) {
      visit(edge.targetNodeId);
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  }

  for (const node of document.nodes) {
    visit(node.nodeId);
  }

  return diagnostics;
}

export function compileShaderGraph(
  document: ShaderGraphDocument,
  options: { compileProfile: RuntimeCompileProfile }
): ShaderIR {
  const context = createContext(document, options.compileProfile);
  context.diagnostics.push(...validateShaderGraphDocument(document));
  context.diagnostics.push(...detectCycles(document));

  const vertexOps: ShaderIROp[] = [];
  const fragmentOps: ShaderIROp[] = [];
  const postProcessOps: ShaderIROp[] = [];
  const outputs: ShaderIR["outputs"] = {};

  for (const node of document.nodes) {
    if (!node.nodeType.startsWith("output.")) {
      continue;
    }

    context.currentOps = [];
    if (node.nodeType === "output.vertex") {
      outputs.vertex = compileNodePort(context, node.nodeId, "value") ?? undefined;
      vertexOps.push(...context.currentOps);
    } else if (node.nodeType === "output.fragment") {
      outputs.fragmentColor = compileNodePort(context, node.nodeId, "color") ?? undefined;
      outputs.fragmentAlpha = compileNodePort(context, node.nodeId, "alpha") ?? undefined;
      fragmentOps.push(...context.currentOps);
    } else if (node.nodeType === "output.emissive") {
      outputs.emissive = compileNodePort(context, node.nodeId, "color") ?? undefined;
      fragmentOps.push(...context.currentOps);
    } else if (node.nodeType === "output.post-process") {
      outputs.postProcessColor =
        compileNodePort(context, node.nodeId, "color") ?? undefined;
      postProcessOps.push(...context.currentOps);
    }
  }

  return {
    shaderDefinitionId: document.shaderDefinitionId,
    revision: document.revision,
    targetKind: document.targetKind,
    vertexOps,
    fragmentOps,
    postProcessOps,
    outputs,
    parameters: document.parameters.map((parameter) => ({
      parameterId: parameter.parameterId,
      displayName: parameter.displayName,
      dataType: parameter.dataType,
      defaultValue: parameter.defaultValue
    })),
    textureSlots: [],
    diagnostics: context.diagnostics
  };
}
