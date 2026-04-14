/**
 * Shader graph domain model and registry.
 *
 * Owns the canonical authored shader graph document format, the typed node
 * definition registry, and validation helpers that guard persisted truth
 * before runtime compilation ever happens. This module intentionally contains
 * no renderer or Three.js dependencies.
 */

import { createScopedId } from "../shared/identity";

export type ShaderTargetKind =
  | "mesh-surface"
  | "mesh-deform"
  | "post-process"
  | "billboard-surface";

export type ShaderDataType =
  | "float"
  | "vec2"
  | "vec3"
  | "vec4"
  | "color"
  | "texture2d"
  | "bool";

export type ShaderSettingDataType =
  | "float"
  | "int"
  | "bool"
  | "enum"
  | "string"
  | "color";

export type ShaderParameterValue =
  | number
  | [number, number]
  | [number, number, number]
  | [number, number, number, number]
  | string
  | boolean;

export interface ShaderParameterOverride {
  parameterId: string;
  value: ShaderParameterValue;
}

export interface ShaderBindingOverride {
  shaderDefinitionId: string;
}

export interface ShaderPortDefinition {
  portId: string;
  displayName: string;
  dataType: ShaderDataType;
  optional: boolean;
  defaultValue?: ShaderParameterValue;
}

export interface ShaderSettingDefinition {
  settingId: string;
  displayName: string;
  dataType: ShaderSettingDataType;
  defaultValue: ShaderParameterValue;
  constraints?: {
    min?: number;
    max?: number;
    step?: number;
    enumValues?: string[];
  };
}

export interface ShaderNodeDefinition {
  nodeType: string;
  displayName: string;
  category: string;
  validTargetKinds: ShaderTargetKind[];
  inputPorts: ShaderPortDefinition[];
  outputPorts: ShaderPortDefinition[];
  settings: ShaderSettingDefinition[];
}

export interface ShaderNodeInstance {
  nodeId: string;
  nodeType: string;
  position: { x: number; y: number };
  settings: Record<string, unknown>;
}

export interface ShaderEdge {
  edgeId: string;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
}

export interface ShaderParameter {
  parameterId: string;
  displayName: string;
  dataType: Exclude<ShaderDataType, "texture2d"> | "texture2d";
  defaultValue: ShaderParameterValue;
}

export interface ShaderGraphDocument {
  shaderDefinitionId: string;
  definitionKind: "shader";
  displayName: string;
  targetKind: ShaderTargetKind;
  revision: number;
  nodes: ShaderNodeInstance[];
  edges: ShaderEdge[];
  parameters: ShaderParameter[];
  metadata: Record<string, unknown>;
}

export interface PostProcessShaderBinding {
  shaderDefinitionId: string;
  order: number;
  parameterOverrides: ShaderParameterOverride[];
  enabled: boolean;
}

export interface ShaderGraphValidationIssue {
  severity: "error" | "warning";
  message: string;
  nodeId?: string;
  edgeId?: string;
  parameterId?: string;
}

function setting(
  settingId: string,
  displayName: string,
  dataType: ShaderSettingDataType,
  defaultValue: ShaderParameterValue,
  constraints?: ShaderSettingDefinition["constraints"]
): ShaderSettingDefinition {
  return { settingId, displayName, dataType, defaultValue, constraints };
}

function inputPort(
  portId: string,
  displayName: string,
  dataType: ShaderDataType,
  options: { optional?: boolean; defaultValue?: ShaderParameterValue } = {}
): ShaderPortDefinition {
  return {
    portId,
    displayName,
    dataType,
    optional: options.optional ?? false,
    ...(options.defaultValue === undefined ? {} : { defaultValue: options.defaultValue })
  };
}

function outputPort(
  portId: string,
  displayName: string,
  dataType: ShaderDataType
): ShaderPortDefinition {
  return {
    portId,
    displayName,
    dataType,
    optional: false
  };
}

