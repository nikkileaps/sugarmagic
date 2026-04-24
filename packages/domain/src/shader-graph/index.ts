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
  | "mesh-effect"
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
  | boolean
  | null;

export type ShaderSlotKind = "surface" | "deform" | "effect";

export const SHADER_SLOT_KINDS: readonly ShaderSlotKind[] = [
  "surface",
  "deform"
] as const;

export type ShaderSlotBindingMap = Record<ShaderSlotKind, string | null>;

export function createEmptyShaderSlotBindingMap(): ShaderSlotBindingMap {
  return {
    surface: null,
    deform: null,
    effect: null
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

/**
 * `inheritSource` lets a shader parameter opt into automatic binding from
 * surrounding authored context at resolve time. Currently the only supported
 * source is `"baseLayerColor"` — when a scatter layer's appearance shader
 * declares a parameter with this source, the scatter resolver injects the
 * color from the containing Surface's first `blendMode: "base"` appearance
 * layer (when that layer's content is `color`-kind). An explicit value in the
 * material/layer `parameterValues` always wins. This is what makes grass
 * visually "grow out of" the ground it's placed on without authoring churn.
 */
export type ShaderParameterInheritSource = "baseLayerColor";

export interface ShaderParameter {
  parameterId: string;
  displayName: string;
  dataType: Exclude<ShaderDataType, "texture2d"> | "texture2d";
  defaultValue: ShaderParameterValue;
  colorSpace?: "sdr" | "hdr";
  textureRole?: "color" | "normal" | "data";
  inheritSource?: ShaderParameterInheritSource;
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
    // Incoming light direction, pointing from the sun toward the scene.
    // This is the vector shader graphs should dot against normals when they
    // want the lit hemisphere to match the actual directional light rig.
    validTargetKinds: ["mesh-surface", "mesh-deform"],
    inputPorts: [],
    outputPorts: [outputPort("value", "Value", "vec3")],
    settings: []
  },
  {
    // Fake sphere normal baked into the FoilageMaker export's _SPHERE_NORMAL
    // vertex attribute (normalize(vertex - clusterCenter)). Replaces the
    // leaf-card normal for lighting purposes so each leaf cluster shades as
    // a smooth volumetric orb rather than a pile of flat cards. Trunk
    // vertices have (0,0,0) here and the foliage shader blends against
    // world-normal accordingly.
    nodeType: "input.sphere-normal",
    displayName: "Sphere Normal",
    category: "input",
    validTargetKinds: ["mesh-surface", "mesh-deform"],
    inputPorts: [],
    outputPorts: [outputPort("value", "Value", "vec3")],
    settings: []
  },
  {
    // Normalized 0..1 altitude within the tree (0 at trunk base, 1 at the
    // highest canopy vertex), baked into the _TREE_HEIGHT vertex attribute
    // by FoilageMaker. Drives the tree-wide top-warm / bottom-cool gradient.
    nodeType: "input.tree-height",
    displayName: "Tree Height",
    category: "input",
    validTargetKinds: ["mesh-surface", "mesh-deform"],
    inputPorts: [],
    outputPorts: [outputPort("value", "Value", "float")],
    settings: []
  },
  {
    nodeType: "input.material-texture",
    displayName: "Material Texture",
    category: "input",
    validTargetKinds: ["mesh-surface", "billboard-surface"],
    inputPorts: [inputPort("uv", "UV", "vec2", { optional: true })],
    outputPorts: [
      outputPort("color", "Color", "color"),
      outputPort("alpha", "Alpha", "float"),
      // Individual channels make ORM-style channel-packed textures
      // authorable inside a graph: `orm.g` → roughness, `orm.b` →
      // metallic, `orm.r` → AO. Without these the only way to pull a
      // single channel would be a swizzle/math node — adding the ports
      // here keeps standard-pbr's authoring surface tight.
      outputPort("r", "Red", "float"),
      outputPort("g", "Green", "float"),
      outputPort("b", "Blue", "float"),
      outputPort("a", "Alpha Channel", "float")
    ],
    settings: [setting("parameterId", "Parameter", "string", "")]
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
    nodeType: "input.accumulator.color",
    displayName: "Accumulator Color",
    category: "input",
    validTargetKinds: ["mesh-effect"],
    inputPorts: [],
    outputPorts: [outputPort("value", "Value", "color")],
    settings: []
  },
  {
    nodeType: "input.accumulator.normal",
    displayName: "Accumulator Normal",
    category: "input",
    validTargetKinds: ["mesh-effect"],
    inputPorts: [],
    outputPorts: [outputPort("value", "Value", "vec3")],
    settings: []
  },
  {
    nodeType: "input.accumulator.roughness",
    displayName: "Accumulator Roughness",
    category: "input",
    validTargetKinds: ["mesh-effect"],
    inputPorts: [],
    outputPorts: [outputPort("value", "Value", "float")],
    settings: []
  },
  {
    nodeType: "input.accumulator.metalness",
    displayName: "Accumulator Metalness",
    category: "input",
    validTargetKinds: ["mesh-effect"],
    inputPorts: [],
    outputPorts: [outputPort("value", "Value", "float")],
    settings: []
  },
  {
    nodeType: "input.accumulator.ao",
    displayName: "Accumulator AO",
    category: "input",
    validTargetKinds: ["mesh-effect"],
    inputPorts: [],
    outputPorts: [outputPort("value", "Value", "float")],
    settings: []
  },
  {
    nodeType: "input.accumulator.alpha",
    displayName: "Accumulator Alpha",
    category: "input",
    validTargetKinds: ["mesh-effect"],
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
    // Accept vec3 or vec4 inputs. Many built-ins (world position, world
    // normal, vertex color RGB-only sources) are naturally vec3 and should
    // not require a synthetic widen node just to expose x/y/z channels.
    inputPorts: [inputPort("input", "Input", "vec3")],
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
      setting("spatialScale", "Spatial Scale", "float", 3.5, {
        min: 0.01,
        max: 10,
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
    nodeType: "effect.world-noise",
    displayName: "World-Space Noise",
    category: "effect",
    validTargetKinds: ["mesh-surface", "billboard-surface", "mesh-deform"],
    inputPorts: [inputPort("position", "Position", "vec3", { optional: true })],
    outputPorts: [outputPort("value", "Value", "float")],
    settings: [
      // scale is a world-space frequency multiplier. Low values (0.05-0.5)
      // produce macro patches of many meters; high values (4-32) produce
      // fine-grain per-fragment-ish noise used for hashed-alpha dither in
      // the grass blade fade. The cap is widened to 32 because the
      // Perlin-like helper multiplies the input by 1/2/4 per octave — at
      // scale=32 the finest octave runs at ~128 cells per world unit,
      // which is roughly "one per centimeter" when viewed in-scene.
      setting("scale", "Scale", "float", 0.25, { min: 0.001, max: 32, step: 0.01 })
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
    nodeType: "output.deform",
    displayName: "Deform Output",
    category: "output",
    validTargetKinds: ["mesh-deform"],
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
      inputPort("color", "Color", "color"),
      inputPort("alpha", "Alpha", "float", { optional: true, defaultValue: 1 }),
      // The remaining PBR channels are optional. When unwired, the
      // runtime leaves the corresponding MeshStandardNodeMaterial node
      // alone — meaning the material's default scalar (roughness=1,
      // metalness=0, ao=1) and default tangent-space normal come
      // through. Authored graphs opt into each channel by wiring it.
      inputPort("normal", "Normal", "vec3", {
        optional: true,
        defaultValue: [0, 0, 1]
      }),
      inputPort("roughness", "Roughness", "float", {
        optional: true,
        defaultValue: 1
      }),
      inputPort("metalness", "Metalness", "float", {
        optional: true,
        defaultValue: 0
      }),
      inputPort("ao", "Ambient Occlusion", "float", {
        optional: true,
        defaultValue: 1
      })
    ],
    outputPorts: [],
    settings: []
  },
  {
    nodeType: "output.surface",
    displayName: "Surface Output",
    category: "output",
    validTargetKinds: ["mesh-surface"],
    inputPorts: [
      inputPort("color", "Color", "color"),
      inputPort("alpha", "Alpha", "float", { optional: true, defaultValue: 1 }),
      inputPort("normal", "Normal", "vec3", {
        optional: true,
        defaultValue: [0, 0, 1]
      }),
      inputPort("roughness", "Roughness", "float", {
        optional: true,
        defaultValue: 1
      }),
      inputPort("metalness", "Metalness", "float", {
        optional: true,
        defaultValue: 0
      }),
      inputPort("ao", "Ambient Occlusion", "float", {
        optional: true,
        defaultValue: 1
      })
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
    nodeType: "output.effect",
    displayName: "Effect Output",
    category: "output",
    validTargetKinds: ["mesh-effect"],
    inputPorts: [
      inputPort("color", "Color", "vec3"),
      inputPort("alpha", "Alpha", "float", { optional: true, defaultValue: 1 }),
      inputPort("normal", "Normal", "vec3", {
        optional: true,
        defaultValue: [0, 0, 1]
      }),
      inputPort("roughness", "Roughness", "float", {
        optional: true,
        defaultValue: 1
      }),
      inputPort("metalness", "Metalness", "float", {
        optional: true,
        defaultValue: 0
      }),
      inputPort("ao", "Ambient Occlusion", "float", {
        optional: true,
        defaultValue: 1
      })
    ],
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
): "output.deform" | "output.post-process" | "output.surface" | "output.effect" {
  return targetKind === "mesh-deform"
    ? "output.deform"
    : targetKind === "post-process"
      ? "output.post-process"
      : targetKind === "mesh-effect"
        ? "output.effect"
        : "output.surface";
}

function allowedOutputNodeTypesForTargetKind(
  targetKind: ShaderTargetKind
): string[] {
  if (targetKind === "mesh-deform") {
    return ["output.deform", "output.vertex"];
  }
  if (targetKind === "post-process") {
    return ["output.post-process"];
  }
  if (targetKind === "mesh-effect") {
    return ["output.effect"];
  }
  return ["output.surface", "output.fragment"];
}

function nodeSupportsTargetKind(
  definition: ShaderNodeDefinition,
  targetKind: ShaderTargetKind
): boolean {
  if (definition.validTargetKinds.includes(targetKind)) {
    return true;
  }
  if (targetKind === "mesh-effect") {
    return (
      definition.validTargetKinds.includes("mesh-surface") ||
      definition.validTargetKinds.includes("post-process")
    );
  }
  return false;
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
        // `_tree_height` baked by createProceduralGrassGeometry: 0 at the
        // blade root, 1 at the tip. Routed into wind-sway's mask port so
        // bases stay anchored and tips sway. This replaces the previous
        // `input.vertex-wind-mask` source, which reads from vertexColor
        // and evaluates to 0 in TSL's vertex stage — collapsing all sway
        // to zero. tree-height is a regular scalar attribute that flows
        // correctly through the vertex pipeline.
        nodeId: "mask",
        nodeType: "input.tree-height",
        position: { x: 48, y: 172 },
        settings: {}
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

/**
 * Minimal surface shader used to isolate alpha-cutout behavior. Samples the
 * material base color texture and routes color + alpha straight to the
 * fragment output. Apply this to simple_alpha_test.glb (tooling/simple-alpha-test/)
 * to distinguish shader-graph problems from GLB/Three loader problems.
 */
export function createSimpleAlphaTestShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  const shaderDefinitionId =
    options.shaderDefinitionId ?? `${projectId}:shader:simple-alpha-test`;

  return {
    shaderDefinitionId,
    definitionKind: "shader",
    displayName: options.displayName ?? "Simple Alpha Test",
    targetKind: "mesh-surface",
    revision: 1,
    nodes: [
      createMaterialTextureNode("base-texture", "baseColorTexture", { x: 48, y: 160 }),
      { nodeId: "output", nodeType: "output.fragment", position: { x: 384, y: 160 }, settings: {} }
    ],
    edges: [
      createShaderEdge("edge-color-output", "base-texture", "color", "output", "color"),
      createShaderEdge("edge-alpha-output", "base-texture", "alpha", "output", "alpha")
    ],
    parameters: [
      {
        parameterId: "baseColorTexture",
        displayName: "Base Color Texture",
        dataType: "texture2d",
        textureRole: "color",
        defaultValue: null
      }
    ],
    metadata: {
      builtIn: true,
      builtInKey: "simple-alpha-test"
    }
  };
}

export function createBuiltInFlatColorShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  const shaderDefinitionId =
    options.shaderDefinitionId ?? `${projectId}:shader:flat-color`;

  return {
    shaderDefinitionId,
    definitionKind: "shader",
    displayName: options.displayName ?? "Flat Color",
    targetKind: "mesh-surface",
    revision: 1,
    nodes: [
      createParameterNode("color", "color", { x: 48, y: 160 }),
      { nodeId: "output", nodeType: "output.surface", position: { x: 360, y: 160 }, settings: {} }
    ],
    edges: [createShaderEdge("edge-color-output", "color", "value", "output", "color")],
    parameters: [
      {
        parameterId: "color",
        displayName: "Color",
        dataType: "color",
        defaultValue: [0.5, 0.5, 0.5]
      }
    ],
    metadata: {
      builtIn: true,
      builtInKey: "flat-color"
    }
  };
}

export function createBuiltInFlatTextureShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  const shaderDefinitionId =
    options.shaderDefinitionId ?? `${projectId}:shader:flat-texture`;

  return {
    shaderDefinitionId,
    definitionKind: "shader",
    displayName: options.displayName ?? "Flat Texture",
    targetKind: "mesh-surface",
    revision: 1,
    nodes: [
      { nodeId: "uv", nodeType: "input.uv", position: { x: 48, y: 160 }, settings: {} },
      createParameterNode("tiling", "tiling", { x: 48, y: 304 }),
      { nodeId: "scale-uv", nodeType: "math.multiply", position: { x: 320, y: 224 }, settings: {} },
      createMaterialTextureNode("texture", "texture", { x: 608, y: 160 }),
      { nodeId: "output", nodeType: "output.surface", position: { x: 912, y: 160 }, settings: {} }
    ],
    edges: [
      createShaderEdge("edge-uv-scale", "uv", "value", "scale-uv", "a"),
      createShaderEdge("edge-tiling-scale", "tiling", "value", "scale-uv", "b"),
      createShaderEdge("edge-scale-texture-uv", "scale-uv", "value", "texture", "uv"),
      createShaderEdge("edge-texture-output", "texture", "color", "output", "color"),
      createShaderEdge("edge-texture-alpha-output", "texture", "alpha", "output", "alpha")
    ],
    parameters: [
      {
        parameterId: "texture",
        displayName: "Texture",
        dataType: "texture2d",
        defaultValue: null,
        textureRole: "color"
      },
      {
        parameterId: "tiling",
        displayName: "Tiling",
        dataType: "vec2",
        defaultValue: [1, 1]
      }
    ],
    metadata: {
      builtIn: true,
      builtInKey: "flat-texture"
    }
  };
}

export function createBuiltInCloudShadowEffectShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  const shaderDefinitionId =
    options.shaderDefinitionId ?? `${projectId}:shader:cloud-shadow-demo`;

  return {
    shaderDefinitionId,
    definitionKind: "shader",
    displayName: options.displayName ?? "Cloud Shadow Demo",
    targetKind: "mesh-effect",
    revision: 1,
    nodes: [
      { nodeId: "accum", nodeType: "input.accumulator.color", position: { x: 48, y: 160 }, settings: {} },
      createParameterNode("tint", "tint", { x: 48, y: 304 }),
      { nodeId: "multiply", nodeType: "color.multiply", position: { x: 352, y: 224 }, settings: {} },
      { nodeId: "output", nodeType: "output.effect", position: { x: 656, y: 160 }, settings: {} }
    ],
    edges: [
      createShaderEdge("edge-accum-multiply", "accum", "value", "multiply", "a"),
      createShaderEdge("edge-tint-multiply", "tint", "value", "multiply", "b"),
      createShaderEdge("edge-multiply-output", "multiply", "value", "output", "color")
    ],
    parameters: [
      {
        parameterId: "tint",
        displayName: "Tint",
        dataType: "color",
        defaultValue: [0.8, 0.8, 0.8]
      }
    ],
    metadata: {
      builtIn: true,
      builtInKey: "cloud-shadow-demo"
    }
  };
}

/**
 * Permanent authoring aid — keep.
 * Why it exists: gives artists and engineers a one-knob proof that shader
 * application and parameter propagation are still working in a live scene.
 * What replaces it: nothing today; this is the minimal canonical debug graph
 * for "is the shader bound and are parameters reaching the GPU?"
 * When to remove it: only once Sugarmagic has a richer built-in shader
 * debugger or material-inspector workflow that covers the same verification.
 *
 * Debug shader: outputs a single authored color (parameter "debugColor")
 * multiplied by texture alpha for cutout. Used to verify both
 * (a) that the shader is being applied at all, and
 * (b) that parameter edits reach the GPU — if changing debugColor in the
 *     inspector doesn't visibly change the object, parameter propagation
 *     is broken.
 */
export function createDebugParameterColorShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  const shaderDefinitionId =
    options.shaderDefinitionId ?? `${projectId}:shader:debug-parameter-color`;

  return {
    shaderDefinitionId,
    definitionKind: "shader",
    displayName: options.displayName ?? "Debug Parameter Color",
    targetKind: "mesh-surface",
    revision: 1,
    nodes: [
      createMaterialTextureNode("base-texture", "baseColorTexture", { x: 48, y: 160 }),
      {
        nodeId: "debug-color",
        nodeType: "input.parameter",
        position: { x: 48, y: 300 },
        settings: { parameterId: "debugColor" }
      },
      { nodeId: "output", nodeType: "output.fragment", position: { x: 384, y: 160 }, settings: {} }
    ],
    edges: [
      createShaderEdge("edge-debug-output", "debug-color", "value", "output", "color"),
      createShaderEdge("edge-alpha-output", "base-texture", "alpha", "output", "alpha")
    ],
    parameters: [
      {
        parameterId: "baseColorTexture",
        displayName: "Base Color Texture",
        dataType: "texture2d",
        textureRole: "color",
        defaultValue: null
      },
      {
        parameterId: "debugColor",
        displayName: "Debug Color",
        dataType: "color",
        colorSpace: "hdr",
        defaultValue: [1.0, 0.0, 1.0]
      }
    ],
    metadata: {
      builtIn: true,
      builtInKey: "debug-parameter-color"
    }
  };
}

/**
 * Permanent authoring aid — keep.
 * Why it exists: isolates the warm-term math from the rest of the foliage
 * graph so authors can tell whether failures come from the warm term itself
 * or from later masking/bias logic.
 * What replaces it: nothing today; this is the canonical narrow probe for the
 * warm-color × warm-strength path.
 * When to remove it: only once graph debugging can selectively preview
 * intermediate nodes/branches inside authored shaders.
 *
 * Debug shader to isolate whether warmColor + warmStrength multiplication
 * itself works, independent of sun-mask / exterior-bias. Emits
 * warmColor × warmStrength directly as fragment color. If cranking warmStrength
 * in the inspector makes the tree visibly brighter with this shader but the
 * Foliage Surface shader stays unchanged, the problem is downstream — the
 * sun-mask or exterior-bias-strength path is zeroing out warm-term.
 */
export function createDebugWarmIsolatedShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  const shaderDefinitionId =
    options.shaderDefinitionId ?? `${projectId}:shader:debug-warm-isolated`;

  return {
    shaderDefinitionId,
    definitionKind: "shader",
    displayName: options.displayName ?? "Debug Warm Isolated",
    targetKind: "mesh-surface",
    revision: 1,
    nodes: [
      createMaterialTextureNode("base-texture", "baseColorTexture", { x: 48, y: 160 }),
      {
        nodeId: "warm-color",
        nodeType: "input.parameter",
        position: { x: 48, y: 300 },
        settings: { parameterId: "warmColor" }
      },
      {
        nodeId: "warm-strength",
        nodeType: "input.parameter",
        position: { x: 48, y: 400 },
        settings: { parameterId: "warmStrength" }
      },
      { nodeId: "warm-term", nodeType: "color.multiply", position: { x: 280, y: 340 }, settings: {} },
      { nodeId: "output", nodeType: "output.fragment", position: { x: 520, y: 160 }, settings: {} }
    ],
    edges: [
      createShaderEdge("edge-warm-a", "warm-color", "value", "warm-term", "a"),
      createShaderEdge("edge-warm-b", "warm-strength", "value", "warm-term", "b"),
      createShaderEdge("edge-color-output", "warm-term", "value", "output", "color"),
      createShaderEdge("edge-alpha-output", "base-texture", "alpha", "output", "alpha")
    ],
    parameters: [
      {
        parameterId: "baseColorTexture",
        displayName: "Base Color Texture",
        dataType: "texture2d",
        textureRole: "color",
        defaultValue: null
      },
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
      }
    ],
    metadata: {
      builtIn: true,
      builtInKey: "debug-warm-isolated"
    }
  };
}

