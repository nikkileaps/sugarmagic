/**
 * TSL noise helpers.
 *
 * Owns the smooth scalar noise nodes used by layer-mask materialization.
 * This keeps authored procedural-mask meaning centralized on the render-web
 * side instead of inlining ad-hoc sine patterns at every call site.
 */

import {
  dot,
  float,
  floor,
  fract,
  mix,
  sin,
  smoothstep,
  vec2
} from "three/tsl";

interface ScalarNodeLike {
  add: (other: unknown) => ScalarNodeLike;
  div: (other: unknown) => ScalarNodeLike;
  mul: (other: unknown) => ScalarNodeLike;
  sub: (other: unknown) => ScalarNodeLike;
}

interface Vec2NodeLike {
  x: unknown;
  y: unknown;
  add: (other: unknown) => Vec2NodeLike;
  mul: (other: unknown) => Vec2NodeLike;
  sub: (other: unknown) => Vec2NodeLike;
}

function hash21(point: unknown): unknown {
  return fract(
    sin(dot(point as never, vec2(127.1, 311.7) as never)).mul(
      float(43758.5453123)
    )
  );
}

function valueNoise2d(point: unknown): unknown {
  const cell = floor(point as never) as unknown as Vec2NodeLike;
  const local = fract(point as never) as unknown as Vec2NodeLike;
  const eased = local
    .mul(local)
    .mul(local.mul(local.mul(float(6)).sub(float(15))).add(float(10))) as Vec2NodeLike;

  const cell00 = cell;
  const cell10 = (cell as { add: (other: unknown) => unknown }).add(vec2(1, 0));
  const cell01 = (cell as { add: (other: unknown) => unknown }).add(vec2(0, 1));
  const cell11 = (cell as { add: (other: unknown) => unknown }).add(vec2(1, 1));

  const n00 = hash21(cell00);
  const n10 = hash21(cell10);
  const n01 = hash21(cell01);
  const n11 = hash21(cell11);

  const nx0 = mix(n00 as never, n10 as never, eased.x as never);
  const nx1 = mix(n01 as never, n11 as never, eased.x as never);
  return mix(nx0 as never, nx1 as never, eased.y as never);
}

export function materializePerlinLikeNoise2d(point: unknown): unknown {
  const pointNode = point as Vec2NodeLike;
  const octave0 = valueNoise2d(point) as unknown as ScalarNodeLike;
  const octave1 = (
    valueNoise2d(pointNode.mul(float(2))) as unknown as ScalarNodeLike
  ).mul(float(0.5));
  const octave2 = (
    valueNoise2d(pointNode.mul(float(4))) as unknown as ScalarNodeLike
  ).mul(float(0.25));
  const combined = octave0
    .add(octave1)
    .add(octave2)
    .div(float(1.75));
  return smoothstep(float(0), float(1), combined as never);
}
