/**
 * VFX content-library definitions.
 *
 * VFX definitions are reusable authored particle-effect recipes. The content
 * library owns the definition; items and regions only store bindings/spawns
 * that reference a definition id.
 */

import { createUuid } from "../shared/identity";

export type VFXBlendMode = "additive" | "normal";
export type VFXShape = "circle" | "square";

export interface VFXColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface VFXVector3 {
  x: number;
  y: number;
  z: number;
}

export interface VFXDefinitionMetadata {
  builtIn?: boolean;
  builtInKey?: string;
}

export interface VFXDefinition {
  definitionId: string;
  definitionKind: "vfx";
  displayName: string;
  description: string;
  metadata?: VFXDefinitionMetadata;
  emissionRatePerSecond: number;
  maxParticles: number;
  lifetimeMinSeconds: number;
  lifetimeMaxSeconds: number;
  colorStart: VFXColor;
  colorEnd: VFXColor;
  sizeStart: number;
  sizeEnd: number;
  initialVelocity: VFXVector3;
  velocityRandomness: number;
  spreadConeDegrees: number;
  gravity: VFXVector3;
  blendMode: VFXBlendMode;
  shape: VFXShape;
}

export interface VFXBinding {
  bindingId: string;
  vfxDefinitionId: string;
  localOffset: VFXVector3;
}

export interface VFXSpawn {
  spawnId: string;
  vfxDefinitionId: string;
  position: VFXVector3;
}

export interface RegionVFXState {
  spawns: VFXSpawn[];
}

const DEFAULT_VFX_COLOR_START: VFXColor = { r: 1, g: 0.55, b: 0.15, a: 0.9 };
const DEFAULT_VFX_COLOR_END: VFXColor = { r: 1, g: 0.08, b: 0.02, a: 0 };
const DEFAULT_VFX_VECTOR: VFXVector3 = { x: 0, y: 0, z: 0 };

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeColor(
  value: Partial<VFXColor> | null | undefined,
  fallback: VFXColor
): VFXColor {
  return {
    r: clamp(finiteNumber(value?.r, fallback.r), 0, 1),
    g: clamp(finiteNumber(value?.g, fallback.g), 0, 1),
    b: clamp(finiteNumber(value?.b, fallback.b), 0, 1),
    a: clamp(finiteNumber(value?.a, fallback.a), 0, 1)
  };
}

export function normalizeVFXVector3(
  value: Partial<VFXVector3> | null | undefined,
  fallback: VFXVector3 = DEFAULT_VFX_VECTOR
): VFXVector3 {
  return {
    x: finiteNumber(value?.x, fallback.x),
    y: finiteNumber(value?.y, fallback.y),
    z: finiteNumber(value?.z, fallback.z)
  };
}

export function createVFXBinding(
  overrides: Partial<VFXBinding> = {}
): VFXBinding {
  return {
    bindingId: overrides.bindingId ?? createUuid(),
    vfxDefinitionId: overrides.vfxDefinitionId ?? "",
    localOffset: normalizeVFXVector3(overrides.localOffset)
  };
}

export function normalizeVFXBinding(
  binding: Partial<VFXBinding> | null | undefined
): VFXBinding | null {
  if (!binding || typeof binding.vfxDefinitionId !== "string") {
    return null;
  }
  return createVFXBinding(binding);
}

export function createVFXSpawn(overrides: Partial<VFXSpawn> = {}): VFXSpawn {
  return {
    spawnId: overrides.spawnId ?? createUuid(),
    vfxDefinitionId: overrides.vfxDefinitionId ?? "",
    position: normalizeVFXVector3(overrides.position)
  };
}

export function normalizeVFXSpawn(
  spawn: Partial<VFXSpawn> | null | undefined
): VFXSpawn | null {
  if (!spawn || typeof spawn.vfxDefinitionId !== "string") {
    return null;
  }
  return createVFXSpawn(spawn);
}

export function normalizeRegionVFXState(
  state: Partial<RegionVFXState> | null | undefined
): RegionVFXState {
  return {
    spawns: (state?.spawns ?? [])
      .map((spawn) => normalizeVFXSpawn(spawn))
      .filter((spawn): spawn is VFXSpawn => spawn !== null)
  };
}

