/**
 * Sky material construction.
 *
 * Owns the shared stylized sky node material used by both Studio and
 * published-web rendering hosts. The environment definition remains the
 * authored source of truth; this module only realizes it as a Three/WebGPU
 * material.
 *
 * Composition order: vertical gradient (two or three stops) -> saturation ->
 * cloud band composited on top. Clouds keep their authored colour rather than
 * riding the gradient's saturation, so a desaturated sky still gets clean
 * highlights.
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
  mul,
  positionWorldDirection,
  pow,
  saturation,
  smoothstep,
  step,
  sub,
  time,
  vec2
} from "three/tsl";
import type { EnvironmentDefinition, SkySettings } from "@sugarmagic/domain";
import { materializePerlinLikeNoise2d } from "../materialize/noise";

/**
 * Three-stop vertical gradient. Both branches evaluate to the mid colour at
 * the split, so selecting between them with a hard `step` is continuous --
 * no seam, and no branch in the compiled shader.
 */
function buildGradient(sky: SkySettings, height: unknown): unknown {
  const bottom = tslColor(new THREE.Color(sky.bottomColor));
  const top = tslColor(new THREE.Color(sky.topColor));

  if (!sky.gradientMidEnabled) {
    return mix(bottom, top, height as never);
  }

  const mid = tslColor(new THREE.Color(sky.gradientMidColor));
  // Clamped away from the endpoints so neither normalization divides by zero.
  const midPosition = Math.min(Math.max(sky.gradientMidPosition, 0.001), 0.999);
  const midNode = float(midPosition);

  const lower = mix(
    bottom,
    mid,
    clamp(div(height as never, midNode), float(0), float(1))
  );
  const upper = mix(
    mid,
    top,
    clamp(
      div(sub(height as never, midNode), float(1 - midPosition)),
      float(0),
      float(1)
    )
  );
  return mix(lower, upper, step(midNode, height as never));
}

/**
 * Wind-aligned cloud band.
 *
 * The sample point is the view direction's horizontal component rotated into
 * wind space, compressed along the wind axis so features stretch into stratus
 * streaks rather than reading as round blobs, then scrolled along that axis
 * over time. Coverage/softness remap the 0..1 noise into a soft mask, and the
 * band fades out at the horizon where the dome's geometry would otherwise
 * smear the sample into a hard ring.
 */
function buildCloudMask(sky: SkySettings): unknown {
  const scale = Math.max(sky.cloudScale, 0.0001);
  const angleRadians = (sky.cloudDirectionDegrees * Math.PI) / 180;
  const windX = Math.cos(angleRadians);
  const windZ = Math.sin(angleRadians);

  // Project the view direction onto a horizontal cloud plane. Sampling the
  // raw direction instead puts the whole sky inside a single noise lattice
  // cell (authored scales are single digits, direction components are
  // [-1,1]), which reads as one enormous smeared blob. The bias keeps the
  // divisor away from zero at the horizon and caps the stretch.
  const CLOUD_PLANE_BIAS = 0.35;
  const planeDivisor = add(positionWorldDirection.y, float(CLOUD_PLANE_BIAS));
  const dirX = div(positionWorldDirection.x, planeDivisor);
  const dirZ = div(positionWorldDirection.z, planeDivisor);

  // Rotate into wind space: `along` follows the wind, `across` is perpendicular.
  const along = add(mul(dirX, float(windX)), mul(dirZ, float(windZ)));
  const across = add(mul(dirX, float(-windZ)), mul(dirZ, float(windX)));

  // Puts single-digit authored scales into a range that spans enough noise
  // cells to read as cloud structure rather than one interpolated cell.
  const CLOUD_BASE_SCALE = 7;
  // Heavily compressing the along-wind axis stretches features into stratus
  // streaks; without it the noise reads as round dapples.
  const ALONG_WIND_STRETCH = 0.15;
  const alongScale = scale * CLOUD_BASE_SCALE * ALONG_WIND_STRETCH;
  const acrossScale = scale * CLOUD_BASE_SCALE;
  const scrolled = add(mul(along, float(alongScale)), mul(time, float(sky.cloudSpeed)));
  const samplePoint = vec2(scrolled, mul(across, float(acrossScale)));

  // Two frequencies: detail carries the wisp edges, and a much broader sample
  // clumps them into cloud masses with open sky between. A single frequency
  // covers the dome uniformly, which reads as camouflage rather than weather.
  const CLUMP_FREQUENCY = 0.28;
  const detail = materializePerlinLikeNoise2d(samplePoint);
  const clump = materializePerlinLikeNoise2d(
    vec2(
      mul(scrolled, float(CLUMP_FREQUENCY)),
      mul(across, float(acrossScale * CLUMP_FREQUENCY))
    )
  );
  const combined = add(
    mul(detail as never, float(0.6)),
    mul(clump as never, float(0.4))
  );

  // Higher coverage lowers the threshold, so more of the noise clears it.
  const softness = Math.max(sky.cloudSoftness, 0.0001);
  const threshold = 1 - sky.cloudCoverage;
  const density = smoothstep(
    float(threshold - softness),
    float(threshold + softness),
    combined as never
  );

  const horizonFade = smoothstep(
    float(0),
    float(0.18),
    positionWorldDirection.y
  );

  return mul(mul(density, horizonFade), float(sky.cloudOpacity));
}

