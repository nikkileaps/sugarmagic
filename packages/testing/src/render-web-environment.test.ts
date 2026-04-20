/**
 * render-web environment tests.
 *
 * Verifies the Three.js realization of authored environments and the ordered
 * application of the authored post-process stack through the shared web
 * render package.
 */

import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  createDefaultEnvironmentDefinition,
  createDefaultRegionLandscapeState,
  createEmptyContentLibrarySnapshot,
  type ContentLibrarySnapshot,
  type RegionDocument
} from "@sugarmagic/domain";
import {
  applyPostProcessStack,
  assignRenderPipelineOutputNode,
  createRenderableShaderApplicationState,
  createEnvironmentSceneController,
  // Canonical authored sun-vector semantics shared by the light rig and shader runtime.
  ensureShaderSetAppliedToRenderable,
  sunIncomingDirectionFromAngles,
  sunPositionDirectionFromAngles,
  type RuntimeRenderPipeline,
  type ShaderRuntime
} from "@sugarmagic/render-web";

function makeRegion(environmentId: string): RegionDocument {
  return {
    identity: { id: "region:a", schema: "RegionDocument", version: 1 },
    displayName: "Region A",
    placement: { gridPosition: { x: 0, y: 0 }, placementPolicy: "world-grid" },
    scene: {
      folders: [],
      placedAssets: [],
      playerPresence: null,
      npcPresences: [],
      itemPresences: []
    },
    environmentBinding: { defaultEnvironmentId: environmentId },
    areas: [],
    behaviors: [],
    landscape: createDefaultRegionLandscapeState({ enabled: false }),
    markers: [],
    gameplayPlacements: []
  };
}

function makeContentLibrary(): ContentLibrarySnapshot {
  const snapshot = createEmptyContentLibrarySnapshot("project");
  const environment = createDefaultEnvironmentDefinition("project", {
    definitionId: "project:environment:test",
    displayName: "Test Environment",
    preset: "golden_hour"
  });

  return {
    ...snapshot,
    environmentDefinitions: [environment]
  };
}

