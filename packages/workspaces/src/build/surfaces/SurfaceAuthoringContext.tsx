/**
 * Surface authoring context.
 *
 * The definition catalogs + mask-paint wiring that every surface
 * editor needs (binding editor, layer stack, mask editor, slot
 * editors). This is ambient environment — the same project-wide
 * catalogs regardless of which slot is being edited — so it flows
 * through React context instead of being threaded as an identical
 * 10-prop bundle down 4+ component levels (the pre-2026-07-10
 * shape, duplicated across six interfaces).
 *
 * Per-instance editing state (which binding, which slot, allowed
 * context, onChange) stays in props — only the shared catalog
 * lives here.
 */

import { createContext, useContext, type ReactNode } from "react";
import type {
  FlowerTypeDefinition,
  GrassTypeDefinition,
  MaterialDefinition,
  MaskTextureDefinition,
  PaintedMaskTargetAddress,
  RockTypeDefinition,
  ShaderGraphDocument,
  SurfaceDefinition,
  TextureDefinition
} from "@sugarmagic/domain";

export interface SurfaceAuthoringCatalog {
  surfaceDefinitions: SurfaceDefinition[];
  materialDefinitions: MaterialDefinition[];
  textureDefinitions: TextureDefinition[];
  maskTextureDefinitions: MaskTextureDefinition[];
  shaderDefinitions: ShaderGraphDocument[];
  grassTypeDefinitions: GrassTypeDefinition[];
  flowerTypeDefinitions: FlowerTypeDefinition[];
  rockTypeDefinitions: RockTypeDefinition[];
  onCreateMaskTextureDefinition?: () =>
    | Promise<MaskTextureDefinition | null>
    | MaskTextureDefinition
    | null;
  onImportMaskTextureDefinition?: () => Promise<MaskTextureDefinition | null>;
  activeMaskPaintTarget: PaintedMaskTargetAddress | null;
  onSetMaskPaintTarget: (target: PaintedMaskTargetAddress | null) => void;
  /** Plan 068.8 QoL -- live pixels of a painted mask for previews
   *  (null while loading / unknown id). Studio backs this with a
   *  canvas cache updated on every stroke commit. */
  getPaintedMaskPreviewCanvas?: (
    maskTextureId: string
  ) => HTMLCanvasElement | null;
  /** Bumps when any painted mask's pixels change, so previews
   *  re-render. */
  paintedMaskPreviewVersion?: number;
}

const SurfaceAuthoringContext = createContext<SurfaceAuthoringCatalog | null>(
  null
);

export function SurfaceAuthoringProvider({
  catalog,
  children
}: {
  catalog: SurfaceAuthoringCatalog;
  children: ReactNode;
}) {
  return (
    <SurfaceAuthoringContext.Provider value={catalog}>
      {children}
    </SurfaceAuthoringContext.Provider>
  );
}

export function useSurfaceAuthoring(): SurfaceAuthoringCatalog {
  const catalog = useContext(SurfaceAuthoringContext);
  if (!catalog) {
    throw new Error(
      "useSurfaceAuthoring: no SurfaceAuthoringProvider above this component. " +
        "Surface editors must render inside the provider (mounted in Studio's App)."
    );
  }
  return catalog;
}