/**
 * Permanent authoring aid — keep.
 * Why it exists: verifies the exact sun-direction/normal mask the foliage
 * shaders depend on without the rest of the surface graph obscuring it.
 * What replaces it: nothing today; this is the canonical sun-mask probe.
 * When to remove it: only once authored shaders support built-in intermediate
 * visualization of directional-light terms.
 *
 * Debug shader: outputs sun-mask (saturate(worldNormal · sunDirection)) as
 * grayscale. If the tree renders black, sunDirection is zero or worldNormal
 * is wrong — which kills the warm term in the foliage shader.
 */
export function createDebugSunMaskShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  const shaderDefinitionId =
    options.shaderDefinitionId ?? `${projectId}:shader:debug-sun-mask`;

  return {
    shaderDefinitionId,
    definitionKind: "shader",
    displayName: options.displayName ?? "Debug Sun Mask",
    targetKind: "mesh-surface",
    revision: 1,
    nodes: [
      createMaterialTextureNode("base-texture", "baseColorTexture", { x: 48, y: 160 }),
      { nodeId: "world-normal", nodeType: "input.world-normal", position: { x: 48, y: 300 }, settings: {} },
      { nodeId: "sun-direction", nodeType: "input.sun-direction", position: { x: 48, y: 400 }, settings: {} },
      { nodeId: "sun-dot", nodeType: "math.dot", position: { x: 280, y: 350 }, settings: {} },
      { nodeId: "sun-mask", nodeType: "math.saturate", position: { x: 520, y: 350 }, settings: {} },
      { nodeId: "output", nodeType: "output.fragment", position: { x: 760, y: 160 }, settings: {} }
    ],
    edges: [
      createShaderEdge("e-n", "world-normal", "value", "sun-dot", "a"),
      createShaderEdge("e-s", "sun-direction", "value", "sun-dot", "b"),
      createShaderEdge("e-d", "sun-dot", "value", "sun-mask", "input"),
      createShaderEdge("e-mc", "sun-mask", "value", "output", "color"),
      createShaderEdge("e-a", "base-texture", "alpha", "output", "alpha")
    ],
    parameters: [
      {
        parameterId: "baseColorTexture",
        displayName: "Base Color Texture",
        dataType: "texture2d",
        textureRole: "color",
        defaultValue: null
      }
    ],
    metadata: { builtIn: true, builtInKey: "debug-sun-mask" }
  };
}

/**
 * Permanent authoring aid — keep.
 * Why it exists: verifies the packed vertex-alpha / exterior-bias channel
 * independently from the rest of the foliage shading stack.
 * What replaces it: nothing today; this is the canonical COLOR_0.w probe.
 * When to remove it: only once the asset/material inspector can preview
 * authored vertex channels directly.
 *
 * Debug shader: outputs vertex-color .w (the FoilageMaker sun_exterior_bias
 * channel) as grayscale. Black means the COLOR_0 attribute's .w is always 0,
 * which zeroes out exterior-bias-strength and kills the warm term.
 */
export function createDebugVertexAlphaShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  const shaderDefinitionId =
    options.shaderDefinitionId ?? `${projectId}:shader:debug-vertex-alpha`;

  return {
    shaderDefinitionId,
    definitionKind: "shader",
    displayName: options.displayName ?? "Debug Vertex Alpha",
    targetKind: "mesh-surface",
    revision: 1,
    nodes: [
      createMaterialTextureNode("base-texture", "baseColorTexture", { x: 48, y: 160 }),
      { nodeId: "vertex-color", nodeType: "input.vertex-color", position: { x: 48, y: 300 }, settings: {} },
      { nodeId: "split", nodeType: "math.split-vector", position: { x: 280, y: 300 }, settings: {} },
      { nodeId: "output", nodeType: "output.fragment", position: { x: 520, y: 160 }, settings: {} }
    ],
    edges: [
      createShaderEdge("e-split", "vertex-color", "value", "split", "input"),
      createShaderEdge("e-c", "split", "w", "output", "color"),
      createShaderEdge("e-a", "base-texture", "alpha", "output", "alpha")
    ],
    parameters: [
      {
        parameterId: "baseColorTexture",
        displayName: "Base Color Texture",
        dataType: "texture2d",
        textureRole: "color",
        defaultValue: null
      }
    ],
    metadata: { builtIn: true, builtInKey: "debug-vertex-alpha" }
  };
}

/**
 * Permanent authoring aid — keep.
 * Why it exists: provides a trivial falsification shader so teams can prove a
 * rendering problem is downstream of shader inputs rather than in the graph.
 * What replaces it: nothing today; this is the minimal "constant output"
 * sanity check for the surface path.
 * When to remove it: only once Sugarmagic ships an equivalent built-in
 * material/shader bypass diagnostic.
 *
 * Debug shader: outputs a literal constant red. No inputs, no math.
 * Falsification test for "sphere-normal is the culprit": if the tree renders
 * red at ALL presets, the sphere-normal path works and the noon-dark-leaves
 * bug is downstream (Three's lighting pipeline crushing the albedo for
 * transparent materials under HemisphereLight). If the tree's leaves go
 * black at noon even with THIS shader, we can rule in "it's not about the
 * shader inputs at all — it's downstream".
 */
export function createDebugConstantRedShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  const shaderDefinitionId =
    options.shaderDefinitionId ?? `${projectId}:shader:debug-constant-red`;

  return {
    shaderDefinitionId,
    definitionKind: "shader",
    displayName: options.displayName ?? "Debug Constant Red",
    targetKind: "mesh-surface",
    revision: 2,
    nodes: [
      createMaterialTextureNode("base-texture", "baseColorTexture", { x: 48, y: 160 }),
      { nodeId: "red", nodeType: "input.constant-color", position: { x: 48, y: 300 }, settings: { color: [1, 0, 0] } },
      { nodeId: "output", nodeType: "output.fragment", position: { x: 380, y: 160 }, settings: {} }
    ],
    edges: [
      createShaderEdge("e-c", "red", "value", "output", "color"),
      createShaderEdge("e-a", "base-texture", "alpha", "output", "alpha")
    ],
    parameters: [
      {
        parameterId: "baseColorTexture",
        displayName: "Base Color Texture",
        dataType: "texture2d",
        textureRole: "color",
        defaultValue: null
      }
    ],
    metadata: { builtIn: true, builtInKey: "debug-constant-red" }
  };
}

/**
 * Permanent authoring aid — keep.
 * Why it exists: verifies the custom sphere-normal attribute path directly so
 * foliage exports can be diagnosed without touching production shaders.
 * What replaces it: nothing today; this remains the canonical sphere-normal
 * attribute probe.
 * When to remove it: only once asset inspection can preview custom vertex
 * attributes or the foliage toolchain no longer emits sphere normals.
 *
 * Debug shader: outputs sphereNormal.xyz directly as color. Components in
 * [-1,1] get clamped to [0,1] at output, so a normal of (1,0,0) appears red,
 * (0,1,0) green, (0,0,1) blue; negative components show as black. If the
 * tree renders a varied gradient of colors (rainbow-ish across leaf
 * clusters) the sphere-normal attribute is being read correctly; if it
 * renders a single flat color or black, the custom-attribute +
 * modelNormalMatrix path is broken.
 */
export function createDebugSphereNormalShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  const shaderDefinitionId =
    options.shaderDefinitionId ?? `${projectId}:shader:debug-sphere-normal`;

  return {
    shaderDefinitionId,
    definitionKind: "shader",
    displayName: options.displayName ?? "Debug Sphere Normal",
    targetKind: "mesh-surface",
    revision: 2,
    nodes: [
      createMaterialTextureNode("base-texture", "baseColorTexture", { x: 48, y: 160 }),
      { nodeId: "sphere-normal", nodeType: "input.sphere-normal", position: { x: 48, y: 300 }, settings: {} },
      { nodeId: "output", nodeType: "output.fragment", position: { x: 380, y: 160 }, settings: {} }
    ],
    edges: [
      createShaderEdge("e-c", "sphere-normal", "value", "output", "color"),
      createShaderEdge("e-a", "base-texture", "alpha", "output", "alpha")
    ],
    parameters: [
      {
        parameterId: "baseColorTexture",
        displayName: "Base Color Texture",
        dataType: "texture2d",
        textureRole: "color",
        defaultValue: null
      }
    ],
    metadata: { builtIn: true, builtInKey: "debug-sphere-normal" }
  };
}

/**
 * Permanent authoring aid — keep.
 * Why it exists: verifies the baked tree-height attribute independently from
 * all lighting math so foliage gradients can be debugged at the source.
 * What replaces it: nothing today; this is the canonical tree-height probe.
 * When to remove it: only once asset inspection can preview custom vertex
 * attributes or the foliage stack stops depending on tree-height.
 *
 * Debug shader: outputs treeHeight (custom vertex attribute) as grayscale.
 * Should show a gradient from black (base) to white (top) of the tree.
 * If the tree renders a flat color, the _tree_height attribute isn't being
 * read correctly.
 */
export function createDebugTreeHeightShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  const shaderDefinitionId =
    options.shaderDefinitionId ?? `${projectId}:shader:debug-tree-height`;

  return {
    shaderDefinitionId,
    definitionKind: "shader",
    displayName: options.displayName ?? "Debug Tree Height",
    targetKind: "mesh-surface",
    revision: 1,
    nodes: [
      createMaterialTextureNode("base-texture", "baseColorTexture", { x: 48, y: 160 }),
      { nodeId: "tree-height", nodeType: "input.tree-height", position: { x: 48, y: 300 }, settings: {} },
      { nodeId: "output", nodeType: "output.fragment", position: { x: 380, y: 160 }, settings: {} }
    ],
    edges: [
      createShaderEdge("e-c", "tree-height", "value", "output", "color"),
      createShaderEdge("e-a", "base-texture", "alpha", "output", "alpha")
    ],
    parameters: [
      {
        parameterId: "baseColorTexture",
        displayName: "Base Color Texture",
        dataType: "texture2d",
        textureRole: "color",
        defaultValue: null
      }
    ],
    metadata: { builtIn: true, builtInKey: "debug-tree-height" }
  };
}

/**
 * Permanent authoring aid — keep.
 * Why it exists: isolates the view-direction/fresnel branch used by painterly
 * foliage rims so teams can test that term without the rest of the graph.
 * What replaces it: nothing today; this is the canonical fresnel probe.
 * When to remove it: only once authored shaders support intermediate-node
 * previews or a built-in rim/fresnel debugger.
 *
 * Debug shader: outputs the fresnel rim-intensity as grayscale. Edges of the
 * geometry should glow white; facing surfaces should be black. If it renders
 * flat black at non-default presets but correctly at default, the
 * fresnel/viewDirection path is the culprit.
 */
export function createDebugFresnelShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  const shaderDefinitionId =
    options.shaderDefinitionId ?? `${projectId}:shader:debug-fresnel`;

  return {
    shaderDefinitionId,
    definitionKind: "shader",
    displayName: options.displayName ?? "Debug Fresnel",
    targetKind: "mesh-surface",
    revision: 2,
    nodes: [
      createMaterialTextureNode("base-texture", "baseColorTexture", { x: 48, y: 160 }),
      { nodeId: "world-normal", nodeType: "input.world-normal", position: { x: 48, y: 300 }, settings: {} },
      { nodeId: "view-direction", nodeType: "input.view-direction", position: { x: 48, y: 400 }, settings: {} },
      { nodeId: "white", nodeType: "input.constant-color", position: { x: 48, y: 500 }, settings: { color: [1, 1, 1] } },
      {
        nodeId: "fresnel",
        nodeType: "effect.fresnel",
        position: { x: 320, y: 350 },
        settings: { power: 2.4, strength: 1.2 }
      },
      { nodeId: "output", nodeType: "output.fragment", position: { x: 600, y: 160 }, settings: {} }
    ],
    edges: [
      createShaderEdge("e-n", "world-normal", "value", "fresnel", "normal"),
      createShaderEdge("e-v", "view-direction", "value", "fresnel", "viewDirection"),
      createShaderEdge("e-col", "white", "value", "fresnel", "color"),
      createShaderEdge("e-c", "fresnel", "value", "output", "color"),
      createShaderEdge("e-a", "base-texture", "alpha", "output", "alpha")
    ],
    parameters: [
      {
        parameterId: "baseColorTexture",
        displayName: "Base Color Texture",
        dataType: "texture2d",
        textureRole: "color",
        defaultValue: null
      }
    ],
    metadata: { builtIn: true, builtInKey: "debug-fresnel" }
  };
}

/**
 * Foliage Surface 2: the authoritative painterly foliage surface shader
 * going forward. Built around the tree-height gradient (base → top), which
 * evaluates consistently across ALL lighting presets because it only reads
 * a vertex attribute — no TSL matrix math.
 *
 * This replaces the original `createDefaultFoliageSurfaceShaderGraph`
 * (which depended on `sphereNormal`) because of a bug we hit where TSL
 * matrix-math builtins applied to custom vertex attributes collapse to
 * zero when the scene uses HemisphereLight-based ambient (any non-default
 * preset). See the `sphereNormal` case in `ShaderRuntime.ts` for the full
 * investigation trail and where to pick it back up.
 *
 * Starting point cloned from the Debug Tree Height shader. Iterate here as
 * the foliage shading model evolves.
 */
