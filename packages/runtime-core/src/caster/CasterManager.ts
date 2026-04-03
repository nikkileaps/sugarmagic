import type { SpellDefinition, SpellEffectDefinition } from "@sugarmagic/domain";
import { Caster, PlayerControlled, type World } from "../ecs";
import {
  applyBatteryRechargePerMinute,
  clampResonance,
  resolveBatteryTier,
  rollChaos,
  type BatteryTier
} from "./math";

export interface SpellCastResult {
  success: boolean;
  chaos: boolean;
  spell: SpellDefinition;
  effects: SpellEffectDefinition[];
  batteryRemaining: number;
  resonanceConsumed: number;
  error?: string;
}

export type SpellCastHandler = (spell: SpellDefinition, result: SpellCastResult) => void;

function cloneSpellFallback(spellDefinitionId: string): SpellDefinition {
  return {
    definitionId: spellDefinitionId,
    displayName: "Unknown Spell",
    description: "",
    iconAssetDefinitionId: null,
    tags: [],
    batteryCost: 0,
    effects: [],
    chaosEffects: []
  };
}

export class CasterManager {
  private world: World | null = null;
  private spellDefinitions = new Map<string, SpellDefinition>();
  private onSpellCast: SpellCastHandler | null = null;

  setWorld(world: World): void {
    this.world = world;
  }

  registerDefinitions(definitions: SpellDefinition[]): void {
    this.spellDefinitions.clear();
    for (const definition of definitions) {
      this.spellDefinitions.set(definition.definitionId, definition);
    }
  }

  setSpellCastHandler(handler: SpellCastHandler | null): void {
    this.onSpellCast = handler;
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
    return this.getAllSpells().filter((definition) => this.isSpellAllowed(definition));
  }

  getBattery(): number {
    return this.getCasterComponent()?.battery ?? 0;
  }

  getMaxBattery(): number {
    return this.getCasterComponent()?.maxBattery ?? 0;
  }

  getResonance(): number {
    return this.getCasterComponent()?.resonance ?? 0;
  }

  getBatteryTier(): BatteryTier {
    return resolveBatteryTier(this.getBattery(), this.getMaxBattery());
  }

  recharge(deltaSeconds: number): void {
    const caster = this.getCasterComponent();
    if (!caster) return;
    caster.battery = applyBatteryRechargePerMinute(
      caster.battery,
      caster.rechargeRate,
      deltaSeconds,
      caster.maxBattery
    );
  }

  canCastSpell(spellDefinitionId: string): { canCast: boolean; reason?: string } {
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

    if (caster.battery < spell.batteryCost) {
      return { canCast: false, reason: "Not enough battery" };
    }

    return { canCast: true };
  }

  castSpell(spellDefinitionId: string): SpellCastResult {
    const canCast = this.canCastSpell(spellDefinitionId);
    const spell = this.spellDefinitions.get(spellDefinitionId) ?? cloneSpellFallback(spellDefinitionId);
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

    const batteryBefore = caster.battery;
    const resonanceConsumed = clampResonance(caster.resonance);
    caster.battery = Math.max(0, caster.battery - spell.batteryCost);
    caster.resonance = 0;

    const chaos = rollChaos(batteryBefore, resonanceConsumed, caster.maxBattery);
    const effects =
      chaos && spell.chaosEffects.length > 0 ? spell.chaosEffects : spell.effects;
    const result: SpellCastResult = {
      success: true,
      chaos,
      spell,
      effects,
      batteryRemaining: caster.battery,
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

  private isSpellAllowed(spell: SpellDefinition): boolean {
    const caster = this.getCasterComponent();
    if (!caster) return false;

    if (caster.allowedSpellTags.length > 0) {
      const hasAllowedTag = spell.tags.some((tag) => caster.allowedSpellTags.includes(tag));
      if (!hasAllowedTag) return false;
    }

    if (caster.blockedSpellTags.length > 0) {
      const hasBlockedTag = spell.tags.some((tag) => caster.blockedSpellTags.includes(tag));
      if (hasBlockedTag) return false;
    }

    return true;
  }
}
