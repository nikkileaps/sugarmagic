/**
 * Effect op materialization for ShaderRuntime.
 *
 * These ops wrap higher-level render effects like fresnel, wind, and bloom.
 * Keeping them here isolates the stateful helper handling without creating a
 * second shader runtime.
 */

import {
  abs,
  acesFilmicToneMapping,
  attribute,
  clamp,
  dot,
  float,
  max,
  mod,
  normalize,
  reinhardToneMapping,
  sin,
  smoothstep,
  vec2,
  vec3
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { materializePerlinLikeNoise2d } from "./noise";
import type {
  EffectMaterializeContext,
  MaterializeOpRequest,
  MaterializeOpResult
} from "./types";

function readNumericFromInput(input: unknown, fallback: number): number {
  if (input && typeof input === "object" && "value" in input) {
    const raw = (input as { value: unknown }).value;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return raw;
    }
  }
  return fallback;
}

export function materializeEffectOp(
  { op, input }: MaterializeOpRequest,
  context: EffectMaterializeContext
): MaterializeOpResult {
  switch (op.opKind) {
    case "effect.height-falloff": {
      const position = input("position") as { y: unknown };
      const baseHeight = float(Number(op.settings?.baseHeight ?? 0));
      const topHeight = float(Number(op.settings?.topHeight ?? 1));
      const range = (topHeight as { sub: (other: unknown) => unknown }).sub(baseHeight);
      const normalizedHeight = ((position.y as { sub: (other: unknown) => unknown }).sub(
        baseHeight
      ) as { div: (other: unknown) => unknown }).div(range);
      return {
        handled: true,
        value: clamp(normalizedHeight as never, float(0), float(1))
      };
    }
    case "effect.world-noise": {
      const position = input("position") as { x: unknown; z: unknown };
      // Scale is a pure setting, read directly from op.settings. An input
      // port was tempting for parameter-driven scale, but materializeValue
      // returns float(0) for unconnected inputs (truthy — not nullish), so
      // the `input ?? fallback` idiom silently evaluates to scale=0 and
      // noise collapses to a constant. Effects that expose both an input
      // port AND a setting (like wind-sway) rely on the port always being
      // wired via an edge upstream; world-noise doesn't, so settings-only
      // is the safe choice.
      const scaleValue = Number(op.settings?.scale ?? 0.25);
      const scaleNode = float(scaleValue);
      const scaledX = (position.x as { mul: (other: unknown) => unknown }).mul(scaleNode);
      const scaledZ = (position.z as { mul: (other: unknown) => unknown }).mul(scaleNode);
      return {
        handled: true,
        value: materializePerlinLikeNoise2d(vec2(scaledX as never, scaledZ as never))
      };
    }
    case "effect.fresnel": {
      const normal = normalize(input("normal") as never);
      const viewDirection = normalize(input("viewDirection") as never);
      const facing = clamp(dot(normal as never, viewDirection as never), float(0), float(1));
      const rim = float(1)
        .sub(facing as never)
        .pow(float(Number(op.settings?.power ?? 2)))
        .mul(float(Number(op.settings?.strength ?? 1)));
      return {
        handled: true,
        value: (input("color") as { mul: (other: unknown) => unknown }).mul(rim)
      };
    }
    case "effect.bloom-pass": {
      const strength = readNumericFromInput(input("strength"), 0.4);
      const radius = readNumericFromInput(input("radius"), 0.4);
      const threshold = readNumericFromInput(input("threshold"), 0.9);
      const inputNode = input("input");
      const cached = context.effectNodes.get(op.opId);
      if (cached && cached.kind === "bloom") {
        const node = cached.node as {
          inputNode: unknown;
          strength: { value: unknown };
          radius: { value: unknown };
          threshold: { value: unknown };
        };
        node.inputNode = inputNode;
        node.strength.value = strength;
        node.radius.value = radius;
        node.threshold.value = threshold;
        return { handled: true, value: cached.node };
      }

      const node = bloom(inputNode as never, strength, radius, threshold);
      context.effectNodes.set(op.opId, { node, kind: "bloom" });
      return { handled: true, value: node };
    }
    case "effect.tonemap-aces":
      return {
        handled: true,
        value: acesFilmicToneMapping(input("input") as never, float(1))
      };
    case "effect.tonemap-reinhard":
      return {
        handled: true,
        value: reinhardToneMapping(input("input") as never, float(1))
      };
    case "effect.wind-gust": {
      const gustStrength = float(Number(op.settings?.gustStrength ?? 0.25));
      const gustInterval = float(Number(op.settings?.gustInterval ?? 3));
      const gustDuration = float(Number(op.settings?.gustDuration ?? 0.8));
      const phase = ((input("time") as { div: (other: unknown) => unknown }).div(
        gustInterval
      ) as { mul: (other: unknown) => unknown }).mul(float(Math.PI * 2));
      const pulse = clamp(sin(phase as never), float(0), float(1));
      return {
        handled: true,
        value: pulse.mul(gustStrength).mul(gustDuration)
      };
    }
    case "effect.wind-sway": {
      // Dead-simple moving-band wind. A single "wind front" travels in the
      // +X direction at 2 m/s. Blades within 1m of the current front bend
      // to the LEFT by `strength`. Everything else is still. When the
      // front passes, blades return to rest.
      //
      // We use this because every previous attempt (sin oscillation, gust
      // noise threshold, etc.) produced whole-field metronome motion
      // instead of a visible localized wind front sweeping across. This
      // implementation is intentionally minimal: no sin, no noise, no
      // gust modulation, no phase offsets. Just `abs(instanceX - front)`
      // to make a band mask. If blades in one band bend while the rest
      // stay still, the per-instance pipeline is wired right and we can
      // layer complexity on top from there.
      //
      // See KNOWN BUG note re: vertex-stage swizzle (positionLocal.y
      // reads as zero). heightMask is fed via input.mask which is wired
      // to input.tree-height in the foliage-wind shader graph.

      const position = input("position") as {
        add: (other: unknown) => unknown;
      };
      const strength = input("strength") ?? float(Number(op.settings?.strength ?? 0.3));
      const frequency = input("frequency") ?? float(Number(op.settings?.frequency ?? 1.6));

      // Per-blade world XZ; sweep axis is +X.
      const instanceOrigin = attribute("instanceOrigin", "vec2");
      const instanceX = dot(instanceOrigin as never, vec2(1, 0) as never);
      const timeNode = input("time");

      // Three wind fronts traveling at DIFFERENT speeds (and starting at
      // different phases) along the +X axis. Because their speeds don't
      // share a common divisor, their combined bend pattern never
      // visibly repeats — no periodic "loop" feeling. At any moment,
      // some blades are inside zero, one, two, or three overlapping
      // bands. Where bands overlap, the blade bends harder.
      //
      // frequency (from the preset material) scales all three fronts.
      // Gusty (freq=2.6) → bands pass every ~2s. Meadow Breeze (1.6) →
      // every ~3s. Gentle Breeze (1.1) → every ~5s. Still Air (freq
      // unused because strength=0) → no bend regardless.
      const timeScaled = (timeNode as { mul: (other: unknown) => unknown }).mul(frequency);

      // Each band's front travels at `speed` m/s but WRAPS every `period`
      // meters — so after sweeping across the region, it re-enters from
      // the opposite side. Without this wrap the front flies off to +X
      // infinity and there's no more wind after a few seconds.
      //
      // period values are different for each band so the wraps stay
      // out of phase. Choose periods >> typical region width (~20m) so
      // there's a clear "gap" between passes, otherwise a new front
      // appears the instant the old one leaves.
      const makeBand = (
        speed: number,
        phase: number,
        widthM: number,
        period: number
      ): unknown => {
        const raw = (
          (timeScaled as { mul: (other: unknown) => unknown }).mul(float(speed)) as {
            add: (other: unknown) => unknown;
          }
        ).add(float(phase));
        // front = (time*speed + phase) mod period - halfPeriod
        // Centering at 0 so the front sweeps across [-period/2, +period/2]
        // which covers the grass region symmetrically.
        const wrapped = (
          mod(raw as never, float(period)) as { sub: (other: unknown) => unknown }
        ).sub(float(period / 2));
        const delta = (instanceX as { sub: (other: unknown) => unknown }).sub(wrapped as never);
        const distance = abs(delta as never);
        return max(
          float(1).sub(
            (distance as { div: (other: unknown) => unknown }).div(float(widthM)) as never
          ) as never,
          float(0) as never
        );
      };

      // periods 130, 190, 100 are coprime-ish so combined pattern has
      // very long repeat. Time between any single band's passes at a
      // given blade is period/(speed*freq). At freq=1.6:
      //   band1: 130/(4.0*1.6) = ~20s
      //   band2: 190/(2.5*1.6) = ~47s
      //   band3: 100/(5.5*1.6) = ~11s
      // Summed there's a front somewhere ~every 10-15s, with most
      // blades seeing a noticeable front every 20-40s.
      const band1 = makeBand(4.0, 0, 4, 130);
      const band2 = makeBand(2.5, 7, 5, 190);
      const band3 = makeBand(5.5, 3, 3, 100);

      // Sum bands — overlapping fronts boost bend. Clamp so one blade
      // can't bend more than ~1.2× strength.
      const summedBands = clamp(
        (band1 as { add: (other: unknown) => unknown })
          .add(band2 as never) as never,
        float(0) as never,
        float(10) as never
      );
      const allBands = clamp(
        ((summedBands as unknown as { add: (other: unknown) => unknown }).add(
          band3 as never
        )) as never,
        float(0) as never,
        float(1.2) as never
      );

      // Noise modulation across the field (time-drifting). We want
      // CONTRASTY noise — visible pockets of "still" blades within
      // the band so not every blade in a passing front bends. Raw
      // perlin spends most of its output in the middle of [0,1], so
      // multiplying alone never zeros anything out. smoothstep with
      // a high lower edge maps the bottom ~40% of the noise range to
      // 0 (dead pockets) and ramps the rest 0→1 sharply.
      //
      // Spatial scale controls pocket size: multiplier M → features
      // ~1/M meters across. 0.2 gives ~5m pockets (large contiguous
      // patches of still or active blades, each spanning many blades).
      // Higher = smaller/denser pockets; lower = huge regional patches.
      const noiseUV = (instanceOrigin as unknown as {
        mul: (other: unknown) => unknown;
      }).mul(float(0.2));
      // Slow drift: the noise field scrolls at 0.15 UV/sec which at
      // scale 0.2 = 0.75 m/s in world space — pockets drift slowly
      // so a "still patch" stays still for several seconds before
      // becoming a bending patch.
      const noiseDrift = (timeNode as { mul: (other: unknown) => unknown }).mul(float(0.15));
      const noiseUVWithTime = (noiseUV as unknown as {
        add: (other: unknown) => unknown;
      }).add(vec2(noiseDrift as never, 0) as never);
      const noiseValue = materializePerlinLikeNoise2d(noiseUVWithTime);

      // Contrast-stretched noise: bottom 40% → 0, top 25% → 1,
      // ramp in between. Result: ~40% of blades in any band are
      // completely still, ~25% bend at full strength, rest between.
      const noiseContrasty = smoothstep(
        float(0.4) as never,
        float(0.75) as never,
        noiseValue as never
      );

      // 1.4× peak amplitude for gust intensity in "active" pockets.
      const amplitudeWithinBand = (noiseContrasty as unknown as {
        mul: (other: unknown) => unknown;
      }).mul(float(1.4));

      // heightMask = input.tree-height (0 at root, 1 at tip).
      const heightMask = input("mask");

      // ============= BAND LAYER =============
      // Bands push grass to the LEFT (-X) when a wind front passes over.
      const bandModulated = (allBands as unknown as { mul: (other: unknown) => unknown })
        .mul(amplitudeWithinBand as never);
      const bandBend = (bandModulated as { mul: (other: unknown) => unknown })
        .mul(strength as never);
      const bandBendH = (bandBend as { mul: (other: unknown) => unknown })
        .mul(heightMask as never);
      const bandBendLeft = (bandBendH as { mul: (other: unknown) => unknown })
        .mul(float(-1));

      // ============= AMBIENT WAVE LAYER =============
      // Always-on background motion. Two octaves of drifting noise,
      // SIGNED so each blade can bend either direction. Different
      // blades get different bend amounts and directions naturally
      // because they sample noise at their own world position.
      // As the noise drifts, each blade's bend amount oscillates
      // smoothly over time — that's the "waving" feel — but it never
      // syncs with neighbors because the noise pattern is spatially
      // varied. Standard technique used in Witcher / Genshin / etc.
      const ambientUV1 = (instanceOrigin as unknown as {
        mul: (other: unknown) => unknown;
      }).mul(float(0.3));
      const ambientDrift1 = vec2(
        (timeNode as { mul: (other: unknown) => unknown }).mul(float(0.25)) as never,
        (timeNode as { mul: (other: unknown) => unknown }).mul(float(0.15)) as never
      );
      const ambientUVT1 = (ambientUV1 as unknown as {
        add: (other: unknown) => unknown;
      }).add(ambientDrift1 as never);
      const ambientNoise1 = materializePerlinLikeNoise2d(ambientUVT1);
      // Signed: noise (0..1) → (-1..+1)
      const ambientSigned1 = (
        (ambientNoise1 as { sub: (other: unknown) => unknown }).sub(float(0.5)) as {
          mul: (other: unknown) => unknown;
        }
      ).mul(float(2));

      // Second octave: smaller, faster — adds fine wave detail.
      const ambientUV2 = (instanceOrigin as unknown as {
        mul: (other: unknown) => unknown;
      }).mul(float(0.8));
      const ambientDrift2 = vec2(
        (timeNode as { mul: (other: unknown) => unknown }).mul(float(0.4)) as never,
        (timeNode as { mul: (other: unknown) => unknown }).mul(float(0.3)) as never
      );
      const ambientUVT2 = (ambientUV2 as unknown as {
        add: (other: unknown) => unknown;
      }).add(ambientDrift2 as never);
      const ambientNoise2 = materializePerlinLikeNoise2d(ambientUVT2);
      const ambientSigned2 = (
        (ambientNoise2 as { sub: (other: unknown) => unknown }).sub(float(0.5)) as {
          mul: (other: unknown) => unknown;
        }
      ).mul(float(2));

      // Combine: 70% large slow + 30% small fast
      const ambientCombined = (
        (ambientSigned1 as { mul: (other: unknown) => unknown }).mul(float(0.7)) as {
          add: (other: unknown) => unknown;
        }
      ).add(
        (ambientSigned2 as { mul: (other: unknown) => unknown }).mul(float(0.3)) as never
      );

      // Scale ambient: roughly 40% of strength as max bend in either
      // direction. Multiplied by heightMask so roots stay still.
      const ambientBend = (
        (
          (ambientCombined as unknown as { mul: (other: unknown) => unknown }).mul(
            strength as never
          ) as { mul: (other: unknown) => unknown }
        ).mul(float(0.4)) as { mul: (other: unknown) => unknown }
      ).mul(heightMask as never);

      // ============= COMBINE =============
      // Total X bend = band push (negative) + ambient (signed).
      const totalBend = (bandBendLeft as unknown as {
        add: (other: unknown) => unknown;
      }).add(ambientBend as never);

      return {
        handled: true,
        value: position.add(vec3(totalBend as never, 0, 0))
      };
    }
    default:
      return { handled: false };
  }
}