describe("render-web environment", () => {
  it("realizes the authored sun direction and never assigns scene fog", () => {
    const scene = new THREE.Scene();
    const contentLibrary = makeContentLibrary();
    const environment = contentLibrary.environmentDefinitions[0]!;
    environment.lighting.sun.azimuthDeg = 130;
    environment.lighting.sun.elevationDeg = 35;

    const controller = createEnvironmentSceneController(scene);
    controller.apply(makeRegion(environment.definitionId), contentLibrary);

    const sun = scene.children.find(
      (child): child is THREE.DirectionalLight => child instanceof THREE.DirectionalLight
    );
    expect(sun).toBeTruthy();
    expect(scene.fog).toBeNull();

    const expectedDirection = sunPositionDirectionFromAngles(
      environment.lighting.sun.azimuthDeg,
      environment.lighting.sun.elevationDeg
    );
    expect(sun!.position.clone().normalize().distanceTo(expectedDirection)).toBeLessThan(
      0.0001
    );
  });

  it("defines shader sun direction as the incoming light vector, opposite the light position vector", () => {
    const positionDirection = sunPositionDirectionFromAngles(155, 68);
    const incomingDirection = sunIncomingDirectionFromAngles(155, 68);

    expect(positionDirection.dot(incomingDirection)).toBeCloseTo(-1, 5);
  });

  it("applies the resolved post-process stack in authored order", () => {
    const contentLibrary = createEmptyContentLibrarySnapshot("project");
    const calls: string[] = [];
    const setOutput = vi.fn();
    const shaderRuntime = {
      applyShader(binding: { shaderDefinitionId: string }) {
        calls.push(binding.shaderDefinitionId);
        return `${binding.shaderDefinitionId}:output`;
      }
    } as unknown as ShaderRuntime;
    const renderPipeline = {
      getBaseOutputNode: () => "scene-color",
      setPostProcessOutputNode: setOutput
    } as unknown as RuntimeRenderPipeline;

    applyPostProcessStack({
      shaderRuntime,
      renderPipeline,
      contentLibrary,
      chain: [
        {
          shaderDefinitionId: "project:shader:tonemap-reinhard",
          order: 2,
          enabled: true,
          parameterOverrides: []
        },
        {
          shaderDefinitionId: "project:shader:color-grade",
          order: 1,
          enabled: true,
          parameterOverrides: []
        }
      ]
    });

    expect(calls).toEqual([
      "project:shader:color-grade",
      "project:shader:tonemap-reinhard"
    ]);
    expect(setOutput).toHaveBeenCalledWith(
      "project:shader:tonemap-reinhard:output"
    );
  });

  it("invalidates the render pipeline when the post-process output node changes", () => {
    const pipeline = {
      outputNode: "old-output",
      needsUpdate: false
    } as unknown as {
      outputNode: unknown;
      needsUpdate: boolean;
    };

    assignRenderPipelineOutputNode(pipeline as never, "new-output", "base-output");

    expect(pipeline.outputNode).toBe("new-output");
    expect(pipeline.needsUpdate).toBe(true);

    assignRenderPipelineOutputNode(pipeline as never, null, "base-output");

    expect(pipeline.outputNode).toBe("base-output");
    expect(pipeline.needsUpdate).toBe(true);
  });

  it("does not treat a renderable as shader-applied until meshes actually exist", () => {
    const shaderRuntime = {
      applyShaderSet: vi.fn((bindingSet: unknown, context: { material: THREE.Material }) => context.material)
    } as unknown as ShaderRuntime;
    const state = createRenderableShaderApplicationState();
    const root = new THREE.Group();
    const object = {
      representationKey: "asset:tree:foliage-shaders",
      effectiveShaders: {
        surface: {
          shaderDefinitionId: "project:shader:foliage-surface",
          targetKind: "mesh-surface",
          documentRevision: 1,
          parameterValues: {},
          parameterOverrides: []
        },
        deform: null
      }
    } as never;

    ensureShaderSetAppliedToRenderable(root, object, shaderRuntime, state);
    expect(state.appliedShaderSignature).toBeNull();

    root.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: 0xffffff })
      )
    );

    ensureShaderSetAppliedToRenderable(root, object, shaderRuntime, state);
    expect(state.appliedShaderSignature).toBe("asset:tree:foliage-shaders");
  });

  it("treats a material-slot-only surface binding as renderable shader intent", () => {
    const shaderRuntime = {
      applyShaderSet: vi.fn((bindingSet: unknown, context: { material: THREE.Material }) => context.material)
    } as unknown as ShaderRuntime;
    const state = createRenderableShaderApplicationState();
    const root = new THREE.Group();
    root.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: 0xffffff, name: "Wordlark Brick" })
      )
    );
    const object = {
      representationKey: "asset:cube:material-slot-only",
      effectiveShaders: {
        surface: null,
        deform: null
      },
      effectiveMaterialSlots: [
        {
          slotName: "Wordlark Brick",
          slotIndex: 0,
          materialDefinitionId: "project:material:brick",
          surface: {
            shaderDefinitionId: "project:shader:standard-pbr",
            targetKind: "mesh-surface",
            documentRevision: 2,
            parameterValues: {},
            textureBindings: {
              basecolor_texture: "project:texture:brick-base"
            },
            parameterOverrides: []
          }
        }
      ]
    } as never;

    ensureShaderSetAppliedToRenderable(root, object, shaderRuntime, state);

    expect(state.appliedShaderSignature).toBe("asset:cube:material-slot-only");
    expect(shaderRuntime.applyShaderSet).toHaveBeenCalled();
  });

  it("reapplies shared shaders when authored file sources change", () => {
    const shaderRuntime = {
      applyShaderSet: vi.fn((bindingSet: unknown, context: { material: THREE.Material }) => context.material),
      releaseMaterial: vi.fn()
    } as unknown as ShaderRuntime;
    const state = createRenderableShaderApplicationState();
    const root = new THREE.Group();
    root.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: 0xffffff })
      )
    );
    const object = {
      representationKey: "asset:cube:textured",
      effectiveShaders: {
        surface: {
          shaderDefinitionId: "project:shader:standard-pbr",
          targetKind: "mesh-surface",
          documentRevision: 2,
          parameterValues: {},
          textureBindings: {
            basecolor_texture: "project:texture:brick-base"
          },
          parameterOverrides: []
        },
        deform: null
      },
      effectiveMaterialSlots: []
    } as never;

    const firstSources = {
      "assets/textures/brick-base.png": "blob:one"
    };
    const secondSources = {
      "assets/textures/brick-base.png": "blob:two"
    };

    ensureShaderSetAppliedToRenderable(root, object, shaderRuntime, state, firstSources);
    ensureShaderSetAppliedToRenderable(root, object, shaderRuntime, state, secondSources);

    expect(shaderRuntime.applyShaderSet).toHaveBeenCalledTimes(2);
    expect(state.appliedShaderSignature).toBe("asset:cube:textured");
    expect(state.appliedFileSources).toBe(secondSources);
  });
});
