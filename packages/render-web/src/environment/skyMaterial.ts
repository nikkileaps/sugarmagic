/**
 * Sky material construction.
 *
 * Owns the shared stylized sky node material used by both Studio and
 * published-web rendering hosts. The environment definition remains the
 * authored source of truth; this module only realizes it as a Three/WebGPU
 * material.
 */

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
import type { EnvironmentDefinition } from "@sugarmagic/domain";

export function buildSkyMaterial(
  definition: EnvironmentDefinition
): MeshBasicNodeMaterial {
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
  material.fog = false;
  return material;
}
