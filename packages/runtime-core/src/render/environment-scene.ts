import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  add,
  clamp,
  color as tslColor,
  div,
  float,
  mix,
  positionWorldDirection,
  pow,
  saturation
} from "three/tsl";
import type {
  ContentLibrarySnapshot,
  EnvironmentDefinition,
  LightingPreset,
  RegionDocument
} from "@sugarmagic/domain";
import type { LightingAdjustments } from "@sugarmagic/domain";
import {
  type EnvironmentApplyResult,
  resolveEnvironmentDefinition
} from "../environment";

export interface EnvironmentSceneController {
  apply: (
    region: RegionDocument | null,
    contentLibrary: ContentLibrarySnapshot,
    overrideEnvironmentId?: string | null
  ) => EnvironmentApplyResult;
  clear: () => void;
  dispose: () => void;
}

interface RuntimeLightConfig {
  type: "ambient" | "directional" | "hemisphere";
  color: number;
  intensity: number;
  position?: [number, number, number];
  groundColor?: number;
  castShadow?: boolean;
}

interface LightingRigConfig {
  backgroundColor: number;
  lights: RuntimeLightConfig[];
}

const DEFAULT_BACKGROUND_COLOR = 0x2a2a2a;
const LIGHTING_PRESETS: Record<LightingPreset, LightingRigConfig> = {
  default: {
    backgroundColor: 0x2a2a2a,
    lights: [
      { type: "ambient", color: 0xffffff, intensity: 0.5 },
      {
        type: "directional",
        color: 0xffffff,
        intensity: 0.8,
        position: [5, 10, 7.5],
        castShadow: true
      }
    ]
  },
  noon: {
    backgroundColor: 0x87ceeb,
    lights: [
      {
        type: "hemisphere",
        color: 0x87ceeb,
        groundColor: 0xb08050,
        intensity: 0.6
      },
      {
        type: "directional",
        color: 0xfff5e0,
        intensity: 1.0,
        position: [2, 12, 4],
        castShadow: true
      }
    ]
  },
  late_afternoon: {
    backgroundColor: 0xb9dbf1,
    lights: [
      {
        type: "hemisphere",
        color: 0xa9d0ee,
        groundColor: 0xc88757,
        intensity: 0.62
      },
      {
        type: "directional",
        color: 0xffe2bc,
        intensity: 1.02,
        position: [7, 8, 2.5],
        castShadow: true
      },
      {
        type: "directional",
        color: 0xaebcff,
        intensity: 0.16,
        position: [-5, 4.5, -5.5],
        castShadow: false
      }
    ]
  },
  golden_hour: {
    backgroundColor: 0xffd4a3,
    lights: [
      {
        type: "hemisphere",
        color: 0xffb88c,
        groundColor: 0x886644,
        intensity: 0.5
      },
      {
        type: "directional",
        color: 0xffe0b5,
        intensity: 0.9,
        position: [8, 6, -3],
        castShadow: true
      },
      {
        type: "directional",
        color: 0x8888cc,
        intensity: 0.15,
        position: [-6, 4, 5],
        castShadow: false
      }
    ]
  },
  night: {
    backgroundColor: 0x1a1428,
    lights: [
      {
        type: "hemisphere",
        color: 0x3a2a4a,
        groundColor: 0x442a22,
        intensity: 0.4
      },
      {
        type: "directional",
        color: 0x7788aa,
        intensity: 0.3,
        position: [-4, 12, -8],
        castShadow: true
      },
      {
        type: "ambient",
        color: 0x382838,
        intensity: 0.25
      }
    ]
  }
};

function clampWarmth(value: number): number {
  return THREE.MathUtils.clamp(value, -1, 1);
}

function shiftWarmth(colorValue: number, warmth: number): number {
  if (warmth === 0) return colorValue;
  const color = new THREE.Color(colorValue);
  const amount = clampWarmth(warmth) * 0.18;
  color.offsetHSL(amount * 0.03, amount * 0.02, 0);
  color.r = THREE.MathUtils.clamp(color.r + Math.max(amount, 0) * 0.12, 0, 1);
  color.b = THREE.MathUtils.clamp(color.b + Math.min(amount, 0) * 0.12, 0, 1);
  return color.getHex();
}

