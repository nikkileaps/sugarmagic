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
  createEnvironmentSceneController,
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

function directionFromAngles(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const azimuth = THREE.MathUtils.degToRad(azimuthDeg);
  const elevation = THREE.MathUtils.degToRad(elevationDeg);
  const horizontal = Math.cos(elevation);
  return new THREE.Vector3(
    Math.sin(azimuth) * horizontal,
    Math.sin(elevation),
    Math.cos(azimuth) * horizontal
  ).normalize();
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

    const expectedDirection = directionFromAngles(
      environment.lighting.sun.azimuthDeg,
      environment.lighting.sun.elevationDeg
    );
    expect(sun!.position.clone().normalize().distanceTo(expectedDirection)).toBeLessThan(
      0.0001
    );
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
});
