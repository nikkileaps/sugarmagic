/**
 * Flower-type library primitive.
 *
 * Defines one reusable scatter profile for painterly flowers. Surfaces
 * reference these by id from scatter layers; render-web realizes them into
 * actual instanced geometry.
 */

import { createScopedId } from "../shared/identity";
import type { ShaderReference } from "./index";
import type { ScatterLodDefinition } from "./lod";

export interface FlowerTypeDefinition extends ScatterLodDefinition {
  definitionId: string;
  definitionKind: "flower-type";
  displayName: string;
  head:
    | {
        kind: "procedural";
        petalCount: number;
        radius: number;
        heightRange: [number, number];
      }
    | {
        kind: "asset";
        assetDefinitionId: string;
      };
  density: number;
  scaleJitter: [number, number];
  rotationJitter: number;
  petalColor: number;
  centerColor: number;
  colorJitter: number;
  wind: ShaderReference | null;
}

export function createDefaultFlowerTypeDefinition(
  projectId: string,
  opts: {
    definitionId?: string;
    displayName?: string;
    petalColor?: number;
    centerColor?: number;
    density?: number;
    wind?: ShaderReference | null;
  } = {}
): FlowerTypeDefinition {
  return {
    definitionId:
      opts.definitionId ??
      `${projectId}:flower-type:${createScopedId("flower-type")}`,
    definitionKind: "flower-type",
    displayName: opts.displayName ?? "Flower Type",
    head: {
      kind: "procedural",
      petalCount: 6,
      radius: 0.08,
      heightRange: [0.28, 0.52]
    },
    density: opts.density ?? 4,
    scaleJitter: [0.9, 1.2],
    rotationJitter: 1,
    petalColor: opts.petalColor ?? 0xf8f6eb,
    centerColor: opts.centerColor ?? 0xf0c85a,
    colorJitter: 0.12,
    wind: opts.wind ?? null,
    lodMeshes: {
      near: { kind: "procedural-default" },
      far: {
        kind: "procedural-reduced",
        vertexBudget: 0.3
      },
      billboard: null
    },
    lod1Distance: 12,
    lod2Distance: 24,
    lodTransitionWidth: 5,
    distantMeshThreshold: 32,
    maxDrawDistance: 52
  };
}
