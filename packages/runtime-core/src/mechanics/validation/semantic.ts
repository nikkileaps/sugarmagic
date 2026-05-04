/**
 * Semantic mechanics validation.
 *
 * Checks expression parseability and authored references that JSON Schema
 * cannot know: stat ids, castable inputs, and consumer invocations.
 */

import type {
  CastableDefinition,
  CastableInvocation,
  MechanicsDefinition
} from "@sugarmagic/domain";
import type { ExpressionAst } from "../expression/ast";
import { parseExpression } from "../expression/parser";
import type {
  MechanicsValidationIssue,
  MechanicsValidationResult
} from "./structural";

export interface MechanicsConsumerInvocation {
  label: string;
  invocation: CastableInvocation;
}

export interface MechanicsSemanticValidationOptions {
  consumers?: MechanicsConsumerInvocation[];
}

function walkExpression(
  ast: ExpressionAst,
  visit: (node: ExpressionAst) => void
): void {
  visit(ast);
  if (ast.kind === "unary") walkExpression(ast.argument, visit);
  if (ast.kind === "binary") {
    walkExpression(ast.left, visit);
    walkExpression(ast.right, visit);
  }
  if (ast.kind === "ternary") {
    walkExpression(ast.condition, visit);
    walkExpression(ast.then, visit);
    walkExpression(ast.else, visit);
  }
  if (ast.kind === "call") {
    for (const arg of ast.args) walkExpression(arg, visit);
  }
}