const SHADER_NODE_DEFINITIONS: ShaderNodeDefinition[] = [
  {
    nodeType: "input.time",
    displayName: "Time",
    category: "input",
    validTargetKinds: ["mesh-surface", "mesh-deform", "post-process", "billboard-surface"],
    inputPorts: [],
    outputPorts: [outputPort("value", "Value", "float")],
    settings: []
  },
  {
    nodeType: "input.delta-time",
    displayName: "Delta Time",
    category: "input",
    validTargetKinds: ["mesh-surface", "mesh-deform", "post-process", "billboard-surface"],
    inputPorts: [],
    outputPorts: [outputPort("value", "Value", "float")],
    settings: []
  },
  {
    nodeType: "input.world-position",
    displayName: "World Position",
    category: "input",
    validTargetKinds: ["mesh-surface", "mesh-deform", "billboard-surface"],
    inputPorts: [],
    outputPorts: [outputPort("value", "Value", "vec3")],
    settings: []
  },
  {
    nodeType: "input.local-position",
    displayName: "Local Position",
    category: "input",
    validTargetKinds: ["mesh-surface", "mesh-deform", "billboard-surface"],
    inputPorts: [],
    outputPorts: [outputPort("value", "Value", "vec3")],
    settings: []
  },
  {
    nodeType: "input.world-normal",
    displayName: "World Normal",
    category: "input",
    validTargetKinds: ["mesh-surface", "mesh-deform"],
    inputPorts: [],
    outputPorts: [outputPort("value", "Value", "vec3")],
    settings: []
  },
  {
    nodeType: "input.local-normal",
    displayName: "Local Normal",
    category: "input",
    validTargetKinds: ["mesh-surface", "mesh-deform"],
    inputPorts: [],
    outputPorts: [outputPort("value", "Value", "vec3")],
    settings: []
  },
  {
    nodeType: "input.uv",
    displayName: "UV",
    category: "input",
    validTargetKinds: ["mesh-surface", "mesh-deform", "billboard-surface"],
    inputPorts: [],
    outputPorts: [outputPort("value", "Value", "vec2")],
    settings: []
  },
  {
    nodeType: "input.vertex-color",
    displayName: "Vertex Color",
    category: "input",
    validTargetKinds: ["mesh-surface", "mesh-deform"],
    inputPorts: [],
    outputPorts: [outputPort("value", "Value", "vec4")],
    settings: []
  },
  {
    nodeType: "input.vertex-wind-mask",
    displayName: "Vertex Wind Mask",
    category: "input",
    validTargetKinds: ["mesh-deform"],
    inputPorts: [],
    outputPorts: [outputPort("value", "Value", "float")],
    settings: [
      setting("channel", "Channel", "enum", "r", {
        enumValues: ["r", "g", "b", "a"]
      })
    ]
  },
  {
    nodeType: "input.camera-position",
    displayName: "Camera Position",
    category: "input",
    validTargetKinds: ["mesh-surface", "mesh-deform", "post-process", "billboard-surface"],
    inputPorts: [],
    outputPorts: [outputPort("value", "Value", "vec3")],
    settings: []
  },
  {
    nodeType: "input.view-direction",
    displayName: "View Direction",
    category: "input",
    validTargetKinds: ["mesh-surface", "mesh-deform", "billboard-surface"],
    inputPorts: [],
    outputPorts: [outputPort("value", "Value", "vec3")],
    settings: []
  },
  {
    nodeType: "input.screen-uv",
    displayName: "Screen UV",
    category: "input",
    validTargetKinds: ["post-process"],
    inputPorts: [],
    outputPorts: [outputPort("value", "Value", "vec2")],
    settings: []
  },
  {
    nodeType: "input.scene-color",
    displayName: "Scene Color",
    category: "input",
    validTargetKinds: ["post-process"],
    inputPorts: [],
    outputPorts: [outputPort("value", "Value", "vec4")],
    settings: []
  },
  {
    nodeType: "input.scene-depth",
    displayName: "Scene Depth",
    category: "input",
    validTargetKinds: ["post-process"],
    inputPorts: [],
    outputPorts: [outputPort("value", "Value", "float")],
    settings: []
  },
  {
    nodeType: "input.parameter",
    displayName: "Parameter",
    category: "input",
    validTargetKinds: ["mesh-surface", "mesh-deform", "post-process", "billboard-surface"],
    inputPorts: [],
    outputPorts: [outputPort("value", "Value", "float")],
    settings: [setting("parameterId", "Parameter", "string", "")]
  },
  {
    nodeType: "input.constant-color",
    displayName: "Color",
    category: "input",
    validTargetKinds: ["mesh-surface", "post-process", "billboard-surface"],
    inputPorts: [],
    outputPorts: [outputPort("value", "Value", "color")],
    settings: [
      setting("color", "Color", "color", [0.72, 0.92, 0.56] as [number, number, number])
    ]
  },
  {
    nodeType: "math.add",
    displayName: "Add",
    category: "math",
    validTargetKinds: ["mesh-surface", "mesh-deform", "post-process", "billboard-surface"],
    inputPorts: [
      inputPort("a", "A", "float"),
      inputPort("b", "B", "float")
    ],
    outputPorts: [outputPort("value", "Value", "float")],
    settings: []
  },
  {
    nodeType: "math.subtract",
    displayName: "Subtract",
    category: "math",
    validTargetKinds: ["mesh-surface", "mesh-deform", "post-process", "billboard-surface"],
    inputPorts: [
      inputPort("a", "A", "float"),
      inputPort("b", "B", "float")
    ],
    outputPorts: [outputPort("value", "Value", "float")],
    settings: []
  },
  {
    nodeType: "math.multiply",
    displayName: "Multiply",
    category: "math",
    validTargetKinds: ["mesh-surface", "mesh-deform", "post-process", "billboard-surface"],
    inputPorts: [
      inputPort("a", "A", "float"),
      inputPort("b", "B", "float")
    ],
    outputPorts: [outputPort("value", "Value", "float")],
    settings: []
  },
  {
    nodeType: "math.divide",
    displayName: "Divide",
    category: "math",
    validTargetKinds: ["mesh-surface", "mesh-deform", "post-process", "billboard-surface"],
    inputPorts: [
      inputPort("a", "A", "float"),
      inputPort("b", "B", "float", { optional: true, defaultValue: 1 })
    ],
    outputPorts: [outputPort("value", "Value", "float")],
    settings: []
  },
  {
    nodeType: "math.sin",
    displayName: "Sin",
    category: "math",
    validTargetKinds: ["mesh-surface", "mesh-deform", "post-process", "billboard-surface"],
    inputPorts: [inputPort("input", "Input", "float")],
    outputPorts: [outputPort("value", "Value", "float")],
    settings: []
  },
  {
    nodeType: "math.cos",
    displayName: "Cos",
    category: "math",
    validTargetKinds: ["mesh-surface", "mesh-deform", "post-process", "billboard-surface"],
    inputPorts: [inputPort("input", "Input", "float")],
    outputPorts: [outputPort("value", "Value", "float")],
    settings: []
  },
  {
    nodeType: "math.abs",
    displayName: "Abs",
    category: "math",
    validTargetKinds: ["mesh-surface", "mesh-deform", "post-process", "billboard-surface"],
    inputPorts: [inputPort("input", "Input", "float")],
    outputPorts: [outputPort("value", "Value", "float")],
    settings: []
  },
  {
    nodeType: "math.clamp",
    displayName: "Clamp",
    category: "math",
    validTargetKinds: ["mesh-surface", "mesh-deform", "post-process", "billboard-surface"],
    inputPorts: [
      inputPort("input", "Input", "float"),
      inputPort("min", "Min", "float", { optional: true, defaultValue: 0 }),
      inputPort("max", "Max", "float", { optional: true, defaultValue: 1 })
    ],
    outputPorts: [outputPort("value", "Value", "float")],
    settings: []
  },
  {
    nodeType: "math.lerp",
    displayName: "Lerp",
    category: "math",
    validTargetKinds: ["mesh-surface", "mesh-deform", "post-process", "billboard-surface"],
    inputPorts: [
      inputPort("a", "A", "vec3"),
      inputPort("b", "B", "vec3"),
      inputPort("alpha", "Alpha", "float")
    ],
    outputPorts: [outputPort("value", "Value", "vec3")],
    settings: []
  },
  {
    nodeType: "math.dot",
    displayName: "Dot",
    category: "math",
    validTargetKinds: ["mesh-surface", "mesh-deform", "post-process", "billboard-surface"],
    inputPorts: [
      inputPort("a", "A", "vec3"),
      inputPort("b", "B", "vec3")
    ],
    outputPorts: [outputPort("value", "Value", "float")],
    settings: []
  },
  {
    nodeType: "math.normalize",
    displayName: "Normalize",
    category: "math",
    validTargetKinds: ["mesh-surface", "mesh-deform", "post-process", "billboard-surface"],
    inputPorts: [inputPort("input", "Input", "vec3")],
    outputPorts: [outputPort("value", "Value", "vec3")],
    settings: []
  },
  {
    nodeType: "math.length",
    displayName: "Length",
    category: "math",
    validTargetKinds: ["mesh-surface", "mesh-deform", "post-process", "billboard-surface"],
    inputPorts: [inputPort("input", "Input", "vec3")],
    outputPorts: [outputPort("value", "Value", "float")],
    settings: []
  },
  {
    nodeType: "math.combine-vector",
    displayName: "Combine Vector",
    category: "math",
    validTargetKinds: ["mesh-surface", "mesh-deform", "post-process", "billboard-surface"],
    inputPorts: [
      inputPort("x", "X", "float"),
      inputPort("y", "Y", "float"),
      inputPort("z", "Z", "float", { optional: true, defaultValue: 0 }),
      inputPort("w", "W", "float", { optional: true, defaultValue: 1 })
    ],
    outputPorts: [
      outputPort("vec2", "Vec2", "vec2"),
      outputPort("vec3", "Vec3", "vec3"),
      outputPort("vec4", "Vec4", "vec4")
    ],
    settings: []
  },
  {
    nodeType: "math.split-vector",
    displayName: "Split Vector",
    category: "math",
    validTargetKinds: ["mesh-surface", "mesh-deform", "post-process", "billboard-surface"],
    inputPorts: [inputPort("input", "Input", "vec4")],
    outputPorts: [
      outputPort("x", "X", "float"),
      outputPort("y", "Y", "float"),
      outputPort("z", "Z", "float"),
      outputPort("w", "W", "float")
    ],
    settings: []
  },
  {
    nodeType: "effect.wind-sway",
    displayName: "Wind Sway",
    category: "effect",
    validTargetKinds: ["mesh-deform", "billboard-surface"],
    inputPorts: [
      inputPort("position", "Position", "vec3", { optional: true }),
      inputPort("time", "Time", "float", { optional: true }),
      inputPort("mask", "Mask", "float", { optional: true, defaultValue: 1 }),
      inputPort("strength", "Strength", "float", { optional: true }),
      inputPort("frequency", "Frequency", "float", { optional: true }),
      inputPort("direction", "Direction", "vec2", {
        optional: true,
        defaultValue: [1, 0] as [number, number]
      }),
      inputPort("spatialScale", "Spatial Scale", "float", { optional: true }),
      inputPort("heightScale", "Height Scale", "float", { optional: true })
    ],
    outputPorts: [outputPort("displacement", "Displacement", "vec3")],
    settings: [
      setting("strength", "Strength", "float", 0.3, { min: 0, max: 2, step: 0.05 }),
      setting("frequency", "Frequency", "float", 1.6, { min: 0.1, max: 6, step: 0.1 }),
      setting("spatialScale", "Spatial Scale", "float", 0.35, {
        min: 0.01,
        max: 2,
        step: 0.05
      }),
      setting("heightScale", "Height Scale", "float", 1, {
        min: 0,
        max: 4,
        step: 0.05
      })
    ]
  },
  {
    nodeType: "effect.wind-gust",
    displayName: "Wind Gust",
    category: "effect",
    validTargetKinds: ["mesh-deform", "billboard-surface"],
    inputPorts: [inputPort("time", "Time", "float", { optional: true })],
    outputPorts: [outputPort("strength", "Strength", "float")],
    settings: [
      setting("gustStrength", "Gust Strength", "float", 0.25, { min: 0, max: 2, step: 0.05 }),
      setting("gustInterval", "Gust Interval", "float", 3, { min: 0.1, max: 20, step: 0.1 }),
      setting("gustDuration", "Gust Duration", "float", 0.8, { min: 0.1, max: 10, step: 0.1 })
    ]
  },
  {
    nodeType: "effect.height-falloff",
    displayName: "Height Falloff",
    category: "effect",
    validTargetKinds: ["mesh-deform", "mesh-surface"],
    inputPorts: [inputPort("position", "Position", "vec3", { optional: true })],
    outputPorts: [outputPort("mask", "Mask", "float")],
    settings: [
      setting("baseHeight", "Base Height", "float", 0, { min: -5, max: 5, step: 0.05 }),
      setting("topHeight", "Top Height", "float", 1, { min: -5, max: 10, step: 0.05 })
    ]
  },
  {
    nodeType: "effect.fresnel",
    displayName: "Fresnel Effect",
    category: "effect",
    validTargetKinds: ["mesh-surface", "billboard-surface"],
    inputPorts: [
      inputPort("normal", "Normal", "vec3", { optional: true }),
      inputPort("viewDirection", "View Direction", "vec3", { optional: true }),
      inputPort("color", "Color", "color", { optional: true, defaultValue: [1, 1, 1] as [number, number, number] })
    ],
    outputPorts: [outputPort("value", "Value", "vec3")],
    settings: [
      setting("power", "Power", "float", 2, { min: 0.1, max: 8, step: 0.1 }),
      setting("strength", "Strength", "float", 1, { min: 0, max: 4, step: 0.05 })
    ]
  },
  {
    nodeType: "output.vertex",
    displayName: "Vertex Output",
    category: "output",
    validTargetKinds: ["mesh-deform", "billboard-surface"],
    inputPorts: [inputPort("value", "Value", "vec3")],
    outputPorts: [],
    settings: []
  },
  {
    nodeType: "output.fragment",
    displayName: "Fragment Output",
    category: "output",
    validTargetKinds: ["mesh-surface", "billboard-surface"],
    inputPorts: [
      inputPort("color", "Color", "vec3"),
      inputPort("alpha", "Alpha", "float", { optional: true, defaultValue: 1 })
    ],
    outputPorts: [],
    settings: []
  },
  {
    nodeType: "output.emissive",
    displayName: "Emissive Output",
    category: "output",
    validTargetKinds: ["mesh-surface"],
    inputPorts: [inputPort("color", "Color", "vec3")],
    outputPorts: [],
    settings: []
  },
  {
    nodeType: "output.post-process",
    displayName: "Post Process Output",
    category: "output",
    validTargetKinds: ["post-process"],
    inputPorts: [inputPort("color", "Color", "vec4")],
    outputPorts: [],
    settings: []
  }
];