export function createDefaultFoliageSurface2ShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  const shaderDefinitionId =
    options.shaderDefinitionId ?? `${projectId}:shader:foliage-surface-2`;

  return {
    shaderDefinitionId,
    definitionKind: "shader",
    displayName: options.displayName ?? "Foliage Surface 2",
    targetKind: "mesh-surface",
    revision: 1,
    nodes: [
      createMaterialTextureNode("base-texture", "baseColorTexture", { x: 48, y: 160 }),
      { nodeId: "tree-height", nodeType: "input.tree-height", position: { x: 48, y: 300 }, settings: {} },
      { nodeId: "output", nodeType: "output.fragment", position: { x: 380, y: 160 }, settings: {} }
    ],
    edges: [
      createShaderEdge("e-c", "tree-height", "value", "output", "color"),
      createShaderEdge("e-a", "base-texture", "alpha", "output", "alpha")
    ],
    parameters: [
      {
        parameterId: "baseColorTexture",
        displayName: "Base Color Texture",
        dataType: "texture2d",
        textureRole: "color",
        defaultValue: null
      }
    ],
    metadata: { builtIn: true, builtInKey: "foliage-surface-2" }
  };
}

/**
 * Foliage Surface 3: FS2's smooth tree-height base + FS's warm-sun and
 * rim-fresnel highlight terms, driven off `world-normal` instead of the
 * broken `sphere-normal` path. Keeps the soft in-shade blending the FS2
 * gradient gives you, but adds bloom-catchable pops on sunlit leaf tops
 * and silhouette edges.
 *
 * Graph shape:
 *   base      = tree-height                               (float, splats to greyscale vec3)
 *   warmTerm  = warmColor * saturate(dot(worldNormal, sunDir)) * warmStrength
 *   rimTerm   = fresnel(worldNormal, viewDir, rimColor, power=2.4, strength=1.2) * rimStrength
 *   color     = base + warmTerm + rimTerm
 *   alpha     = leafTexture.alpha
 *
 * Tune warmStrength / rimStrength from the inspector to taste. Default
 * values are deliberately modest — the intent is "a little more pop than
 * FS2," not "as much pop as FS original."
 */
export function createDefaultFoliageSurface3ShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  const shaderDefinitionId =
    options.shaderDefinitionId ?? `${projectId}:shader:foliage-surface-3`;

  return {
    shaderDefinitionId,
    definitionKind: "shader",
    displayName: options.displayName ?? "Foliage Surface 3",
    targetKind: "mesh-surface",
    revision: 1,
    nodes: [
      createMaterialTextureNode("base-texture", "baseColorTexture", { x: 48, y: 160 }),
      { nodeId: "tree-height", nodeType: "input.tree-height", position: { x: 48, y: 60 }, settings: {} },

      // Shared inputs for lighting math
      { nodeId: "world-normal", nodeType: "input.world-normal", position: { x: 48, y: 340 }, settings: {} },
      { nodeId: "sun-direction", nodeType: "input.sun-direction", position: { x: 48, y: 440 }, settings: {} },
      { nodeId: "view-direction", nodeType: "input.view-direction", position: { x: 48, y: 540 }, settings: {} },

      // Warm sun term: warmColor * saturate(worldNormal · sunDirection) * warmStrength
      { nodeId: "warm-color", nodeType: "input.parameter", position: { x: 48, y: 240 }, settings: { parameterId: "warmColor" } },
      { nodeId: "warm-strength", nodeType: "input.parameter", position: { x: 256, y: 240 }, settings: { parameterId: "warmStrength" } },
      { nodeId: "sun-dot", nodeType: "math.dot", position: { x: 256, y: 380 }, settings: {} },
      { nodeId: "sun-mask", nodeType: "math.saturate", position: { x: 448, y: 380 }, settings: {} },
      { nodeId: "warm-scalar", nodeType: "math.multiply", position: { x: 640, y: 310 }, settings: {} },
      { nodeId: "warm-term", nodeType: "color.multiply", position: { x: 832, y: 260 }, settings: {} },

      // Rim term: fresnel(worldNormal, viewDir, rimColor) * rimStrength
      { nodeId: "rim-color", nodeType: "input.parameter", position: { x: 48, y: 640 }, settings: { parameterId: "rimColor" } },
      { nodeId: "rim-strength", nodeType: "input.parameter", position: { x: 256, y: 640 }, settings: { parameterId: "rimStrength" } },
      {
        nodeId: "rim-fresnel",
        nodeType: "effect.fresnel",
        position: { x: 448, y: 540 },
        settings: { power: 2.4, strength: 1.2 }
      },
      { nodeId: "rim-term", nodeType: "color.multiply", position: { x: 640, y: 620 }, settings: {} },

      // Combine: base (tree-height) + warm + rim
      { nodeId: "warm-plus-rim", nodeType: "color.add", position: { x: 1024, y: 440 }, settings: {} },
      { nodeId: "final-color", nodeType: "color.add", position: { x: 1216, y: 260 }, settings: {} },
      { nodeId: "output", nodeType: "output.fragment", position: { x: 1440, y: 260 }, settings: {} }
    ],
    edges: [
      // Sun dot / sun mask
      createShaderEdge("e-n-sundot", "world-normal", "value", "sun-dot", "a"),
      createShaderEdge("e-sun-sundot", "sun-direction", "value", "sun-dot", "b"),
      createShaderEdge("e-sundot-mask", "sun-dot", "value", "sun-mask", "input"),

      // Warm scalar = warmStrength * sun-mask
      createShaderEdge("e-warmstrength-scalar", "warm-strength", "value", "warm-scalar", "a"),
      createShaderEdge("e-sunmask-scalar", "sun-mask", "value", "warm-scalar", "b"),

      // Warm term = warmColor * warmScalar  (scalar splats to vec3)
      createShaderEdge("e-warmcolor-term", "warm-color", "value", "warm-term", "a"),
      createShaderEdge("e-warmscalar-term", "warm-scalar", "value", "warm-term", "b"),

      // Rim fresnel
      createShaderEdge("e-n-rim", "world-normal", "value", "rim-fresnel", "normal"),
      createShaderEdge("e-v-rim", "view-direction", "value", "rim-fresnel", "viewDirection"),
      createShaderEdge("e-rimcolor-rim", "rim-color", "value", "rim-fresnel", "color"),

      // Rim term = rimFresnel * rimStrength  (scalar splats)
      createShaderEdge("e-rimfresnel-term", "rim-fresnel", "value", "rim-term", "a"),
      createShaderEdge("e-rimstrength-term", "rim-strength", "value", "rim-term", "b"),

      // Combine warm + rim, then add the tree-height base
      createShaderEdge("e-warm-plus-rim-a", "warm-term", "value", "warm-plus-rim", "a"),
      createShaderEdge("e-warm-plus-rim-b", "rim-term", "value", "warm-plus-rim", "b"),
      createShaderEdge("e-base-final", "tree-height", "value", "final-color", "a"),
      createShaderEdge("e-warmrim-final", "warm-plus-rim", "value", "final-color", "b"),

      // Output
      createShaderEdge("e-final-output", "final-color", "value", "output", "color"),
      createShaderEdge("e-alpha-output", "base-texture", "alpha", "output", "alpha")
    ],
    parameters: [
      {
        parameterId: "baseColorTexture",
        displayName: "Base Color Texture",
        dataType: "texture2d",
        textureRole: "color",
        defaultValue: null
      },
      {
        parameterId: "warmColor",
        displayName: "Warm Sun Color",
        dataType: "color",
        colorSpace: "hdr",
        defaultValue: [1.45, 1.15, 0.72]
      },
      {
        parameterId: "warmStrength",
        displayName: "Warm Sun Strength",
        dataType: "float",
        defaultValue: 0.4
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
        defaultValue: 0.3
      }
    ],
    metadata: {
      builtIn: true,
      builtInKey: "foliage-surface-3"
    }
  };
}

/**
 * Grass Surface 2: the FS2-equivalent for grass. Strips away sun-dot,
 * tip-boost, and rim-fresnel lighting terms and outputs a single gradient:
 *   color = vertexColor * mix(rootTint, tipTint, treeHeight)
 *   alpha = 1
 *
 * Why: the built-in grass shader's four lighting terms look great on one
 * big silhouette (like a tree canopy) but produce per-blade noise on the
 * thousands of near-vertical thin quads that make up a grass field,
 * reading as "spiky" rather than "soft." FS2 solved the same problem for
 * foliage canopies by removing the lighting math entirely. This applies
 * that same cure to grass.
 *
 * `rootTint` declares `inheritSource: "baseLayerColor"` so unless the
 * author has explicitly set a root tint via parameterValues, the scatter
 * resolver injects the color of the containing Surface's first
 * `blendMode: "base"` appearance layer. Grass visually grows out of the
 * ground it sits on without any per-scene tuning.
 */
export function createDefaultGrassSurface2ShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  const shaderDefinitionId =
    options.shaderDefinitionId ?? `${projectId}:shader:grass-surface-2`;
  return {
    shaderDefinitionId,
    definitionKind: "shader",
    displayName: options.displayName ?? "Grass Surface 2",
    targetKind: "mesh-surface",
    revision: 1,
    nodes: [
      { nodeId: "tree-height", nodeType: "input.tree-height", position: { x: 48, y: 56 }, settings: {} },
      { nodeId: "root-tint", nodeType: "input.parameter", position: { x: 256, y: 0 }, settings: { parameterId: "rootTint" } },
      { nodeId: "tip-tint", nodeType: "input.parameter", position: { x: 256, y: 96 }, settings: { parameterId: "tipTint" } },
      { nodeId: "height-tint", nodeType: "math.lerp", position: { x: 480, y: 56 }, settings: {} },
      { nodeId: "output", nodeType: "output.fragment", position: { x: 704, y: 56 }, settings: {} }
    ],
    edges: [
      createShaderEdge("gs2-e-root-heighttint", "root-tint", "value", "height-tint", "a"),
      createShaderEdge("gs2-e-tip-heighttint", "tip-tint", "value", "height-tint", "b"),
      createShaderEdge("gs2-e-th-heighttint", "tree-height", "value", "height-tint", "alpha"),
      createShaderEdge("gs2-e-ht-out", "height-tint", "value", "output", "color")
    ],
    parameters: [
      {
        parameterId: "rootTint",
        displayName: "Root Tint",
        dataType: "color",
        colorSpace: "hdr",
        defaultValue: [0.36, 0.52, 0.24],
        inheritSource: "baseLayerColor"
      },
      {
        parameterId: "tipTint",
        displayName: "Tip Tint",
        dataType: "color",
        colorSpace: "hdr",
        defaultValue: [0.84, 0.91, 0.58]
      }
    ],
    metadata: { builtIn: true, builtInKey: "grass-surface-2" }
  };
}

/**
 * Grass Surface 3: GS2's smooth rootTint↔tipTint gradient + the FS3 warm-sun
 * and rim-fresnel highlight terms, driven off `world-normal` (which is the
 * force-up `(0, 1, 0)` vertex normal baked by `createProceduralGrassGeometry`).
 *
 * Because every blade in a tuft has the same up-pointing normal, the sun
 * dot and rim fresnel produce per-TUFT / per-view variation — sunlit sides
 * of a hill pick up the warm term, silhouette-edge clumps pick up the rim
 * term — without introducing per-BLADE lighting noise, which was the bug
 * that made the original grass shader look spiky. This is the FS3 pattern
 * safely re-applied to grass.
 *
 * Graph shape:
 *   base      = mix(rootTint, tipTint, treeHeight)
 *   warmTerm  = warmColor * saturate(dot(worldNormal, sunDir)) * warmStrength
 *   rimTerm   = fresnel(worldNormal, viewDir, rimColor, power=2.1, strength=1.0) * rimStrength
 *   color     = base + warmTerm + rimTerm
 *
 * `rootTint` declares `inheritSource: "baseLayerColor"` so the grass root
 * color auto-matches the containing Surface's base layer color unless the
 * author explicitly sets it. Same inheritance contract as GS2.
 */
export function createDefaultGrassSurface3ShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  const shaderDefinitionId =
    options.shaderDefinitionId ?? `${projectId}:shader:grass-surface-3`;
  return {
    shaderDefinitionId,
    definitionKind: "shader",
    displayName: options.displayName ?? "Grass Surface 3",
    targetKind: "mesh-surface",
    revision: 1,
    nodes: [
      { nodeId: "tree-height", nodeType: "input.tree-height", position: { x: 48, y: 40 }, settings: {} },
      { nodeId: "root-tint", nodeType: "input.parameter", position: { x: 256, y: 0 }, settings: { parameterId: "rootTint" } },
      { nodeId: "tip-tint", nodeType: "input.parameter", position: { x: 256, y: 80 }, settings: { parameterId: "tipTint" } },
      { nodeId: "height-tint", nodeType: "math.lerp", position: { x: 480, y: 40 }, settings: {} },

      // Shared lighting inputs (world-normal is force-up on grass geometry)
      { nodeId: "world-normal", nodeType: "input.world-normal", position: { x: 48, y: 260 }, settings: {} },
      { nodeId: "sun-direction", nodeType: "input.sun-direction", position: { x: 48, y: 340 }, settings: {} },
      { nodeId: "view-direction", nodeType: "input.view-direction", position: { x: 48, y: 420 }, settings: {} },

      // Warm sun term: warmColor * saturate(dot(worldNormal, sunDirection)) * warmStrength
      { nodeId: "warm-color", nodeType: "input.parameter", position: { x: 256, y: 180 }, settings: { parameterId: "warmColor" } },
      { nodeId: "warm-strength", nodeType: "input.parameter", position: { x: 256, y: 260 }, settings: { parameterId: "warmStrength" } },
      { nodeId: "sun-dot", nodeType: "math.dot", position: { x: 256, y: 360 }, settings: {} },
      { nodeId: "sun-mask", nodeType: "math.saturate", position: { x: 448, y: 360 }, settings: {} },
      { nodeId: "warm-scalar", nodeType: "math.multiply", position: { x: 640, y: 300 }, settings: {} },
      { nodeId: "warm-term", nodeType: "color.multiply", position: { x: 832, y: 240 }, settings: {} },

      // Rim term: fresnel(worldNormal, viewDir, rimColor) * rimStrength
      { nodeId: "rim-color", nodeType: "input.parameter", position: { x: 256, y: 520 }, settings: { parameterId: "rimColor" } },
      { nodeId: "rim-strength", nodeType: "input.parameter", position: { x: 256, y: 600 }, settings: { parameterId: "rimStrength" } },
      {
        nodeId: "rim-fresnel",
        nodeType: "effect.fresnel",
        position: { x: 448, y: 500 },
        settings: { power: 2.1, strength: 1.0 }
      },
      { nodeId: "rim-term", nodeType: "color.multiply", position: { x: 640, y: 580 }, settings: {} },

      // Combine: heightTint + warmTerm + rimTerm
      { nodeId: "warm-plus-rim", nodeType: "color.add", position: { x: 1024, y: 400 }, settings: {} },
      { nodeId: "final-color", nodeType: "color.add", position: { x: 1216, y: 240 }, settings: {} },
      { nodeId: "output", nodeType: "output.fragment", position: { x: 1440, y: 240 }, settings: {} }
    ],
    edges: [
      // Base gradient
      createShaderEdge("gs3-e-root-heighttint", "root-tint", "value", "height-tint", "a"),
      createShaderEdge("gs3-e-tip-heighttint", "tip-tint", "value", "height-tint", "b"),
      createShaderEdge("gs3-e-th-heighttint", "tree-height", "value", "height-tint", "alpha"),

      // Sun dot / saturate mask
      createShaderEdge("gs3-e-n-sundot", "world-normal", "value", "sun-dot", "a"),
      createShaderEdge("gs3-e-sun-sundot", "sun-direction", "value", "sun-dot", "b"),
      createShaderEdge("gs3-e-sundot-mask", "sun-dot", "value", "sun-mask", "input"),

      // Warm scalar = warmStrength * sunMask
      createShaderEdge("gs3-e-warmstrength-scalar", "warm-strength", "value", "warm-scalar", "a"),
      createShaderEdge("gs3-e-sunmask-scalar", "sun-mask", "value", "warm-scalar", "b"),

      // Warm term = warmColor * warmScalar (scalar splats to vec3)
      createShaderEdge("gs3-e-warmcolor-term", "warm-color", "value", "warm-term", "a"),
      createShaderEdge("gs3-e-warmscalar-term", "warm-scalar", "value", "warm-term", "b"),

      // Rim fresnel
      createShaderEdge("gs3-e-n-rim", "world-normal", "value", "rim-fresnel", "normal"),
      createShaderEdge("gs3-e-v-rim", "view-direction", "value", "rim-fresnel", "viewDirection"),
      createShaderEdge("gs3-e-rimcolor-rim", "rim-color", "value", "rim-fresnel", "color"),

      // Rim term = rimFresnel * rimStrength
      createShaderEdge("gs3-e-rimfresnel-term", "rim-fresnel", "value", "rim-term", "a"),
      createShaderEdge("gs3-e-rimstrength-term", "rim-strength", "value", "rim-term", "b"),

      // Combine warm + rim, then add heightTint base
      createShaderEdge("gs3-e-warm-plus-rim-a", "warm-term", "value", "warm-plus-rim", "a"),
      createShaderEdge("gs3-e-warm-plus-rim-b", "rim-term", "value", "warm-plus-rim", "b"),
      createShaderEdge("gs3-e-base-final", "height-tint", "value", "final-color", "a"),
      createShaderEdge("gs3-e-warmrim-final", "warm-plus-rim", "value", "final-color", "b"),

      // Output
      createShaderEdge("gs3-e-final-output", "final-color", "value", "output", "color")
    ],
    parameters: [
      {
        parameterId: "rootTint",
        displayName: "Root Tint",
        dataType: "color",
        colorSpace: "hdr",
        defaultValue: [0.36, 0.52, 0.24],
        inheritSource: "baseLayerColor"
      },
      {
        parameterId: "tipTint",
        displayName: "Tip Tint",
        dataType: "color",
        colorSpace: "hdr",
        defaultValue: [0.84, 0.91, 0.58]
      },
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
        defaultValue: 0.25
      },
      {
        parameterId: "rimColor",
        displayName: "Rim Color",
        dataType: "color",
        colorSpace: "hdr",
        defaultValue: [0.88, 0.96, 0.72]
      },
      {
        parameterId: "rimStrength",
        displayName: "Rim Strength",
        dataType: "float",
        defaultValue: 0.3
      }
    ],
    metadata: { builtIn: true, builtInKey: "grass-surface-3" }
  };
}