function validateExpressionReferences(
  expression: string,
  path: string,
  castable: CastableDefinition,
  statIds: Set<string>,
  issues: MechanicsValidationIssue[]
): void {
  try {
    const parsed = parseExpression(expression);
    const inputIds = new Set(castable.inputs.map((input) => input.id));
    walkExpression(parsed.ast, (node) => {
      if (node.kind !== "member") return;
      const [root, member, ...rest] = node.path;
      if (rest.length > 0) {
        issues.push({
          path,
          message: `Reference "${node.path.join(".")}" is too deep; use root.field.`
        });
        return;
      }
      if (root === "caster" && (!member || !statIds.has(member))) {
        issues.push({
          path,
          message: `Unknown caster stat "${member ?? ""}".`
        });
      }
      if (root === "target" && (!member || !statIds.has(member))) {
        issues.push({
          path,
          message: `Unknown target stat "${member ?? ""}".`
        });
      }
      if (root === "self" && (!member || !inputIds.has(member))) {
        issues.push({
          path,
          message: `Unknown castable input "${member ?? ""}".`
        });
      }
      if (root !== "caster" && root !== "target" && root !== "self") {
        issues.push({
          path,
          message: `Unknown expression root "${root}".`
        });
      }
    });
  } catch (error) {
    issues.push({
      path,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

function validateOpExpressions(
  castable: CastableDefinition,
  statIds: Set<string>,
  issues: MechanicsValidationIssue[],
  path: string
): void {
  castable.onCast.forEach((op, index) => {
    const opPath = `${path}/onCast/${index}`;
    if (op.op === "consume") {
      validateExpressionReferences(
        op.amount,
        `${opPath}/amount`,
        castable,
        statIds,
        issues
      );
      validateTarget(op.target, `${opPath}/target`, statIds, castable, issues);
    } else if (op.op === "set") {
      validateExpressionReferences(
        op.value,
        `${opPath}/value`,
        castable,
        statIds,
        issues
      );
      validateTarget(op.target, `${opPath}/target`, statIds, castable, issues);
    } else if (op.op === "branch") {
      validateExpressionReferences(
        op.condition,
        `${opPath}/condition`,
        castable,
        statIds,
        issues
      );
      const nestedCastable = { ...castable, onCast: op.then };
      validateOpExpressions(nestedCastable, statIds, issues, `${opPath}/then`);
      validateOpExpressions(
        { ...castable, onCast: op.else },
        statIds,
        issues,
        `${opPath}/else`
      );
    }
  });
}

function validateTarget(
  target: string,
  path: string,
  statIds: Set<string>,
  castable: CastableDefinition,
  issues: MechanicsValidationIssue[]
): void {
  const [root, statId, ...rest] = target.split(".");
  if (rest.length > 0 || !statId) {
    issues.push({ path, message: `Invalid target "${target}".` });
    return;
  }
  if (root !== "caster" && root !== "target") {
    issues.push({ path, message: `Target root must be caster or target.` });
    return;
  }
  if (root === "target" && !castable.acceptsTarget) {
    issues.push({
      path,
      message: `Target stat used by castable that does not accept a target.`
    });
  }
  if (!statIds.has(statId)) {
    issues.push({ path, message: `Unknown stat "${statId}".` });
  }
}

function validateConsumers(
  mechanics: MechanicsDefinition,
  consumers: MechanicsConsumerInvocation[],
  issues: MechanicsValidationIssue[]
): void {
  const castables = new Map(
    mechanics.castables.map((castable) => [castable.id, castable])
  );
  for (const consumer of consumers) {
    const castable = castables.get(consumer.invocation.id);
    if (!castable) {
      issues.push({
        path: consumer.label,
        message: `Unknown castable "${consumer.invocation.id}".`
      });
      continue;
    }
    for (const input of castable.inputs) {
      const value = consumer.invocation.args[input.id] ?? input.default;
      if (value === undefined && input.required) {
        issues.push({
          path: `${consumer.label}/args/${input.id}`,
          message: `Missing required input "${input.id}".`
        });
        continue;
      }
      if (value === undefined) continue;
      const actualType =
        value !== null && Array.isArray(value)
          ? "object"
          : value !== null
            ? typeof value
            : "object";
      if (actualType !== input.type) {
        issues.push({
          path: `${consumer.label}/args/${input.id}`,
          message: `Expected ${input.type} but received ${actualType}.`
        });
      }
    }
  }
}

export function validateMechanicsSemantic(
  mechanics: MechanicsDefinition,
  options: MechanicsSemanticValidationOptions = {}
): MechanicsValidationResult {
  const issues: MechanicsValidationIssue[] = [];
  const statIds = new Set(mechanics.stats.map((stat) => stat.id));
  const seenStats = new Set<string>();
  const seenRoles = new Set<string>();
  const seenCastables = new Set<string>();

  mechanics.stats.forEach((stat, index) => {
    if (seenStats.has(stat.id)) {
      issues.push({
        path: `/stats/${index}/id`,
        message: `Duplicate stat id "${stat.id}".`
      });
    }
    seenStats.add(stat.id);
    if (stat.role) {
      if (seenRoles.has(stat.role)) {
        issues.push({
          path: `/stats/${index}/role`,
          message: `Duplicate stat role "${stat.role}".`
        });
      }
      seenRoles.add(stat.role);
    }
    if (stat.min !== null && stat.max !== null && stat.min > stat.max) {
      issues.push({
        path: `/stats/${index}`,
        message: `Stat min cannot exceed max.`
      });
    }
  });

  mechanics.castables.forEach((castable, index) => {
    const path = `/castables/${index}`;
    if (seenCastables.has(castable.id)) {
      issues.push({
        path: `${path}/id`,
        message: `Duplicate castable id "${castable.id}".`
      });
    }
    seenCastables.add(castable.id);
    if (castable.cost) {
      validateExpressionReferences(
        castable.cost,
        `${path}/cost`,
        castable,
        statIds,
        issues
      );
    }
    validateOpExpressions(castable, statIds, issues, path);
  });

  validateConsumers(mechanics, options.consumers ?? [], issues);
  return { valid: issues.length === 0, issues };
}

export function assertMechanicsSemantic(
  mechanics: MechanicsDefinition,
  options: MechanicsSemanticValidationOptions = {}
): void {
  const result = validateMechanicsSemantic(mechanics, options);
  if (!result.valid) {
    throw new Error(
      `Invalid mechanics semantics:\n${result.issues
        .map((issue) => `- ${issue.path}: ${issue.message}`)
        .join("\n")}`
    );
  }
}
