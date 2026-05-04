/**
 * Mechanics runtime public API.
 *
 * Domain owns the authored mechanics shape. This package owns parsing,
 * validation, stat carriers, and castable execution.
 */

import type { MechanicsDefinition } from "@sugarmagic/domain";
import {
  assertMechanicsStructural,
  validateMechanicsStructural,
  type MechanicsValidationResult
} from "./validation/structural";
import {
  assertMechanicsSemantic,
  validateMechanicsSemantic,
  type MechanicsSemanticValidationOptions
} from "./validation/semantic";

export * from "./expression/ast";
export * from "./expression/dice";
export * from "./expression/evaluator";
export * from "./expression/parser";
export * from "./expression/tokenizer";
export * from "./runtime/CastableExecutor";
export * from "./runtime/EventEmitter";
export * from "./runtime/StatCarrier";
export * from "./runtime/StatModifierRegistry";
export * from "./validation/semantic";
export * from "./validation/structural";
export * from "./validation/json5-input";

export function validateMechanicsDefinition(
  mechanics: unknown,
  options: MechanicsSemanticValidationOptions = {}
): MechanicsValidationResult {
  const structural = validateMechanicsStructural(mechanics);
  if (!structural.valid) {
    return structural;
  }
  return validateMechanicsSemantic(mechanics as MechanicsDefinition, options);
}

export function assertValidMechanicsDefinition(
  mechanics: unknown,
  options: MechanicsSemanticValidationOptions = {}
): asserts mechanics is MechanicsDefinition {
  assertMechanicsStructural(mechanics);
  assertMechanicsSemantic(mechanics, options);
}