/**
 * Grass Surface 4: GS3 + world-space macro noise color modulation. The
 * stylized-grass trick the Unreal tutorial and every painterly reference
 * lean on: sample a perlin-like noise at each fragment's world XZ position,
 * use it to interpolate between two subtle tint colors, and multiply the
 * resulting tint onto the accumulated lighting. Because the noise is
 * spatially coherent (neighboring fragments see similar values), you get
 * washes of color variation at multi-meter scale instead of per-blade
 * speckle. This is what makes stylized grass fields feel alive and
 * painterly instead of uniform.
 *
 * Graph shape:
 *   base      = mix(rootTint, tipTint, treeHeight)
 *   warmTerm  = warmColor * saturate(dot(worldNormal, sunDir)) * warmStrength
 *   rimTerm   = fresnel(worldNormal, viewDir, rimColor) * rimStrength
 *   lit       = base + warmTerm + rimTerm
 *   noise     = worldNoise(worldPosition * macroScale)
 *   macroTint = mix(macroDarkColor, macroLightColor, noise)
 *   color     = lit * macroTint
 *
 * The two macro colors are defaulted close to white (~0.8-1.1 range) so
 * the modulation is a gentle tint, not a full color replacement. Authors
 * can widen the range for more dramatic washes.
 *
 * `rootTint` inherits from base layer color (same contract as GS2/GS3).
 */
export function createDefaultGrassSurface4ShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  const shaderDefinitionId =
    options.shaderDefinitionId ?? `${projectId}:shader:grass-surface-4`;
  return {
    shaderDefinitionId,
    definitionKind: "shader",
    displayName: options.displayName ?? "Grass Surface 4",
    targetKind: "mesh-surface",
    revision: 1,
    nodes: [
      { nodeId: "tree-height", nodeType: "input.tree-height", position: { x: 48, y: 40 }, settings: {} },
      { nodeId: "root-tint", nodeType: "input.parameter", position: { x: 256, y: 0 }, settings: { parameterId: "rootTint" } },
      { nodeId: "tip-tint", nodeType: "input.parameter", position: { x: 256, y: 80 }, settings: { parameterId: "tipTint" } },
      { nodeId: "height-tint", nodeType: "math.lerp", position: { x: 480, y: 40 }, settings: {} },

      // Lighting inputs (worldNormal is the force-up (0,1,0) on grass geometry)
      { nodeId: "world-normal", nodeType: "input.world-normal", position: { x: 48, y: 260 }, settings: {} },
      { nodeId: "sun-direction", nodeType: "input.sun-direction", position: { x: 48, y: 340 }, settings: {} },
      { nodeId: "view-direction", nodeType: "input.view-direction", position: { x: 48, y: 420 }, settings: {} },
      { nodeId: "world-position", nodeType: "input.world-position", position: { x: 48, y: 720 }, settings: {} },

      // Warm sun term
      { nodeId: "warm-color", nodeType: "input.parameter", position: { x: 256, y: 180 }, settings: { parameterId: "warmColor" } },
      { nodeId: "warm-strength", nodeType: "input.parameter", position: { x: 256, y: 260 }, settings: { parameterId: "warmStrength" } },
      { nodeId: "sun-dot", nodeType: "math.dot", position: { x: 256, y: 360 }, settings: {} },
      { nodeId: "sun-mask", nodeType: "math.saturate", position: { x: 448, y: 360 }, settings: {} },
      { nodeId: "warm-scalar", nodeType: "math.multiply", position: { x: 640, y: 300 }, settings: {} },
      { nodeId: "warm-term", nodeType: "color.multiply", position: { x: 832, y: 240 }, settings: {} },

      // Rim term
      { nodeId: "rim-color", nodeType: "input.parameter", position: { x: 256, y: 520 }, settings: { parameterId: "rimColor" } },
      { nodeId: "rim-strength", nodeType: "input.parameter", position: { x: 256, y: 600 }, settings: { parameterId: "rimStrength" } },
      {
        nodeId: "rim-fresnel",
        nodeType: "effect.fresnel",
        position: { x: 448, y: 500 },
        settings: { power: 2.1, strength: 1.0 }
      },
      { nodeId: "rim-term", nodeType: "color.multiply", position: { x: 640, y: 580 }, settings: {} },

      // Combine lit = base + warm + rim
      { nodeId: "warm-plus-rim", nodeType: "color.add", position: { x: 1024, y: 400 }, settings: {} },
      { nodeId: "lit", nodeType: "color.add", position: { x: 1216, y: 240 }, settings: {} },

      // Macro-noise modulation
      { nodeId: "macro-dark", nodeType: "input.parameter", position: { x: 256, y: 760 }, settings: { parameterId: "macroDarkColor" } },
      { nodeId: "macro-light", nodeType: "input.parameter", position: { x: 256, y: 840 }, settings: { parameterId: "macroLightColor" } },
      {
        nodeId: "world-noise",
        nodeType: "effect.world-noise",
        position: { x: 256, y: 720 },
        settings: { scale: 0.08 }
      },
      { nodeId: "macro-tint", nodeType: "math.lerp", position: { x: 640, y: 800 }, settings: {} },

      // final = lit * macroTint
      { nodeId: "final-color", nodeType: "color.multiply", position: { x: 1408, y: 500 }, settings: {} },
      { nodeId: "output", nodeType: "output.fragment", position: { x: 1632, y: 500 }, settings: {} }
    ],
    edges: [
      // Base gradient
      createShaderEdge("gs4-e-root-heighttint", "root-tint", "value", "height-tint", "a"),
      createShaderEdge("gs4-e-tip-heighttint", "tip-tint", "value", "height-tint", "b"),
      createShaderEdge("gs4-e-th-heighttint", "tree-height", "value", "height-tint", "alpha"),

      // Sun dot / mask
      createShaderEdge("gs4-e-n-sundot", "world-normal", "value", "sun-dot", "a"),
      createShaderEdge("gs4-e-sun-sundot", "sun-direction", "value", "sun-dot", "b"),
      createShaderEdge("gs4-e-sundot-mask", "sun-dot", "value", "sun-mask", "input"),

      // Warm scalar + term
      createShaderEdge("gs4-e-warmstrength-scalar", "warm-strength", "value", "warm-scalar", "a"),
      createShaderEdge("gs4-e-sunmask-scalar", "sun-mask", "value", "warm-scalar", "b"),
      createShaderEdge("gs4-e-warmcolor-term", "warm-color", "value", "warm-term", "a"),
      createShaderEdge("gs4-e-warmscalar-term", "warm-scalar", "value", "warm-term", "b"),

      // Rim fresnel + term
      createShaderEdge("gs4-e-n-rim", "world-normal", "value", "rim-fresnel", "normal"),
      createShaderEdge("gs4-e-v-rim", "view-direction", "value", "rim-fresnel", "viewDirection"),
      createShaderEdge("gs4-e-rimcolor-rim", "rim-color", "value", "rim-fresnel", "color"),
      createShaderEdge("gs4-e-rimfresnel-term", "rim-fresnel", "value", "rim-term", "a"),
      createShaderEdge("gs4-e-rimstrength-term", "rim-strength", "value", "rim-term", "b"),

      // Combine lit = base + warm + rim
      createShaderEdge("gs4-e-warm-plus-rim-a", "warm-term", "value", "warm-plus-rim", "a"),
      createShaderEdge("gs4-e-warm-plus-rim-b", "rim-term", "value", "warm-plus-rim", "b"),
      createShaderEdge("gs4-e-base-lit", "height-tint", "value", "lit", "a"),
      createShaderEdge("gs4-e-warmrim-lit", "warm-plus-rim", "value", "lit", "b"),

      // World-noise at worldPosition (scale from node setting)
      createShaderEdge("gs4-e-worldpos-noise", "world-position", "value", "world-noise", "position"),

      // macroTint = mix(macroDark, macroLight, noise)
      createShaderEdge("gs4-e-macrodark-tint", "macro-dark", "value", "macro-tint", "a"),
      createShaderEdge("gs4-e-macrolight-tint", "macro-light", "value", "macro-tint", "b"),
      createShaderEdge("gs4-e-noise-tint", "world-noise", "value", "macro-tint", "alpha"),

      // final = lit * macroTint
      createShaderEdge("gs4-e-lit-final", "lit", "value", "final-color", "a"),
      createShaderEdge("gs4-e-tint-final", "macro-tint", "value", "final-color", "b"),

      // Output
      createShaderEdge("gs4-e-final-output", "final-color", "value", "output", "color")
    ],
    parameters: [
      {
        parameterId: "rootTint",
        displayName: "Root Tint",
        dataType: "color",
        colorSpace: "hdr",
        defaultValue: [0.36, 0.52, 0.24],
        inheritSource: "baseLayerColor"
      },
      {
        parameterId: "tipTint",
        displayName: "Tip Tint",
        dataType: "color",
        colorSpace: "hdr",
        defaultValue: [0.84, 0.91, 0.58]
      },
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
        defaultValue: 0.25
      },
      {
        parameterId: "rimColor",
        displayName: "Rim Color",
        dataType: "color",
        colorSpace: "hdr",
        defaultValue: [0.88, 0.96, 0.72]
      },
      {
        parameterId: "rimStrength",
        displayName: "Rim Strength",
        dataType: "float",
        defaultValue: 0.3
      },
      {
        parameterId: "macroDarkColor",
        displayName: "Macro Dark Tint",
        dataType: "color",
        colorSpace: "hdr",
        defaultValue: [0.5, 0.68, 0.42]
      },
      {
        parameterId: "macroLightColor",
        displayName: "Macro Light Tint",
        dataType: "color",
        colorSpace: "hdr",
        defaultValue: [1.4, 1.22, 0.74]
      }
    ],
    metadata: { builtIn: true, builtInKey: "grass-surface-4" }
  };
}

/**
 * Grass Surface 6: GS4's color math + a textured blade silhouette. Samples
 * an authored blade PNG (soft antialiased alpha edges, subtle internal
 * luminance grain) to shape the visible blade cutout and to add micro-scale
 * painterly variation on top of the macro world-space noise.
 *
 * Why: up through GS4 the blade silhouette is pure geometry — every blade
 * edge traces a clean geometric ribbon, which reads as cartoonish / vector-
 * graphic next to the alpha-cutout tree foliage that inherits painterly
 * silhouettes from its leaf texture. GS6 closes that gap by letting the
 * blade shape come from an authored alpha texture, same mechanism the
 * foliage surfaces use. The `tooling/generate-grass-blade.mjs` script
 * produces a default 128×512 PNG matching the procedural ribbon geometry
 * with soft noise-jittered edges.
 *
 * Graph shape:
 *   texture    = sample(bladeTexture, uv)
 *   base       = mix(rootTint, tipTint, treeHeight)
 *   warmTerm   = warmColor * saturate(dot(worldNormal, sunDir)) * warmStrength
 *   rimTerm    = fresnel(worldNormal, viewDir, rimColor) * rimStrength
 *   lit        = base + warmTerm + rimTerm
 *   noise      = worldNoise(worldPosition * macroScale)
 *   macroTint  = mix(macroDarkColor, macroLightColor, noise)
 *   color.rgb  = lit * macroTint * texture.color   (texture luminance adds grain)
 *   color.a    = texture.alpha                     (silhouette + soft edge)
 *
 * `rootTint` inherits from base layer color as in GS2/GS3/GS4. The
 * `bladeTexture` parameter has no default binding — authors must import a
 * blade PNG (e.g., `assets/grass-blade.png`) as a TextureDefinition in
 * their project and bind it on the material instance. Without a texture
 * bound, the material falls back to full opacity (default texture alpha
 * is 1) and looks identical to GS4.
 */
