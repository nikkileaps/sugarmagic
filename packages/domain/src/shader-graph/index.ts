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

export type ShaderSlotKind = "surface" | "deform";

export const SHADER_SLOT_KINDS: readonly ShaderSlotKind[] = [
  "surface",
  "deform"
] as const;

export type ShaderSlotBindingMap = Record<ShaderSlotKind, string | null>;

export function createEmptyShaderSlotBindingMap(): ShaderSlotBindingMap {
  return {
    surface: null,
    deform: null
  };
}

export interface ShaderParameterOverride {
  parameterId: string;
  slot?: ShaderSlotKind;
  value: ShaderParameterValue;
}

export interface ShaderBindingOverride {
  shaderDefinitionId: string;
  slot: ShaderSlotKind;
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
  colorSpace?: "sdr" | "hdr";
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
    // Post-process is supported: the ShaderRuntime finalizer reconstructs
    // fragment world position from screen UV + scene-depth + inverse
    // projection, so depth-based post-effects (height fog, volumetrics)
    // can read an author-friendly world position without each graph
    // redoing the reconstruction math.
    validTargetKinds: ["mesh-surface", "mesh-deform", "billboard-surface", "post-process"],
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
    nodeType: "input.sun-direction",
    displayName: "Sun Direction",
    category: "input",
    validTargetKinds: ["mesh-surface", "mesh-deform"],
    inputPorts: [],
    outputPorts: [outputPort("value", "Value", "vec3")],
    settings: []
  },
  {
    nodeType: "input.material-texture",
    displayName: "Material Texture",
    category: "input",
    validTargetKinds: ["mesh-surface", "billboard-surface"],
    inputPorts: [],
    outputPorts: [
      outputPort("color", "Color", "color"),
      outputPort("alpha", "Alpha", "float")
    ],
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
    outputPorts: [outputPort("value", "Value", "vec3")],
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
    nodeType: "input.constant-float",
    displayName: "Constant Float",
    category: "input",
    validTargetKinds: ["mesh-surface", "mesh-deform", "post-process", "billboard-surface"],
    inputPorts: [],
    outputPorts: [outputPort("value", "Value", "float")],
    settings: [setting("value", "Value", "float", 0)]
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
    nodeType: "math.pow",
    displayName: "Power",
    category: "math",
    validTargetKinds: ["mesh-surface", "mesh-deform", "post-process", "billboard-surface"],
    inputPorts: [
      inputPort("a", "Base", "float"),
      inputPort("b", "Exponent", "float")
    ],
    outputPorts: [outputPort("value", "Value", "float")],
    settings: []
  },
  {
    nodeType: "math.exp",
    displayName: "Exp",
    category: "math",
    validTargetKinds: ["mesh-surface", "mesh-deform", "post-process", "billboard-surface"],
    inputPorts: [inputPort("input", "Input", "float")],
    outputPorts: [outputPort("value", "Value", "float")],
    settings: []
  },
  {
    nodeType: "math.min",
    displayName: "Min",
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
    nodeType: "math.max",
    displayName: "Max",
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
    nodeType: "math.saturate",
    displayName: "Saturate",
    category: "math",
    validTargetKinds: ["mesh-surface", "mesh-deform", "post-process", "billboard-surface"],
    inputPorts: [inputPort("input", "Input", "float")],
    outputPorts: [outputPort("value", "Value", "float")],
    settings: []
  },
  {
    nodeType: "math.smoothstep",
    displayName: "Smoothstep",
    category: "math",
    validTargetKinds: ["mesh-surface", "mesh-deform", "post-process", "billboard-surface"],
    inputPorts: [
      inputPort("edge0", "Edge 0", "float"),
      inputPort("edge1", "Edge 1", "float"),
      inputPort("x", "Value", "float")
    ],
    outputPorts: [outputPort("value", "Value", "float")],
    settings: []
  },
  {
    nodeType: "math.distance",
    displayName: "Distance",
    category: "math",
    validTargetKinds: ["mesh-surface", "mesh-deform", "post-process", "billboard-surface"],
    inputPorts: [
      inputPort("a", "A", "vec2"),
      inputPort("b", "B", "vec2")
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
    nodeType: "color.luminance",
    displayName: "Luminance",
    category: "color",
    validTargetKinds: ["mesh-surface", "mesh-deform", "post-process", "billboard-surface"],
    inputPorts: [inputPort("input", "Input", "color")],
    outputPorts: [outputPort("value", "Value", "float")],
    settings: []
  },
  {
    nodeType: "color.add",
    displayName: "Color Add",
    category: "color",
    validTargetKinds: ["mesh-surface", "mesh-deform", "post-process", "billboard-surface"],
    inputPorts: [
      inputPort("a", "A", "color"),
      inputPort("b", "B", "color")
    ],
    outputPorts: [outputPort("value", "Value", "color")],
    settings: []
  },
  {
    nodeType: "color.multiply",
    displayName: "Color Multiply",
    category: "color",
    validTargetKinds: ["mesh-surface", "mesh-deform", "post-process", "billboard-surface"],
    inputPorts: [
      inputPort("a", "A", "color"),
      inputPort("b", "B", "color")
    ],
    outputPorts: [outputPort("value", "Value", "color")],
    settings: []
  },
  {
    nodeType: "color.divide",
    displayName: "Color Divide",
    category: "color",
    validTargetKinds: ["mesh-surface", "mesh-deform", "post-process", "billboard-surface"],
    inputPorts: [
      inputPort("a", "A", "color"),
      inputPort("b", "B", "color")
    ],
    outputPorts: [outputPort("value", "Value", "color")],
    settings: []
  },
  {
    nodeType: "color.pow",
    displayName: "Color Power",
    category: "color",
    validTargetKinds: ["mesh-surface", "mesh-deform", "post-process", "billboard-surface"],
    inputPorts: [
      inputPort("a", "Base", "color"),
      inputPort("b", "Exponent", "color")
    ],
    outputPorts: [outputPort("value", "Value", "color")],
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
    nodeType: "effect.bloom-pass",
    displayName: "Bloom Pass",
    category: "effect",
    validTargetKinds: ["post-process"],
    inputPorts: [
      inputPort("input", "Input", "vec3"),
      inputPort("strength", "Strength", "float", { optional: true }),
      inputPort("radius", "Radius", "float", { optional: true }),
      inputPort("threshold", "Threshold", "float", { optional: true })
    ],
    outputPorts: [outputPort("value", "Value", "vec3")],
    settings: [
      setting("strength", "Strength", "float", 0.4, { min: 0, max: 4, step: 0.05 }),
      setting("radius", "Radius", "float", 0.4, { min: 0, max: 1, step: 0.01 }),
      setting("threshold", "Threshold", "float", 0.9, { min: 0, max: 4, step: 0.01 })
    ]
  },
  {
    nodeType: "effect.tonemap-aces",
    displayName: "Tonemap ACES",
    category: "effect",
    validTargetKinds: ["post-process"],
    inputPorts: [
      inputPort("input", "Input", "vec3"),
      inputPort("exposure", "Exposure", "float", { optional: true })
    ],
    outputPorts: [outputPort("value", "Value", "vec3")],
    settings: [setting("exposure", "Exposure", "float", 1, { min: 0, max: 8, step: 0.05 })]
  },
  {
    nodeType: "effect.tonemap-reinhard",
    displayName: "Tonemap Reinhard",
    category: "effect",
    validTargetKinds: ["post-process"],
    inputPorts: [
      inputPort("input", "Input", "vec3"),
      inputPort("exposure", "Exposure", "float", { optional: true })
    ],
    outputPorts: [outputPort("value", "Value", "vec3")],
    settings: [setting("exposure", "Exposure", "float", 1, { min: 0, max: 8, step: 0.05 })]
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
    inputPorts: [inputPort("color", "Color", "vec3")],
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

export function createDefaultFoliageSurfaceShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  const shaderDefinitionId =
    options.shaderDefinitionId ?? `${projectId}:shader:foliage-surface`;

  return {
    shaderDefinitionId,
    definitionKind: "shader",
    displayName: options.displayName ?? "Foliage Surface",
    targetKind: "mesh-surface",
    revision: 1,
    nodes: [
      { nodeId: "leaf-texture", nodeType: "input.material-texture", position: { x: 48, y: 156 }, settings: {} },
      { nodeId: "vertex-color", nodeType: "input.vertex-color", position: { x: 48, y: 340 }, settings: {} },
      { nodeId: "split-vertex-color", nodeType: "math.split-vector", position: { x: 248, y: 340 }, settings: {} },
      { nodeId: "canopy-tint", nodeType: "math.combine-vector", position: { x: 448, y: 232 }, settings: {} },
      { nodeId: "base-color", nodeType: "color.multiply", position: { x: 656, y: 160 }, settings: {} },
      { nodeId: "world-normal", nodeType: "input.world-normal", position: { x: 48, y: 556 }, settings: {} },
      { nodeId: "sun-direction", nodeType: "input.sun-direction", position: { x: 48, y: 652 }, settings: {} },
      { nodeId: "sun-dot", nodeType: "math.dot", position: { x: 256, y: 604 }, settings: {} },
      { nodeId: "sun-mask", nodeType: "math.saturate", position: { x: 448, y: 604 }, settings: {} },
      { nodeId: "warm-color", nodeType: "input.parameter", position: { x: 656, y: 460 }, settings: { parameterId: "warmColor" } },
      { nodeId: "warm-strength", nodeType: "input.parameter", position: { x: 656, y: 556 }, settings: { parameterId: "warmStrength" } },
      { nodeId: "exterior-bias-strength", nodeType: "math.multiply", position: { x: 656, y: 652 }, settings: {} },
      { nodeId: "warm-mask", nodeType: "math.multiply", position: { x: 864, y: 652 }, settings: {} },
      { nodeId: "warm-term", nodeType: "color.multiply", position: { x: 1088, y: 540 }, settings: {} },
      { nodeId: "view-direction", nodeType: "input.view-direction", position: { x: 656, y: 780 }, settings: {} },
      { nodeId: "rim-color", nodeType: "input.parameter", position: { x: 656, y: 876 }, settings: { parameterId: "rimColor" } },
      { nodeId: "rim-strength", nodeType: "input.parameter", position: { x: 1088, y: 876 }, settings: { parameterId: "rimStrength" } },
      {
        nodeId: "rim-fresnel",
        nodeType: "effect.fresnel",
        position: { x: 880, y: 780 },
        settings: { power: 2.4, strength: 1.2 }
      },
      { nodeId: "rim-term", nodeType: "color.multiply", position: { x: 1296, y: 780 }, settings: {} },
      { nodeId: "base-plus-warm", nodeType: "color.add", position: { x: 1296, y: 268 }, settings: {} },
      { nodeId: "final-color", nodeType: "color.add", position: { x: 1504, y: 420 }, settings: {} },
      { nodeId: "output", nodeType: "output.fragment", position: { x: 1728, y: 420 }, settings: {} }
    ],
    edges: [
      createShaderEdge("edge-vertex-split", "vertex-color", "value", "split-vertex-color", "input"),
      createShaderEdge("edge-split-x-tint", "split-vertex-color", "x", "canopy-tint", "x"),
      createShaderEdge("edge-split-y-tint", "split-vertex-color", "y", "canopy-tint", "y"),
      createShaderEdge("edge-split-z-tint", "split-vertex-color", "z", "canopy-tint", "z"),
      createShaderEdge("edge-texture-base", "leaf-texture", "color", "base-color", "a"),
      createShaderEdge("edge-tint-base", "canopy-tint", "vec3", "base-color", "b"),
      createShaderEdge("edge-normal-sundot", "world-normal", "value", "sun-dot", "a"),
      createShaderEdge("edge-sun-sundot", "sun-direction", "value", "sun-dot", "b"),
      createShaderEdge("edge-sundot-mask", "sun-dot", "value", "sun-mask", "input"),
      createShaderEdge("edge-vertex-a-bias", "split-vertex-color", "w", "exterior-bias-strength", "a"),
      createShaderEdge("edge-strength-bias", "warm-strength", "value", "exterior-bias-strength", "b"),
      createShaderEdge("edge-bias-mask", "exterior-bias-strength", "value", "warm-mask", "a"),
      createShaderEdge("edge-sunmask-warmmask", "sun-mask", "value", "warm-mask", "b"),
      createShaderEdge("edge-warmcolor-warmterm", "warm-color", "value", "warm-term", "a"),
      createShaderEdge("edge-warmmask-warmterm", "warm-mask", "value", "warm-term", "b"),
      createShaderEdge("edge-normal-rim", "world-normal", "value", "rim-fresnel", "normal"),
      createShaderEdge("edge-view-rim", "view-direction", "value", "rim-fresnel", "viewDirection"),
      createShaderEdge("edge-rimcolor-rim", "rim-color", "value", "rim-fresnel", "color"),
      createShaderEdge("edge-rimfresnel-rimterm", "rim-fresnel", "value", "rim-term", "a"),
      createShaderEdge("edge-rimstrength-rimterm", "rim-strength", "value", "rim-term", "b"),
      createShaderEdge("edge-base-basepluswarm", "base-color", "value", "base-plus-warm", "a"),
      createShaderEdge("edge-warm-basepluswarm", "warm-term", "value", "base-plus-warm", "b"),
      createShaderEdge("edge-basepluswarm-final", "base-plus-warm", "value", "final-color", "a"),
      createShaderEdge("edge-rimterm-final", "rim-term", "value", "final-color", "b"),
      createShaderEdge("edge-final-output", "final-color", "value", "output", "color"),
      createShaderEdge("edge-alpha-output", "leaf-texture", "alpha", "output", "alpha")
    ],
    parameters: [
      {
        parameterId: "warmColor",
        displayName: "Warm Sun Color",
        dataType: "color",
        colorSpace: "hdr",
        defaultValue: [1.35, 1.08, 0.68]
      },
      {
        parameterId: "warmStrength",
        displayName: "Warm Sun Strength",
        dataType: "float",
        defaultValue: 0.55
      },
      {
        parameterId: "rimColor",
        displayName: "Rim Color",
        dataType: "color",
        colorSpace: "hdr",
        defaultValue: [0.82, 0.95, 0.78]
      },
      {
        parameterId: "rimStrength",
        displayName: "Rim Strength",
        dataType: "float",
        defaultValue: 0.24
      }
    ],
    metadata: {
      builtIn: true,
      builtInKey: "foliage-surface"
    }
  };
}

function createFloatConstantNode(
  nodeId: string,
  value: number,
  position: { x: number; y: number }
): ShaderNodeInstance {
  return {
    nodeId,
    nodeType: "input.constant-float",
    position,
    settings: { value }
  };
}

function createColorConstantNode(
  nodeId: string,
  value: [number, number, number],
  position: { x: number; y: number }
): ShaderNodeInstance {
  return {
    nodeId,
    nodeType: "input.constant-color",
    position,
    settings: { color: value }
  };
}

function createParameterNode(
  nodeId: string,
  parameterId: string,
  position: { x: number; y: number }
): ShaderNodeInstance {
  return {
    nodeId,
    nodeType: "input.parameter",
    position,
    settings: { parameterId }
  };
}

function createShaderEdge(
  edgeId: string,
  sourceNodeId: string,
  sourcePortId: string,
  targetNodeId: string,
  targetPortId: string
): ShaderEdge {
  return {
    edgeId,
    sourceNodeId,
    sourcePortId,
    targetNodeId,
    targetPortId
  };
}

export function createDefaultColorGradePostProcessShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  const shaderDefinitionId =
    options.shaderDefinitionId ?? `${projectId}:shader:color-grade`;

  return {
    shaderDefinitionId,
    definitionKind: "shader",
    displayName: options.displayName ?? "Color Grade",
    targetKind: "post-process",
    revision: 1,
    nodes: [
      { nodeId: "scene-color", nodeType: "input.scene-color", position: { x: 48, y: 176 }, settings: {} },
      createParameterNode("lift", "lift", { x: 48, y: 48 }),
      createParameterNode("gamma", "gamma", { x: 48, y: 304 }),
      createParameterNode("gain", "gain", { x: 48, y: 432 }),
      createParameterNode("saturation", "saturation", { x: 448, y: 432 }),
      createParameterNode("contrast", "contrast", { x: 912, y: 432 }),
      createColorConstantNode("mid-grey", [0.5, 0.5, 0.5], { x: 912, y: 560 }),
      createColorConstantNode("white", [1, 1, 1], { x: 448, y: 304 }),
      { nodeId: "apply-gain", nodeType: "color.multiply", position: { x: 272, y: 176 }, settings: {} },
      { nodeId: "apply-lift", nodeType: "color.add", position: { x: 448, y: 176 }, settings: {} },
      { nodeId: "invert-gamma", nodeType: "color.divide", position: { x: 640, y: 304 }, settings: {} },
      { nodeId: "apply-gamma", nodeType: "color.pow", position: { x: 816, y: 176 }, settings: {} },
      { nodeId: "luminance", nodeType: "color.luminance", position: { x: 1088, y: 48 }, settings: {} },
      { nodeId: "grey-color", nodeType: "math.combine-vector", position: { x: 1280, y: 48 }, settings: {} },
      { nodeId: "apply-saturation", nodeType: "math.lerp", position: { x: 1472, y: 176 }, settings: {} },
      { nodeId: "apply-contrast", nodeType: "math.lerp", position: { x: 1664, y: 176 }, settings: {} },
      { nodeId: "output", nodeType: "output.post-process", position: { x: 1872, y: 176 }, settings: {} }
    ],
    edges: [
      createShaderEdge("edge-scene-gain", "scene-color", "value", "apply-gain", "a"),
      createShaderEdge("edge-gain-gain", "gain", "value", "apply-gain", "b"),
      createShaderEdge("edge-gain-lift", "apply-gain", "value", "apply-lift", "a"),
      createShaderEdge("edge-lift-lift", "lift", "value", "apply-lift", "b"),
      createShaderEdge("edge-one-invert-gamma", "white", "value", "invert-gamma", "a"),
      createShaderEdge("edge-gamma-invert-gamma", "gamma", "value", "invert-gamma", "b"),
      createShaderEdge("edge-lifted-gamma", "apply-lift", "value", "apply-gamma", "a"),
      createShaderEdge("edge-inverted-gamma", "invert-gamma", "value", "apply-gamma", "b"),
      createShaderEdge("edge-gamma-luminance", "apply-gamma", "value", "luminance", "input"),
      createShaderEdge("edge-lum-grey-x", "luminance", "value", "grey-color", "x"),
      createShaderEdge("edge-lum-grey-y", "luminance", "value", "grey-color", "y"),
      createShaderEdge("edge-lum-grey-z", "luminance", "value", "grey-color", "z"),
      createShaderEdge("edge-grey-sat-a", "grey-color", "vec3", "apply-saturation", "a"),
      createShaderEdge("edge-gamma-sat-b", "apply-gamma", "value", "apply-saturation", "b"),
      createShaderEdge("edge-saturation-sat-alpha", "saturation", "value", "apply-saturation", "alpha"),
      createShaderEdge("edge-mid-grey-contrast-a", "mid-grey", "value", "apply-contrast", "a"),
      createShaderEdge("edge-sat-contrast-b", "apply-saturation", "value", "apply-contrast", "b"),
      createShaderEdge("edge-contrast-contrast-alpha", "contrast", "value", "apply-contrast", "alpha"),
      createShaderEdge("edge-contrast-output", "apply-contrast", "value", "output", "color")
    ],
    parameters: [
      { parameterId: "lift", displayName: "Lift", dataType: "color", defaultValue: [0, 0, 0] },
      { parameterId: "gamma", displayName: "Gamma", dataType: "color", defaultValue: [1, 1, 1] },
      { parameterId: "gain", displayName: "Gain", dataType: "color", defaultValue: [1, 1, 1] },
      { parameterId: "saturation", displayName: "Saturation", dataType: "float", defaultValue: 1 },
      { parameterId: "contrast", displayName: "Contrast", dataType: "float", defaultValue: 1 }
    ],
    metadata: {
      builtIn: true,
      builtInKey: "color-grade"
    }
  };
}

export function createDefaultTonemapAcesPostProcessShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  const shaderDefinitionId =
    options.shaderDefinitionId ?? `${projectId}:shader:tonemap-aces`;

  return {
    shaderDefinitionId,
    definitionKind: "shader",
    displayName: options.displayName ?? "Tonemap ACES",
    targetKind: "post-process",
    revision: 1,
    nodes: [
      { nodeId: "scene-color", nodeType: "input.scene-color", position: { x: 48, y: 128 }, settings: {} },
      createParameterNode("exposure", "exposure", { x: 48, y: 288 }),
      { nodeId: "expose", nodeType: "color.multiply", position: { x: 288, y: 128 }, settings: {} },
      { nodeId: "tonemap", nodeType: "effect.tonemap-aces", position: { x: 528, y: 128 }, settings: {} },
      { nodeId: "output", nodeType: "output.post-process", position: { x: 768, y: 128 }, settings: {} }
    ],
    edges: [
      createShaderEdge("edge-scene-expose", "scene-color", "value", "expose", "a"),
      createShaderEdge("edge-exposure-expose", "exposure", "value", "expose", "b"),
      createShaderEdge("edge-expose-tonemap", "expose", "value", "tonemap", "input"),
      createShaderEdge("edge-exposure-tonemap", "exposure", "value", "tonemap", "exposure"),
      createShaderEdge("edge-tonemap-output", "tonemap", "value", "output", "color")
    ],
    parameters: [{ parameterId: "exposure", displayName: "Exposure", dataType: "float", defaultValue: 1 }],
    metadata: {
      builtIn: true,
      builtInKey: "tonemap-aces"
    }
  };
}

export function createDefaultTonemapReinhardPostProcessShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  const shaderDefinitionId =
    options.shaderDefinitionId ?? `${projectId}:shader:tonemap-reinhard`;

  return {
    shaderDefinitionId,
    definitionKind: "shader",
    displayName: options.displayName ?? "Tonemap Reinhard",
    targetKind: "post-process",
    revision: 1,
    nodes: [
      { nodeId: "scene-color", nodeType: "input.scene-color", position: { x: 48, y: 128 }, settings: {} },
      createParameterNode("exposure", "exposure", { x: 48, y: 288 }),
      { nodeId: "expose", nodeType: "color.multiply", position: { x: 288, y: 128 }, settings: {} },
      { nodeId: "tonemap", nodeType: "effect.tonemap-reinhard", position: { x: 528, y: 128 }, settings: {} },
      { nodeId: "output", nodeType: "output.post-process", position: { x: 768, y: 128 }, settings: {} }
    ],
    edges: [
      createShaderEdge("edge-scene-expose", "scene-color", "value", "expose", "a"),
      createShaderEdge("edge-exposure-expose", "exposure", "value", "expose", "b"),
      createShaderEdge("edge-expose-tonemap", "expose", "value", "tonemap", "input"),
      createShaderEdge("edge-exposure-tonemap", "exposure", "value", "tonemap", "exposure"),
      createShaderEdge("edge-tonemap-output", "tonemap", "value", "output", "color")
    ],
    parameters: [{ parameterId: "exposure", displayName: "Exposure", dataType: "float", defaultValue: 1 }],
    metadata: {
      builtIn: true,
      builtInKey: "tonemap-reinhard"
    }
  };
}

export function createDefaultVignettePostProcessShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  const shaderDefinitionId =
    options.shaderDefinitionId ?? `${projectId}:shader:vignette`;

  return {
    shaderDefinitionId,
    definitionKind: "shader",
    displayName: options.displayName ?? "Vignette",
    targetKind: "post-process",
    revision: 1,
    nodes: [
      { nodeId: "scene-color", nodeType: "input.scene-color", position: { x: 48, y: 176 }, settings: {} },
      { nodeId: "screen-uv", nodeType: "input.screen-uv", position: { x: 48, y: 48 }, settings: {} },
      createParameterNode("color", "color", { x: 912, y: 384 }),
      createParameterNode("intensity", "intensity", { x: 1216, y: 304 }),
      createParameterNode("softness", "softness", { x: 448, y: 304 }),
      createParameterNode("radius", "radius", { x: 448, y: 432 }),
      createFloatConstantNode("center-half", 0.5, { x: 48, y: 304 }),
      { nodeId: "center", nodeType: "math.combine-vector", position: { x: 240, y: 304 }, settings: {} },
      { nodeId: "distance", nodeType: "math.distance", position: { x: 448, y: 128 }, settings: {} },
      { nodeId: "radius-minus-softness", nodeType: "math.subtract", position: { x: 672, y: 304 }, settings: {} },
      { nodeId: "mask", nodeType: "math.smoothstep", position: { x: 912, y: 128 }, settings: {} },
      { nodeId: "intensity-mask", nodeType: "math.multiply", position: { x: 1216, y: 128 }, settings: {} },
      { nodeId: "mix", nodeType: "math.lerp", position: { x: 1456, y: 176 }, settings: {} },
      { nodeId: "output", nodeType: "output.post-process", position: { x: 1696, y: 176 }, settings: {} }
    ],
    edges: [
      createShaderEdge("edge-half-center-x", "center-half", "value", "center", "x"),
      createShaderEdge("edge-half-center-y", "center-half", "value", "center", "y"),
      createShaderEdge("edge-uv-distance-a", "screen-uv", "value", "distance", "a"),
      createShaderEdge("edge-center-distance-b", "center", "vec2", "distance", "b"),
      createShaderEdge("edge-radius-minus-softness-a", "radius", "value", "radius-minus-softness", "a"),
      createShaderEdge("edge-radius-minus-softness-b", "softness", "value", "radius-minus-softness", "b"),
      createShaderEdge("edge-radius-minus-softness-mask-edge0", "radius-minus-softness", "value", "mask", "edge0"),
      createShaderEdge("edge-radius-mask-edge1", "radius", "value", "mask", "edge1"),
      createShaderEdge("edge-distance-mask-x", "distance", "value", "mask", "x"),
      createShaderEdge("edge-mask-intensity-mask-a", "mask", "value", "intensity-mask", "a"),
      createShaderEdge("edge-intensity-intensity-mask-b", "intensity", "value", "intensity-mask", "b"),
      createShaderEdge("edge-scene-mix-a", "scene-color", "value", "mix", "a"),
      createShaderEdge("edge-color-mix-b", "color", "value", "mix", "b"),
      createShaderEdge("edge-mask-mix-alpha", "intensity-mask", "value", "mix", "alpha"),
      createShaderEdge("edge-mix-output", "mix", "value", "output", "color")
    ],
    parameters: [
      { parameterId: "color", displayName: "Color", dataType: "color", defaultValue: [0, 0, 0] },
      { parameterId: "intensity", displayName: "Intensity", dataType: "float", defaultValue: 0.35 },
      { parameterId: "softness", displayName: "Softness", dataType: "float", defaultValue: 0.18 },
      { parameterId: "radius", displayName: "Radius", dataType: "float", defaultValue: 0.78 }
    ],
    metadata: {
      builtIn: true,
      builtInKey: "vignette"
    }
  };
}

export function createDefaultFogTintPostProcessShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  const shaderDefinitionId =
    options.shaderDefinitionId ?? `${projectId}:shader:fog-tint`;

  return {
    shaderDefinitionId,
    definitionKind: "shader",
    displayName: options.displayName ?? "Fog Tint",
    targetKind: "post-process",
    // Bumped to 2: graph structure changed to support height-falloff fog
    // attenuation. Saved projects pinned to revision 1 will be upgraded by
    // mergeBuiltInShaderDefinitions, which now replaces older built-ins.
    revision: 2,
    // Graph shape:
    //   distance fog: mask_dist = 1 - exp(-sceneDepth * density)
    //   height atten: heightAtten = exp(-max(0, worldY) * heightFalloff)
    //   final mask:   mask = mask_dist * heightAtten
    //   output:       mix(sceneColor, fogColor, mask)
    // worldY = 0 is treated as fog base. Fragments above y=0 get attenuated
    // by heightFalloff; fragments at or below y=0 get the full distance fog.
    // heightFalloff of 0 disables height attenuation (heightAtten = 1, giving
    // uniform distance fog — the previous behavior).
    nodes: [
      { nodeId: "scene-color", nodeType: "input.scene-color", position: { x: 48, y: 176 }, settings: {} },
      { nodeId: "scene-depth", nodeType: "input.scene-depth", position: { x: 48, y: 48 }, settings: {} },
      { nodeId: "world-position", nodeType: "input.world-position", position: { x: 48, y: 560 }, settings: {} },
      createParameterNode("color", "color", { x: 912, y: 304 }),
      createParameterNode("density", "density", { x: 288, y: 304 }),
      createParameterNode("heightFalloff", "heightFalloff", { x: 288, y: 688 }),
      createFloatConstantNode("one", 1, { x: 912, y: 432 }),
      createFloatConstantNode("negative-one", -1, { x: 288, y: 432 }),
      createFloatConstantNode("zero", 0, { x: 288, y: 560 }),
      { nodeId: "depth-times-density", nodeType: "math.multiply", position: { x: 528, y: 48 }, settings: {} },
      { nodeId: "negate-depth", nodeType: "math.multiply", position: { x: 720, y: 48 }, settings: {} },
      { nodeId: "exp", nodeType: "math.exp", position: { x: 912, y: 176 }, settings: {} },
      { nodeId: "one-minus-exp", nodeType: "math.subtract", position: { x: 1120, y: 176 }, settings: {} },
      { nodeId: "world-y", nodeType: "math.split-vector", position: { x: 288, y: 560 }, settings: {} },
      { nodeId: "world-y-clamped", nodeType: "math.max", position: { x: 528, y: 560 }, settings: {} },
      { nodeId: "height-times-falloff", nodeType: "math.multiply", position: { x: 720, y: 560 }, settings: {} },
      { nodeId: "negate-height", nodeType: "math.multiply", position: { x: 912, y: 560 }, settings: {} },
      { nodeId: "height-atten", nodeType: "math.exp", position: { x: 1120, y: 560 }, settings: {} },
      { nodeId: "combined-mask", nodeType: "math.multiply", position: { x: 1320, y: 368 }, settings: {} },
      { nodeId: "mix", nodeType: "math.lerp", position: { x: 1560, y: 176 }, settings: {} },
      { nodeId: "output", nodeType: "output.post-process", position: { x: 1780, y: 176 }, settings: {} }
    ],
    edges: [
      // Distance fog chain
      createShaderEdge("edge-depth-density", "scene-depth", "value", "depth-times-density", "a"),
      createShaderEdge("edge-density-density", "density", "value", "depth-times-density", "b"),
      createShaderEdge("edge-depth-negate", "depth-times-density", "value", "negate-depth", "a"),
      createShaderEdge("edge-negative-one-negate", "negative-one", "value", "negate-depth", "b"),
      createShaderEdge("edge-negate-exp", "negate-depth", "value", "exp", "input"),
      createShaderEdge("edge-one-subtract", "one", "value", "one-minus-exp", "a"),
      createShaderEdge("edge-exp-subtract", "exp", "value", "one-minus-exp", "b"),
      // Height attenuation chain
      createShaderEdge("edge-worldpos-split", "world-position", "value", "world-y", "input"),
      // split-vector exposes x/y/z/w outputs — we read "y" for world altitude.
      createShaderEdge("edge-worldy-max-a", "world-y", "y", "world-y-clamped", "a"),
      createShaderEdge("edge-zero-max-b", "zero", "value", "world-y-clamped", "b"),
      createShaderEdge("edge-height-times-falloff-a", "world-y-clamped", "value", "height-times-falloff", "a"),
      createShaderEdge("edge-height-times-falloff-b", "heightFalloff", "value", "height-times-falloff", "b"),
      createShaderEdge("edge-negate-height-a", "height-times-falloff", "value", "negate-height", "a"),
      createShaderEdge("edge-negate-height-b", "negative-one", "value", "negate-height", "b"),
      createShaderEdge("edge-height-exp", "negate-height", "value", "height-atten", "input"),
      // Combine distance + height into final mask
      createShaderEdge("edge-combine-a", "one-minus-exp", "value", "combined-mask", "a"),
      createShaderEdge("edge-combine-b", "height-atten", "value", "combined-mask", "b"),
      // Mix scene with fog color by combined mask
      createShaderEdge("edge-scene-mix", "scene-color", "value", "mix", "a"),
      createShaderEdge("edge-color-mix", "color", "value", "mix", "b"),
      createShaderEdge("edge-mask-mix", "combined-mask", "value", "mix", "alpha"),
      createShaderEdge("edge-mix-output", "mix", "value", "output", "color")
    ],
    parameters: [
      { parameterId: "color", displayName: "Color", dataType: "color", defaultValue: [0.75, 0.82, 0.92] },
      { parameterId: "density", displayName: "Density", dataType: "float", defaultValue: 0.008 },
      // 0 = uniform distance fog at all altitudes. Positive values attenuate
      // fog exponentially with world Y above 0 (good for ground mist). A
      // value of 1 roughly halves fog every ~0.7 world units up.
      { parameterId: "heightFalloff", displayName: "Height Falloff", dataType: "float", defaultValue: 0 }
    ],
    metadata: {
      builtIn: true,
      builtInKey: "fog-tint"
    }
  };
}

export function createDefaultBloomPostProcessShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  const shaderDefinitionId =
    options.shaderDefinitionId ?? `${projectId}:shader:bloom`;

  return {
    shaderDefinitionId,
    definitionKind: "shader",
    displayName: options.displayName ?? "Bloom",
    targetKind: "post-process",
    revision: 1,
    nodes: [
      { nodeId: "scene-color", nodeType: "input.scene-color", position: { x: 48, y: 176 }, settings: {} },
      createParameterNode("strength", "strength", { x: 48, y: 48 }),
      createParameterNode("radius", "radius", { x: 48, y: 176 }),
      createParameterNode("threshold", "threshold", { x: 48, y: 304 }),
      { nodeId: "bloom", nodeType: "effect.bloom-pass", position: { x: 352, y: 176 }, settings: {} },
      { nodeId: "composite", nodeType: "color.add", position: { x: 640, y: 176 }, settings: {} },
      { nodeId: "output", nodeType: "output.post-process", position: { x: 912, y: 176 }, settings: {} }
    ],
    edges: [
      createShaderEdge("edge-scene-bloom", "scene-color", "value", "bloom", "input"),
      createShaderEdge("edge-strength-bloom", "strength", "value", "bloom", "strength"),
      createShaderEdge("edge-radius-bloom", "radius", "value", "bloom", "radius"),
      createShaderEdge("edge-threshold-bloom", "threshold", "value", "bloom", "threshold"),
      createShaderEdge("edge-scene-composite", "scene-color", "value", "composite", "a"),
      createShaderEdge("edge-bloom-composite", "bloom", "value", "composite", "b"),
      createShaderEdge("edge-composite-output", "composite", "value", "output", "color")
    ],
    parameters: [
      { parameterId: "strength", displayName: "Strength", dataType: "float", defaultValue: 0.4 },
      { parameterId: "radius", displayName: "Radius", dataType: "float", defaultValue: 0.4 },
      { parameterId: "threshold", displayName: "Threshold", dataType: "float", defaultValue: 0.9 }
    ],
    metadata: {
      builtIn: true,
      builtInKey: "bloom"
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

    const effectiveSourceDataType =
      source.nodeType === "input.parameter"
        ? parameterMap.get(String(source.settings.parameterId ?? "").trim())?.dataType ??
          sourcePort.dataType
        : sourcePort.dataType;

    if (effectiveSourceDataType !== targetPort.dataType) {
      const isDirectAlias =
        (effectiveSourceDataType === "vec3" && targetPort.dataType === "color") ||
        (effectiveSourceDataType === "color" && targetPort.dataType === "vec3");
      const isFloatSplat =
        effectiveSourceDataType === "float" &&
        (targetPort.dataType === "vec2" ||
          targetPort.dataType === "vec3" ||
          targetPort.dataType === "vec4" ||
          targetPort.dataType === "color");

      if (!isDirectAlias && !isFloatSplat) {
        issues.push({
          severity: "error",
          edgeId: edge.edgeId,
          message: `Port type mismatch: ${effectiveSourceDataType} cannot connect to ${targetPort.dataType}.`
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
