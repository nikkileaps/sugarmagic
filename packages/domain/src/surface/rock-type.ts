/**
 * Rock-type library primitive.
 *
 * Defines one reusable scatter profile for stones / rocks. This parallels the
 * grass/flower library types so surface scatter can dispatch by content kind
 * without inventing a second authored model.
 */

import { createScopedId } from "../shared/identity";
import type { ScatterLodDefinition } from "./lod";

export interface RockTypeDefinition extends ScatterLodDefinition {
  definitionId: string;
  definitionKind: "rock-type";
  displayName: string;
  source:
    | {
        kind: "asset";
        assetDefinitionId: string;
      }
    | {
        kind: "procedural";
        radiusRange: [number, number];
        heightRatioRange: [number, number];
        facetCount: number;
      };
  density: number;
  scaleJitter: [number, number];
  rotationJitter: number;
  color: number;
  colorJitter: number;
}

export function createDefaultRockTypeDefinition(
  projectId: string,
  opts: {
    definitionId?: string;
    displayName?: string;
    density?: number;
    color?: number;
  } = {}
): RockTypeDefinition {
  return {
    definitionId:
      opts.definitionId ?? `${projectId}:rock-type:${createScopedId("rock-type")}`,
    definitionKind: "rock-type",
    displayName: opts.displayName ?? "Rock Type",
    source: {
      kind: "procedural",
      radiusRange: [0.08, 0.18],
      heightRatioRange: [0.45, 0.9],
      facetCount: 8
    },
    density: opts.density ?? 0.75,
    scaleJitter: [0.7, 1.45],
    rotationJitter: 1,
    color: opts.color ?? 0x8f8a7b,
    colorJitter: 0.12,
    lodMeshes: {
      near: { kind: "procedural-default" },
      far: null,
      billboard: null
    },
    lod1Distance: 14,
    lod2Distance: 24,
    lodTransitionWidth: 4,
    distantMeshThreshold: 24,
    maxDrawDistance: 32
  };
}
