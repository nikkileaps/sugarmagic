/**
 * Material preview shader.
 *
 * Single engine-internal PBR shader used to render any material in
 * the Material library popover preview. NOT user-facing: it does
 * not appear in the Shaders library, has no shader graph, and is
 * never bindable from authored content. Its sole purpose is to
 * read a MaterialDefinition's PBR fields (baseColor, metallic,
 * roughness, emissive, etc.) and render them on a primitive in
 * the preview viewport.
 *
 * Implemented as a THREE.MeshStandardMaterial because that's the
 * stock PBR shader for previewing PBR data — there's no benefit to
 * re-implementing the same math in TSL for a preview-only path.
 *
 * Every material in the library (built-in or project) displays
 * through this single shader instance per preview viewport.
 * Swapping the selected material in the popover mutates the
 * shader's parameters in place; no re-allocation per material.
 */

import * as THREE from "three";
import type {
  MaterialDefinition,
  MaterialPbrDefinition,
  TextureDefinition
} from "@sugarmagic/domain";
import type { AuthoredAssetResolver } from "@sugarmagic/render-web";

const NEUTRAL_BASE_COLOR = 0x808080;
const NEUTRAL_ROUGHNESS = 1;
const NEUTRAL_METALLIC = 0;
const NEUTRAL_EMISSIVE_COLOR = 0x000000;
const NEUTRAL_EMISSIVE_INTENSITY = 0;

export interface PreviewTextureContext {
  textureDefinitions: TextureDefinition[];
  assetResolver: AuthoredAssetResolver | null;
}

export function createMaterialPreviewShader(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: NEUTRAL_BASE_COLOR,
    roughness: NEUTRAL_ROUGHNESS,
    metalness: NEUTRAL_METALLIC
  });
}

function resolveTexture(
  definitionId: string | null,
  context: PreviewTextureContext,
  tiling: [number, number]
): THREE.Texture | null {
  if (!definitionId || !context.assetResolver) return null;
  const definition = context.textureDefinitions.find(
    (d) => d.definitionId === definitionId
  );
  if (!definition) return null;
  return context.assetResolver.resolveTextureDefinition(definition, {
    repeatX: tiling[0],
    repeatY: tiling[1]
  });
}

export function applyMaterialToPreviewShader(
  shader: THREE.MeshStandardMaterial,
  material: MaterialDefinition | null,
  context: PreviewTextureContext
): void {
  if (!material) {
    shader.color.setHex(NEUTRAL_BASE_COLOR);
    shader.roughness = NEUTRAL_ROUGHNESS;
    shader.metalness = NEUTRAL_METALLIC;
    shader.emissive.setHex(NEUTRAL_EMISSIVE_COLOR);
    shader.emissiveIntensity = NEUTRAL_EMISSIVE_INTENSITY;
    shader.map = null;
    shader.normalMap = null;
    shader.roughnessMap = null;
    shader.metalnessMap = null;
    shader.aoMap = null;
    shader.emissiveMap = null;
    shader.needsUpdate = true;
    return;
  }
  // Defensive read: built-in materials authored before Plan 037's
  // narrowing may not have `pbr` set yet. Fall back to neutrals so
  // the preview shows SOMETHING while the built-in library is mid-
  // migration.
  const pbr = (material as unknown as { pbr?: MaterialPbrDefinition }).pbr;
  shader.color.setHex(pbr?.baseColor ?? NEUTRAL_BASE_COLOR);
  shader.roughness = pbr?.roughness ?? NEUTRAL_ROUGHNESS;
  shader.metalness = pbr?.metallic ?? NEUTRAL_METALLIC;
  shader.emissive.setHex(pbr?.emissiveColor ?? NEUTRAL_EMISSIVE_COLOR);
  shader.emissiveIntensity = pbr?.emissiveIntensity ?? NEUTRAL_EMISSIVE_INTENSITY;

  const tiling: [number, number] = pbr?.tiling ?? [1, 1];
  shader.map = resolveTexture(pbr?.baseColorMap ?? null, context, tiling);
  shader.normalMap = resolveTexture(pbr?.normalMap ?? null, context, tiling);
  shader.emissiveMap = resolveTexture(pbr?.emissiveMap ?? null, context, tiling);

  // OrM packed map (GLTF convention: R=AO, G=Roughness, B=Metallic).
  // When ORM is bound, three.js reads roughness from G channel of
  // roughnessMap and metalness from B channel of metalnessMap, so
  // assign the same texture to all three slots — three's shader
  // samples the right channels automatically. AO additionally
  // requires a UV2 set normally, but for a preview the default UV
  // works acceptably.
  const ormMap = resolveTexture(pbr?.ormMap ?? null, context, tiling);
  if (ormMap) {
    shader.roughnessMap = ormMap;
    shader.metalnessMap = ormMap;
    shader.aoMap = ormMap;
  } else {
    shader.roughnessMap = resolveTexture(pbr?.roughnessMap ?? null, context, tiling);
    shader.metalnessMap = resolveTexture(pbr?.metallicMap ?? null, context, tiling);
    shader.aoMap = resolveTexture(pbr?.ambientOcclusionMap ?? null, context, tiling);
  }

  shader.needsUpdate = true;
}
