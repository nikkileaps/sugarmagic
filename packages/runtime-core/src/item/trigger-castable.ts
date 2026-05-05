/**
 * Trigger-castable item interaction executor.
 *
 * Item interactions that fire mechanics should go through the same
 * CastableExecutor as spells. This helper keeps the dispatch path reusable
 * and testable without standing up the full DOM gameplay session.
 */

import type { ItemDefinition, MechanicsDefinition } from "@sugarmagic/domain";
import {
  createCastableExecutor,
  type CastableExecutionResult,
  type StatCarrier
} from "../mechanics";

export interface TriggerCastableItemInteractionOptions {
  mechanics: MechanicsDefinition;
  itemDefinition: ItemDefinition;
  caster: StatCarrier;
  emit?: (kind: string, payload?: Record<string, unknown>) => void;
}

export function executeTriggerCastableItemInteraction(
  options: TriggerCastableItemInteractionOptions
): CastableExecutionResult {
  if (options.itemDefinition.interactionView.kind !== "trigger-castable") {
    return {
      status: "runtime-error",
      castable: null,
      error: `Item "${options.itemDefinition.definitionId}" is not trigger-castable.`
    };
  }

  return createCastableExecutor({
    mechanics: options.mechanics,
    emit: options.emit
  }).execute({
    invocation: options.itemDefinition.interactionView.castableInvocation,
    caster: options.caster,
    target: null
  });
}