export function createDefaultGrassSurface6ShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  const shaderDefinitionId =
    options.shaderDefinitionId ?? `${projectId}:shader:grass-surface-6`;
  return {
    shaderDefinitionId,
    definitionKind: "shader",
    displayName: options.displayName ?? "Grass Surface 6",
    targetKind: "mesh-surface",
    revision: 1,
    nodes: [
      // Blade texture (alpha + subtle luminance grain)
      createMaterialTextureNode("blade-texture", "bladeTexture", { x: 48, y: 900 }),

      // Diffuse tint texture (optional painterly color field tiled across
      // world XZ). Sampled at worldXZ × diffuseTiling so neighboring blades
      // see coherent color patches. Multiplied into the final color via a
      // strength-controlled lerp so strength=0 disables it and strength=1
      // fully applies the tint.
      createMaterialTextureNode("diffuse-texture", "diffuseTexture", { x: 48, y: 1140 }),

      // Base gradient
      { nodeId: "tree-height", nodeType: "input.tree-height", position: { x: 48, y: 40 }, settings: {} },
      { nodeId: "root-tint", nodeType: "input.parameter", position: { x: 256, y: 0 }, settings: { parameterId: "rootTint" } },
      { nodeId: "tip-tint", nodeType: "input.parameter", position: { x: 256, y: 80 }, settings: { parameterId: "tipTint" } },
      { nodeId: "height-tint", nodeType: "math.lerp", position: { x: 480, y: 40 }, settings: {} },

      // Lighting inputs
      { nodeId: "world-normal", nodeType: "input.world-normal", position: { x: 48, y: 260 }, settings: {} },
      { nodeId: "sun-direction", nodeType: "input.sun-direction", position: { x: 48, y: 340 }, settings: {} },
      { nodeId: "view-direction", nodeType: "input.view-direction", position: { x: 48, y: 420 }, settings: {} },
      { nodeId: "world-position", nodeType: "input.world-position", position: { x: 48, y: 720 }, settings: {} },

      // Warm sun term
      { nodeId: "warm-color", nodeType: "input.parameter", position: { x: 256, y: 180 }, settings: { parameterId: "warmColor" } },
      { nodeId: "warm-strength", nodeType: "input.parameter", position: { x: 256, y: 260 }, settings: { parameterId: "warmStrength" } },
      { nodeId: "sun-dot", nodeType: "math.dot", position: { x: 256, y: 360 }, settings: {} },
      { nodeId: "sun-mask", nodeType: "math.saturate", position: { x: 448, y: 360 }, settings: {} },
      { nodeId: "warm-scalar", nodeType: "math.multiply", position: { x: 640, y: 300 }, settings: {} },
      { nodeId: "warm-term", nodeType: "color.multiply", position: { x: 832, y: 240 }, settings: {} },

      // Rim term
      { nodeId: "rim-color", nodeType: "input.parameter", position: { x: 256, y: 520 }, settings: { parameterId: "rimColor" } },
      { nodeId: "rim-strength", nodeType: "input.parameter", position: { x: 256, y: 600 }, settings: { parameterId: "rimStrength" } },
      {
        nodeId: "rim-fresnel",
        nodeType: "effect.fresnel",
        position: { x: 448, y: 500 },
        settings: { power: 2.1, strength: 1.0 }
      },
      { nodeId: "rim-term", nodeType: "color.multiply", position: { x: 640, y: 580 }, settings: {} },

      // Combine lit = base + warm + rim
      { nodeId: "warm-plus-rim", nodeType: "color.add", position: { x: 1024, y: 400 }, settings: {} },
      { nodeId: "lit", nodeType: "color.add", position: { x: 1216, y: 240 }, settings: {} },

      // Macro-noise modulation
      { nodeId: "macro-dark", nodeType: "input.parameter", position: { x: 256, y: 760 }, settings: { parameterId: "macroDarkColor" } },
      { nodeId: "macro-light", nodeType: "input.parameter", position: { x: 256, y: 840 }, settings: { parameterId: "macroLightColor" } },
      {
        nodeId: "world-noise",
        nodeType: "effect.world-noise",
        position: { x: 256, y: 720 },
        settings: { scale: 0.08 }
      },
      { nodeId: "macro-tint", nodeType: "math.lerp", position: { x: 640, y: 800 }, settings: {} },
      { nodeId: "lit-macro", nodeType: "color.multiply", position: { x: 1408, y: 500 }, settings: {} },

      // Apply texture luminance to add painterly grain (lit × macro × texture.color)
      { nodeId: "final-color", nodeType: "color.multiply", position: { x: 1600, y: 700 }, settings: {} },

      // Diffuse tint sampling path. math.multiply has strict-float ports, so
      // we split the mesh UV vec2 into its components (via split-vector with
      // widen-to-vec3 coercion), scale each scalar by tiling, and recombine
      // into a vec2 UV for the texture sample. Mesh UV varies across each
      // blade (0→1 base→tip), so tiling controls how many texture
      // repetitions per blade.
      //   split = splitVector(meshUV → widen to vec3)
      //   scaledU = split.x × diffuseTiling
      //   scaledV = split.y × diffuseTiling
      //   uv = vec2(scaledU, scaledV)
      //   tint = texture(diffuseTexture, uv).color × 2      // re-centers mean around 1
      //   factor = mix(1.0, tint, diffuseStrength)          // strength=0 disables
      //   finalWithDiffuse = finalColor × factor
      { nodeId: "diffuse-mesh-uv", nodeType: "input.uv", position: { x: 240, y: 1180 }, settings: {} },
      { nodeId: "split-mesh-uv", nodeType: "math.split-vector", position: { x: 432, y: 1180 }, settings: {} },
      { nodeId: "diffuse-tiling", nodeType: "input.parameter", position: { x: 432, y: 1260 }, settings: { parameterId: "diffuseTiling" } },
      { nodeId: "uv-x-scaled", nodeType: "math.multiply", position: { x: 624, y: 1140 }, settings: {} },
      { nodeId: "uv-y-scaled", nodeType: "math.multiply", position: { x: 624, y: 1220 }, settings: {} },
      { nodeId: "diffuse-uv", nodeType: "math.combine-vector", position: { x: 816, y: 1180 }, settings: {} },
      createColorConstantNode("diffuse-boost-color", [2, 2, 2], { x: 816, y: 1320 }),
      { nodeId: "diffuse-boosted", nodeType: "color.multiply", position: { x: 1008, y: 1220 }, settings: {} },
      createColorConstantNode("diffuse-identity", [1, 1, 1], { x: 1008, y: 1400 }),
      { nodeId: "diffuse-strength", nodeType: "input.parameter", position: { x: 1200, y: 1400 }, settings: { parameterId: "diffuseStrength" } },
      { nodeId: "diffuse-factor", nodeType: "math.lerp", position: { x: 1392, y: 1320 }, settings: {} },
      { nodeId: "final-with-diffuse", nodeType: "color.multiply", position: { x: 1760, y: 760 }, settings: {} },

      // Base fade: the blade's alpha fades from 0 at the root (treeHeight=0)
      // to full at treeHeight=baseFadeEnd. BUT the engine's alphaTest=0.5
      // cutout collapses a smooth gradient into a hard horizontal line at
      // the blade's cut height. To break that line we jitter the smoothstep
      // input per-fragment using a fine-grained world-space noise — each
      // fragment's cutoff threshold shifts ±baseFadeJitter/2, producing a
      // dithered / irregular edge ("hashed alpha" pattern) instead of a
      // clean line. Both baseFadeEnd and baseFadeJitter are material
      // parameters so the author can tune from the inspector without
      // shader rebuilds.
      createFloatConstantNode("fade-edge-start", 0, { x: 1600, y: 880 }),
      { nodeId: "fade-edge-end", nodeType: "input.parameter", position: { x: 1600, y: 960 }, settings: { parameterId: "baseFadeEnd" } },
      {
        nodeId: "fine-noise",
        nodeType: "effect.world-noise",
        position: { x: 1600, y: 1040 },
        // Scale tuned for per-fragment-ish dithering on ~10cm-tall blades:
        // at 12, the noise varies at roughly 12 world-unit frequency, so
        // across a single blade height you sample 5-6 distinct values.
        // Combined with the smoothstep thresholding this reads as a
        // scattered cutoff boundary instead of a clean line.
        settings: { scale: 12.0 }
      },
      createFloatConstantNode("fade-noise-center", 0.5, { x: 1600, y: 1120 }),
      { nodeId: "fade-noise-offset", nodeType: "math.subtract", position: { x: 1760, y: 1080 }, settings: {} },
      { nodeId: "fade-jitter-amount", nodeType: "input.parameter", position: { x: 1600, y: 1200 }, settings: { parameterId: "baseFadeJitter" } },
      { nodeId: "fade-jitter-scaled", nodeType: "math.multiply", position: { x: 1920, y: 1120 }, settings: {} },
      { nodeId: "fade-height-jittered", nodeType: "math.add", position: { x: 2080, y: 1040 }, settings: {} },
      { nodeId: "base-fade", nodeType: "math.smoothstep", position: { x: 2240, y: 920 }, settings: {} },
      { nodeId: "faded-alpha", nodeType: "math.multiply", position: { x: 2400, y: 860 }, settings: {} },

      { nodeId: "output", nodeType: "output.fragment", position: { x: 2624, y: 780 }, settings: {} }
    ],
    edges: [
      // Base gradient
      createShaderEdge("gs6-e-root-heighttint", "root-tint", "value", "height-tint", "a"),
      createShaderEdge("gs6-e-tip-heighttint", "tip-tint", "value", "height-tint", "b"),
      createShaderEdge("gs6-e-th-heighttint", "tree-height", "value", "height-tint", "alpha"),

      // Sun dot / mask
      createShaderEdge("gs6-e-n-sundot", "world-normal", "value", "sun-dot", "a"),
      createShaderEdge("gs6-e-sun-sundot", "sun-direction", "value", "sun-dot", "b"),
      createShaderEdge("gs6-e-sundot-mask", "sun-dot", "value", "sun-mask", "input"),

      // Warm scalar + term
      createShaderEdge("gs6-e-warmstrength-scalar", "warm-strength", "value", "warm-scalar", "a"),
      createShaderEdge("gs6-e-sunmask-scalar", "sun-mask", "value", "warm-scalar", "b"),
      createShaderEdge("gs6-e-warmcolor-term", "warm-color", "value", "warm-term", "a"),
      createShaderEdge("gs6-e-warmscalar-term", "warm-scalar", "value", "warm-term", "b"),

      // Rim fresnel + term
      createShaderEdge("gs6-e-n-rim", "world-normal", "value", "rim-fresnel", "normal"),
      createShaderEdge("gs6-e-v-rim", "view-direction", "value", "rim-fresnel", "viewDirection"),
      createShaderEdge("gs6-e-rimcolor-rim", "rim-color", "value", "rim-fresnel", "color"),
      createShaderEdge("gs6-e-rimfresnel-term", "rim-fresnel", "value", "rim-term", "a"),
      createShaderEdge("gs6-e-rimstrength-term", "rim-strength", "value", "rim-term", "b"),

      // Combine lit = base + warm + rim
      createShaderEdge("gs6-e-warm-plus-rim-a", "warm-term", "value", "warm-plus-rim", "a"),
      createShaderEdge("gs6-e-warm-plus-rim-b", "rim-term", "value", "warm-plus-rim", "b"),
      createShaderEdge("gs6-e-base-lit", "height-tint", "value", "lit", "a"),
      createShaderEdge("gs6-e-warmrim-lit", "warm-plus-rim", "value", "lit", "b"),

      // World-noise
      createShaderEdge("gs6-e-worldpos-noise", "world-position", "value", "world-noise", "position"),
      createShaderEdge("gs6-e-macrodark-tint", "macro-dark", "value", "macro-tint", "a"),
      createShaderEdge("gs6-e-macrolight-tint", "macro-light", "value", "macro-tint", "b"),
      createShaderEdge("gs6-e-noise-tint", "world-noise", "value", "macro-tint", "alpha"),

      // lit × macroTint
      createShaderEdge("gs6-e-lit-macro-a", "lit", "value", "lit-macro", "a"),
      createShaderEdge("gs6-e-lit-macro-b", "macro-tint", "value", "lit-macro", "b"),

      // Final: (lit × macro) × texture.color — texture luminance adds painterly grain
      createShaderEdge("gs6-e-litmacro-final", "lit-macro", "value", "final-color", "a"),
      createShaderEdge("gs6-e-texture-final", "blade-texture", "color", "final-color", "b"),

      // Diffuse tint path: mesh UV → split → scale per-component → recombine
      createShaderEdge("gs6-e-meshuv-split", "diffuse-mesh-uv", "value", "split-mesh-uv", "input"),
      createShaderEdge("gs6-e-uv-x-a", "split-mesh-uv", "x", "uv-x-scaled", "a"),
      createShaderEdge("gs6-e-uv-x-b", "diffuse-tiling", "value", "uv-x-scaled", "b"),
      createShaderEdge("gs6-e-uv-y-a", "split-mesh-uv", "y", "uv-y-scaled", "a"),
      createShaderEdge("gs6-e-uv-y-b", "diffuse-tiling", "value", "uv-y-scaled", "b"),
      createShaderEdge("gs6-e-uv-combine-x", "uv-x-scaled", "value", "diffuse-uv", "x"),
      createShaderEdge("gs6-e-uv-combine-y", "uv-y-scaled", "value", "diffuse-uv", "y"),
      createShaderEdge("gs6-e-diffuse-uv-input", "diffuse-uv", "vec2", "diffuse-texture", "uv"),
      createShaderEdge("gs6-e-diffuse-boost-a", "diffuse-texture", "color", "diffuse-boosted", "a"),
      createShaderEdge("gs6-e-diffuse-boost-b", "diffuse-boost-color", "value", "diffuse-boosted", "b"),
      createShaderEdge("gs6-e-factor-a", "diffuse-identity", "value", "diffuse-factor", "a"),
      createShaderEdge("gs6-e-factor-b", "diffuse-boosted", "value", "diffuse-factor", "b"),
      createShaderEdge("gs6-e-factor-alpha", "diffuse-strength", "value", "diffuse-factor", "alpha"),
      createShaderEdge("gs6-e-final-diffuse-a", "final-color", "value", "final-with-diffuse", "a"),
      createShaderEdge("gs6-e-final-diffuse-b", "diffuse-factor", "value", "final-with-diffuse", "b"),

      // Base fade with noise-jittered cutoff:
      //   noise = worldNoise(worldPos × 8) ∈ [0, 1]
      //   offset = noise - 0.5 ∈ [-0.5, 0.5]
      //   scaled = offset × baseFadeJitter
      //   jitteredHeight = treeHeight + scaled
      //   fade = smoothstep(0, baseFadeEnd, jitteredHeight)
      //   alpha = textureAlpha × fade
      createShaderEdge("gs6-e-fade-noise-pos", "world-position", "value", "fine-noise", "position"),
      createShaderEdge("gs6-e-fade-noise-a", "fine-noise", "value", "fade-noise-offset", "a"),
      createShaderEdge("gs6-e-fade-noise-b", "fade-noise-center", "value", "fade-noise-offset", "b"),
      createShaderEdge("gs6-e-fade-jitter-a", "fade-noise-offset", "value", "fade-jitter-scaled", "a"),
      createShaderEdge("gs6-e-fade-jitter-b", "fade-jitter-amount", "value", "fade-jitter-scaled", "b"),
      createShaderEdge("gs6-e-fade-height-a", "tree-height", "value", "fade-height-jittered", "a"),
      createShaderEdge("gs6-e-fade-height-b", "fade-jitter-scaled", "value", "fade-height-jittered", "b"),
      createShaderEdge("gs6-e-fade-edge0", "fade-edge-start", "value", "base-fade", "edge0"),
      createShaderEdge("gs6-e-fade-edge1", "fade-edge-end", "value", "base-fade", "edge1"),
      createShaderEdge("gs6-e-fade-x", "fade-height-jittered", "value", "base-fade", "x"),
      createShaderEdge("gs6-e-fade-alpha-a", "blade-texture", "alpha", "faded-alpha", "a"),
      createShaderEdge("gs6-e-fade-alpha-b", "base-fade", "value", "faded-alpha", "b"),

      // Output color + faded alpha
      createShaderEdge("gs6-e-color-output", "final-with-diffuse", "value", "output", "color"),
      createShaderEdge("gs6-e-alpha-output", "faded-alpha", "value", "output", "alpha")
    ],
    parameters: [
      {
        parameterId: "bladeTexture",
        displayName: "Blade Texture",
        dataType: "texture2d",
        textureRole: "color",
        defaultValue: null
      },
      {
        parameterId: "rootTint",
        displayName: "Root Tint",
        dataType: "color",
        colorSpace: "hdr",
        defaultValue: [0.36, 0.52, 0.24],
        inheritSource: "baseLayerColor"
      },
      {
        parameterId: "tipTint",
        displayName: "Tip Tint",
        dataType: "color",
        colorSpace: "hdr",
        defaultValue: [0.84, 0.91, 0.58]
      },
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
        defaultValue: 0.25
      },
      {
        parameterId: "rimColor",
        displayName: "Rim Color",
        dataType: "color",
        colorSpace: "hdr",
        defaultValue: [0.88, 0.96, 0.72]
      },
      {
        parameterId: "rimStrength",
        displayName: "Rim Strength",
        dataType: "float",
        defaultValue: 0.3
      },
      {
        parameterId: "macroDarkColor",
        displayName: "Macro Dark Tint",
        dataType: "color",
        colorSpace: "hdr",
        defaultValue: [0.5, 0.68, 0.42]
      },
      {
        parameterId: "macroLightColor",
        displayName: "Macro Light Tint",
        dataType: "color",
        colorSpace: "hdr",
        defaultValue: [1.4, 1.22, 0.74]
      },
      {
        parameterId: "baseFadeEnd",
        displayName: "Base Fade End",
        dataType: "float",
        defaultValue: 0.4
      },
      {
        parameterId: "baseFadeJitter",
        displayName: "Base Fade Jitter",
        dataType: "float",
        defaultValue: 0.0
      },
      {
        parameterId: "diffuseTexture",
        displayName: "Diffuse Tint Texture",
        dataType: "texture2d",
        textureRole: "color",
        defaultValue: null
      },
      {
        parameterId: "diffuseTiling",
        displayName: "Diffuse Tiling",
        dataType: "float",
        defaultValue: 3.0
      },
      {
        parameterId: "diffuseStrength",
        displayName: "Diffuse Strength",
        dataType: "float",
        defaultValue: 0.0
      }
    ],
    metadata: { builtIn: true, builtInKey: "grass-surface-6", blendMode: "blend" }
  };
}

interface BuiltInGrassSurfacePreset {
  shaderDefinitionId: string;
  displayName: string;
  builtInKey: string;
  rootTint: [number, number, number];
  tipTint: [number, number, number];
  sunColor: [number, number, number];
  sunStrength: number;
  tipBoostColor: [number, number, number];
  tipBoostStrength: number;
  rimColor: [number, number, number];
  rimStrength: number;
}

/**
 * Shared painterly grass surface graph.
 *
 * This is the canonical stylized scatter-surface shape for grass-like
 * instances. It preserves the GrassTypeDefinition's authored vertex colors,
 * then layers on painterly tinting, warm sun, tip brightening, and a soft rim
 * so grass lands in the same visual family as the foliage surface shaders.
 */