/**
 * Cloud deck below the horizon, projected onto a plane UNDER the camera --
 * the floating-island cloud sea.
 *
 * Mirror image of the overhead band's projection: the divisor is built from
 * how far the view direction points DOWN, so the deck recedes toward the
 * horizon instead of overhead. The deck is faded out in the last few degrees
 * above its own horizon so it merges into the sky's bottom colour rather than
 * ending on a hard line.
 */
function applyUndercast(sky: SkySettings, baseColor: unknown): unknown {
  const scale = Math.max(sky.undercastScale, 0.0001);
  const angleRadians = (sky.cloudDirectionDegrees * Math.PI) / 180;
  const windX = Math.cos(angleRadians);
  const windZ = Math.sin(angleRadians);

  // How far below the horizon this fragment looks; 0 at the horizon.
  const below = clamp(mul(positionWorldDirection.y, float(-1)), float(0), float(1));
  const UNDERCAST_PLANE_BIAS = 0.22;
  const planeDivisor = add(below, float(UNDERCAST_PLANE_BIAS));
  const dirX = div(positionWorldDirection.x, planeDivisor);
  const dirZ = div(positionWorldDirection.z, planeDivisor);

  const along = add(mul(dirX, float(windX)), mul(dirZ, float(windZ)));
  const across = add(mul(dirX, float(-windZ)), mul(dirZ, float(windX)));

  const UNDERCAST_BASE_SCALE = 7;
  const ALONG_WIND_STRETCH = 0.35;
  const alongScale = scale * UNDERCAST_BASE_SCALE * ALONG_WIND_STRETCH;
  const acrossScale = scale * UNDERCAST_BASE_SCALE;
  const scrolled = add(mul(along, float(alongScale)), mul(time, float(sky.cloudSpeed)));
  const samplePoint = vec2(scrolled, mul(across, float(acrossScale)));

  const CLUMP_FREQUENCY = 0.3;
  const detail = materializePerlinLikeNoise2d(samplePoint);
  const clump = materializePerlinLikeNoise2d(
    vec2(
      mul(scrolled, float(CLUMP_FREQUENCY)),
      mul(across, float(acrossScale * CLUMP_FREQUENCY))
    )
  );
  const combined = add(
    mul(detail as never, float(0.55)),
    mul(clump as never, float(0.45))
  );

  // Wider window than the overhead band: this is a continuous surface being
  // shaded, not a mask cutting cloud shapes out of open sky.
  const UNDERCAST_SHADING_SOFTNESS = 0.35;
  const threshold = 1 - sky.undercastCoverage;
  const lit = smoothstep(
    float(threshold - UNDERCAST_SHADING_SOFTNESS),
    float(threshold + UNDERCAST_SHADING_SOFTNESS),
    combined as never
  );
  const deckColor = mix(
    tslColor(new THREE.Color(sky.undercastShadowColor)),
    tslColor(new THREE.Color(sky.undercastColor)),
    lit as never
  );

  // Haze-out approaching the horizon so the deck does not terminate abruptly.
  const horizonFade = smoothstep(float(0), float(0.1), below);
  const coverageAmount = mul(horizonFade, float(sky.undercastOpacity));

  return mix(baseColor as never, deckColor, coverageAmount as never);
}

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
  const height = pow(blend, float(Math.max(sky.gradientExponent, 0.0001)));

  const gradient = buildGradient(sky, height);
  const saturated = saturation(gradient as never, float(sky.saturation));

  // Overhead band first, then the deck below: they occupy opposite hemispheres,
  // so the order only matters for the thin overlap either side of the horizon,
  // where the deck should win (it is the nearer surface).
  let composited: unknown = saturated;
  if (sky.cloudsEnabled) {
    composited = mix(
      composited as never,
      tslColor(new THREE.Color(sky.cloudColor)),
      buildCloudMask(sky) as never
    );
  }
  if (sky.undercastEnabled) {
    composited = applyUndercast(sky, composited);
  }
  material.colorNode = composited as never;
  material.side = THREE.BackSide;
  material.depthWrite = false;
  material.fog = false;
  return material;
}