export function createDefaultVFXDefinition(
  options: Partial<VFXDefinition> = {}
): VFXDefinition {
  const lifetimeMinSeconds = Math.max(
    0.01,
    finiteNumber(options.lifetimeMinSeconds, 0.45)
  );
  const lifetimeMaxSeconds = Math.max(
    lifetimeMinSeconds,
    finiteNumber(options.lifetimeMaxSeconds, 1.25)
  );
  return {
    definitionId: options.definitionId ?? createUuid(),
    definitionKind: "vfx",
    displayName: options.displayName ?? "New VFX",
    description: options.description ?? "",
    metadata: options.metadata ? { ...options.metadata } : undefined,
    emissionRatePerSecond: Math.max(
      0,
      finiteNumber(options.emissionRatePerSecond, 24)
    ),
    maxParticles: Math.max(1, Math.floor(finiteNumber(options.maxParticles, 160))),
    lifetimeMinSeconds,
    lifetimeMaxSeconds,
    colorStart: normalizeColor(options.colorStart, DEFAULT_VFX_COLOR_START),
    colorEnd: normalizeColor(options.colorEnd, DEFAULT_VFX_COLOR_END),
    sizeStart: Math.max(0, finiteNumber(options.sizeStart, 0.22)),
    sizeEnd: Math.max(0, finiteNumber(options.sizeEnd, 0.05)),
    initialVelocity: normalizeVFXVector3(options.initialVelocity, {
      x: 0,
      y: 0.75,
      z: 0
    }),
    velocityRandomness: clamp(finiteNumber(options.velocityRandomness, 0.35), 0, 1),
    spreadConeDegrees: clamp(finiteNumber(options.spreadConeDegrees, 35), 0, 360),
    gravity: normalizeVFXVector3(options.gravity, { x: 0, y: 0.2, z: 0 }),
    blendMode: options.blendMode === "normal" ? "normal" : "additive",
    shape: options.shape === "square" ? "square" : "circle"
  };
}

export function normalizeVFXDefinition(
  definition: Partial<VFXDefinition> | null | undefined
): VFXDefinition {
  return createDefaultVFXDefinition({
    ...definition,
    definitionId:
      typeof definition?.definitionId === "string" &&
      definition.definitionId.trim().length > 0
        ? definition.definitionId
        : createUuid(),
    definitionKind: "vfx"
  });
}

export function createDefaultFlameVFX(
  options: { definitionId?: string } = {}
): VFXDefinition {
  return createDefaultVFXDefinition({
    definitionId: options.definitionId,
    displayName: "Default Flame",
    description: "Warm additive flame particles for torches and magical points.",
    metadata: { builtIn: true, builtInKey: "default-flame" },
    emissionRatePerSecond: 36,
    maxParticles: 220,
    lifetimeMinSeconds: 0.35,
    lifetimeMaxSeconds: 0.95,
    colorStart: { r: 1, g: 0.65, b: 0.18, a: 0.95 },
    colorEnd: { r: 1, g: 0.04, b: 0.01, a: 0 },
    sizeStart: 0.18,
    sizeEnd: 0.02,
    initialVelocity: { x: 0, y: 0.9, z: 0 },
    velocityRandomness: 0.48,
    spreadConeDegrees: 46,
    gravity: { x: 0, y: 0.18, z: 0 },
    blendMode: "additive",
    shape: "circle"
  });
}

export function createDefaultSparkleVFX(
  options: { definitionId?: string } = {}
): VFXDefinition {
  return createDefaultVFXDefinition({
    definitionId: options.definitionId,
    displayName: "Default Sparkle",
    description: "Soft magical sparkle particles for ambient charm effects.",
    metadata: { builtIn: true, builtInKey: "default-sparkle" },
    emissionRatePerSecond: 12,
    maxParticles: 90,
    lifetimeMinSeconds: 0.65,
    lifetimeMaxSeconds: 1.6,
    colorStart: { r: 0.72, g: 0.95, b: 1, a: 0.9 },
    colorEnd: { r: 1, g: 0.76, b: 1, a: 0 },
    sizeStart: 0.08,
    sizeEnd: 0.01,
    initialVelocity: { x: 0, y: 0.25, z: 0 },
    velocityRandomness: 0.7,
    spreadConeDegrees: 180,
    gravity: { x: 0, y: 0.03, z: 0 },
    blendMode: "additive",
    shape: "circle"
  });
}
