/**
 * Grass-type library primitive.
 *
 * Defines one reusable scatter profile for painterly grass tufts. Surfaces
 * reference these by id from scatter layers; render-web realizes them into
 * actual instanced geometry.
 */

import { createScopedId } from "../shared/identity";
import type { ShaderOrMaterial } from "./index";
import type { ScatterLodDefinition } from "./lod";

export interface GrassTypeDefinition extends ScatterLodDefinition {
  definitionId: string;
  definitionKind: "grass-type";
  displayName: string;
  tuft:
    | {
        kind: "procedural";
        bladeProfile?: "flat" | "tapered";
        bladesPerTuft: number;
        heightRange: [number, number];
        widthBase: number;
        bendAmount: number;
      }
    | {
        kind: "asset";
        assetDefinitionId: string;
      };
  density: number;
  scaleJitter: [number, number];
  rotationJitter: number;
  heightJitter: number;
  tipColor: number;
  baseColor: number;
  colorJitter: number;
  wind: ShaderOrMaterial | null;
}

export function createDefaultGrassTypeDefinition(
  projectId: string,
  opts: {
    definitionId?: string;
    displayName?: string;
    tipColor?: number;
    baseColor?: number;
    density?: number;
    wind?: ShaderOrMaterial | null;
  } = {}
): GrassTypeDefinition {
  return {
    definitionId:
      opts.definitionId ?? `${projectId}:grass-type:${createScopedId("grass-type")}`,
    definitionKind: "grass-type",
    displayName: opts.displayName ?? "Grass Type",
    tuft: {
      kind: "procedural",
      bladeProfile: "tapered",
      bladesPerTuft: 6,
      heightRange: [0.35, 0.7],
      widthBase: 0.08,
      bendAmount: 0.7
    },
    density: opts.density ?? 60,
    scaleJitter: [0.8, 1.25],
    rotationJitter: 1,
    heightJitter: 0.3,
    tipColor: opts.tipColor ?? 0xbadf7c,
    baseColor: opts.baseColor ?? 0x4f7d35,
    colorJitter: 0.15,
    wind: opts.wind ?? null,
    lodMeshes: {
      near: { kind: "procedural-default" },
      far: {
        kind: "procedural-reduced",
        vertexBudget: 0.5
      },
      billboard: { kind: "billboard" }
    },
    lod1Distance: 36,
    lod2Distance: 68,
    lodTransitionWidth: 12,
    distantMeshThreshold: 88,
    maxDrawDistance: 120
  };
}