const SHADER_NODE_DEFINITIONS_BY_TYPE = new Map(
  SHADER_NODE_DEFINITIONS.map((definition) => [definition.nodeType, definition])
);

export function createShaderGraphDefinitionId(projectId: string): string {
  return `${projectId}:shader:${createScopedId("shader")}`;
}

function requiredOutputNodeTypeForTargetKind(
  targetKind: ShaderTargetKind
): "output.vertex" | "output.post-process" | "output.fragment" {
  return targetKind === "mesh-deform"
    ? "output.vertex"
    : targetKind === "post-process"
      ? "output.post-process"
      : "output.fragment";
}

export function createDefaultShaderGraphDocument(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
    targetKind?: ShaderTargetKind;
  } = {}
): ShaderGraphDocument {
  const targetKind = options.targetKind ?? "mesh-surface";
  return {
    shaderDefinitionId:
      options.shaderDefinitionId ?? createShaderGraphDefinitionId(projectId),
    definitionKind: "shader",
    displayName: options.displayName ?? "Shader Graph",
    targetKind,
    revision: 0,
    nodes: [
      {
        nodeId: "output",
        nodeType: requiredOutputNodeTypeForTargetKind(targetKind),
        position: { x: 640, y: 160 },
        settings: {}
      }
    ],
    edges: [],
    parameters: [],
    metadata: {}
  };
}