function createBuiltInGrassSurfaceShaderGraph(
  preset: BuiltInGrassSurfacePreset
): ShaderGraphDocument {
  return {
    shaderDefinitionId: preset.shaderDefinitionId,
    definitionKind: "shader",
    displayName: preset.displayName,
    targetKind: "mesh-surface",
    revision: 1,
    nodes: [
      { nodeId: "vertex-color", nodeType: "input.vertex-color", position: { x: 48, y: 200 }, settings: {} },
      { nodeId: "split-vertex-color", nodeType: "math.split-vector", position: { x: 256, y: 200 }, settings: {} },
      { nodeId: "vertex-rgb", nodeType: "math.combine-vector", position: { x: 480, y: 200 }, settings: {} },
      { nodeId: "tree-height", nodeType: "input.tree-height", position: { x: 48, y: 56 }, settings: {} },
      { nodeId: "world-normal", nodeType: "input.world-normal", position: { x: 48, y: 360 }, settings: {} },
      { nodeId: "sun-direction", nodeType: "input.sun-direction", position: { x: 48, y: 456 }, settings: {} },
      { nodeId: "view-direction", nodeType: "input.view-direction", position: { x: 48, y: 552 }, settings: {} },

      { nodeId: "root-tint", nodeType: "input.parameter", position: { x: 256, y: 0 }, settings: { parameterId: "rootTint" } },
      { nodeId: "tip-tint", nodeType: "input.parameter", position: { x: 256, y: 96 }, settings: { parameterId: "tipTint" } },
      { nodeId: "height-tint", nodeType: "math.lerp", position: { x: 480, y: 56 }, settings: {} },
      { nodeId: "tinted-base", nodeType: "color.multiply", position: { x: 704, y: 160 }, settings: {} },

      { nodeId: "sun-color", nodeType: "input.parameter", position: { x: 256, y: 240 }, settings: { parameterId: "sunColor" } },
      { nodeId: "sun-strength", nodeType: "input.parameter", position: { x: 256, y: 320 }, settings: { parameterId: "sunStrength" } },
      { nodeId: "sun-dot", nodeType: "math.dot", position: { x: 256, y: 432 }, settings: {} },
      { nodeId: "sun-mask", nodeType: "math.saturate", position: { x: 480, y: 432 }, settings: {} },
      { nodeId: "sun-scalar", nodeType: "math.multiply", position: { x: 704, y: 376 }, settings: {} },
      { nodeId: "sun-term", nodeType: "color.multiply", position: { x: 928, y: 312 }, settings: {} },

      { nodeId: "tip-boost-color", nodeType: "input.parameter", position: { x: 256, y: 648 }, settings: { parameterId: "tipBoostColor" } },
      { nodeId: "tip-boost-strength", nodeType: "input.parameter", position: { x: 256, y: 728 }, settings: { parameterId: "tipBoostStrength" } },
      { nodeId: "tip-boost-scalar", nodeType: "math.multiply", position: { x: 480, y: 696 }, settings: {} },
      { nodeId: "tip-boost-term", nodeType: "color.multiply", position: { x: 704, y: 648 }, settings: {} },

      { nodeId: "rim-color", nodeType: "input.parameter", position: { x: 928, y: 536 }, settings: { parameterId: "rimColor" } },
      { nodeId: "rim-strength", nodeType: "input.parameter", position: { x: 928, y: 632 }, settings: { parameterId: "rimStrength" } },
      {
        nodeId: "rim-fresnel",
        nodeType: "effect.fresnel",
        position: { x: 1168, y: 520 },
        settings: { power: 2.1, strength: 1.0 }
      },
      { nodeId: "rim-term", nodeType: "color.multiply", position: { x: 1408, y: 576 }, settings: {} },

      { nodeId: "base-plus-sun", nodeType: "color.add", position: { x: 1168, y: 200 }, settings: {} },
      { nodeId: "base-plus-sun-plus-tip", nodeType: "color.add", position: { x: 1408, y: 264 }, settings: {} },
      { nodeId: "final-color", nodeType: "color.add", position: { x: 1648, y: 360 }, settings: {} },
      { nodeId: "output", nodeType: "output.fragment", position: { x: 1888, y: 360 }, settings: {} }
    ],
    edges: [
      createShaderEdge("e-vertexcolor-split", "vertex-color", "value", "split-vertex-color", "input"),
      createShaderEdge("e-splitvertex-x-rgb", "split-vertex-color", "x", "vertex-rgb", "x"),
      createShaderEdge("e-splitvertex-y-rgb", "split-vertex-color", "y", "vertex-rgb", "y"),
      createShaderEdge("e-splitvertex-z-rgb", "split-vertex-color", "z", "vertex-rgb", "z"),
      createShaderEdge("e-root-heighttint", "root-tint", "value", "height-tint", "a"),
      createShaderEdge("e-tip-heighttint", "tip-tint", "value", "height-tint", "b"),
      createShaderEdge("e-treeheight-heighttint", "tree-height", "value", "height-tint", "alpha"),
      createShaderEdge("e-vertexcolor-tintedbase", "vertex-rgb", "vec3", "tinted-base", "a"),
      createShaderEdge("e-heighttint-tintedbase", "height-tint", "value", "tinted-base", "b"),

      createShaderEdge("e-normal-sundot", "world-normal", "value", "sun-dot", "a"),
      createShaderEdge("e-sundir-sundot", "sun-direction", "value", "sun-dot", "b"),
      createShaderEdge("e-sundot-sunmask", "sun-dot", "value", "sun-mask", "input"),
      createShaderEdge("e-sunmask-sunscalar", "sun-mask", "value", "sun-scalar", "a"),
      createShaderEdge("e-sunstrength-sunscalar", "sun-strength", "value", "sun-scalar", "b"),
      createShaderEdge("e-suncolor-sunterm", "sun-color", "value", "sun-term", "a"),
      createShaderEdge("e-sunscalar-sunterm", "sun-scalar", "value", "sun-term", "b"),

      createShaderEdge("e-treeheight-tipboostscalar", "tree-height", "value", "tip-boost-scalar", "a"),
      createShaderEdge("e-tipbooststrength-tipboostscalar", "tip-boost-strength", "value", "tip-boost-scalar", "b"),
      createShaderEdge("e-tipboostcolor-tipboostterm", "tip-boost-color", "value", "tip-boost-term", "a"),
      createShaderEdge("e-tipboostscalar-tipboostterm", "tip-boost-scalar", "value", "tip-boost-term", "b"),

      createShaderEdge("e-normal-rimfresnel", "world-normal", "value", "rim-fresnel", "normal"),
      createShaderEdge("e-view-rimfresnel", "view-direction", "value", "rim-fresnel", "viewDirection"),
      createShaderEdge("e-rimcolor-rimfresnel", "rim-color", "value", "rim-fresnel", "color"),
      createShaderEdge("e-rimfresnel-rimterm", "rim-fresnel", "value", "rim-term", "a"),
      createShaderEdge("e-rimstrength-rimterm", "rim-strength", "value", "rim-term", "b"),

      createShaderEdge("e-tintedbase-baseplussun", "tinted-base", "value", "base-plus-sun", "a"),
      createShaderEdge("e-sunterm-baseplussun", "sun-term", "value", "base-plus-sun", "b"),
      createShaderEdge("e-baseplussun-baseplussunplustip", "base-plus-sun", "value", "base-plus-sun-plus-tip", "a"),
      createShaderEdge("e-tipboostterm-baseplussunplustip", "tip-boost-term", "value", "base-plus-sun-plus-tip", "b"),
      createShaderEdge("e-baseplussunplustip-final", "base-plus-sun-plus-tip", "value", "final-color", "a"),
      createShaderEdge("e-rimterm-final", "rim-term", "value", "final-color", "b"),
      createShaderEdge("e-final-output", "final-color", "value", "output", "color")
    ],
    parameters: [
      {
        parameterId: "rootTint",
        displayName: "Root Tint",
        dataType: "color",
        colorSpace: "hdr",
        defaultValue: preset.rootTint
      },
      {
        parameterId: "tipTint",
        displayName: "Tip Tint",
        dataType: "color",
        colorSpace: "hdr",
        defaultValue: preset.tipTint
      },
      {
        parameterId: "sunColor",
        displayName: "Sun Color",
        dataType: "color",
        colorSpace: "hdr",
        defaultValue: preset.sunColor
      },
      {
        parameterId: "sunStrength",
        displayName: "Sun Strength",
        dataType: "float",
        defaultValue: preset.sunStrength
      },
      {
        parameterId: "tipBoostColor",
        displayName: "Tip Boost Color",
        dataType: "color",
        colorSpace: "hdr",
        defaultValue: preset.tipBoostColor
      },
      {
        parameterId: "tipBoostStrength",
        displayName: "Tip Boost Strength",
        dataType: "float",
        defaultValue: preset.tipBoostStrength
      },
      {
        parameterId: "rimColor",
        displayName: "Rim Color",
        dataType: "color",
        colorSpace: "hdr",
        defaultValue: preset.rimColor
      },
      {
        parameterId: "rimStrength",
        displayName: "Rim Strength",
        dataType: "float",
        defaultValue: preset.rimStrength
      }
    ],
    metadata: {
      builtIn: true,
      builtInKey: preset.builtInKey
    }
  };
}

/**
 * Meadow Grass: soft cool-to-warm greens with painterly tips and a modest
 * warm sun term. This is the neutral default that should sit comfortably next
 * to the foliage surface family in spring/summer scenes.
 */
export function createDefaultMeadowGrassShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  return createBuiltInGrassSurfaceShaderGraph({
    shaderDefinitionId:
      options.shaderDefinitionId ?? `${projectId}:shader:meadow-grass`,
    displayName: options.displayName ?? "Meadow Grass",
    builtInKey: "meadow-grass",
    rootTint: [0.72, 0.9, 0.72],
    tipTint: [1.08, 1.18, 0.86],
    sunColor: [1.22, 1.08, 0.72],
    sunStrength: 0.28,
    tipBoostColor: [1.12, 1.14, 0.8],
    tipBoostStrength: 0.16,
    rimColor: [0.88, 0.96, 0.82],
    rimStrength: 0.12
  });
}

/**
 * Sunlit Lawn: a brighter, cleaner lawn look with stronger top-lighting and a
 * lighter value range for the broad sunlit fields in the refs.
 */
export function createDefaultSunlitLawnShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  return createBuiltInGrassSurfaceShaderGraph({
    shaderDefinitionId:
      options.shaderDefinitionId ?? `${projectId}:shader:sunlit-lawn`,
    displayName: options.displayName ?? "Sunlit Lawn",
    builtInKey: "sunlit-lawn",
    rootTint: [0.86, 1.04, 0.76],
    tipTint: [1.22, 1.32, 0.92],
    sunColor: [1.36, 1.18, 0.76],
    sunStrength: 0.38,
    tipBoostColor: [1.2, 1.22, 0.82],
    tipBoostStrength: 0.22,
    rimColor: [0.92, 1.0, 0.86],
    rimStrength: 0.16
  });
}

/**
 * Autumn Field Grass: warm ochres and golds tuned for broad painterly field
 * reads that still keep some base-to-tip separation.
 */
export function createDefaultAutumnFieldGrassShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  return createBuiltInGrassSurfaceShaderGraph({
    shaderDefinitionId:
      options.shaderDefinitionId ?? `${projectId}:shader:autumn-field-grass`,
    displayName: options.displayName ?? "Autumn Field Grass",
    builtInKey: "autumn-field-grass",
    rootTint: [0.98, 0.82, 0.58],
    tipTint: [1.28, 1.0, 0.62],
    sunColor: [1.42, 1.02, 0.58],
    sunStrength: 0.26,
    tipBoostColor: [1.32, 1.04, 0.68],
    tipBoostStrength: 0.18,
    rimColor: [1.0, 0.9, 0.72],
    rimStrength: 0.1
  });
}

/**
 * Painterly Grass: a more stylized scatter look with brighter tip lift,
 * softer root-to-tip banding, and a stronger soft rim so a dedicated
 * painterly surface can be added without disturbing the existing starter
 * meadow/lawn/field looks.
 */
export function createDefaultPainterlyGrassShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  const shaderDefinitionId =
    options.shaderDefinitionId ?? `${projectId}:shader:painterly-grass`;

  return {
    shaderDefinitionId,
    definitionKind: "shader",
    displayName: options.displayName ?? "Painterly Grass",
    targetKind: "mesh-surface",
    revision: 2,
    nodes: [
      { nodeId: "vertex-color", nodeType: "input.vertex-color", position: { x: 48, y: 240 }, settings: {} },
      { nodeId: "split-vertex-color", nodeType: "math.split-vector", position: { x: 256, y: 240 }, settings: {} },
      { nodeId: "vertex-rgb", nodeType: "math.combine-vector", position: { x: 448, y: 240 }, settings: {} },
      { nodeId: "tree-height", nodeType: "input.tree-height", position: { x: 48, y: 80 }, settings: {} },
      { nodeId: "uv", nodeType: "input.uv", position: { x: 48, y: 560 }, settings: {} },
      { nodeId: "split-uv", nodeType: "math.split-vector", position: { x: 256, y: 560 }, settings: {} },
      { nodeId: "world-normal", nodeType: "input.world-normal", position: { x: 48, y: 400 }, settings: {} },
      { nodeId: "sun-direction", nodeType: "input.sun-direction", position: { x: 48, y: 720 }, settings: {} },
      { nodeId: "view-direction", nodeType: "input.view-direction", position: { x: 48, y: 820 }, settings: {} },

      { nodeId: "root-tint", nodeType: "input.parameter", position: { x: 256, y: 24 }, settings: { parameterId: "rootTint" } },
      { nodeId: "tip-tint", nodeType: "input.parameter", position: { x: 256, y: 104 }, settings: { parameterId: "tipTint" } },
      { nodeId: "height-tint", nodeType: "math.lerp", position: { x: 672, y: 64 }, settings: {} },
      { nodeId: "base-color", nodeType: "color.multiply", position: { x: 896, y: 168 }, settings: {} },

      { nodeId: "base-shade", nodeType: "input.parameter", position: { x: 448, y: 360 }, settings: { parameterId: "baseShade" } },
      { nodeId: "tip-shade", nodeType: "input.parameter", position: { x: 448, y: 440 }, settings: { parameterId: "tipShade" } },
      { nodeId: "vertical-shade", nodeType: "math.lerp", position: { x: 672, y: 408 }, settings: {} },
      { nodeId: "shaded-base", nodeType: "color.multiply", position: { x: 1120, y: 200 }, settings: {} },

      { nodeId: "sun-dot", nodeType: "math.dot", position: { x: 256, y: 720 }, settings: {} },
      { nodeId: "sun-dot-abs", nodeType: "math.abs", position: { x: 448, y: 720 }, settings: {} },
      { nodeId: "sun-mask", nodeType: "math.saturate", position: { x: 672, y: 720 }, settings: {} },
      { nodeId: "sun-strength", nodeType: "input.parameter", position: { x: 448, y: 804 }, settings: { parameterId: "sunStrength" } },
      { nodeId: "sun-scalar", nodeType: "math.multiply", position: { x: 896, y: 760 }, settings: {} },
      { nodeId: "sun-color", nodeType: "input.parameter", position: { x: 896, y: 664 }, settings: { parameterId: "sunColor" } },
      { nodeId: "sun-term", nodeType: "color.multiply", position: { x: 1120, y: 680 }, settings: {} },

      { nodeId: "tip-boost-color", nodeType: "input.parameter", position: { x: 896, y: 360 }, settings: { parameterId: "tipBoostColor" } },
      { nodeId: "tip-boost-strength", nodeType: "input.parameter", position: { x: 896, y: 456 }, settings: { parameterId: "tipBoostStrength" } },
      { nodeId: "tip-boost-scalar", nodeType: "math.multiply", position: { x: 1120, y: 456 }, settings: {} },
      { nodeId: "tip-boost-term", nodeType: "color.multiply", position: { x: 1344, y: 392 }, settings: {} },

      { nodeId: "rim-color", nodeType: "input.parameter", position: { x: 896, y: 920 }, settings: { parameterId: "rimColor" } },
      { nodeId: "rim-strength", nodeType: "input.parameter", position: { x: 1120, y: 920 }, settings: { parameterId: "rimStrength" } },
      {
        nodeId: "rim-fresnel",
        nodeType: "effect.fresnel",
        position: { x: 1120, y: 820 },
        settings: { power: 1.6, strength: 1.0 }
      },
      { nodeId: "rim-term", nodeType: "color.multiply", position: { x: 1344, y: 840 }, settings: {} },

      { nodeId: "center-x", nodeType: "math.subtract", position: { x: 448, y: 560 }, settings: {} },
      { nodeId: "half", nodeType: "input.parameter", position: { x: 448, y: 640 }, settings: { parameterId: "halfValue" } },
      { nodeId: "abs-x", nodeType: "math.abs", position: { x: 672, y: 560 }, settings: {} },
      { nodeId: "root-width", nodeType: "input.parameter", position: { x: 672, y: 880 }, settings: { parameterId: "rootWidth" } },
      { nodeId: "tip-width", nodeType: "input.parameter", position: { x: 672, y: 960 }, settings: { parameterId: "tipWidth" } },
      { nodeId: "width-delta", nodeType: "math.subtract", position: { x: 896, y: 920 }, settings: {} },
      { nodeId: "width-scale", nodeType: "math.multiply", position: { x: 1120, y: 960 }, settings: {} },
      { nodeId: "width-at-height", nodeType: "math.add", position: { x: 1344, y: 920 }, settings: {} },
      { nodeId: "distance-to-edge", nodeType: "math.subtract", position: { x: 1120, y: 560 }, settings: {} },
      { nodeId: "edge-softness", nodeType: "input.parameter", position: { x: 1120, y: 640 }, settings: { parameterId: "edgeSoftness" } },
      { nodeId: "alpha-divide", nodeType: "math.divide", position: { x: 1344, y: 560 }, settings: {} },
      { nodeId: "alpha-mask", nodeType: "math.clamp", position: { x: 1568, y: 560 }, settings: {} },

      { nodeId: "base-plus-sun", nodeType: "color.add", position: { x: 1568, y: 200 }, settings: {} },
      { nodeId: "base-plus-sun-plus-tip", nodeType: "color.add", position: { x: 1792, y: 296 }, settings: {} },
      { nodeId: "final-color", nodeType: "color.add", position: { x: 2016, y: 424 }, settings: {} },
      { nodeId: "output", nodeType: "output.fragment", position: { x: 2240, y: 424 }, settings: {} }
    ],
    edges: [
      createShaderEdge("e-vertexcolor-split", "vertex-color", "value", "split-vertex-color", "input"),
      createShaderEdge("e-vertexsplit-x", "split-vertex-color", "x", "vertex-rgb", "x"),
      createShaderEdge("e-vertexsplit-y", "split-vertex-color", "y", "vertex-rgb", "y"),
      createShaderEdge("e-vertexsplit-z", "split-vertex-color", "z", "vertex-rgb", "z"),
      createShaderEdge("e-uv-splituv", "uv", "value", "split-uv", "input"),

      createShaderEdge("e-root-heighttint", "root-tint", "value", "height-tint", "a"),
      createShaderEdge("e-tip-heighttint", "tip-tint", "value", "height-tint", "b"),
      createShaderEdge("e-treeheight-heighttint", "tree-height", "value", "height-tint", "alpha"),
      createShaderEdge("e-vertexrgb-basecolor", "vertex-rgb", "vec3", "base-color", "a"),
      createShaderEdge("e-heighttint-basecolor", "height-tint", "value", "base-color", "b"),

      createShaderEdge("e-baseshade-verticalshade", "base-shade", "value", "vertical-shade", "a"),
      createShaderEdge("e-tipshade-verticalshade", "tip-shade", "value", "vertical-shade", "b"),
      createShaderEdge("e-uvy-verticalshade", "split-uv", "y", "vertical-shade", "alpha"),
      createShaderEdge("e-basecolor-shadedbase", "base-color", "value", "shaded-base", "a"),
      createShaderEdge("e-verticalshade-shadedbase", "vertical-shade", "value", "shaded-base", "b"),

      createShaderEdge("e-normal-sundot", "world-normal", "value", "sun-dot", "a"),
      createShaderEdge("e-sundir-sundot", "sun-direction", "value", "sun-dot", "b"),
      createShaderEdge("e-sundot-abs", "sun-dot", "value", "sun-dot-abs", "input"),
      createShaderEdge("e-sundotabs-sunmask", "sun-dot-abs", "value", "sun-mask", "input"),
      createShaderEdge("e-sunmask-sunscalar", "sun-mask", "value", "sun-scalar", "a"),
      createShaderEdge("e-sunstrength-sunscalar", "sun-strength", "value", "sun-scalar", "b"),
      createShaderEdge("e-suncolor-sunterm", "sun-color", "value", "sun-term", "a"),
      createShaderEdge("e-sunscalar-sunterm", "sun-scalar", "value", "sun-term", "b"),

      createShaderEdge("e-treeheight-tipboostscalar", "tree-height", "value", "tip-boost-scalar", "a"),
      createShaderEdge("e-tipbooststrength-tipboostscalar", "tip-boost-strength", "value", "tip-boost-scalar", "b"),
      createShaderEdge("e-tipboostcolor-tipboostterm", "tip-boost-color", "value", "tip-boost-term", "a"),
      createShaderEdge("e-tipboostscalar-tipboostterm", "tip-boost-scalar", "value", "tip-boost-term", "b"),

      createShaderEdge("e-normal-rimfresnel", "world-normal", "value", "rim-fresnel", "normal"),
      createShaderEdge("e-view-rimfresnel", "view-direction", "value", "rim-fresnel", "viewDirection"),
      createShaderEdge("e-rimcolor-rimfresnel", "rim-color", "value", "rim-fresnel", "color"),
      createShaderEdge("e-rimfresnel-rimterm", "rim-fresnel", "value", "rim-term", "a"),
      createShaderEdge("e-rimstrength-rimterm", "rim-strength", "value", "rim-term", "b"),

      createShaderEdge("e-half-centerx", "half", "value", "center-x", "a"),
      createShaderEdge("e-uvx-centerx", "split-uv", "x", "center-x", "b"),
      createShaderEdge("e-centerx-absx", "center-x", "value", "abs-x", "input"),
      createShaderEdge("e-tipwidth-widthdelta", "tip-width", "value", "width-delta", "a"),
      createShaderEdge("e-rootwidth-widthdelta", "root-width", "value", "width-delta", "b"),
      createShaderEdge("e-widthdelta-widthscale", "width-delta", "value", "width-scale", "a"),
      createShaderEdge("e-uvy-widthscale", "split-uv", "y", "width-scale", "b"),
      createShaderEdge("e-rootwidth-widthatheight", "root-width", "value", "width-at-height", "a"),
      createShaderEdge("e-widthscale-widthatheight", "width-scale", "value", "width-at-height", "b"),
      createShaderEdge("e-widthatheight-distancetoedge", "width-at-height", "value", "distance-to-edge", "a"),
      createShaderEdge("e-absx-distancetoedge", "abs-x", "value", "distance-to-edge", "b"),
      createShaderEdge("e-distancetoedge-alphadivide", "distance-to-edge", "value", "alpha-divide", "a"),
      createShaderEdge("e-edgesoftness-alphadivide", "edge-softness", "value", "alpha-divide", "b"),
      createShaderEdge("e-alphadivide-alphamask", "alpha-divide", "value", "alpha-mask", "input"),

      createShaderEdge("e-shadedbase-baseplussun", "shaded-base", "value", "base-plus-sun", "a"),
      createShaderEdge("e-sunterm-baseplussun", "sun-term", "value", "base-plus-sun", "b"),
      createShaderEdge("e-baseplussun-baseplussunplustip", "base-plus-sun", "value", "base-plus-sun-plus-tip", "a"),
      createShaderEdge("e-tipboostterm-baseplussunplustip", "tip-boost-term", "value", "base-plus-sun-plus-tip", "b"),
      createShaderEdge("e-baseplussunplustip-final", "base-plus-sun-plus-tip", "value", "final-color", "a"),
      createShaderEdge("e-rimterm-final", "rim-term", "value", "final-color", "b"),

      createShaderEdge("e-final-output", "final-color", "value", "output", "color"),
      createShaderEdge("e-alpha-output", "alpha-mask", "value", "output", "alpha")
    ],
    parameters: [
      {
        parameterId: "rootTint",
        displayName: "Root Tint",
        dataType: "color",
        colorSpace: "hdr",
        defaultValue: [0.88, 0.98, 0.78]
      },
      {
        parameterId: "tipTint",
        displayName: "Tip Tint",
        dataType: "color",
        colorSpace: "hdr",
        defaultValue: [1.26, 1.34, 0.96]
      },
      {
        parameterId: "baseShade",
        displayName: "Base Shade",
        dataType: "float",
        defaultValue: 0.58
      },
      {
        parameterId: "tipShade",
        displayName: "Tip Shade",
        dataType: "float",
        defaultValue: 1.06
      },
      {
        parameterId: "sunColor",
        displayName: "Sun Color",
        dataType: "color",
        colorSpace: "hdr",
        defaultValue: [1.42, 1.22, 0.76]
      },
      {
        parameterId: "sunStrength",
        displayName: "Sun Strength",
        dataType: "float",
        defaultValue: 0.34
      },
      {
        parameterId: "tipBoostColor",
        displayName: "Tip Boost Color",
        dataType: "color",
        colorSpace: "hdr",
        defaultValue: [1.18, 1.24, 0.92]
      },
      {
        parameterId: "tipBoostStrength",
        displayName: "Tip Boost Strength",
        dataType: "float",
        defaultValue: 0.22
      },
      {
        parameterId: "rimColor",
        displayName: "Rim Color",
        dataType: "color",
        colorSpace: "hdr",
        defaultValue: [0.94, 1, 0.9]
      },
      {
        parameterId: "rimStrength",
        displayName: "Rim Strength",
        dataType: "float",
        defaultValue: 0.18
      },
      {
        parameterId: "halfValue",
        displayName: "Half",
        dataType: "float",
        defaultValue: 0.5
      },
      {
        parameterId: "rootWidth",
        displayName: "Root Width",
        dataType: "float",
        defaultValue: 0.48
      },
      {
        parameterId: "tipWidth",
        displayName: "Tip Width",
        dataType: "float",
        defaultValue: 0.025
      },
      {
        parameterId: "edgeSoftness",
        displayName: "Edge Softness",
        dataType: "float",
        defaultValue: 0.16
      }
    ],
    metadata: {
      builtIn: true,
      builtInKey: "painterly-grass"
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

  // Painterly foliage shader. Three stacked effects combine to produce the
  // soft volumetric look from the reference:
  //   1. Tree-wide top-warm / bottom-cool gradient driven by the
  //      FoilageMaker-baked _TREE_HEIGHT vertex attribute (0..1 along the
  //      tree). Multiplies into base color so the whole canopy shades
  //      warm at top and cool at bottom.
  //   2. Per-cluster volumetric lighting using the _SPHERE_NORMAL attribute
  //      baked at export — each leaf cluster lights as if it were a smooth
  //      sphere, not a cloud of flat cards. Blended with the real leaf
  //      world-normal via individualNormalsFactor so a hint of card
  //      silhouette remains.
  //   3. Warm-sun-term + rim-fresnel (unchanged in spirit from v1) both now
  //      driven off the blended sphere/leaf normal, giving smoother
  //      highlight falloff across each cluster.
  return {
    shaderDefinitionId,
    definitionKind: "shader",
    displayName: options.displayName ?? "Foliage Surface",
    targetKind: "mesh-surface",
    revision: 3,
    nodes: [
      createMaterialTextureNode("leaf-texture", "baseColorTexture", { x: 48, y: 156 }),
      { nodeId: "vertex-color", nodeType: "input.vertex-color", position: { x: 48, y: 340 }, settings: {} },
      { nodeId: "split-vertex-color", nodeType: "math.split-vector", position: { x: 248, y: 340 }, settings: {} },
      { nodeId: "canopy-tint", nodeType: "math.combine-vector", position: { x: 448, y: 232 }, settings: {} },
      // Canopy tint acts as a brightness modulator only, not a hue source.
      // This lets the tree-wide gradient provide the dominant hue (warm top,
      // cool bottom) while preserving FoilageMaker's interior-darker /
      // exterior-brighter per-cluster shading.
      { nodeId: "canopy-luminance", nodeType: "color.luminance", position: { x: 656, y: 232 }, settings: {} },

      // Tree-wide height gradient: mix(bottomColor, topColor, treeHeight)
      { nodeId: "tree-height", nodeType: "input.tree-height", position: { x: 48, y: 60 }, settings: {} },
      { nodeId: "top-color", nodeType: "input.parameter", position: { x: 48, y: 0 }, settings: { parameterId: "topColor" } },
      { nodeId: "bottom-color", nodeType: "input.parameter", position: { x: 248, y: 0 }, settings: { parameterId: "bottomColor" } },
      { nodeId: "height-gradient", nodeType: "math.lerp", position: { x: 448, y: 40 }, settings: {} },
      // gradient * canopyLuminance gives us the painterly hue gradient
      // multiplied by per-cluster brightness. Leaf texture is then multiplied
      // in for leaf silhouette texture (mostly white where opaque, so this is
      // a near-no-op for color but keeps any in-leaf detail).
      { nodeId: "gradient-times-lum", nodeType: "color.multiply", position: { x: 656, y: 60 }, settings: {} },
      { nodeId: "base-color", nodeType: "color.multiply", position: { x: 864, y: 160 }, settings: {} },

      // Blended sphere/leaf normal for painterly volumetric shading.
      { nodeId: "sphere-normal", nodeType: "input.sphere-normal", position: { x: 48, y: 480 }, settings: {} },
      { nodeId: "world-normal", nodeType: "input.world-normal", position: { x: 48, y: 556 }, settings: {} },
      { nodeId: "individual-normals-factor", nodeType: "input.parameter", position: { x: 48, y: 420 }, settings: { parameterId: "individualNormalsFactor" } },
      { nodeId: "blended-normal", nodeType: "math.lerp", position: { x: 256, y: 480 }, settings: {} },

      { nodeId: "sun-direction", nodeType: "input.sun-direction", position: { x: 48, y: 652 }, settings: {} },
      { nodeId: "sun-dot", nodeType: "math.dot", position: { x: 448, y: 604 }, settings: {} },
      { nodeId: "sun-mask", nodeType: "math.saturate", position: { x: 640, y: 604 }, settings: {} },
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
      // Canopy tint from vertex color RGB → luminance (brightness modulator)
      createShaderEdge("edge-vertex-split", "vertex-color", "value", "split-vertex-color", "input"),
      createShaderEdge("edge-split-x-tint", "split-vertex-color", "x", "canopy-tint", "x"),
      createShaderEdge("edge-split-y-tint", "split-vertex-color", "y", "canopy-tint", "y"),
      createShaderEdge("edge-split-z-tint", "split-vertex-color", "z", "canopy-tint", "z"),
      createShaderEdge("edge-canopy-luminance", "canopy-tint", "vec3", "canopy-luminance", "input"),

      // Tree-wide height gradient: mix(bottomColor, topColor, treeHeight)
      createShaderEdge("edge-bottomcolor-gradient", "bottom-color", "value", "height-gradient", "a"),
      createShaderEdge("edge-topcolor-gradient", "top-color", "value", "height-gradient", "b"),
      createShaderEdge("edge-treeheight-gradient", "tree-height", "value", "height-gradient", "alpha"),

      // Gradient hue × canopy luminance → leaf-texture rgb → base-color
      createShaderEdge("edge-gradient-times-lum-a", "height-gradient", "value", "gradient-times-lum", "a"),
      createShaderEdge("edge-gradient-times-lum-b", "canopy-luminance", "value", "gradient-times-lum", "b"),
      createShaderEdge("edge-texture-base", "leaf-texture", "color", "base-color", "a"),
      createShaderEdge("edge-gradient-lum-base", "gradient-times-lum", "value", "base-color", "b"),

      // Blended normal: mix(sphereNormal, worldNormal, individualNormalsFactor)
      createShaderEdge("edge-spherenormal-blended", "sphere-normal", "value", "blended-normal", "a"),
      createShaderEdge("edge-worldnormal-blended", "world-normal", "value", "blended-normal", "b"),
      createShaderEdge("edge-individualfactor-blended", "individual-normals-factor", "value", "blended-normal", "alpha"),

      // Sun dot using blended normal (was: world-normal)
      createShaderEdge("edge-normal-sundot", "blended-normal", "value", "sun-dot", "a"),
      createShaderEdge("edge-sun-sundot", "sun-direction", "value", "sun-dot", "b"),
      createShaderEdge("edge-sundot-mask", "sun-dot", "value", "sun-mask", "input"),
      createShaderEdge("edge-vertex-a-bias", "split-vertex-color", "w", "exterior-bias-strength", "a"),
      createShaderEdge("edge-strength-bias", "warm-strength", "value", "exterior-bias-strength", "b"),
      createShaderEdge("edge-bias-mask", "exterior-bias-strength", "value", "warm-mask", "a"),
      createShaderEdge("edge-sunmask-warmmask", "sun-mask", "value", "warm-mask", "b"),
      createShaderEdge("edge-warmcolor-warmterm", "warm-color", "value", "warm-term", "a"),
      createShaderEdge("edge-warmmask-warmterm", "warm-mask", "value", "warm-term", "b"),

      // Rim fresnel also uses the blended (smoothed) normal
      createShaderEdge("edge-normal-rim", "blended-normal", "value", "rim-fresnel", "normal"),
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
        parameterId: "baseColorTexture",
        displayName: "Base Color Texture",
        dataType: "texture2d",
        textureRole: "color",
        defaultValue: null
      },
      {
        parameterId: "topColor",
        displayName: "Top Color",
        dataType: "color",
        colorSpace: "hdr",
        defaultValue: [1.8, 1.5, 0.7]
      },
      {
        parameterId: "bottomColor",
        displayName: "Bottom Color",
        dataType: "color",
        colorSpace: "hdr",
        defaultValue: [0.8, 1.3, 1.2]
      },
      {
        parameterId: "individualNormalsFactor",
        displayName: "Individual Leaf Normals",
        dataType: "float",
        defaultValue: 0.2
      },
      {
        parameterId: "warmColor",
        displayName: "Warm Sun Color",
        dataType: "color",
        colorSpace: "hdr",
        defaultValue: [1.45, 1.15, 0.72]
      },
      {
        parameterId: "warmStrength",
        displayName: "Warm Sun Strength",
        dataType: "float",
        defaultValue: 1.1
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
        defaultValue: 0.6
      }
    ],
    metadata: {
      builtIn: true,
      builtInKey: "foliage-surface"
    }
  };
}