function applyIntensityAdjustment(
  light: RuntimeLightConfig,
  adjustments: LightingAdjustments
): number {
  if (light.type === "ambient" || light.type === "hemisphere") {
    return light.intensity * adjustments.ambientIntensity;
  }
  return light.intensity * adjustments.keyIntensity;
}

function createThreeLight(
  config: RuntimeLightConfig,
  adjustments: LightingAdjustments
): THREE.Light {
  const color = shiftWarmth(config.color, adjustments.warmth);
  const intensity = applyIntensityAdjustment(config, adjustments);

  if (config.type === "ambient") {
    return new THREE.AmbientLight(color, intensity);
  }

  if (config.type === "hemisphere") {
    return new THREE.HemisphereLight(
      color,
      shiftWarmth(config.groundColor ?? 0x443322, adjustments.warmth * 0.5),
      intensity
    );
  }

  const light = new THREE.DirectionalLight(color, intensity);
  if (config.position) {
    light.position.set(...config.position);
  }
  light.castShadow = Boolean(config.castShadow);
  return light;
}

function buildSkyMaterial(definition: EnvironmentDefinition): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  const sky = definition.atmosphere.sky;
  const horizonBlendNode = float(sky.horizonBlend);
  const blend = clamp(
    div(
      add(positionWorldDirection.y, horizonBlendNode),
      add(float(1), horizonBlendNode)
    ),
    float(0),
    float(1)
  );
  const gradient = mix(
    tslColor(new THREE.Color(sky.bottomColor)),
    tslColor(new THREE.Color(sky.topColor)),
    pow(blend, float(Math.max(sky.gradientExponent, 0.0001)))
  );

  material.colorNode = saturation(gradient, float(sky.saturation));
  material.side = THREE.BackSide;
  material.depthWrite = false;
  material.depthTest = false;
  material.fog = false;

  return material;
}

export function createEnvironmentSceneController(
  scene: THREE.Scene
): EnvironmentSceneController {
  const ownedLights: THREE.Light[] = [];
  let skyMesh: THREE.Mesh | null = null;

  function clearObject(root: THREE.Object3D | null) {
    if (!root) return;
    scene.remove(root);
    root.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          for (const material of child.material) material.dispose();
        } else {
          child.material.dispose();
        }
      }
    });
  }

  function clear() {
    for (const light of ownedLights) {
      scene.remove(light);
    }
    ownedLights.length = 0;
    clearObject(skyMesh);
    skyMesh = null;
    scene.fog = null;
    scene.background = new THREE.Color(DEFAULT_BACKGROUND_COLOR);
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
              message:
                "No environment definition was available; the runtime fell back to a neutral background."
            }
          ]
        };
      }

      const rig = LIGHTING_PRESETS[definition.lighting.preset];

      if (definition.atmosphere.sky.enabled) {
        const geometry = new THREE.SphereGeometry(500, 24, 16);
        skyMesh = new THREE.Mesh(geometry, buildSkyMaterial(definition));
        skyMesh.renderOrder = -1000;
        scene.add(skyMesh);
        scene.background = null;
      } else {
        scene.background = new THREE.Color(rig.backgroundColor);
      }

      for (const lightConfig of rig.lights) {
        const light = createThreeLight(lightConfig, definition.lighting.adjustments);
        ownedLights.push(light);
        scene.add(light);
      }

      if (definition.atmosphere.fog.enabled) {
        const fogColor = definition.atmosphere.sky.enabled
          ? definition.atmosphere.sky.bottomColor
          : rig.backgroundColor;
        scene.fog = new THREE.FogExp2(
          fogColor,
          definition.atmosphere.fog.density
        );
      }

      return {
        definitionId: definition.definitionId,
        preset: definition.lighting.preset,
        warnings: []
      };
    },
    clear,
    dispose: clear
  };
}