export function createDefaultFoliageWindShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  const shaderDefinitionId =
    options.shaderDefinitionId ?? `${projectId}:shader:foliage-wind`;

  return {
    shaderDefinitionId,
    definitionKind: "shader",
    displayName: options.displayName ?? "Foliage Wind",
    targetKind: "mesh-deform",
    revision: 1,
    nodes: [
      {
        nodeId: "time",
        nodeType: "input.time",
        position: { x: 48, y: 48 },
        settings: {}
      },
      {
        nodeId: "mask",
        nodeType: "input.vertex-wind-mask",
        position: { x: 48, y: 172 },
        settings: { channel: "r" }
      },
      {
        nodeId: "local-position",
        nodeType: "input.local-position",
        position: { x: 48, y: 296 },
        settings: {}
      },
      {
        nodeId: "wind",
        nodeType: "effect.wind-sway",
        position: { x: 520, y: 224 },
        settings: {
          strength: 0.3,
          frequency: 1.6,
          spatialScale: 0.35,
          heightScale: 1
        }
      },
      {
        nodeId: "strength-parameter",
        nodeType: "input.parameter",
        position: { x: 196, y: 96 },
        settings: { parameterId: "windStrength" }
      },
      {
        nodeId: "frequency-parameter",
        nodeType: "input.parameter",
        position: { x: 196, y: 188 },
        settings: { parameterId: "windFrequency" }
      },
      {
        nodeId: "direction-parameter",
        nodeType: "input.parameter",
        position: { x: 196, y: 280 },
        settings: { parameterId: "windDirection" }
      },
      {
        nodeId: "output",
        nodeType: "output.vertex",
        position: { x: 832, y: 224 },
        settings: {}
      }
    ],
    edges: [
      {
        edgeId: "edge-time-wind",
        sourceNodeId: "time",
        sourcePortId: "value",
        targetNodeId: "wind",
        targetPortId: "time"
      },
      {
        edgeId: "edge-mask-wind",
        sourceNodeId: "mask",
        sourcePortId: "value",
        targetNodeId: "wind",
        targetPortId: "mask"
      },
      {
        edgeId: "edge-strength-wind",
        sourceNodeId: "strength-parameter",
        sourcePortId: "value",
        targetNodeId: "wind",
        targetPortId: "strength"
      },
      {
        edgeId: "edge-frequency-wind",
        sourceNodeId: "frequency-parameter",
        sourcePortId: "value",
        targetNodeId: "wind",
        targetPortId: "frequency"
      },
      {
        edgeId: "edge-direction-wind",
        sourceNodeId: "direction-parameter",
        sourcePortId: "value",
        targetNodeId: "wind",
        targetPortId: "direction"
      },
      {
        edgeId: "edge-position-wind",
        sourceNodeId: "local-position",
        sourcePortId: "value",
        targetNodeId: "wind",
        targetPortId: "position"
      },
      {
        edgeId: "edge-wind-output",
        sourceNodeId: "wind",
        sourcePortId: "displacement",
        targetNodeId: "output",
        targetPortId: "value"
      }
    ],
    parameters: [
      { parameterId: "windStrength", displayName: "Wind Strength", dataType: "float", defaultValue: 0.3 },
      { parameterId: "windFrequency", displayName: "Wind Frequency", dataType: "float", defaultValue: 1.6 },
      { parameterId: "windDirection", displayName: "Wind Direction", dataType: "vec2", defaultValue: [1, 0] }
    ],
    metadata: {
      builtIn: true,
      builtInKey: "foliage-wind"
    }
  };
}

