import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { ShaderRuntime } from "@sugarmagic/render-web";
import {
  resolveSceneObjects,
  resolveEffectivePostProcessShaderBindings,
  compileShaderGraph,
  type EffectiveShaderBinding
} from "@sugarmagic/runtime-core";
import {
  createDefaultEnvironmentDefinition,
  createDefaultFoliageTintShaderGraph,
  createDefaultFoliageWindShaderGraph,
  createDefaultShaderGraphDocument,
  createPlacedAssetInstance,
  createRegionPlayerPresence,
  type ContentLibrarySnapshot,
  type RegionDocument
} from "@sugarmagic/domain";

function createContentLibrary(): ContentLibrarySnapshot {
  const foliageShader = createDefaultFoliageWindShaderGraph("project");
  const postProcessShader = {
    ...createDefaultShaderGraphDocument("project", {
      shaderDefinitionId: "project:shader:post-process-test",
      displayName: "Post Process Test",
      targetKind: "post-process"
    }),
    revision: 2,
    parameters: [
      {
        parameterId: "intensity",
        displayName: "Intensity",
        dataType: "float" as const,
        defaultValue: 0.5
      }
    ]
  };

  return {
    identity: {
      id: "project:content-library",
      schema: "ContentLibrarySnapshot",
      version: 1
    },
    assetDefinitions: [
      {
        definitionId: "asset:tree",
        definitionKind: "asset",
        displayName: "Tree",
        assetKind: "foliage",
        defaultShaderDefinitionId: null,
        source: {
          relativeAssetPath: "assets/imported/tree.glb",
          fileName: "tree.glb",
          mimeType: "model/gltf-binary"
        }
      }
    ],
    environmentDefinitions: [
      createDefaultEnvironmentDefinition("project", {
        definitionId: "env:default",
        displayName: "Default"
      })
    ],
    shaderDefinitions: [foliageShader, postProcessShader]
  };
}

function createRegion(): RegionDocument {
  return {
    identity: { id: "region:one", schema: "RegionDocument", version: 1 },
    displayName: "Region",
    placement: { gridPosition: { x: 0, y: 0 }, placementPolicy: "world-grid" },
    scene: {
      folders: [],
      placedAssets: [
        createPlacedAssetInstance({
          instanceId: "placed:tree",
          assetDefinitionId: "asset:tree",
          displayName: "Tree",
          transform: {
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1]
          }
        })
      ],
      playerPresence: createRegionPlayerPresence(),
      npcPresences: [],
      itemPresences: []
    },
    environmentBinding: { defaultEnvironmentId: "env:default" },
    areas: [],
    behaviors: [],
    landscape: {
      enabled: false,
      size: 100,
      subdivisions: 32,
      channels: [],
      paintPayload: null
    },
    markers: [],
    gameplayPlacements: []
  };
}

describe("shader runtime contracts", () => {
  it("resolves the built-in foliage wind shader for foliage assets without an explicit default", () => {
    const contentLibrary = createContentLibrary();
    const sceneObjects = resolveSceneObjects(createRegion(), { contentLibrary });
    const treeObject = sceneObjects.find((object) => object.instanceId === "placed:tree");

    expect(treeObject?.effectiveShader?.shaderDefinitionId).toBe(
      "project:shader:foliage-wind"
    );
    expect(treeObject?.effectiveShader?.targetKind).toBe("mesh-deform");
  });

  it("resolves post-process defaults plus parameter overrides before the web host applies them", () => {
    const contentLibrary = createContentLibrary();
    const bindings = resolveEffectivePostProcessShaderBindings(
      [
        {
          shaderDefinitionId: "project:shader:post-process-test",
          order: 0,
          enabled: true,
          parameterOverrides: [{ parameterId: "intensity", value: 1.25 }]
        }
      ],
      contentLibrary
    );

    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.documentRevision).toBe(2);
    expect(bindings[0]?.parameterValues).toEqual({ intensity: 1.25 });
  });

  it("compiles the shipped foliage wind graph into vertex IR with a concrete vertex output", () => {
    const shader = createDefaultFoliageWindShaderGraph("project");
    const compiled = compileShaderGraph(shader, {
      compileProfile: "authoring-preview"
    });

    expect(compiled.targetKind).toBe("mesh-deform");
    expect(compiled.outputs.vertex).toBeDefined();
    expect(
      compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")
    ).toEqual([]);
  });

  it("compiles the shipped foliage tint graph into fragment IR with a concrete fragment output", () => {
    const shader = createDefaultFoliageTintShaderGraph("project");
    const compiled = compileShaderGraph(shader, {
      compileProfile: "authoring-preview"
    });

    expect(compiled.targetKind).toBe("mesh-surface");
    expect(compiled.outputs.fragmentColor).toBeDefined();
    expect(
      compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")
    ).toEqual([]);
  });

  it("keeps shared finalized materials alive until all references release and the grace period elapses", () => {
    vi.useFakeTimers();
    try {
      const shader = createDefaultFoliageTintShaderGraph("project");
      const runtime = new ShaderRuntime({
        contentLibrary: {
          identity: {
            id: "project:content-library",
            schema: "ContentLibrarySnapshot",
            version: 1
          },
          assetDefinitions: [],
          environmentDefinitions: [],
          shaderDefinitions: [shader]
        },
        compileProfile: "authoring-preview",
        materialDisposalGraceMs: 100
      });
      const binding: EffectiveShaderBinding = {
        shaderDefinitionId: shader.shaderDefinitionId,
        targetKind: shader.targetKind,
        documentRevision: shader.revision,
        parameterValues: {},
        parameterOverrides: []
      };
      const geometry = new THREE.BufferGeometry();

      const first = runtime.applyShader(binding, {
        targetKind: "mesh-surface",
        material: new THREE.MeshStandardMaterial(),
        geometry
      }) as THREE.Material;
      const second = runtime.applyShader(binding, {
        targetKind: "mesh-surface",
        material: new THREE.MeshStandardMaterial(),
        geometry
      }) as THREE.Material;

      expect(first).toBe(second);

      const disposeSpy = vi.spyOn(first, "dispose");
      runtime.releaseMaterial(first);
      runtime.invalidate(shader.shaderDefinitionId);

      vi.advanceTimersByTime(150);
      expect(disposeSpy).not.toHaveBeenCalled();

      runtime.releaseMaterial(second);
      vi.advanceTimersByTime(99);
      expect(disposeSpy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(disposeSpy).toHaveBeenCalledTimes(1);
      geometry.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
