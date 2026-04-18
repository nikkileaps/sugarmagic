/**
 * Environment scene controller.
 *
 * Owns the Three.js realization of authored environments for Studio and the
 * published web runtime. runtime-core resolves authored meaning; this module
 * turns the resolved environment definition into concrete lights and sky
 * meshes. Fog is intentionally not realized here; the authored fog-tint
 * post-process graph is the sole runtime enforcer for fog semantics.
 *
 * Shadow contract (Plan 030 Story 3):
 *
 * - Sun shadows are realized via Three's WebGPU `CSMShadowNode`, parameterized
 *   by authored `SunShadowSettings` on the environment definition.
 * - `expandShadowQuality()` from runtime-core maps the authored quality preset
 *   to concrete cascade count / map size / PCF sample count.
 * - Quality changes trigger a full CSM rebuild (different cascade count
 *   allocates different GPU resources). Other shadow parameters (distance,
 *   strength, softness, bias, normalBias) update the existing rig in place
 *   via uniform/property mutation — no rebuild. This parallels the
 *   cache-and-mutate pattern ShaderRuntime uses for bloom and similar
 *   effect nodes: a long-lived pipeline caches compiled shader programs by
 *   graph structure, so recreating the rig on each apply would silently
 *   keep the old parameters baked into the cached program.
 * - Rim/fill lights never cast shadows — they're non-shadowing by design,
 *   enforced at light construction.
 */

import * as THREE from "three";
import { CSMShadowNode } from "three/examples/jsm/csm/CSMShadowNode.js";
import type {
  ContentLibrarySnapshot,
  EnvironmentDefinition,
  RegionDocument,
  RimLight,
  ShadowQuality,
  SunLight,
  SunShadowSettings
} from "@sugarmagic/domain";
import {
  type EnvironmentApplyResult,
  computeSkyDrivenAmbient,
  expandShadowQuality,
  resolveEnvironmentDefinition,
  resolveAmbientLighting
} from "@sugarmagic/runtime-core";
import { buildSkyMaterial } from "./skyMaterial";
import { sunPositionDirectionFromAngles } from "./sunVectors";

export interface EnvironmentSceneController {
  apply: (
    region: RegionDocument | null,
    contentLibrary: ContentLibrarySnapshot,
    overrideEnvironmentId?: string | null
  ) => EnvironmentApplyResult;
  /**
   * Update shadow parameters on the currently-applied sun without re-running
   * the full environment apply path. Hosts should call this from the shadow
   * inspector commit path. Quality changes rebuild the CSM rig; other
   * parameters mutate the existing rig in place.
   */
  updateShadowParameters: (shadows: SunShadowSettings) => void;
  clear: () => void;
  dispose: () => void;
}

/**
 * Directional light + attached CSM rig for the sun. The rig is tracked so we
 * can update cheap parameters (distance, strength, softness, bias) in place
 * and only rebuild on quality changes.
 */
interface SunShadowRig {
  readonly csm: CSMShadowNode;
  readonly quality: ShadowQuality;
}

function createSunLight(sun: SunLight): THREE.DirectionalLight {
  const light = new THREE.DirectionalLight(sun.color, sun.intensity);
  const direction = sunPositionDirectionFromAngles(sun.azimuthDeg, sun.elevationDeg);
  light.position.copy(direction.multiplyScalar(24));
  light.target.position.set(0, 0, 0);
  return light;
}

function createNonShadowingDirectionalLight(
  definition: Pick<SunLight, "azimuthDeg" | "elevationDeg" | "color" | "intensity">
): THREE.DirectionalLight {
  const light = new THREE.DirectionalLight(definition.color, definition.intensity);
  const direction = sunPositionDirectionFromAngles(
    definition.azimuthDeg,
    definition.elevationDeg
  );
  light.position.copy(direction.multiplyScalar(24));
  light.target.position.set(0, 0, 0);
  light.castShadow = false;
  return light;
}

/**
 * Configure the base DirectionalLight shadow properties from authored
 * settings. These are cloned by CSMShadowNode onto each cascade during
 * `_init`, so setting them before CSM construction is the canonical entry
 * point. For in-place updates on an existing rig, mutate each cascade's
 * cloned shadow directly via updateSunShadowRig().
 */
