/**
 * Environment scene controller.
 *
 * Owns the Three.js realization of authored environments for Studio and the
 * published web runtime. runtime-core resolves authored meaning; this module
 * turns the resolved environment definition into concrete lights and sky
 * meshes. Fog is intentionally not realized here; the authored fog-tint
 * post-process graph is the sole runtime enforcer for fog semantics.
 */

import * as THREE from "three";
import type {
  ContentLibrarySnapshot,
  EnvironmentDefinition,
  RegionDocument,
  SunLight
} from "@sugarmagic/domain";
import {
  type EnvironmentApplyResult,
  computeSkyDrivenAmbient,
  resolveEnvironmentDefinition,
  resolveAmbientLighting
} from "@sugarmagic/runtime-core";
import { buildSkyMaterial } from "./skyMaterial";

export interface EnvironmentSceneController {
  apply: (
    region: RegionDocument | null,
    contentLibrary: ContentLibrarySnapshot,
    overrideEnvironmentId?: string | null
  ) => EnvironmentApplyResult;
  clear: () => void;
  dispose: () => void;
}

function directionFromAngles(
  azimuthDeg: number,
  elevationDeg: number
): THREE.Vector3 {
  const azimuth = THREE.MathUtils.degToRad(azimuthDeg);
  const elevation = THREE.MathUtils.degToRad(elevationDeg);
  const horizontal = Math.cos(elevation);
  return new THREE.Vector3(
    Math.sin(azimuth) * horizontal,
    Math.sin(elevation),
    Math.cos(azimuth) * horizontal
  ).normalize();
}

function createDirectionalLight(
  lightDefinition: Pick<SunLight, "azimuthDeg" | "elevationDeg" | "color" | "intensity"> & {
    castShadows?: boolean;
  }
): THREE.DirectionalLight {
  const light = new THREE.DirectionalLight(
    lightDefinition.color,
    lightDefinition.intensity
  );
  const direction = directionFromAngles(
    lightDefinition.azimuthDeg,
    lightDefinition.elevationDeg
  );
  light.position.copy(direction.multiplyScalar(24));
  light.castShadow = Boolean(lightDefinition.castShadows);

  if (light.castShadow) {
    // Default DirectionalLight shadow camera is a -5..5 frustum, which is
    // smaller than most authored buildings — nothing inside the frustum,
    // nothing in the shadow map. Expand to ~100m square at 2K resolution
    // with bias values that prevent the most common shadow acne.
    light.shadow.mapSize.set(2048, 2048);
    light.shadow.camera.left = -50;
    light.shadow.camera.right = 50;
    light.shadow.camera.top = 50;
    light.shadow.camera.bottom = -50;
    light.shadow.camera.near = 0.5;
    light.shadow.camera.far = 200;
    light.shadow.bias = -0.0001;
    light.shadow.normalBias = 0.05;
  }

  return light;
}

function createAmbientLight(definition: EnvironmentDefinition): THREE.Light {
  const resolvedAmbient = resolveAmbientLighting(definition);

  // Flat mode = truly uniform ambient on every surface regardless of normal.
  // HemisphereLight is fundamentally directional (sky vs ground), so using it
  // for flat mode under-illuminates vertical surfaces — that's exactly what
  // produced the pitch-black building walls. AmbientLight matches the legacy
  // pre-epic behavior and matches what authors mean when they pick "flat".
  if (resolvedAmbient.mode === "flat") {
    return new THREE.AmbientLight(
      resolvedAmbient.resolvedColor,
      resolvedAmbient.resolvedIntensity
    );
  }

  // Sky-driven mode = hemispheric ambient where upward-facing surfaces pick
  // up the sky's top color and downward-facing surfaces pick up the bottom.
  // The bottom color is used directly (not darkened) — the previous × 0.65
  // multiplier crushed wall ambient on every preset.
  return new THREE.HemisphereLight(
    resolvedAmbient.resolvedColor,
    definition.atmosphere.sky.bottomColor,
    resolvedAmbient.resolvedIntensity
  );
}

export function createEnvironmentSceneController(
  scene: THREE.Scene
): EnvironmentSceneController {
  const ownedLights: THREE.Light[] = [];
  let skyMesh: THREE.Mesh | null = null;

  function clearSkyMesh() {
    if (!skyMesh) {
      return;
    }
    scene.remove(skyMesh);
    skyMesh.geometry.dispose();
    if (Array.isArray(skyMesh.material)) {
      for (const material of skyMesh.material) {
        material.dispose();
      }
    } else {
      skyMesh.material.dispose();
    }
    skyMesh = null;
  }

  function clear() {
    for (const light of ownedLights) {
      scene.remove(light);
    }
    ownedLights.length = 0;
    clearSkyMesh();
  }

  return {
    apply(region, contentLibrary, overrideEnvironmentId = null) {
      clear();

      const definition = resolveEnvironmentDefinition(
        region,
        contentLibrary,
        overrideEnvironmentId
      );
      if (!definition) {
        return {
          definitionId: null,
          preset: null,
          warnings: [
            {
              code: "environment-missing",
              message: "No environment definition could be resolved for the scene."
            }
          ]
        };
      }

      scene.background = null;

      const ambientLight = createAmbientLight(definition);
      scene.add(ambientLight);
      ownedLights.push(ambientLight);

      const sunLight = createDirectionalLight(definition.lighting.sun);
      scene.add(sunLight);
      ownedLights.push(sunLight);

      if (definition.lighting.rim) {
        const rimLight = createDirectionalLight({
          ...definition.lighting.rim,
          castShadows: false
        });
        scene.add(rimLight);
        ownedLights.push(rimLight);
      }

      if (definition.atmosphere.sky.enabled) {
        skyMesh = new THREE.Mesh(
          new THREE.SphereGeometry(250, 48, 24),
          buildSkyMaterial(definition)
        );
        skyMesh.name = "environment-sky";
        scene.add(skyMesh);
      }

      return {
        definitionId: definition.definitionId,
        preset: definition.lighting.preset,
        warnings: []
      };
    },
    clear,
    dispose() {
      clear();
      scene.background = null;
    }
  };
}
