/**
 * VFX content-library definitions.
 *
 * VFX is the additive composition layer that sits on top of the asset
 * pipeline. A VFXDefinition is a tagged-union over the *kind* of visual it
 * realizes — particle emitter, shader billboard (orb/aura), ribbon streamer,
 * point light. Items and regions store bindings/spawns that reference a
 * definition id; the renderer dispatches by `kind` at runtime.
 *
 * The legacy flat-shaped VFXDefinition (pre-045.7) is preserved by the
 * normalizer: an input record without a `kind` field is read as
 * `kind: "particle-emitter"` with the legacy fields lifted under `.emitter`.
 */

import { createUuid } from "../shared/identity";

export type VFXBlendMode = "additive" | "normal";
export type VFXShape = "circle" | "square";

export type VFXDefinitionKind =
  | "particle-emitter"
  | "shader-billboard"
  | "ribbon-streamer"
  | "point-light";

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

export interface ParticleEmitterParams {
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

export interface ShaderBillboardParams {
  coreColor: VFXColor;
  haloColor: VFXColor;
  coreRadius: number;
  haloRadius: number;
  pulseRate: number;
  rotationRate: number;
  size: number;
  blendMode: VFXBlendMode;
}

export interface RibbonStreamerParams {
  count: number;
  length: number;
  width: number;
  color: VFXColor;
  orbitSpeed: number;
  verticalDrift: number;
  easeShape: "linear" | "ease-out";
  blendMode: VFXBlendMode;
}

export interface PointLightParams {
  color: VFXColor;
  intensity: number;
  distance: number;
  decay: number;
  pulseRate?: number;
  pulseAmount?: number;
}

interface VFXDefinitionBase {
  definitionId: string;
  definitionKind: "vfx";
  displayName: string;
  description: string;
  metadata?: VFXDefinitionMetadata;
}

export interface ParticleEmitterDefinition extends VFXDefinitionBase {
  kind: "particle-emitter";
  emitter: ParticleEmitterParams;
}

export interface ShaderBillboardDefinition extends VFXDefinitionBase {
  kind: "shader-billboard";
  billboard: ShaderBillboardParams;
}

export interface RibbonStreamerDefinition extends VFXDefinitionBase {
  kind: "ribbon-streamer";
  streamer: RibbonStreamerParams;
}

export interface PointLightDefinition extends VFXDefinitionBase {
  kind: "point-light";
  light: PointLightParams;
}

export type VFXDefinition =
  | ParticleEmitterDefinition
  | ShaderBillboardDefinition
  | RibbonStreamerDefinition
  | PointLightDefinition;

/**
 * Patch shape for `UpdateVFXDefinition`. Common fields apply to any kind;
 * kind-specific param sub-records (`emitter`, `billboard`, etc.) only take
 * effect when the target definition's `kind` matches. The mismatched-kind
 * case is silently ignored — to switch a definition's kind, delete and
 * re-create instead.
 */
export interface VFXDefinitionPatch {
  displayName?: string;
  description?: string;
  metadata?: VFXDefinitionMetadata;
  emitter?: Partial<ParticleEmitterParams>;
  billboard?: Partial<ShaderBillboardParams>;
  streamer?: Partial<RibbonStreamerParams>;
  light?: Partial<PointLightParams>;
}

export interface VFXBinding {
  bindingId: string;
  vfxDefinitionId: string;
  localOffset: VFXVector3;
  renderOrder: number;
}

export interface VFXSpawn {
  spawnId: string;
  vfxDefinitionId: string;
  position: VFXVector3;
  renderOrder: number;
}

export interface RegionVFXState {
  spawns: VFXSpawn[];
}

const DEFAULT_VFX_VECTOR: VFXVector3 = { x: 0, y: 0, z: 0 };
const DEFAULT_PARTICLE_COLOR_START: VFXColor = {
  r: 1,
  g: 0.55,
  b: 0.15,
  a: 0.9
};
const DEFAULT_PARTICLE_COLOR_END: VFXColor = { r: 1, g: 0.08, b: 0.02, a: 0 };

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
    localOffset: normalizeVFXVector3(overrides.localOffset),
    renderOrder: Math.trunc(finiteNumber(overrides.renderOrder, 0))
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
    position: normalizeVFXVector3(overrides.position),
    renderOrder: Math.trunc(finiteNumber(overrides.renderOrder, 0))
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

function normalizeParticleEmitterParams(
  raw: Partial<ParticleEmitterParams> | null | undefined
): ParticleEmitterParams {
  const params = raw ?? {};
  const lifetimeMinSeconds = Math.max(
    0.01,
    finiteNumber(params.lifetimeMinSeconds, 0.45)
  );
  const lifetimeMaxSeconds = Math.max(
    lifetimeMinSeconds,
    finiteNumber(params.lifetimeMaxSeconds, 1.25)
  );
  return {
    emissionRatePerSecond: Math.max(
      0,
      finiteNumber(params.emissionRatePerSecond, 24)
    ),
    maxParticles: Math.max(
      1,
      Math.floor(finiteNumber(params.maxParticles, 160))
    ),
    lifetimeMinSeconds,
    lifetimeMaxSeconds,
    colorStart: normalizeColor(params.colorStart, DEFAULT_PARTICLE_COLOR_START),
    colorEnd: normalizeColor(params.colorEnd, DEFAULT_PARTICLE_COLOR_END),
    sizeStart: Math.max(0, finiteNumber(params.sizeStart, 0.22)),
    sizeEnd: Math.max(0, finiteNumber(params.sizeEnd, 0.05)),
    initialVelocity: normalizeVFXVector3(params.initialVelocity, {
      x: 0,
      y: 0.75,
      z: 0
    }),
    velocityRandomness: clamp(finiteNumber(params.velocityRandomness, 0.35), 0, 1),
    spreadConeDegrees: clamp(finiteNumber(params.spreadConeDegrees, 35), 0, 360),
    gravity: normalizeVFXVector3(params.gravity, { x: 0, y: 0.2, z: 0 }),
    blendMode: params.blendMode === "normal" ? "normal" : "additive",
    shape: params.shape === "square" ? "square" : "circle"
  };
}

function normalizeShaderBillboardParams(
  raw: Partial<ShaderBillboardParams> | null | undefined
): ShaderBillboardParams {
  const params = raw ?? {};
  return {
    coreColor: normalizeColor(params.coreColor, {
      r: 1,
      g: 0.95,
      b: 0.78,
      a: 1
    }),
    haloColor: normalizeColor(params.haloColor, {
      r: 0.7,
      g: 0.85,
      b: 1,
      a: 0.6
    }),
    coreRadius: clamp(finiteNumber(params.coreRadius, 0.18), 0.001, 1),
    haloRadius: clamp(finiteNumber(params.haloRadius, 0.5), 0.01, 1),
    pulseRate: Math.max(0, finiteNumber(params.pulseRate, 0.35)),
    rotationRate: finiteNumber(params.rotationRate, 0.25),
    size: Math.max(0.001, finiteNumber(params.size, 0.6)),
    blendMode: params.blendMode === "normal" ? "normal" : "additive"
  };
}

function normalizeRibbonStreamerParams(
  raw: Partial<RibbonStreamerParams> | null | undefined
): RibbonStreamerParams {
  const params = raw ?? {};
  return {
    count: Math.max(1, Math.floor(finiteNumber(params.count, 4))),
    length: Math.max(0.01, finiteNumber(params.length, 0.6)),
    width: Math.max(0.001, finiteNumber(params.width, 0.04)),
    color: normalizeColor(params.color, { r: 0.85, g: 0.95, b: 1, a: 0.85 }),
    orbitSpeed: finiteNumber(params.orbitSpeed, 1.2),
    verticalDrift: finiteNumber(params.verticalDrift, 0.05),
    easeShape: params.easeShape === "ease-out" ? "ease-out" : "linear",
    blendMode: params.blendMode === "normal" ? "normal" : "additive"
  };
}

function normalizePointLightParams(
  raw: Partial<PointLightParams> | null | undefined
): PointLightParams {
  const params = raw ?? {};
  const result: PointLightParams = {
    color: normalizeColor(params.color, { r: 1, g: 0.85, b: 0.65, a: 1 }),
    intensity: Math.max(0, finiteNumber(params.intensity, 1.4)),
    distance: Math.max(0, finiteNumber(params.distance, 4)),
    decay: Math.max(0, finiteNumber(params.decay, 2))
  };
  if (typeof params.pulseRate === "number" && Number.isFinite(params.pulseRate)) {
    result.pulseRate = Math.max(0, params.pulseRate);
  }
  if (
    typeof params.pulseAmount === "number" &&
    Number.isFinite(params.pulseAmount)
  ) {
    result.pulseAmount = clamp(params.pulseAmount, 0, 1);
  }
  return result;
}

interface LegacyFlatVFXDefinitionFields {
  emissionRatePerSecond?: number;
  maxParticles?: number;
  lifetimeMinSeconds?: number;
  lifetimeMaxSeconds?: number;
  colorStart?: VFXColor;
  colorEnd?: VFXColor;
  sizeStart?: number;
  sizeEnd?: number;
  initialVelocity?: VFXVector3;
  velocityRandomness?: number;
  spreadConeDegrees?: number;
  gravity?: VFXVector3;
  blendMode?: VFXBlendMode;
  shape?: VFXShape;
}

type AnyVFXDefinitionInput =
  | (Partial<VFXDefinitionBase> & {
      kind?: VFXDefinitionKind;
      emitter?: Partial<ParticleEmitterParams>;
      billboard?: Partial<ShaderBillboardParams>;
      streamer?: Partial<RibbonStreamerParams>;
      light?: Partial<PointLightParams>;
    } & LegacyFlatVFXDefinitionFields)
  | null
  | undefined;

function pickBaseFields(input: AnyVFXDefinitionInput): {
  definitionId: string;
  displayName: string;
  description: string;
  metadata?: VFXDefinitionMetadata;
} {
  return {
    definitionId:
      typeof input?.definitionId === "string" &&
      input.definitionId.trim().length > 0
        ? input.definitionId
        : createUuid(),
    displayName:
      typeof input?.displayName === "string" ? input.displayName : "New VFX",
    description:
      typeof input?.description === "string" ? input.description : "",
    metadata: input?.metadata ? { ...input.metadata } : undefined
  };
}

export function normalizeVFXDefinition(
  definition: AnyVFXDefinitionInput
): VFXDefinition {
  const base = pickBaseFields(definition);
  const kind = (definition?.kind ?? "particle-emitter") as VFXDefinitionKind;

  switch (kind) {
    case "shader-billboard":
      return {
        ...base,
        definitionKind: "vfx",
        kind: "shader-billboard",
        billboard: normalizeShaderBillboardParams(definition?.billboard)
      };
    case "ribbon-streamer":
      return {
        ...base,
        definitionKind: "vfx",
        kind: "ribbon-streamer",
        streamer: normalizeRibbonStreamerParams(definition?.streamer)
      };
    case "point-light":
      return {
        ...base,
        definitionKind: "vfx",
        kind: "point-light",
        light: normalizePointLightParams(definition?.light)
      };
    case "particle-emitter":
    default: {
      // Legacy flat shape: lift particle-emitter fields from the top level
      // when no nested `emitter` record is present.
      const flatLegacy: Partial<ParticleEmitterParams> = {
        emissionRatePerSecond: definition?.emissionRatePerSecond,
        maxParticles: definition?.maxParticles,
        lifetimeMinSeconds: definition?.lifetimeMinSeconds,
        lifetimeMaxSeconds: definition?.lifetimeMaxSeconds,
        colorStart: definition?.colorStart,
        colorEnd: definition?.colorEnd,
        sizeStart: definition?.sizeStart,
        sizeEnd: definition?.sizeEnd,
        initialVelocity: definition?.initialVelocity,
        velocityRandomness: definition?.velocityRandomness,
        spreadConeDegrees: definition?.spreadConeDegrees,
        gravity: definition?.gravity,
        blendMode: definition?.blendMode,
        shape: definition?.shape
      };
      const emitterParams = definition?.emitter ?? flatLegacy;
      return {
        ...base,
        definitionKind: "vfx",
        kind: "particle-emitter",
        emitter: normalizeParticleEmitterParams(emitterParams)
      };
    }
  }
}

export function createDefaultVFXDefinition(
  options: Partial<ParticleEmitterParams> & {
    definitionId?: string;
    displayName?: string;
    description?: string;
    metadata?: VFXDefinitionMetadata;
  } = {}
): ParticleEmitterDefinition {
  return {
    definitionId: options.definitionId ?? createUuid(),
    definitionKind: "vfx",
    kind: "particle-emitter",
    displayName: options.displayName ?? "New VFX",
    description: options.description ?? "",
    metadata: options.metadata ? { ...options.metadata } : undefined,
    emitter: normalizeParticleEmitterParams(options)
  };
}

export function createDefaultFlameVFX(
  options: { definitionId?: string } = {}
): ParticleEmitterDefinition {
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
): ParticleEmitterDefinition {
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

export function createDefaultAuraVFX(
  options: { definitionId?: string } = {}
): ShaderBillboardDefinition {
  return {
    definitionId: options.definitionId ?? createUuid(),
    definitionKind: "vfx",
    kind: "shader-billboard",
    displayName: "Default Aura",
    description: "Translucent magical orb with hot core, soft halo, slow pulse.",
    metadata: { builtIn: true, builtInKey: "default-aura" },
    billboard: normalizeShaderBillboardParams({
      coreColor: { r: 1, g: 0.95, b: 0.78, a: 1 },
      haloColor: { r: 0.55, g: 0.78, b: 1, a: 0.65 },
      coreRadius: 0.16,
      haloRadius: 0.5,
      pulseRate: 0.4,
      rotationRate: 0.15,
      size: 0.7,
      blendMode: "additive"
    })
  };
}

export function createDefaultStreamersVFX(
  options: { definitionId?: string } = {}
): RibbonStreamerDefinition {
  return {
    definitionId: options.definitionId ?? createUuid(),
    definitionKind: "vfx",
    kind: "ribbon-streamer",
    displayName: "Default Streamers",
    description: "Soft ribbon streamers orbiting the host.",
    metadata: { builtIn: true, builtInKey: "default-streamers" },
    streamer: normalizeRibbonStreamerParams({
      count: 4,
      length: 0.55,
      width: 0.04,
      color: { r: 0.7, g: 0.88, b: 1, a: 0.85 },
      orbitSpeed: 1.4,
      verticalDrift: 0.04,
      easeShape: "ease-out",
      blendMode: "additive"
    })
  };
}

export function applyVFXDefinitionPatch(
  definition: VFXDefinition,
  patch: VFXDefinitionPatch
): VFXDefinition {
  const base = {
    ...definition,
    displayName:
      patch.displayName !== undefined ? patch.displayName : definition.displayName,
    description:
      patch.description !== undefined ? patch.description : definition.description,
    metadata:
      patch.metadata !== undefined
        ? { ...patch.metadata }
        : definition.metadata
          ? { ...definition.metadata }
          : undefined
  };

  switch (definition.kind) {
    case "particle-emitter":
      return {
        ...base,
        kind: "particle-emitter",
        emitter: patch.emitter
          ? normalizeParticleEmitterParams({
              ...definition.emitter,
              ...patch.emitter
            })
          : definition.emitter
      };
    case "shader-billboard":
      return {
        ...base,
        kind: "shader-billboard",
        billboard: patch.billboard
          ? normalizeShaderBillboardParams({
              ...definition.billboard,
              ...patch.billboard
            })
          : definition.billboard
      };
    case "ribbon-streamer":
      return {
        ...base,
        kind: "ribbon-streamer",
        streamer: patch.streamer
          ? normalizeRibbonStreamerParams({
              ...definition.streamer,
              ...patch.streamer
            })
          : definition.streamer
      };
    case "point-light":
      return {
        ...base,
        kind: "point-light",
        light: patch.light
          ? normalizePointLightParams({
              ...definition.light,
              ...patch.light
            })
          : definition.light
      };
  }
}

export function createDefaultGlowLightVFX(
  options: { definitionId?: string } = {}
): PointLightDefinition {
  return {
    definitionId: options.definitionId ?? createUuid(),
    definitionKind: "vfx",
    kind: "point-light",
    displayName: "Default Glow Light",
    description: "Warm point light contributing scene illumination near the host.",
    metadata: { builtIn: true, builtInKey: "default-glow-light" },
    light: normalizePointLightParams({
      color: { r: 1, g: 0.82, b: 0.55, a: 1 },
      intensity: 1.6,
      distance: 4.5,
      decay: 2,
      pulseRate: 0.4,
      pulseAmount: 0.12
    })
  };
}