export function createDefaultFoliageTintShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  const shaderDefinitionId =
    options.shaderDefinitionId ?? `${projectId}:shader:foliage-tint`;

  return {
    shaderDefinitionId,
    definitionKind: "shader",
    displayName: options.displayName ?? "Foliage Tint",
    targetKind: "mesh-surface",
    revision: 1,
    nodes: [
      {
        nodeId: "tint",
        nodeType: "input.constant-color",
        position: { x: 64, y: 160 },
        settings: {
          color: [0.72, 0.92, 0.56]
        }
      },
      {
        nodeId: "output",
        nodeType: "output.fragment",
        position: { x: 384, y: 160 },
        settings: {}
      }
    ],
    edges: [
      {
        edgeId: "edge-tint-output",
        sourceNodeId: "tint",
        sourcePortId: "value",
        targetNodeId: "output",
        targetPortId: "color"
      }
    ],
    parameters: [],
    metadata: {
      builtIn: true,
      builtInKey: "foliage-tint"
    }
  };
}

export function listShaderNodeDefinitions(): ShaderNodeDefinition[] {
  return SHADER_NODE_DEFINITIONS.map((definition) => ({
    ...definition,
    inputPorts: [...definition.inputPorts],
    outputPorts: [...definition.outputPorts],
    settings: [...definition.settings]
  }));
}

