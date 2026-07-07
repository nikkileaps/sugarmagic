/**
 * packages/domain/src/motion-recipe/index.ts
 *
 * Purpose: Plan 063 — the persisted contract for procedurally
 * generated animations. A MotionRecipe travels INSIDE the clip
 * GLB (`asset.extras.sugarmagicAnimation`) so a generated clip is
 * reopenable: the animation panel restores its sliders and (later)
 * curve overrides from the file itself, exactly like the Character
 * Wizard's rig recipe (ADR 023 decision 6). Types + versioning
 * only — generation algorithms live in packages/character-rig.
 *
 * The schema version gates evolution: readers reject newer
 * versions rather than misinterpret them.
 *
 * Status: active
 */

export const MOTION_RECIPE_SCHEMA_VERSION = 1;

export type MotionGeneratorId = "idle" | "walk" | "run";

/** The four personality controls, each 0..1. */
export interface MotionPersonality {
  energy: number;
  bounce: number;
  curiosity: number;
  fidgetiness: number;
}

export interface MotionRecipe {
  recipeSchemaVersion: number;
  generatorId: MotionGeneratorId;
  personality: MotionPersonality;
  /** Variation seed — same recipe = byte-identical clip. */
  seed: number;
  /** §063.5 semantic-curve overrides; reserved (empty in v1). */
  curveOverrides?: Record<string, unknown>;
}

export function createDefaultMotionRecipe(
  generatorId: MotionGeneratorId
): MotionRecipe {
  return {
    recipeSchemaVersion: MOTION_RECIPE_SCHEMA_VERSION,
    generatorId,
    personality: { energy: 0.35, bounce: 0.4, curiosity: 0.45, fidgetiness: 0.3 },
    seed: 1
  };
}

export function isMotionRecipe(value: unknown): value is MotionRecipe {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as MotionRecipe;
  return (
    typeof candidate.recipeSchemaVersion === "number" &&
    candidate.recipeSchemaVersion <= MOTION_RECIPE_SCHEMA_VERSION &&
    (candidate.generatorId === "idle" ||
      candidate.generatorId === "walk" ||
      candidate.generatorId === "run") &&
    typeof candidate.seed === "number" &&
    typeof candidate.personality === "object" &&
    candidate.personality !== null
  );
}
