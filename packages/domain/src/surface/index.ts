/**
 * Surface / deform / effect domain traits.
 *
 * Owns the canonical authored slot-content shape used by surface, deform, and
 * effect traits. This module is the single domain source of truth for
 * "what can fill a render slot" before runtime-core resolves that authored
 * meaning into concrete shader bindings.
 */

export type Surface =
  | { kind: "color"; color: number }
  | {
      kind: "texture";
      textureDefinitionId: string;
      tiling: [number, number];
    }
  | { kind: "material"; materialDefinitionId: string }
  | {
      kind: "shader";
      shaderDefinitionId: string;
      parameterValues: Record<string, unknown>;
      textureBindings: Record<string, string>;
    };

export type ShaderOrMaterial = Extract<
  Surface,
  { kind: "material" } | { kind: "shader" }
>;

export interface SurfaceSlot {
  readonly slotName: string;
  readonly surface: Surface | null;
}

export interface AssetSurfaceSlot extends SurfaceSlot {
  readonly slotIndex: number;
}

export interface LandscapeSurfaceSlot extends SurfaceSlot {
  readonly channelId: string;
  readonly displayName: string;
  readonly tilingScale: [number, number] | null;
}

export interface Surfaceable {
  readonly surfaceSlots: readonly SurfaceSlot[];
}

export interface Deformable {
  readonly deform: ShaderOrMaterial | null;
}

export interface Effectable {
  readonly effect: ShaderOrMaterial | null;
}

export function createColorSurface(color: number): Surface {
  return { kind: "color", color };
}

export function createTextureSurface(
  textureDefinitionId: string,
  tiling: [number, number] = [1, 1]
): Surface {
  return {
    kind: "texture",
    textureDefinitionId,
    tiling
  };
}

export function createMaterialSurface(
  materialDefinitionId: string
): Extract<Surface, { kind: "material" }> {
  return { kind: "material", materialDefinitionId };
}

export function createShaderSurface(
  shaderDefinitionId: string,
  parameterValues: Record<string, unknown> = {},
  textureBindings: Record<string, string> = {}
): Extract<Surface, { kind: "shader" }> {
  return {
    kind: "shader",
    shaderDefinitionId,
    parameterValues,
    textureBindings
  };
}

export function isShaderOrMaterialSurface(
  surface: Surface | null | undefined
): surface is ShaderOrMaterial {
  return surface?.kind === "material" || surface?.kind === "shader";
}
