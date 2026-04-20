/**
 * Effect op materialization for ShaderRuntime.
 *
 * These ops wrap higher-level render effects like fresnel, wind, and bloom.
 * Keeping them here isolates the stateful helper handling without creating a
 * second shader runtime.
 */

import {
  acesFilmicToneMapping,
  clamp,
  dot,
  float,
  normalize,
  reinhardToneMapping,
  sin,
  vec3
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
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
      const position = input("position") as {
        x: unknown;
        z: unknown;
        y: unknown;
        add: (other: unknown) => unknown;
      };
      const direction = normalize(input("direction") as never) as { x: unknown; y: unknown };
      const frequency = input("frequency") ?? float(Number(op.settings?.frequency ?? 1.6));
      const strength = input("strength") ?? float(Number(op.settings?.strength ?? 0.3));
      const spatialScale =
        input("spatialScale") ?? float(Number(op.settings?.spatialScale ?? 0.35));
      const heightScale =
        input("heightScale") ?? float(Number(op.settings?.heightScale ?? 1));
      const timedPhase = (input("time") as { mul: (other: unknown) => unknown }).mul(
        frequency
      ) as {
        add: (other: unknown) => unknown;
      };
      const phase = (timedPhase
        .add((position.x as { mul: (other: unknown) => unknown }).mul(spatialScale)) as {
        add: (other: unknown) => unknown;
      }).add((position.z as { mul: (other: unknown) => unknown }).mul(spatialScale));
      const heightMask = clamp(
        (position.y as { mul: (other: unknown) => unknown }).mul(heightScale) as never,
        float(0),
        float(1)
      );
      const sway = sin(phase as never)
        .mul(strength as never)
        .mul(input("mask") as never)
        .mul(heightMask);
      return {
        handled: true,
        value: position.add(
          vec3(
            (direction.x as { mul: (other: unknown) => unknown }).mul(sway) as never,
            0,
            (direction.y as { mul: (other: unknown) => unknown }).mul(sway) as never
          )
        )
      };
    }
    default:
      return { handled: false };
  }
}
