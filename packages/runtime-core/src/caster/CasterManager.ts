import {
  type MechanicsDefinition,
  STAT_ROLE_BATTERY,
  STAT_ROLE_RESONANCE,
  type StatRole,
  type SpellDefinition,
  type SpellEffectDefinition
} from "@sugarmagic/domain";
import { Caster, PlayerControlled, type World } from "../ecs";
import {
  createCastableExecutor,
  evaluateExpression,
  type CastableExecutionResult,
  type StatCarrier
} from "../mechanics";
import { resolveBatteryTier, type BatteryTier } from "./math";

export interface SpellCastResult {
  success: boolean;
  chaos: boolean;
  spell: SpellDefinition;
  effects: SpellEffectDefinition[];
  batteryRemaining: number;
  resonanceConsumed: number;
  error?: string;
}

export type SpellCastHandler = (
  spell: SpellDefinition,
  result: SpellCastResult
) => void;

export type MechanicsEmitFanoutHandler = (input: {
  emitKind: string;
  payload: Record<string, unknown> | undefined;
  caster: StatCarrier;
  target: StatCarrier | null;
}) => void;

function cloneSpellFallback(spellDefinitionId: string): SpellDefinition {
  return {
    definitionId: spellDefinitionId,
    displayName: "Unknown Spell",
    description: "",
    iconAssetDefinitionId: null,
    tags: [],
    castable: {
      id: "",
      args: {}
    },
    effects: [],
    chaosEffects: []
  };
}

export class CasterManager {
  private world: World | null = null;
  private mechanics: MechanicsDefinition | null = null;
  private spellDefinitions = new Map<string, SpellDefinition>();
  private onSpellCast: SpellCastHandler | null = null;
  private onMechanicsEmit: MechanicsEmitFanoutHandler | null = null;

  setWorld(world: World): void {
    this.world = world;
  }

  registerDefinitions(definitions: SpellDefinition[]): void {
    this.spellDefinitions.clear();
    for (const definition of definitions) {
      this.spellDefinitions.set(definition.definitionId, definition);
    }
  }

  registerMechanics(mechanics: MechanicsDefinition): void {
    this.mechanics = mechanics;
  }

  setSpellCastHandler(handler: SpellCastHandler | null): void {
    this.onSpellCast = handler;
  }

  setMechanicsEmitHandler(handler: MechanicsEmitFanoutHandler | null): void {
    this.onMechanicsEmit = handler;
  }

  getAllSpells(): SpellDefinition[] {
    return Array.from(this.spellDefinitions.values());
  }

  hasSpell(spellDefinitionId: string): boolean {
    const spell = this.spellDefinitions.get(spellDefinitionId);
    if (!spell) return false;
    return this.isSpellAllowed(spell);
  }

  getAvailableSpells(): SpellDefinition[] {
    return this.getAllSpells().filter((definition) =>
      this.isSpellAllowed(definition)
    );
  }

  getBattery(): number {
    return this.getPrimaryStatValue(STAT_ROLE_BATTERY);
  }

  getMaxBattery(): number {
    const caster = this.getCasterComponent();
    const statId = this.getPrimaryStatId(STAT_ROLE_BATTERY);
    return statId ? (caster?.stats.getDefinition(statId)?.max ?? 1) : 1;
  }

  getResonance(): number {
    return this.getPrimaryStatValue(STAT_ROLE_RESONANCE);
  }

  getBatteryTier(): BatteryTier {
    return resolveBatteryTier(this.getBattery(), this.getMaxBattery());
  }

  recharge(deltaSeconds: number): void {
    const caster = this.getCasterComponent();
    if (!caster) return;
    caster.stats.tick(deltaSeconds);
  }

