/**
 * Surface-definition library primitive.
 *
 * Owns the reusable content-library wrapper around a Surface layer stack so
 * authors can build one named surface and reference it from multiple slots.
 */

import { createScopedId } from "../shared/identity";
import { createDefaultSurface, type Surface } from "./index";

export interface SurfaceDefinition {
  definitionId: string;
  definitionKind: "surface";
  displayName: string;
  surface: Surface;
}

export function createDefaultSurfaceDefinition(
  projectId: string,
  opts: {
    definitionId?: string;
    displayName?: string;
    baseColor?: number;
  } = {}
): SurfaceDefinition {
  return {
    definitionId:
      opts.definitionId ?? `${projectId}:surface:${createScopedId("surface")}`,
    definitionKind: "surface",
    displayName: opts.displayName ?? "New Surface",
    surface: createDefaultSurface(opts.baseColor)
  };
}