export function createDefaultStandardPbrShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  const shaderDefinitionId =
    options.shaderDefinitionId ?? `${projectId}:shader:standard-pbr`;

  // Tiling math: primary UV split into x/y, each multiplied by the
  // corresponding tiling component, recombined into a vec2. The
  // compiler's coerce layer widens vec2 → vec3 on input to split-vector,
  // so we can consume the builtin uv and the tiling parameter directly.
  // ORM-packed PBR graph: a single ORM texture's R/G/B channels drive
  // AO / roughness / metalness. For the "separate-files" workflow use
  // `createDefaultStandardPbrSeparateShaderGraph` instead — that
  // variant has its own simple graph with one texture per channel.
  // Keeping each variant as a dedicated graph (rather than one fused
  // graph with runtime branching) means both paths stay legible on
  // their own and the GPU only samples what a given material actually
  // uses.
  const nodes: ShaderNodeInstance[] = [
    { nodeId: "uv", nodeType: "input.uv", position: { x: 0, y: 0 }, settings: {} },
    {
      nodeId: "tiling",
      nodeType: "input.parameter",
      position: { x: 0, y: 80 },
      settings: { parameterId: "tiling" }
    },
    {
      nodeId: "uv-split",
      nodeType: "math.split-vector",
      position: { x: 180, y: 0 },
      settings: {}
    },
    {
      nodeId: "tiling-split",
      nodeType: "math.split-vector",
      position: { x: 180, y: 80 },
      settings: {}
    },
    {
      nodeId: "tile-x",
      nodeType: "math.multiply",
      position: { x: 360, y: 0 },
      settings: {}
    },
    {
      nodeId: "tile-y",
      nodeType: "math.multiply",
      position: { x: 360, y: 60 },
      settings: {}
    },
    {
      nodeId: "tiled-uv",
      nodeType: "math.combine-vector",
      position: { x: 520, y: 30 },
      settings: {}
    },

    createMaterialTextureNode("basecolor-texture", "basecolor_texture", {
      x: 700,
      y: 0
    }),
    createMaterialTextureNode("normal-texture", "normal_texture", {
      x: 700,
      y: 130
    }),
    createMaterialTextureNode("orm-texture", "orm_texture", {
      x: 700,
      y: 260
    }),

    {
      nodeId: "roughness-scale",
      nodeType: "input.parameter",
      position: { x: 700, y: 400 },
      settings: { parameterId: "roughness_scale" }
    },
    {
      nodeId: "metallic-scale",
      nodeType: "input.parameter",
      position: { x: 700, y: 460 },
      settings: { parameterId: "metallic_scale" }
    },
    {
      nodeId: "roughness-mul",
      nodeType: "math.multiply",
      position: { x: 900, y: 330 },
      settings: {}
    },
    {
      nodeId: "metallic-mul",
      nodeType: "math.multiply",
      position: { x: 900, y: 400 },
      settings: {}
    },

    {
      nodeId: "output",
      nodeType: "output.fragment",
      position: { x: 1120, y: 120 },
      settings: {}
    }
  ];

  const edges: ShaderEdge[] = [
    // Tiled-UV construction.
    createShaderEdge("e-uv-split", "uv", "value", "uv-split", "input"),
    createShaderEdge("e-tiling-split", "tiling", "value", "tiling-split", "input"),
    createShaderEdge("e-uvx-a", "uv-split", "x", "tile-x", "a"),
    createShaderEdge("e-tilingx-b", "tiling-split", "x", "tile-x", "b"),
    createShaderEdge("e-uvy-a", "uv-split", "y", "tile-y", "a"),
    createShaderEdge("e-tilingy-b", "tiling-split", "y", "tile-y", "b"),
    createShaderEdge("e-tiled-x", "tile-x", "value", "tiled-uv", "x"),
    createShaderEdge("e-tiled-y", "tile-y", "value", "tiled-uv", "y"),

    createShaderEdge("e-uv-basecolor", "tiled-uv", "vec2", "basecolor-texture", "uv"),
    createShaderEdge("e-uv-normal", "tiled-uv", "vec2", "normal-texture", "uv"),
    createShaderEdge("e-uv-orm", "tiled-uv", "vec2", "orm-texture", "uv"),

    createShaderEdge(
      "e-basecolor-color",
      "basecolor-texture",
      "color",
      "output",
      "color"
    ),
    createShaderEdge(
      "e-basecolor-alpha",
      "basecolor-texture",
      "alpha",
      "output",
      "alpha"
    ),

    // Normal map (tangent-space; the runtime wraps with normalMap()
    // for tangent-to-world reconstruction).
    createShaderEdge("e-normal", "normal-texture", "color", "output", "normal"),

    // ORM channel splits feed roughness / metalness / AO.
    createShaderEdge("e-orm-g", "orm-texture", "g", "roughness-mul", "a"),
    createShaderEdge("e-rs-b", "roughness-scale", "value", "roughness-mul", "b"),
    createShaderEdge("e-roughness", "roughness-mul", "value", "output", "roughness"),

    createShaderEdge("e-orm-b", "orm-texture", "b", "metallic-mul", "a"),
    createShaderEdge("e-ms-b", "metallic-scale", "value", "metallic-mul", "b"),
    createShaderEdge("e-metallic", "metallic-mul", "value", "output", "metalness"),

    createShaderEdge("e-orm-r", "orm-texture", "r", "output", "ao")
  ];

  return {
    shaderDefinitionId,
    definitionKind: "shader",
    displayName: options.displayName ?? "Standard PBR (ORM)",
    targetKind: "mesh-surface",
    revision: 4,
    nodes,
    edges,
    parameters: [
      {
        parameterId: "basecolor_texture",
        displayName: "Basecolor Texture",
        dataType: "texture2d",
        textureRole: "color",
        defaultValue: null
      },
      {
        parameterId: "normal_texture",
        displayName: "Normal Texture",
        dataType: "texture2d",
        textureRole: "normal",
        defaultValue: null
      },
      {
        parameterId: "orm_texture",
        displayName: "ORM Texture",
        dataType: "texture2d",
        textureRole: "data",
        defaultValue: null
      },
      {
        parameterId: "tiling",
        displayName: "Tiling",
        dataType: "vec2",
        defaultValue: [1, 1]
      },
      {
        parameterId: "roughness_scale",
        displayName: "Roughness Scale",
        dataType: "float",
        defaultValue: 1
      },
      {
        parameterId: "metallic_scale",
        displayName: "Metallic Scale",
        dataType: "float",
        defaultValue: 0
      }
    ],
    metadata: {
      builtIn: true,
      builtInKey: "standard-pbr"
    }
  };
}

/**
 * Standard PBR shader graph for the "separate channels" workflow:
 * roughness, metallic, and AO each supplied as their own texture,
 * not channel-packed into an ORM pack. Use this when the author is
 * working from a Substance / Painter export with individual roughness
 * / metallic / AO PNGs, or when authoring a material from scratch
 * where each channel was produced by a different artist / pass.
 *
 * Mirrors `createDefaultStandardPbrShaderGraph` (ORM) in everything
 * except how the scalar channels are sourced: instead of splitting
 * ORM.r / .g / .b, we sample dedicated `roughness_texture`,
 * `metallic_texture`, and `ao_texture` and read their red channel.
 * The two variants are kept as separate graphs (rather than fused
 * with runtime branching) so each stays legible on its own and the
 * GPU only samples what the bound Material supplies.
 */
export function createDefaultStandardPbrSeparateShaderGraph(
  projectId: string,
  options: {
    shaderDefinitionId?: string;
    displayName?: string;
  } = {}
): ShaderGraphDocument {
  const shaderDefinitionId =
    options.shaderDefinitionId ??
    `${projectId}:shader:standard-pbr-separate`;

  const nodes: ShaderNodeInstance[] = [
    { nodeId: "uv", nodeType: "input.uv", position: { x: 0, y: 0 }, settings: {} },
    {
      nodeId: "tiling",
      nodeType: "input.parameter",
      position: { x: 0, y: 80 },
      settings: { parameterId: "tiling" }
    },
    {
      nodeId: "uv-split",
      nodeType: "math.split-vector",
      position: { x: 180, y: 0 },
      settings: {}
    },
    {
      nodeId: "tiling-split",
      nodeType: "math.split-vector",
      position: { x: 180, y: 80 },
      settings: {}
    },
    {
      nodeId: "tile-x",
      nodeType: "math.multiply",
      position: { x: 360, y: 0 },
      settings: {}
    },
    {
      nodeId: "tile-y",
      nodeType: "math.multiply",
      position: { x: 360, y: 60 },
      settings: {}
    },
    {
      nodeId: "tiled-uv",
      nodeType: "math.combine-vector",
      position: { x: 520, y: 30 },
      settings: {}
    },

    createMaterialTextureNode("basecolor-texture", "basecolor_texture", {
      x: 700,
      y: 0
    }),
    createMaterialTextureNode("normal-texture", "normal_texture", {
      x: 700,
      y: 130
    }),
    createMaterialTextureNode("roughness-texture", "roughness_texture", {
      x: 700,
      y: 260
    }),
    createMaterialTextureNode("metallic-texture", "metallic_texture", {
      x: 700,
      y: 400
    }),
    createMaterialTextureNode("ao-texture", "ao_texture", {
      x: 700,
      y: 540
    }),

    {
      nodeId: "roughness-scale",
      nodeType: "input.parameter",
      position: { x: 700, y: 680 },
      settings: { parameterId: "roughness_scale" }
    },
    {
      nodeId: "metallic-scale",
      nodeType: "input.parameter",
      position: { x: 700, y: 740 },
      settings: { parameterId: "metallic_scale" }
    },
    {
      nodeId: "roughness-mul",
      nodeType: "math.multiply",
      position: { x: 900, y: 330 },
      settings: {}
    },
    {
      nodeId: "metallic-mul",
      nodeType: "math.multiply",
      position: { x: 900, y: 400 },
      settings: {}
    },

    {
      nodeId: "output",
      nodeType: "output.fragment",
      position: { x: 1120, y: 120 },
      settings: {}
    }
  ];

  const edges: ShaderEdge[] = [
    createShaderEdge("e-uv-split", "uv", "value", "uv-split", "input"),
    createShaderEdge("e-tiling-split", "tiling", "value", "tiling-split", "input"),
    createShaderEdge("e-uvx-a", "uv-split", "x", "tile-x", "a"),
    createShaderEdge("e-tilingx-b", "tiling-split", "x", "tile-x", "b"),
    createShaderEdge("e-uvy-a", "uv-split", "y", "tile-y", "a"),
    createShaderEdge("e-tilingy-b", "tiling-split", "y", "tile-y", "b"),
    createShaderEdge("e-tiled-x", "tile-x", "value", "tiled-uv", "x"),
    createShaderEdge("e-tiled-y", "tile-y", "value", "tiled-uv", "y"),

    createShaderEdge("e-uv-basecolor", "tiled-uv", "vec2", "basecolor-texture", "uv"),
    createShaderEdge("e-uv-normal", "tiled-uv", "vec2", "normal-texture", "uv"),
    createShaderEdge("e-uv-roughness", "tiled-uv", "vec2", "roughness-texture", "uv"),
    createShaderEdge("e-uv-metallic", "tiled-uv", "vec2", "metallic-texture", "uv"),
    createShaderEdge("e-uv-ao", "tiled-uv", "vec2", "ao-texture", "uv"),

    createShaderEdge(
      "e-basecolor-color",
      "basecolor-texture",
      "color",
      "output",
      "color"
    ),
    createShaderEdge(
      "e-basecolor-alpha",
      "basecolor-texture",
      "alpha",
      "output",
      "alpha"
    ),

    createShaderEdge("e-normal", "normal-texture", "color", "output", "normal"),

    createShaderEdge("e-r-src", "roughness-texture", "r", "roughness-mul", "a"),
    createShaderEdge("e-r-scale", "roughness-scale", "value", "roughness-mul", "b"),
    createShaderEdge("e-roughness", "roughness-mul", "value", "output", "roughness"),

    createShaderEdge("e-m-src", "metallic-texture", "r", "metallic-mul", "a"),
    createShaderEdge("e-m-scale", "metallic-scale", "value", "metallic-mul", "b"),
    createShaderEdge("e-metallic", "metallic-mul", "value", "output", "metalness"),

    createShaderEdge("e-ao", "ao-texture", "r", "output", "ao")
  ];

  return {
    shaderDefinitionId,
    definitionKind: "shader",
    displayName: options.displayName ?? "Standard PBR (Separate)",
    targetKind: "mesh-surface",
    revision: 1,
    nodes,
    edges,
    parameters: [
      {
        parameterId: "basecolor_texture",
        displayName: "Basecolor Texture",
        dataType: "texture2d",
        textureRole: "color",
        defaultValue: null
      },
      {
        parameterId: "normal_texture",
        displayName: "Normal Texture",
        dataType: "texture2d",
        textureRole: "normal",
        defaultValue: null
      },
      {
        parameterId: "roughness_texture",
        displayName: "Roughness Texture",
        dataType: "texture2d",
        textureRole: "data",
        defaultValue: null
      },
      {
        parameterId: "metallic_texture",
        displayName: "Metallic Texture",
        dataType: "texture2d",
        textureRole: "data",
        defaultValue: null
      },
      {
        parameterId: "ao_texture",
        displayName: "Ambient Occlusion Texture",
        dataType: "texture2d",
        textureRole: "data",
        defaultValue: null
      },
      {
        parameterId: "tiling",
        displayName: "Tiling",
        dataType: "vec2",
        defaultValue: [1, 1]
      },
      {
        parameterId: "roughness_scale",
        displayName: "Roughness Scale",
        dataType: "float",
        defaultValue: 1
      },
      {
        parameterId: "metallic_scale",
        displayName: "Metallic Scale",
        dataType: "float",
        defaultValue: 0
      }
    ],
    metadata: {
      builtIn: true,
      builtInKey: "standard-pbr-separate"
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

function createMaterialTextureNode(
  nodeId: string,
  parameterId: string,
  position: { x: number; y: number }
): ShaderNodeInstance {
  return {
    nodeId,
    nodeType: "input.material-texture",
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

function requestedMaterialTextureOutputType(portId: string): ShaderDataType {
  switch (portId) {
    case "alpha":
    case "r":
    case "g":
    case "b":
    case "a":
      return "float";
    case "color":
    default:
      return "color";
  }
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
      return value === null || typeof value === "string";
    default:
      return false;
  }
}

function areShaderPortTypesCompatible(
  source: ShaderDataType,
  target: ShaderDataType
): boolean {
  if (source === target) {
    return true;
  }

  const isDirectAlias =
    (source === "vec3" && target === "color") ||
    (source === "color" && target === "vec3");
  if (isDirectAlias) {
    return true;
  }

  const isFloatSplat =
    source === "float" &&
    (target === "vec2" ||
      target === "vec3" ||
      target === "vec4" ||
      target === "color");
  if (isFloatSplat) {
    return true;
  }

  const isVectorTruncate =
    (source === "vec4" && target === "vec3") ||
    (source === "vec3" && target === "vec2");
  if (isVectorTruncate) {
    return true;
  }

  const isVectorWiden =
    (source === "vec3" && target === "vec4") ||
    (source === "vec2" && (target === "vec3" || target === "vec4")) ||
    (source === "color" && target === "vec4");
  if (isVectorWiden) {
    return true;
  }

  return false;
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

    if (!nodeSupportsTargetKind(definition, document.targetKind)) {
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

    if (node.nodeType === "input.material-texture") {
      const parameterId =
        typeof node.settings.parameterId === "string"
          ? node.settings.parameterId.trim()
          : "";
      const parameter = parameterId ? parameterMap.get(parameterId) ?? null : null;
      if (!parameter || parameter.dataType !== "texture2d") {
        issues.push({
          severity: "error",
          nodeId: node.nodeId,
          message:
            "Material Texture nodes must reference an existing texture2d shader parameter."
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
        : source.nodeType === "input.material-texture"
          ? requestedMaterialTextureOutputType(edge.sourcePortId)
          : sourcePort.dataType;

    if (!areShaderPortTypesCompatible(effectiveSourceDataType, targetPort.dataType)) {
      issues.push({
        severity: "error",
        edgeId: edge.edgeId,
        message: `Port type mismatch: ${effectiveSourceDataType} cannot connect to ${targetPort.dataType}.`
      });
    }
  }

  const outputNodeTypes = allowedOutputNodeTypesForTargetKind(document.targetKind);
  if (!document.nodes.some((node) => outputNodeTypes.includes(node.nodeType))) {
    issues.push({
      severity: "error",
      message: `Graph is missing a required ${requiredOutputNodeTypeForTargetKind(document.targetKind)} node.`
    });
  }

  return issues;
}
