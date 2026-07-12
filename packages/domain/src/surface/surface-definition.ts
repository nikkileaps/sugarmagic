/**
 * Surface-definition library primitive.
 *
 * Owns the reusable content-library wrapper around a Surface layer stack so
 * authors can build one named surface and reference it from multiple slots.
 */

import { createScopedId } from "../shared/identity";
import {
  createDefaultSurface,
  type Surface,
  type SurfaceContext
} from "./index";

export interface SurfaceDefinition {
  definitionId: string;
  definitionKind: "surface";
  displayName: string;
  surface: Surface;
  /**
   * Built-in presets are factory-owned: the load normalizer
   * replaces them from the factory on every project load, so
   * in-place edits DO NOT PERSIST. The authoring UI must gate
   * editing behind "Duplicate to edit" (Procreate-brush model) —
   * the duplicate omits this metadata and is user-owned.
   */
  metadata?: { builtIn?: boolean; builtInKey?: string };
}

/**
 * True when a library surface may bind to a slot of the given
 * context. Landscape slots accept everything; universal slots
 * (asset meshes) reject landscape-only surfaces (splatmap masks).
 * SINGLE ENFORCER of context compatibility — UI pickers and
 * resolvers must call this, never re-derive the rule.
 */
export function surfaceDefinitionMatchesContext(
  definition: SurfaceDefinition,
  allowedContext: SurfaceContext
): boolean {
  return (
    allowedContext === "landscape-only" ||
    definition.surface.context === "universal"
  );
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