export function getShaderNodeDefinition(
  nodeType: string
): ShaderNodeDefinition | null {
  const definition = SHADER_NODE_DEFINITIONS_BY_TYPE.get(nodeType) ?? null;
  if (!definition) {
    return null;
  }

  return {
    ...definition,
    inputPorts: [...definition.inputPorts],
    outputPorts: [...definition.outputPorts],
    settings: [...definition.settings]
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isVector(value: unknown, size: number): value is number[] {
  return Array.isArray(value) && value.length === size && value.every(isFiniteNumber);
}

function isParameterValueCompatible(
  value: unknown,
  dataType: ShaderDataType | ShaderSettingDataType
): boolean {
  switch (dataType) {
    case "float":
    case "int":
      return isFiniteNumber(value);
    case "bool":
      return typeof value === "boolean";
    case "string":
    case "enum":
      return typeof value === "string";
    case "vec2":
      return isVector(value, 2);
    case "vec3":
    case "color":
      return isVector(value, 3);
    case "vec4":
      return isVector(value, 4);
    case "texture2d":
      return typeof value === "string";
    default:
      return false;
  }
}

function validateSettingValue(
  value: unknown,
  definition: ShaderSettingDefinition
): string | null {
  if (!isParameterValueCompatible(value, definition.dataType)) {
    return `Setting "${definition.settingId}" must be ${definition.dataType}.`;
  }

  if (typeof value === "number") {
    if (definition.constraints?.min !== undefined && value < definition.constraints.min) {
      return `Setting "${definition.settingId}" must be >= ${definition.constraints.min}.`;
    }
    if (definition.constraints?.max !== undefined && value > definition.constraints.max) {
      return `Setting "${definition.settingId}" must be <= ${definition.constraints.max}.`;
    }
  }

  if (
    definition.dataType === "enum" &&
    definition.constraints?.enumValues &&
    !definition.constraints.enumValues.includes(value as string)
  ) {
    return `Setting "${definition.settingId}" must be one of ${definition.constraints.enumValues.join(", ")}.`;
  }

  return null;
}

export function validateShaderGraphDocument(
  document: ShaderGraphDocument
): ShaderGraphValidationIssue[] {
  const issues: ShaderGraphValidationIssue[] = [];
  const nodeMap = new Map(document.nodes.map((node) => [node.nodeId, node]));
  const parameterMap = new Map(document.parameters.map((parameter) => [parameter.parameterId, parameter]));

  for (const parameter of document.parameters) {
    if (!isParameterValueCompatible(parameter.defaultValue, parameter.dataType)) {
      issues.push({
        severity: "error",
        parameterId: parameter.parameterId,
        message: `Parameter "${parameter.displayName}" has an invalid default value for ${parameter.dataType}.`
      });
    }
  }

  for (const node of document.nodes) {
    const definition = SHADER_NODE_DEFINITIONS_BY_TYPE.get(node.nodeType);
    if (!definition) {
      issues.push({
        severity: "error",
        nodeId: node.nodeId,
        message: `Unknown shader node type "${node.nodeType}".`
      });
      continue;
    }

    if (!definition.validTargetKinds.includes(document.targetKind)) {
      issues.push({
        severity: "error",
        nodeId: node.nodeId,
        message: `Node "${definition.displayName}" is not valid for ${document.targetKind} graphs.`
      });
    }

    const allowedSettingIds = new Set(definition.settings.map((settingDef) => settingDef.settingId));
    for (const settingId of Object.keys(node.settings)) {
      if (!allowedSettingIds.has(settingId)) {
        issues.push({
          severity: "error",
          nodeId: node.nodeId,
          message: `Node "${definition.displayName}" does not define a "${settingId}" setting.`
        });
      }
    }

    for (const settingDefinition of definition.settings) {
      const value =
        node.settings[settingDefinition.settingId] ?? settingDefinition.defaultValue;
      const error = validateSettingValue(value, settingDefinition);
      if (error) {
        issues.push({
          severity: "error",
          nodeId: node.nodeId,
          message: error
        });
      }
    }

    if (node.nodeType === "input.parameter") {
      const parameterId = typeof node.settings.parameterId === "string"
        ? node.settings.parameterId.trim()
        : "";
      if (!parameterId || !parameterMap.has(parameterId)) {
        issues.push({
          severity: "error",
          nodeId: node.nodeId,
          message: "Parameter input nodes must reference an existing shader parameter."
        });
      }
    }
  }

  for (const edge of document.edges) {
    const source = nodeMap.get(edge.sourceNodeId) ?? null;
    const target = nodeMap.get(edge.targetNodeId) ?? null;
    if (!source || !target) {
      issues.push({
        severity: "error",
        edgeId: edge.edgeId,
        message: "Edge references a missing source or target node."
      });
      continue;
    }

    const sourceDefinition = SHADER_NODE_DEFINITIONS_BY_TYPE.get(source.nodeType) ?? null;
    const targetDefinition = SHADER_NODE_DEFINITIONS_BY_TYPE.get(target.nodeType) ?? null;
    const sourcePort = sourceDefinition?.outputPorts.find((port) => port.portId === edge.sourcePortId) ?? null;
    const targetPort = targetDefinition?.inputPorts.find((port) => port.portId === edge.targetPortId) ?? null;
    if (!sourcePort || !targetPort) {
      issues.push({
        severity: "error",
        edgeId: edge.edgeId,
        message: "Edge references a missing source or target port."
      });
      continue;
    }

    if (sourcePort.dataType !== targetPort.dataType) {
      const isDirectAlias =
        (sourcePort.dataType === "vec3" && targetPort.dataType === "color") ||
        (sourcePort.dataType === "color" && targetPort.dataType === "vec3");
      const isFloatSplat =
        sourcePort.dataType === "float" &&
        (targetPort.dataType === "vec2" ||
          targetPort.dataType === "vec3" ||
          targetPort.dataType === "vec4" ||
          targetPort.dataType === "color");

      if (!isDirectAlias && !isFloatSplat) {
        issues.push({
          severity: "error",
          edgeId: edge.edgeId,
          message: `Port type mismatch: ${sourcePort.dataType} cannot connect to ${targetPort.dataType}.`
        });
      }
    }
  }

  const outputNodeType = requiredOutputNodeTypeForTargetKind(document.targetKind);
  if (!document.nodes.some((node) => node.nodeType === outputNodeType)) {
    issues.push({
      severity: "error",
      message: `Graph is missing a required ${outputNodeType} node.`
    });
  }

  return issues;
}
