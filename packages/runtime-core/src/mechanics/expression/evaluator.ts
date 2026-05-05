/**
 * Tree-walking evaluator for mechanics expressions.
 *
 * Evaluation is pure: expressions can read scope values and call built-ins,
 * but mutations happen only through structured castable ops.
 */

import type { ExpressionAst } from "./ast";
import { rollDice } from "./dice";
import { parseExpression } from "./parser";

export type ExpressionValue = string | number | boolean;

export interface ExpressionScope {
  caster?: Record<string, unknown>;
  self?: Record<string, unknown>;
  target?: Record<string, unknown> | null;
}

export interface EvaluateExpressionOptions {
  scope: ExpressionScope;
  rng?: () => number;
}

function asNumber(value: ExpressionValue): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected number but received ${typeof value}.`);
  }
  return value;
}

function asBoolean(value: ExpressionValue): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Expected boolean but received ${typeof value}.`);
  }
  return value;
}

function resolvePath(path: string[], scope: ExpressionScope): ExpressionValue {
  let current: unknown = scope[path[0] as keyof ExpressionScope];
  for (const segment of path.slice(1)) {
    if (!current || typeof current !== "object") {
      throw new Error(`Unknown expression reference "${path.join(".")}".`);
    }
    current = (current as Record<string, unknown>)[segment];
  }
  if (
    typeof current !== "string" &&
    typeof current !== "number" &&
    typeof current !== "boolean"
  ) {
    throw new Error(`Reference "${path.join(".")}" is not a primitive value.`);
  }
  return current;
}

function callBuiltIn(
  callee: string,
  args: ExpressionValue[],
  rng: () => number
): ExpressionValue {
  if (callee === "roll") {
    const literal = args[0];
    if (typeof literal !== "string") {
      throw new Error("roll() expects a dice literal.");
    }
    return rollDice(literal, rng);
  }
  if (callee === "min") return Math.min(...args.map(asNumber));
  if (callee === "max") return Math.max(...args.map(asNumber));
  if (callee === "floor") return Math.floor(asNumber(args[0] ?? 0));
  if (callee === "ceil") return Math.ceil(asNumber(args[0] ?? 0));
  if (callee === "abs") return Math.abs(asNumber(args[0] ?? 0));
  if (callee === "clamp") {
    const value = asNumber(args[0] ?? 0);
    const min = asNumber(args[1] ?? 0);
    const max = asNumber(args[2] ?? 0);
    return Math.max(min, Math.min(max, value));
  }
  throw new Error(`Unknown function "${callee}".`);
}

export function evaluateExpressionAst(
  ast: ExpressionAst,
  options: EvaluateExpressionOptions
): ExpressionValue {
  const rng = options.rng ?? Math.random;

  if (ast.kind === "literal") return ast.value;
  if (ast.kind === "member") return resolvePath(ast.path, options.scope);
  if (ast.kind === "call") {
    return callBuiltIn(
      ast.callee,
      ast.args.map((arg) => evaluateExpressionAst(arg, options)),
      rng
    );
  }
  if (ast.kind === "unary") {
    const value = evaluateExpressionAst(ast.argument, options);
    return ast.operator === "!" ? !asBoolean(value) : -asNumber(value);
  }
  if (ast.kind === "ternary") {
    return evaluateExpressionAst(
      asBoolean(evaluateExpressionAst(ast.condition, options))
        ? ast.then
        : ast.else,
      options
    );
  }

  const left = evaluateExpressionAst(ast.left, options);
  if (ast.operator === "&&") {
    return (
      asBoolean(left) && asBoolean(evaluateExpressionAst(ast.right, options))
    );
  }
  if (ast.operator === "||") {
    return (
      asBoolean(left) || asBoolean(evaluateExpressionAst(ast.right, options))
    );
  }
  const right = evaluateExpressionAst(ast.right, options);

  switch (ast.operator) {
    case "+":
      return typeof left === "string" || typeof right === "string"
        ? `${left}${right}`
        : asNumber(left) + asNumber(right);
    case "-":
      return asNumber(left) - asNumber(right);
    case "*":
      return asNumber(left) * asNumber(right);
    case "/":
      return asNumber(left) / asNumber(right);
    case "%":
      return asNumber(left) % asNumber(right);
    case "==":
      return left === right;
    case "!=":
      return left !== right;
    case "<":
      return asNumber(left) < asNumber(right);
    case ">":
      return asNumber(left) > asNumber(right);
    case "<=":
      return asNumber(left) <= asNumber(right);
    case ">=":
      return asNumber(left) >= asNumber(right);
  }
}

export function evaluateExpression(
  source: string,
  options: EvaluateExpressionOptions
): ExpressionValue {
  return evaluateExpressionAst(parseExpression(source).ast, options);
}
