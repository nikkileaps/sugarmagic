/**
 * Runtime stat carrier.
 *
 * A carrier is the per-actor mutable projection of authored StatDefinitions.
 * Definitions remain project truth; carriers hold runtime values and clamp
 * mutations according to the authored stat bounds.
 */

import type { MechanicsDefinition, StatDefinition } from "@sugarmagic/domain";
import { MechanicsEventEmitter, type Unsubscribe } from "./EventEmitter";
import { StatModifierRegistry } from "./StatModifierRegistry";

export interface StatChangeEvent {
  statId: string;
  previousValue: number;
  nextValue: number;
}

export interface StatCarrier {
  get(statId: string): number;
  getEffective(statId: string): number;
  getDefinition(statId: string): StatDefinition | null;
  set(statId: string, value: number): void;
  mutate(statId: string, delta: number): void;
  snapshot(): Record<string, number>;
  tick(deltaSeconds: number): void;
  subscribe(listener: (event: StatChangeEvent) => void): Unsubscribe;
}

function clampToDefinition(definition: StatDefinition, value: number): number {
  let next = value;
  if (definition.min !== null) next = Math.max(definition.min, next);
  if (definition.max !== null) next = Math.min(definition.max, next);
  return next;
}

export class RuntimeStatCarrier implements StatCarrier {
  private readonly definitions = new Map<string, StatDefinition>();
  private readonly values = new Map<string, number>();
  private readonly events = new MechanicsEventEmitter<StatChangeEvent>();

  constructor(
    mechanics: MechanicsDefinition,
    private readonly modifiers = new StatModifierRegistry()
  ) {
    for (const definition of mechanics.stats) {
      this.definitions.set(definition.id, definition);
      this.values.set(
        definition.id,
        clampToDefinition(definition, definition.default)
      );
    }
  }

  get(statId: string): number {
    return this.values.get(statId) ?? 0;
  }

  getEffective(statId: string): number {
    return this.modifiers.applyEffectiveValue(statId, this.get(statId));
  }

  getDefinition(statId: string): StatDefinition | null {
    return this.definitions.get(statId) ?? null;
  }

  set(statId: string, value: number): void {
    const definition = this.definitions.get(statId);
    if (!definition) {
      throw new Error(`Unknown stat "${statId}".`);
    }
    const previousValue = this.get(statId);
    const nextValue = clampToDefinition(definition, value);
    if (previousValue === nextValue) {
      return;
    }
    this.values.set(statId, nextValue);
    this.events.emit({ statId, previousValue, nextValue });
  }

  mutate(statId: string, delta: number): void {
    const transformed = this.modifiers.applyMutation(statId, delta);
    this.set(statId, this.get(statId) + transformed);
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.values.entries());
  }

  tick(deltaSeconds: number): void {
    if (deltaSeconds <= 0) return;
    for (const definition of this.definitions.values()) {
      let delta = 0;
      if (definition.recharge) {
        delta += definition.recharge.ratePerSecond * deltaSeconds;
      }
      if (definition.decay) {
        delta -= definition.decay.ratePerSecond * deltaSeconds;
      }
      if (delta !== 0) {
        this.mutate(definition.id, delta);
      }
    }
  }

  subscribe(listener: (event: StatChangeEvent) => void): Unsubscribe {
    return this.events.subscribe(listener);
  }
}

export function createStatCarrier(
  mechanics: MechanicsDefinition,
  modifiers?: StatModifierRegistry
): RuntimeStatCarrier {
  return new RuntimeStatCarrier(mechanics, modifiers);
}
