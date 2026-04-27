/**
 * Surface noise helpers.
 *
 * Owns the deterministic CPU-side scalar noise sampling used by authoring
 * previews and other non-TSL evaluation paths. render-web's shader
 * materialization implements the same authored mask meaning on the GPU.
 */

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hashAngle(ix: number, iy: number): number {
  const seed = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453123;
  const fract = seed - Math.floor(seed);
  return fract * Math.PI * 2;
}

function gradientDot(ix: number, iy: number, x: number, y: number): number {
  const angle = hashAngle(ix, iy);
  const gx = Math.cos(angle);
  const gy = Math.sin(angle);
  return gx * (x - ix) + gy * (y - iy);
}

function gradientNoise2d(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const sx = fade(x - x0);
  const sy = fade(y - y0);

  const n00 = gradientDot(x0, y0, x, y);
  const n10 = gradientDot(x1, y0, x, y);
  const n01 = gradientDot(x0, y1, x, y);
  const n11 = gradientDot(x1, y1, x, y);

  const ix0 = lerp(n00, n10, sx);
  const ix1 = lerp(n01, n11, sx);
  return lerp(ix0, ix1, sy);
}

export function samplePerlinNoise2d(options: {
  x: number;
  y: number;
  octaves?: number;
  lacunarity?: number;
  gain?: number;
}): number {
  const {
    x,
    y,
    octaves = 4,
    lacunarity = 2,
    gain = 0.5
  } = options;

  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let amplitudeSum = 0;

  for (let octave = 0; octave < octaves; octave += 1) {
    total += gradientNoise2d(x * frequency, y * frequency) * amplitude;
    amplitudeSum += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }

  if (amplitudeSum <= 0) {
    return 0.5;
  }

  const normalized = total / amplitudeSum;
  return Math.max(0, Math.min(1, normalized * 0.5 + 0.5));
}
