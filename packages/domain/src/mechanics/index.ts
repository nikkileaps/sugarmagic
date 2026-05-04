/**
 * Project-authored mechanics definitions.
 *
 * Domain owns the persisted shape for stats, castables, and castable
 * invocations. Runtime-core imports these types to parse expressions and
 * execute casts, but authored mechanics data starts here as project truth.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ExpressionString = string & {
  readonly __expression: unique symbol;
};

export type StatDisplayHint = "battery" | "bar" | "number" | "percentage";
export type StatRole = "battery" | "resonance";

export const STAT_DISPLAY_BATTERY: StatDisplayHint = "battery";
export const STAT_DISPLAY_BAR: StatDisplayHint = "bar";
export const STAT_ROLE_BATTERY: StatRole = "battery";
export const STAT_ROLE_RESONANCE: StatRole = "resonance";

export interface StatRateDefinition {
  ratePerSecond: number;
}

export interface StatDefinition {
  id: string;
  displayName: string;
  default: number;
  min: number | null;
  max: number | null;
  decay: StatRateDefinition | null;
  recharge: StatRateDefinition | null;
  display: StatDisplayHint;
  role: StatRole | null;
}

export type CastableInputType = "number" | "string" | "boolean" | "object";

export interface CastableInput {
  id: string;
  type: CastableInputType;
  required: boolean;
  default?: JsonValue;
  description?: string;
}

export interface ConsumeCastableOp {
  op: "consume";
  target: string;
  amount: ExpressionString | string;
}

export interface SetCastableOp {
  op: "set";
  target: string;
  value: ExpressionString | string;
}

export interface BranchCastableOp {
  op: "branch";
  condition: ExpressionString | string;
  then: CastableOp[];
  else: CastableOp[];
}

export interface EmitCastableOp {
  op: "emit";
  kind: string;
  payload?: Record<string, JsonValue>;
}

export type CastableOp =
  | ConsumeCastableOp
  | SetCastableOp
  | BranchCastableOp
  | EmitCastableOp;

export interface CastableDefinition {
  id: string;
  displayName: string;
  description?: string;
  inputs: CastableInput[];
  cost: ExpressionString | string | null;
  acceptsTarget: boolean;
  onCast: CastableOp[];
}

export interface CastableInvocation {
  id: string;
  args: Record<string, JsonValue>;
}

export interface MechanicsDefinition {
  stats: StatDefinition[];
  castables: CastableDefinition[];
}

export const DEFAULT_SPELL_CASTABLE_ID = "spell";

function normalizeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeNullableNumber(value: unknown, fallback: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeRate(
  value: Partial<StatRateDefinition> | null | undefined
): StatRateDefinition | null {
  if (!value) return null;
  return {
    ratePerSecond: Math.max(0, normalizeNumber(value.ratePerSecond, 0))
  };
}

function normalizeDisplayHint(value: unknown): StatDisplayHint {
  return value === "battery" ||
    value === "bar" ||
    value === "number" ||
    value === "percentage"
    ? value
    : "number";
}

function normalizeStatRole(value: unknown): StatRole | null {
  return value === "battery" || value === "resonance" ? value : null;
}

export function normalizeStatDefinition(
  definition: Partial<StatDefinition> | null | undefined
): StatDefinition {
  return {
    id:
      typeof definition?.id === "string" && definition.id.trim().length > 0
        ? definition.id
        : "stat",
    displayName:
      typeof definition?.displayName === "string" &&
      definition.displayName.trim().length > 0
        ? definition.displayName
        : "Stat",
    default: normalizeNumber(definition?.default, 0),
    min: normalizeNullableNumber(definition?.min, null),
    max: normalizeNullableNumber(definition?.max, null),
    decay: normalizeRate(definition?.decay),
    recharge: normalizeRate(definition?.recharge),
    display: normalizeDisplayHint(definition?.display),
    role: normalizeStatRole(definition?.role)
  };
}

function isInputType(value: unknown): value is CastableInputType {
  return (
    value === "number" ||
    value === "string" ||
    value === "boolean" ||
    value === "object"
  );
}

export function normalizeCastableInput(
  input: Partial<CastableInput> | null | undefined
): CastableInput {
  const normalized: CastableInput = {
    id:
      typeof input?.id === "string" && input.id.trim().length > 0
        ? input.id
        : "input",
    type: isInputType(input?.type) ? input.type : "number",
    required: input?.required !== false
  };
  if (input?.default !== undefined) {
    normalized.default = input.default as JsonValue;
  }
  if (typeof input?.description === "string") {
    normalized.description = input.description;
  }
  return normalized;
}

export function normalizeCastableOp(op: CastableOp): CastableOp {
  if (op.op === "consume") {
    return { op: "consume", target: op.target, amount: op.amount };
  }
  if (op.op === "set") {
    return { op: "set", target: op.target, value: op.value };
  }
  if (op.op === "branch") {
    return {
      op: "branch",
      condition: op.condition,
      then: (op.then ?? []).map(normalizeCastableOp),
      else: (op.else ?? []).map(normalizeCastableOp)
    };
  }
  return {
    op: "emit",
    kind: op.kind,
    ...(op.payload ? { payload: op.payload } : {})
  };
}

export function normalizeCastableDefinition(
  definition: Partial<CastableDefinition> | null | undefined
): CastableDefinition {
  return {
    id:
      typeof definition?.id === "string" && definition.id.trim().length > 0
        ? definition.id
        : "castable",
    displayName:
      typeof definition?.displayName === "string" &&
      definition.displayName.trim().length > 0
        ? definition.displayName
        : "Castable",
    ...(typeof definition?.description === "string"
      ? { description: definition.description }
      : {}),
    inputs: (definition?.inputs ?? []).map(normalizeCastableInput),
    cost:
      typeof definition?.cost === "string" && definition.cost.trim().length > 0
        ? definition.cost
        : null,
    acceptsTarget: definition?.acceptsTarget === true,
    onCast: ((definition?.onCast ?? []) as CastableOp[]).map(
      normalizeCastableOp
    )
  };
}

export function normalizeCastableInvocation(
  invocation: Partial<CastableInvocation> | null | undefined,
  missingCastableId: string
): CastableInvocation {
  return {
    id:
      typeof invocation?.id === "string" && invocation.id.trim().length > 0
        ? invocation.id
        : missingCastableId,
    args:
      invocation?.args && typeof invocation.args === "object"
        ? { ...(invocation.args as Record<string, JsonValue>) }
        : {}
  };
}

export function createDefaultMechanicsDefinition(): MechanicsDefinition {
  return {
    stats: [
      {
        id: "battery",
        displayName: "Battery",
        default: 100,
        min: 0,
        max: 100,
        decay: null,
        recharge: { ratePerSecond: 1 / 60 },
        display: STAT_DISPLAY_BATTERY,
        role: STAT_ROLE_BATTERY
      },
      {
        id: "resonance",
        displayName: "Resonance",
        default: 0,
        min: 0,
        max: 100,
        decay: null,
        recharge: null,
        display: STAT_DISPLAY_BAR,
        role: STAT_ROLE_RESONANCE
      }
    ],
    castables: [
      {
        id: DEFAULT_SPELL_CASTABLE_ID,
        displayName: "Spell",
        description: "Default Sugarmagic spell cast flow.",
        inputs: [
          {
            id: "batteryCost",
            type: "number",
            required: true,
            default: 1,
            description: "Battery consumed by the spell."
          },
          {
            id: "chaosBase",
            type: "number",
            required: true,
            default: 0,
            description: "Base chaos chance from 0 to 100."
          }
        ],
        cost: "caster.battery >= self.batteryCost",
        acceptsTarget: false,
        onCast: [
          {
            op: "consume",
            target: "caster.battery",
            amount: "self.batteryCost"
          },
          {
            op: "branch",
            condition:
              "roll(1d100) <= clamp(self.chaosBase - caster.resonance * 0.8, 0, 100)",
            then: [
              { op: "emit", kind: "spell-chaos" },
              { op: "set", target: "caster.resonance", value: "0" }
            ],
            else: [{ op: "emit", kind: "spell-success" }]
          }
        ]
      }
    ]
  };
}

export function normalizeMechanicsDefinition(
  mechanics: Partial<MechanicsDefinition> | null | undefined
): MechanicsDefinition {
  if (!mechanics) {
    return createDefaultMechanicsDefinition();
  }
  return {
    stats: (mechanics.stats ?? []).map(normalizeStatDefinition),
    castables: (mechanics.castables ?? []).map(normalizeCastableDefinition)
  };
}