  canCastSpell(spellDefinitionId: string): {
    canCast: boolean;
    reason?: string;
  } {
    const caster = this.getCasterComponent();
    if (!caster) {
      return { canCast: false, reason: "No caster available" };
    }

    const spell = this.spellDefinitions.get(spellDefinitionId);
    if (!spell) {
      return { canCast: false, reason: "Spell not found" };
    }

    if (!this.isSpellAllowed(spell)) {
      return { canCast: false, reason: "Spell is not allowed" };
    }

    const mechanics = this.mechanics;
    const castable = mechanics?.castables.find(
      (definition) => definition.id === spell.castable.id
    );
    if (!mechanics || !castable) {
      return { canCast: false, reason: "Castable not found" };
    }

    if (castable.cost) {
      try {
        const canPayCost = evaluateExpression(castable.cost, {
          scope: {
            caster: caster.stats.snapshot(),
            self: spell.castable.args,
            target: null
          }
        });
        if (canPayCost !== true) {
          return { canCast: false, reason: "Cost requirement failed" };
        }
      } catch {
        return { canCast: false, reason: "Cost requirement failed" };
      }
    }

    return { canCast: true };
  }

  castSpell(spellDefinitionId: string): SpellCastResult {
    const canCast = this.canCastSpell(spellDefinitionId);
    const spell =
      this.spellDefinitions.get(spellDefinitionId) ??
      cloneSpellFallback(spellDefinitionId);
    const caster = this.getCasterComponent();

    if (!canCast.canCast || !caster) {
      return {
        success: false,
        chaos: false,
        spell,
        effects: [],
        batteryRemaining: this.getBattery(),
        resonanceConsumed: 0,
        error: canCast.reason ?? "No caster available"
      };
    }

    const mechanics = this.mechanics;
    if (!mechanics) {
      return {
        success: false,
        chaos: false,
        spell,
        effects: [],
        batteryRemaining: this.getBattery(),
        resonanceConsumed: 0,
        error: "Mechanics not registered"
      };
    }

    const resonanceConsumed = this.getResonance();
    let chaos = false;
    let effects: SpellEffectDefinition[] = [];
    const executor = createCastableExecutor({
      mechanics,
      emit: (kind, payload) => {
        this.onMechanicsEmit?.({
          emitKind: kind,
          payload,
          caster: caster.stats,
          target: null
        });
        if (kind === "spell-chaos") {
          chaos = true;
          effects =
            spell.chaosEffects.length > 0 ? spell.chaosEffects : spell.effects;
          return;
        }
        if (kind === "spell-success") {
          effects = spell.effects;
        }
      }
    });
    const execution = executor.execute({
      invocation: spell.castable,
      caster: caster.stats,
      target: null
    });
    if (execution.status !== "success") {
      return this.failedCastResult(spell, execution, resonanceConsumed);
    }

    const result: SpellCastResult = {
      success: true,
      chaos,
      spell,
      effects,
      batteryRemaining: this.getBattery(),
      resonanceConsumed
    };
    this.onSpellCast?.(spell, result);
    return result;
  }

  private getCasterComponent(): Caster | null {
    if (!this.world) return null;
    const entities = this.world.query(Caster, PlayerControlled);
    const entity = entities[0];
    if (!entity) return null;
    return this.world.getComponent(entity, Caster) ?? null;
  }

  private failedCastResult(
    spell: SpellDefinition,
    execution: CastableExecutionResult,
    resonanceConsumed: number
  ): SpellCastResult {
    return {
      success: false,
      chaos: false,
      spell,
      effects: [],
      batteryRemaining: this.getBattery(),
      resonanceConsumed,
      error:
        execution.status === "cost-failed"
          ? "Cost requirement failed"
          : (execution.error ?? "Cast failed")
    };
  }

  private getPrimaryStatId(role: StatRole): string | null {
    return (
      this.mechanics?.stats.find((definition) => definition.role === role)
        ?.id ?? null
    );
  }

  private getPrimaryStatValue(role: StatRole): number {
    const caster = this.getCasterComponent();
    const statId = this.getPrimaryStatId(role);
    return statId ? (caster?.stats.get(statId) ?? 0) : 0;
  }

  private isSpellAllowed(spell: SpellDefinition): boolean {
    const caster = this.getCasterComponent();
    if (!caster) return false;

    if (caster.allowedSpellTags.length > 0) {
      const hasAllowedTag = spell.tags.some((tag) =>
        caster.allowedSpellTags.includes(tag)
      );
      if (!hasAllowedTag) return false;
    }

    if (caster.blockedSpellTags.length > 0) {
      const hasBlockedTag = spell.tags.some((tag) =>
        caster.blockedSpellTags.includes(tag)
      );
      if (hasBlockedTag) return false;
    }

    return true;
  }
}
