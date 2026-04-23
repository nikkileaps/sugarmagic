/**
 * Surface-editor utilities.
 *
 * Keeps immutable layer-stack manipulation in one place so the surface editor
 * stays readable and the `createSurface(...)` invariant remains the single
 * enforcer for layer ordering and context derivation.
 */

import type {
  AppearanceContent,
  FlowerTypeDefinition,
  GrassTypeDefinition,
  Layer,
  MaterialDefinition,
  ShaderGraphDocument,
  Surface,
  SurfaceBinding,
  SurfaceContext,
  SurfaceDefinition,
  TextureDefinition
} from "@sugarmagic/domain";
import {
  createAppearanceLayer,
  createColorAppearanceContent,
  createColorEmissionContent,
  createEmissionLayer,
  createInlineSurfaceBinding,
  createScatterLayer,
  createSurface
} from "@sugarmagic/domain";

export function cloneLayer(layer: Layer): Layer {
  if (layer.kind === "appearance") {
    return {
      ...layer,
      mask: { ...layer.mask },
      content:
        layer.content.kind === "texture"
          ? { ...layer.content, tiling: [...layer.content.tiling] as [number, number] }
          : layer.content.kind === "shader"
            ? {
                ...layer.content,
                parameterValues: { ...layer.content.parameterValues },
                textureBindings: { ...layer.content.textureBindings }
              }
            : { ...layer.content }
    };
  }
  if (layer.kind === "emission") {
    return {
      ...layer,
      mask: { ...layer.mask },
      content:
        layer.content.kind === "texture"
          ? { ...layer.content, tiling: [...layer.content.tiling] as [number, number] }
          : { ...layer.content }
    };
  }
  return {
    ...layer,
    mask: { ...layer.mask },
    content: { ...layer.content }
  };
}

export function describeAppearanceContent(
  content: AppearanceContent | null | undefined,
  materials: MaterialDefinition[],
  textures: TextureDefinition[],
  shaders: ShaderGraphDocument[]
): string {
  if (!content) {
    return "No appearance";
  }
  if (content.kind === "color") {
    return `Color #${content.color.toString(16).padStart(6, "0")}`;
  }
  if (content.kind === "texture") {
    return (
      textures.find((texture) => texture.definitionId === content.textureDefinitionId)
        ?.displayName ?? "Missing Texture"
    );
  }
  if (content.kind === "material") {
    return (
      materials.find((material) => material.definitionId === content.materialDefinitionId)
        ?.displayName ?? "Missing Material"
    );
  }
  return (
    shaders.find((shader) => shader.shaderDefinitionId === content.shaderDefinitionId)
      ?.displayName ?? "Missing Shader"
  );
}

export function previewColorForBinding(
  binding: SurfaceBinding | null,
  surfaceDefinitions: SurfaceDefinition[]
): string {
  if (!binding) {
    return "#5c6370";
  }
  const surface =
    binding.kind === "reference"
      ? surfaceDefinitions.find(
          (definition) => definition.definitionId === binding.surfaceDefinitionId
        )?.surface ?? null
      : binding.surface;
  const baseLayer = surface?.layers[0];
  if (!baseLayer || baseLayer.kind !== "appearance") {
    return "#f38ba8";
  }
  switch (baseLayer.content.kind) {
    case "color":
      return `#${baseLayer.content.color.toString(16).padStart(6, "0")}`;
    case "material":
      return "#89b4fa";
    case "texture":
      return "#a6e3a1";
    case "shader":
      return "#f9e2af";
  }
}

export function surfaceDefinitionMatchesContext(
  definition: SurfaceDefinition,
  allowedContext: SurfaceContext
): boolean {
  return allowedContext === "landscape-only" || definition.surface.context === "universal";
}

export function createDefaultLayer(
  kind: Layer["kind"],
  grassTypes: GrassTypeDefinition[],
  flowerTypes: FlowerTypeDefinition[]
): Layer {
  if (kind === "appearance") {
    return createAppearanceLayer(createColorAppearanceContent(0x6f8f52), {
      displayName: "Appearance",
      blendMode: "mix",
      opacity: 0.8
    });
  }
  if (kind === "scatter") {
    if (grassTypes[0]) {
      return createScatterLayer(
        { kind: "grass", grassTypeId: grassTypes[0].definitionId },
        { displayName: "Grass" }
      );
    }
    return createScatterLayer(
      {
        kind: "flowers",
        flowerTypeId: flowerTypes[0]?.definitionId ?? "missing:flower-type"
      },
      { displayName: "Flowers" }
    );
  }
  return createEmissionLayer(createColorEmissionContent(0xf6cd7c, 0.2), {
    displayName: "Emission",
    opacity: 0.5
  });
}

export function ensureInlineSurfaceBinding<C extends SurfaceContext>(
  binding: SurfaceBinding<C> | null
): Extract<SurfaceBinding<C>, { kind: "inline" }> {
  if (binding?.kind === "inline") {
    return binding;
  }
  return createInlineSurfaceBinding() as Extract<SurfaceBinding<C>, { kind: "inline" }>;
}

export function updateInlineSurface<C extends SurfaceContext>(
  binding: SurfaceBinding<C> | null,
  update: (surface: Surface<C>) => Surface<C>
): SurfaceBinding<C> {
  const inline = ensureInlineSurfaceBinding(binding);
  return {
    kind: "inline",
    surface: update(inline.surface)
  };
}

export function replaceLayer<C extends SurfaceContext>(
  binding: SurfaceBinding<C> | null,
  layerId: string,
  nextLayer: Layer
): SurfaceBinding<C> {
  return updateInlineSurface(binding, (surface) =>
    createSurface(
      surface.layers.map((layer) =>
        layer.layerId === layerId ? cloneLayer(nextLayer) : cloneLayer(layer)
      ),
      surface.context
    ) as Surface<C>
  );
}

export function appendLayer<C extends SurfaceContext>(
  binding: SurfaceBinding<C> | null,
  layer: Layer
): SurfaceBinding<C> {
  return updateInlineSurface(binding, (surface) =>
    createSurface(
      [...surface.layers.map(cloneLayer), cloneLayer(layer)],
      surface.context
    ) as Surface<C>
  );
}

export function deleteLayer<C extends SurfaceContext>(
  binding: SurfaceBinding<C> | null,
  layerId: string
): SurfaceBinding<C> {
  return updateInlineSurface(binding, (surface) =>
    createSurface(
      surface.layers.filter((layer) => layer.layerId !== layerId).map(cloneLayer),
      surface.context
    ) as Surface<C>
  );
}

export function moveLayer<C extends SurfaceContext>(
  binding: SurfaceBinding<C> | null,
  layerId: string,
  direction: "up" | "down"
): SurfaceBinding<C> {
  return updateInlineSurface(binding, (surface) => {
    const layers = surface.layers.map(cloneLayer);
    const currentIndex = layers.findIndex((layer) => layer.layerId === layerId);
    if (currentIndex < 0) {
      return surface;
    }
    const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (nextIndex <= 0 || nextIndex >= layers.length) {
      return surface;
    }
    const [moved] = layers.splice(currentIndex, 1);
    layers.splice(nextIndex, 0, moved!);
    return createSurface(layers, surface.context) as Surface<C>;
  });
}
