/**
 * Stat modifier registry.
 *
 * V1 ships with no built-in buffs/debuffs, but the registry is the permanent
 * extension seam for future systems that need to transform effective stat
 * values or mutations without changing StatCarrier.
 */

export interface StatModifierContext {
  statId: string;
}

export interface StatModifier {
  modifierId: string;
  getEffectiveValue?: (value: number, context: StatModifierContext) => number;
  transformMutation?: (delta: number, context: StatModifierContext) => number;
}

export class StatModifierRegistry {
  private readonly modifiers = new Map<string, StatModifier>();

  register(modifier: StatModifier): void {
    this.modifiers.set(modifier.modifierId, modifier);
  }

  unregister(modifierId: string): void {
    this.modifiers.delete(modifierId);
  }

  applyEffectiveValue(statId: string, value: number): number {
    let next = value;
    for (const modifier of this.modifiers.values()) {
      next = modifier.getEffectiveValue?.(next, { statId }) ?? next;
    }
    return next;
  }

  applyMutation(statId: string, delta: number): number {
    let next = delta;
    for (const modifier of this.modifiers.values()) {
      next = modifier.transformMutation?.(next, { statId }) ?? next;
    }
    return next;
  }
}
