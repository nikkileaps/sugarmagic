/**
 * Castable executor.
 *
 * This is the single runtime enforcer for authored castable ops. It mutates
 * StatCarriers and emits opaque events through a caller-supplied callback;
 * it never imports spell, audio, dialogue, or target code.
 */

import type {
  CastableDefinition,
  CastableInvocation,
  CastableOp,
  MechanicsDefinition
} from "@sugarmagic/domain";
import {
  evaluateExpression,
  type ExpressionScope
} from "../expression/evaluator";
import type { StatCarrier } from "./StatCarrier";

export type CastableExecutionStatus =
  | "success"
  | "cost-failed"
  | "runtime-error";

export interface CastableExecutionResult {
  status: CastableExecutionStatus;
  castable: CastableDefinition | null;
  error?: string;
}

export interface CastableExecutorOptions {
  mechanics: MechanicsDefinition;
  rng?: () => number;
  emit?: (kind: string, payload?: Record<string, unknown>) => void;
}

export interface ExecuteCastableInput {
  invocation: CastableInvocation;
  caster: StatCarrier;
  target?: StatCarrier | null;
}

export interface CastableExecutor {
  execute(input: ExecuteCastableInput): CastableExecutionResult;
}

function assertNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${context} must evaluate to a finite number.`);
  }
  return value;
}

function assertBoolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${context} must evaluate to a boolean.`);
  }
  return value;
}

function resolveTargetCarrier(
  target: string,
  caster: StatCarrier,
  targetCarrier: StatCarrier | null | undefined
): { carrier: StatCarrier; statId: string } {
  const [root, statId, ...rest] = target.split(".");
  if (!root || !statId || rest.length > 0) {
    throw new Error(
      `Invalid stat target "${target}". Expected caster.stat or target.stat.`
    );
  }
  if (root === "caster") {
    return { carrier: caster, statId };
  }
  if (root === "target" && targetCarrier) {
    return { carrier: targetCarrier, statId };
  }
  throw new Error(`Invalid stat target "${target}".`);
}

function buildScope(
  caster: StatCarrier,
  invocation: CastableInvocation,
  target: StatCarrier | null | undefined
): ExpressionScope {
  return {
    caster: caster.snapshot(),
    self: invocation.args,
    target: target?.snapshot() ?? null
  };
}

export function createCastableExecutor(
  options: CastableExecutorOptions
): CastableExecutor {
  const rng = options.rng ?? Math.random;
  const emit = options.emit ?? (() => {});

  function executeOps(
    ops: CastableOp[],
    input: ExecuteCastableInput,
    scope: ExpressionScope
  ): void {
    for (const op of ops) {
      if (op.op === "consume") {
        const target = resolveTargetCarrier(
          op.target,
          input.caster,
          input.target
        );
        const amount = assertNumber(
          evaluateExpression(op.amount, { scope, rng }),
          `${op.op}.${op.target}`
        );
        target.carrier.mutate(target.statId, -amount);
        scope.caster = input.caster.snapshot();
        scope.target = input.target?.snapshot() ?? null;
        continue;
      }
      if (op.op === "set") {
        const target = resolveTargetCarrier(
          op.target,
          input.caster,
          input.target
        );
        const value = assertNumber(
          evaluateExpression(op.value, { scope, rng }),
          `${op.op}.${op.target}`
        );
        target.carrier.set(target.statId, value);
        scope.caster = input.caster.snapshot();
        scope.target = input.target?.snapshot() ?? null;
        continue;
      }
      if (op.op === "branch") {
        const condition = assertBoolean(
          evaluateExpression(op.condition, { scope, rng }),
          "branch.condition"
        );
        executeOps(condition ? op.then : op.else, input, scope);
        continue;
      }
      emit(op.kind, op.payload);
    }
  }

  return {
    execute(input) {
      const castable =
        options.mechanics.castables.find(
          (definition) => definition.id === input.invocation.id
        ) ?? null;
      if (!castable) {
        return {
          status: "runtime-error",
          castable: null,
          error: `Unknown castable "${input.invocation.id}".`
        };
      }
      try {
        const scope = buildScope(input.caster, input.invocation, input.target);
        if (castable.cost) {
          const canPayCost = assertBoolean(
            evaluateExpression(castable.cost, { scope, rng }),
            "castable.cost"
          );
          if (!canPayCost) {
            return { status: "cost-failed", castable };
          }
        }
        executeOps(castable.onCast, input, scope);
        return { status: "success", castable };
      } catch (error) {
        return {
          status: "runtime-error",
          castable,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  };
}