function configureLightShadow(
  light: THREE.DirectionalLight,
  shadows: SunShadowSettings,
  mapSize: number
): void {
  light.castShadow = true;
  light.shadow.mapSize.set(mapSize, mapSize);
  light.shadow.bias = shadows.bias;
  light.shadow.normalBias = shadows.normalBias;
  // Shadow intensity maps to "strength" — 0 = no darkening, 1 = full.
  light.shadow.intensity = shadows.strength;
  // PCF radius is mapSize-relative; softness 0..1 scales it sensibly.
  light.shadow.radius = Math.max(1, shadows.softness * 8);
}

/**
 * Build a fresh CSM rig for the given sun + authored shadow settings. The
 * returned rig owns the CSMShadowNode. Attach via `light.shadow.shadowNode`.
 *
 * Called on first apply, when `shadows.enabled` flips on, or when
 * `shadows.quality` changes (quality change requires a different number of
 * cascades and a different GPU-allocated map size, so we cannot mutate in
 * place).
 */
function buildSunShadowRig(
  light: THREE.DirectionalLight,
  shadows: SunShadowSettings
): SunShadowRig {
  const expanded = expandShadowQuality(shadows.quality);
  configureLightShadow(light, shadows, expanded.mapSize);

  const csm = new CSMShadowNode(light, {
    cascades: expanded.cascadeCount,
    maxFar: shadows.distance,
    // "practical" is the standard Three default — balanced near/far
    // distribution. Not exposed as an author choice (see epic).
    mode: "practical",
    lightMargin: 200
  });
  csm.fade = true;

  // Attach to the light's shadow slot so AnalyticLightNode picks it up
  // as the custom shadow node during the render pass.
  (light.shadow as unknown as { shadowNode: CSMShadowNode }).shadowNode = csm;

  return { csm, quality: shadows.quality };
}

/**
 * Update an existing CSM rig in place for cheap parameter changes. No GPU
 * resource reallocation — only uniform/property writes that propagate on
 * the next frame.
 */
