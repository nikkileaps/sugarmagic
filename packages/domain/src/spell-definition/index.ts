import { createUuid } from "../shared/identity";

export type SpellEffectType =
  | "event"
  | "unlock"
  | "world-flag"
  | "dialogue"
  | "heal"
  | "damage";

export interface SpellEffectDefinition {
  effectId: string;
  type: SpellEffectType;
  targetId?: string;
  value?: unknown;
}

export interface SpellDefinition {
  definitionId: string;
  displayName: string;
  description: string;
  iconAssetDefinitionId: string | null;
  tags: string[];
  batteryCost: number;
  effects: SpellEffectDefinition[];
  chaosEffects: SpellEffectDefinition[];
}

export function createSpellDefinitionId(): string {
  return createUuid();
}

export function createSpellEffectId(): string {
  return createUuid();
}

export function createDefaultSpellEffectDefinition(
  options: Partial<SpellEffectDefinition> = {}
): SpellEffectDefinition {
  return {
    effectId: options.effectId ?? createSpellEffectId(),
    type: options.type ?? "event",
    targetId: options.targetId ?? undefined,
    value: options.value
  };
}

export function createDefaultSpellDefinition(
  options: Partial<SpellDefinition> = {}
): SpellDefinition {
  return {
    definitionId: options.definitionId ?? createSpellDefinitionId(),
    displayName: options.displayName ?? "New Spell",
    description: options.description ?? "Spell description...",
    iconAssetDefinitionId: options.iconAssetDefinitionId ?? null,
    tags: [...(options.tags ?? [])],
    batteryCost: options.batteryCost ?? 1,
    effects: (options.effects ?? [createDefaultSpellEffectDefinition()]).map((effect) =>
      normalizeSpellEffectDefinition(effect)
    ),
    chaosEffects: (options.chaosEffects ?? []).map((effect) =>
      normalizeSpellEffectDefinition(effect)
    )
  };
}

export function normalizeSpellEffectDefinition(
  definition: Partial<SpellEffectDefinition> | null | undefined
): SpellEffectDefinition {
  const defaultDefinition = createDefaultSpellEffectDefinition();
  if (!definition) {
    return defaultDefinition;
  }

  return {
    effectId: definition.effectId ?? defaultDefinition.effectId,
    type: definition.type ?? defaultDefinition.type,
    targetId: definition.targetId ?? undefined,
    value: definition.value
  };
}

export function normalizeSpellDefinition(
  definition: Partial<SpellDefinition> | null | undefined
): SpellDefinition {
  const defaultDefinition = createDefaultSpellDefinition();
  if (!definition) {
    return defaultDefinition;
  }

  return {
    definitionId: definition.definitionId ?? defaultDefinition.definitionId,
    displayName: definition.displayName ?? defaultDefinition.displayName,
    description: definition.description ?? defaultDefinition.description,
    iconAssetDefinitionId:
      definition.iconAssetDefinitionId ?? defaultDefinition.iconAssetDefinitionId,
    tags: [...(definition.tags ?? defaultDefinition.tags)],
    batteryCost:
      typeof definition.batteryCost === "number"
        ? Math.max(0, definition.batteryCost)
        : defaultDefinition.batteryCost,
    effects: (definition.effects ?? defaultDefinition.effects).map((effect) =>
      normalizeSpellEffectDefinition(effect)
    ),
    chaosEffects: (definition.chaosEffects ?? defaultDefinition.chaosEffects).map((effect) =>
      normalizeSpellEffectDefinition(effect)
    )
  };
}
