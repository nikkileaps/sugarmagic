/**
 * Shader IR contract.
 *
 * Defines the platform-agnostic intermediate representation produced by the
 * semantic compiler and consumed by target-specific finalizers. This module is
 * intentionally pure TypeScript with no rendering dependencies.
 */

import type {
  ShaderDataType,
  ShaderParameter,
  ShaderTargetKind
} from "@sugarmagic/domain";

export type ShaderIRBuiltinName =
  | "time"
  | "deltaTime"
  | "worldPosition"
  | "localPosition"
  | "worldNormal"
  | "localNormal"
  | "uv"
  | "vertexColor"
  | "vertexWindMask"
  | "cameraPosition"
  | "viewDirection"
  | "sunDirection"
  | "sphereNormal"
  | "treeHeight"
  | "materialTextureColor"
  | "materialTextureAlpha"
  | "materialTextureR"
  | "materialTextureG"
  | "materialTextureB"
  | "materialTextureA"
  | "screenUV"
  | "sceneColor"
  | "sceneDepth"
  | "accumulatorColor"
  | "accumulatorNormal"
  | "accumulatorRoughness"
  | "accumulatorMetalness"
  | "accumulatorAo"
  | "accumulatorAlpha";

export interface ShaderIRDiagnostic {
  severity: "error" | "warning";
  message: string;
  nodeId?: string;
  edgeId?: string;
  parameterId?: string;
}

export interface ShaderIRParameter {
  parameterId: string;
  displayName: string;
  dataType: ShaderParameter["dataType"];
  defaultValue: ShaderParameter["defaultValue"];
}

export interface ShaderIRTextureSlot {
  slotId: string;
  displayName: string;
  parameterId: string | null;
}

export type ShaderIRValue =
  | { kind: "literal"; dataType: ShaderDataType; value: unknown }
  | { kind: "reference"; dataType: ShaderDataType; opId: string }
  | { kind: "builtin"; dataType: ShaderDataType; name: ShaderIRBuiltinName; settings?: Record<string, unknown> }
  | { kind: "parameter"; dataType: ShaderDataType; parameterId: string };

export interface ShaderIROp {
  opId: string;
  opKind: string;
  dataType: ShaderDataType;
  nodeId?: string;
  inputs: Record<string, ShaderIRValue>;
  settings?: Record<string, unknown>;
}

export interface ShaderIROutputs {
  vertex?: ShaderIRValue;
  fragmentColor?: ShaderIRValue;
  fragmentAlpha?: ShaderIRValue;
  /**
   * Tangent-space normal read from a normal map (RGB in [0, 1], to be
   * unpacked to [-1, 1] at the target). Left undefined when the graph
   * does not author a normal output — the runtime leaves the
   * material's default normal alone in that case.
   */
  fragmentNormal?: ShaderIRValue;
  fragmentRoughness?: ShaderIRValue;
  fragmentMetalness?: ShaderIRValue;
  fragmentAo?: ShaderIRValue;
  emissive?: ShaderIRValue;
  postProcessColor?: ShaderIRValue;
  effectColor?: ShaderIRValue;
  effectAlpha?: ShaderIRValue;
  effectNormal?: ShaderIRValue;
  effectRoughness?: ShaderIRValue;
  effectMetalness?: ShaderIRValue;
  effectAo?: ShaderIRValue;
}

export interface ShaderIR {
  shaderDefinitionId: string;
  revision: number;
  targetKind: ShaderTargetKind;
  vertexOps: ShaderIROp[];
  fragmentOps: ShaderIROp[];
  postProcessOps: ShaderIROp[];
  outputs: ShaderIROutputs;
  parameters: ShaderIRParameter[];
  textureSlots: ShaderIRTextureSlot[];
  diagnostics: ShaderIRDiagnostic[];
}

const BUILTIN_TYPES: Record<ShaderIRBuiltinName, ShaderDataType> = {
  time: "float",
  deltaTime: "float",
  worldPosition: "vec3",
  localPosition: "vec3",
  worldNormal: "vec3",
  localNormal: "vec3",
  uv: "vec2",
  vertexColor: "vec4",
  vertexWindMask: "float",
  cameraPosition: "vec3",
  viewDirection: "vec3",
  sunDirection: "vec3",
  sphereNormal: "vec3",
  treeHeight: "float",
  materialTextureColor: "color",
  materialTextureAlpha: "float",
  materialTextureR: "float",
  materialTextureG: "float",
  materialTextureB: "float",
  materialTextureA: "float",
  screenUV: "vec2",
  sceneColor: "vec3",
  sceneDepth: "float",
  accumulatorColor: "color",
  accumulatorNormal: "vec3",
  accumulatorRoughness: "float",
  accumulatorMetalness: "float",
  accumulatorAo: "float",
  accumulatorAlpha: "float"
};

export function validateShaderIR(ir: ShaderIR): ShaderIRDiagnostic[] {
  const diagnostics: ShaderIRDiagnostic[] = [];
  const opIds = new Set<string>();

  for (const op of [...ir.vertexOps, ...ir.fragmentOps, ...ir.postProcessOps]) {
    opIds.add(op.opId);
    for (const value of Object.values(op.inputs)) {
      if (value.kind === "reference" && !opIds.has(value.opId)) {
        diagnostics.push({
          severity: "error",
          nodeId: op.nodeId,
          message: `IR op "${op.opKind}" references missing op "${value.opId}".`
        });
      }

      if (value.kind === "builtin" && BUILTIN_TYPES[value.name] !== value.dataType) {
        diagnostics.push({
          severity: "error",
          nodeId: op.nodeId,
          message: `Builtin "${value.name}" was emitted with the wrong data type.`
        });
      }
    }
  }

  return diagnostics;
}