function updateSunShadowRig(
  rig: SunShadowRig,
  light: THREE.DirectionalLight,
  shadows: SunShadowSettings
): void {
  light.shadow.bias = shadows.bias;
  light.shadow.normalBias = shadows.normalBias;
  light.shadow.intensity = shadows.strength;
  light.shadow.radius = Math.max(1, shadows.softness * 8);

  // CSMShadowNode clones light.shadow once per cascade at init time, so the
  // cloned cascade shadows also need their properties updated. The clone
  // scales bias by (cascadeIndex + 1), which we preserve.
  for (let i = 0; i < rig.csm.lights.length; i++) {
    const cascadeLight = rig.csm.lights[i];
    if (cascadeLight?.shadow) {
      cascadeLight.shadow.bias = shadows.bias * (i + 1);
      cascadeLight.shadow.normalBias = shadows.normalBias;
      cascadeLight.shadow.intensity = shadows.strength;
      cascadeLight.shadow.radius = Math.max(1, shadows.softness * 8);
    }
  }

  if (rig.csm.maxFar !== shadows.distance) {
    rig.csm.maxFar = shadows.distance;
    // Distance changes reshape the cascade frustums; updateFrustums is the
    // supported public entry point for reshaping without a full rebuild.
    if (rig.csm.camera) {
      rig.csm.updateFrustums();
    }
  }
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
  // Long-lived light + shadow rig state. Persisted across apply() calls so
  // that cheap parameter edits (sun direction, shadow distance/strength/
  // softness, etc.) flow as in-place mutations rather than teardown-and-
  // rebuild. The CSM rig is especially expensive to rebuild (GPU cascade
  // map allocations), so we only dispose it when the environment actually
  // changes or when shadow quality changes. Same cache-and-mutate pattern
  // as ShaderRuntime uses for bloom and parameter uniforms.
  let ambientLight: THREE.Light | null = null;
  let sunLight: THREE.DirectionalLight | null = null;
  let rimLight: THREE.DirectionalLight | null = null;
  let sunShadowRig: SunShadowRig | null = null;
  let skyMesh: THREE.Mesh | null = null;
  let lastEnvironmentId: string | null = null;

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

  function disposeSunShadowRig() {
    if (!sunShadowRig) {
      return;
    }
    sunShadowRig.csm.dispose();
    sunShadowRig = null;
  }

  function removeLight(light: THREE.Light | null) {
    if (!light) return;
    scene.remove(light);
    if (light instanceof THREE.DirectionalLight) {
      scene.remove(light.target);
    }
  }

  function clear() {
    disposeSunShadowRig();
    removeLight(ambientLight);
    ambientLight = null;
    removeLight(sunLight);
    sunLight = null;
    removeLight(rimLight);
    rimLight = null;
    clearSkyMesh();
    lastEnvironmentId = null;
  }

  function applyAmbient(definition: EnvironmentDefinition) {
    // Ambient mode (flat vs sky-driven) determines the Three class, so we
    // always rebuild ambient — it's O(microseconds), no GPU allocation.
    removeLight(ambientLight);
    ambientLight = createAmbientLight(definition);
    scene.add(ambientLight);
  }

  function applySunLight(sun: SunLight) {
    // Mutate existing sun light in place when possible. Position/color/
    // intensity changes are free; replacing the DirectionalLight would
    // invalidate any attached CSM rig (which holds the light reference
    // internally), so reuse is required for the shadow cache to matter.
    if (!sunLight) {
      sunLight = createSunLight(sun);
      scene.add(sunLight);
      scene.add(sunLight.target);
      return;
    }
    const direction = sunPositionDirectionFromAngles(sun.azimuthDeg, sun.elevationDeg);
    sunLight.position.copy(direction.multiplyScalar(24));
    sunLight.color.setHex(sun.color);
    sunLight.intensity = sun.intensity;
  }

  function applySunShadows(shadows: SunShadowSettings) {
    if (!sunLight) return;
    if (!shadows.enabled) {
      disposeSunShadowRig();
      sunLight.castShadow = false;
      return;
    }
    if (!sunShadowRig) {
      sunShadowRig = buildSunShadowRig(sunLight, shadows);
      return;
    }
    if (sunShadowRig.quality !== shadows.quality) {
      // Quality change is the one shadow parameter that requires a rebuild
      // (different cascade count, different map size = different GPU
      // allocation). Everything else stays in place.
      disposeSunShadowRig();
      sunShadowRig = buildSunShadowRig(sunLight, shadows);
      return;
    }
    updateSunShadowRig(sunShadowRig, sunLight, shadows);
  }

  function applyRimLight(rim: RimLight | null) {
    if (!rim) {
      removeLight(rimLight);
      rimLight = null;
      return;
    }
    if (!rimLight) {
      rimLight = createNonShadowingDirectionalLight(rim);
      scene.add(rimLight);
      scene.add(rimLight.target);
      return;
    }
    const direction = sunPositionDirectionFromAngles(rim.azimuthDeg, rim.elevationDeg);
    rimLight.position.copy(direction.multiplyScalar(24));
    rimLight.color.setHex(rim.color);
    rimLight.intensity = rim.intensity;
  }

  function applySky(definition: EnvironmentDefinition) {
    // Sky is a full rebuild every apply for now — the gradient material
    // pulls many uniforms and the sphere geometry is tiny. Revisit if
    // profile data shows it mattering.
    clearSkyMesh();
    if (definition.atmosphere.sky.enabled) {
      skyMesh = new THREE.Mesh(
        new THREE.SphereGeometry(250, 48, 24),
        buildSkyMaterial(definition)
      );
      skyMesh.name = "environment-sky";
      scene.add(skyMesh);
    }
  }

  return {
    apply(region, contentLibrary, overrideEnvironmentId = null) {
      const definition = resolveEnvironmentDefinition(
        region,
        contentLibrary,
        overrideEnvironmentId
      );
      if (!definition) {
        clear();
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

      // Full teardown only when switching to a different environment. Same-
      // environment re-applies (the common case during live slider edits)
      // mutate existing lights and the CSM rig in place.
      if (lastEnvironmentId !== definition.definitionId) {
        clear();
      }
      lastEnvironmentId = definition.definitionId;

      scene.background = null;

      applyAmbient(definition);
      applySunLight(definition.lighting.sun);
      applySunShadows(definition.lighting.sun.shadows);
      applyRimLight(definition.lighting.rim);
      applySky(definition);

      return {
        definitionId: definition.definitionId,
        preset: definition.lighting.preset,
        warnings: []
      };
    },
    updateShadowParameters(shadows) {
      // Direct entry point exposed for hosts that know they're only editing
      // shadow settings. apply() takes the same fast path when it detects
      // the environment hasn't changed, so in practice most callers just
      // re-run apply and don't need this — but keeping it in the interface
      // makes the contract explicit: shadows have a cheap update path.
      applySunShadows(shadows);
    },
    clear,
    dispose() {
      clear();
      scene.background = null;
    }
  };
}
