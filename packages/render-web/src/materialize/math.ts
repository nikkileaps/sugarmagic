/**
 * Math/color/vector op materialization for ShaderRuntime.
 *
 * This module owns pure TSL-node construction for deterministic op families.
 * ShaderRuntime remains the single enforcer; this file only keeps the main
 * materialize switch readable.
 */

import {
  abs,
  clamp,
  cos,
  dot,
  exp,
  float,
  length,
  luminance,
  max,
  min,
  mix,
  normalize,
  pow,
  saturate,
  sin,
  smoothstep,
  vec2,
  vec3,
  vec4
} from "three/tsl";
import type { MaterializeOpRequest, MaterializeOpResult } from "./types";

export function materializeMathOp({
  op,
  input
}: MaterializeOpRequest): MaterializeOpResult {
  switch (op.opKind) {
    case "math.add":
      return { handled: true, value: (input("a") as { add: (other: unknown) => unknown }).add(input("b")) };
    case "math.subtract":
      return { handled: true, value: (input("a") as { sub: (other: unknown) => unknown }).sub(input("b")) };
    case "math.multiply":
      return { handled: true, value: (input("a") as { mul: (other: unknown) => unknown }).mul(input("b")) };
    case "math.divide":
      return { handled: true, value: (input("a") as { div: (other: unknown) => unknown }).div(input("b")) };
    case "math.pow":
      return { handled: true, value: pow(input("a") as never, input("b") as never) };
    case "math.exp":
      return { handled: true, value: exp(input("input") as never) };
    case "math.min":
      return { handled: true, value: min(input("a") as never, input("b") as never) };
    case "math.max":
      return { handled: true, value: max(input("a") as never, input("b") as never) };
    case "math.saturate":
      return { handled: true, value: saturate(input("input") as never) };
    case "math.smoothstep":
      return {
        handled: true,
        value: smoothstep(
          input("edge0") as never,
          input("edge1") as never,
          input("x") as never
        )
      };
    case "math.distance":
      return {
        handled: true,
        value: length(
          (input("a") as { sub: (other: unknown) => unknown }).sub(input("b")) as never
        )
      };
    case "math.sin":
      return { handled: true, value: sin(input("input") as never) };
    case "math.cos":
      return { handled: true, value: cos(input("input") as never) };
    case "math.abs":
      return { handled: true, value: abs(input("input") as never) };
    case "math.clamp":
      return {
        handled: true,
        value: clamp(input("input") as never, input("min") as never, input("max") as never)
      };
    case "math.lerp":
      return {
        handled: true,
        value: mix(input("a") as never, input("b") as never, input("alpha") as never)
      };
    case "color.luminance":
      return {
        handled: true,
        value: luminance(input("input") as never)
      };
    case "color.add":
      return { handled: true, value: (input("a") as { add: (other: unknown) => unknown }).add(input("b")) };
    case "color.multiply":
      return { handled: true, value: (input("a") as { mul: (other: unknown) => unknown }).mul(input("b")) };
    case "color.divide":
      return { handled: true, value: (input("a") as { div: (other: unknown) => unknown }).div(input("b")) };
    case "color.pow":
      return { handled: true, value: pow(input("a") as never, input("b") as never) };
    case "math.dot":
      return { handled: true, value: dot(input("a") as never, input("b") as never) };
    case "math.normalize":
      return { handled: true, value: normalize(input("input") as never) };
    case "math.length":
      return { handled: true, value: length(input("input") as never) };
    case "math.combine-vector":
      return {
        handled: true,
        value:
          op.dataType === "vec2"
            ? vec2(input("x") as never, input("y") as never)
            : op.dataType === "vec3"
              ? vec3(input("x") as never, input("y") as never, input("z") as never)
              : vec4(
                  input("x") as never,
                  input("y") as never,
                  input("z") as never,
                  input("w") as never
                )
      };
    case "math.split-vector": {
      const vector = input("input") as { x: unknown; y: unknown; z: unknown; w?: unknown };
      const outputPortId = String(op.settings?.outputPortId ?? "x");
      return {
        handled: true,
        value:
          outputPortId === "y"
            ? vector.y
            : outputPortId === "z"
              ? vector.z
              : outputPortId === "w"
                ? (vector.w ?? float(1))
                : vector.x
      };
    }
    case "splat": {
      const scalar = input("input") as never;
      return {
        handled: true,
        value:
          op.dataType === "vec2"
            ? vec2(scalar, scalar)
            : op.dataType === "vec3" || op.dataType === "color"
              ? vec3(scalar, scalar, scalar)
              : vec4(scalar, scalar, scalar, scalar)
      };
    }
    case "truncate": {
      const source = input("input") as { x: unknown; y: unknown; z?: unknown };
      return {
        handled: true,
        value:
          op.dataType === "vec2"
            ? vec2(source.x as never, source.y as never)
            : vec3(source.x as never, source.y as never, source.z as never)
      };
    }
    case "widen": {
      const source = input("input") as { x: unknown; y: unknown; z?: unknown };
      return {
        handled: true,
        value:
          op.dataType === "vec4"
            ? vec4(
                source.x as never,
                source.y as never,
                (source.z ?? float(0)) as never,
                float(0) as never
              )
            : op.dataType === "vec3" || op.dataType === "color"
              ? vec3(source.x as never, source.y as never, float(0) as never)
              : vec2(source.x as never, source.y as never)
      };
    }
    default:
      return { handled: false };
  }
}
