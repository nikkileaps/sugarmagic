import { createUuid } from "../shared/identity";

/**
 * A flag declared once for the whole project. Authored content references the
 * `definitionId`; the runtime flag store is keyed by `name`.
 *
 * The two are separate on purpose. Referencing the id means renaming a flag is
 * one edit to one entry and no content moves -- under name references a rename
 * is a find-and-replace across quests, dialogues, spells and region conditions,
 * and one miss is a condition that silently never matches. Keying the runtime
 * store by `name` means the debug handles, spell effects and agent proposals
 * can still name a flag in a string, which they have to: an agent proposing a
 * flag has no way to produce an id.
 */
export interface FlagDefinition {
  definitionId: string;
  /**
   * The flag's key in the runtime store. Unique across the project -- two
   * entries with the same name would collide in one slot.
   */
  name: string;
  displayName: string;
  description: string;
  /** What the flag holds. Conditions compare against a value of this type. */
  valueType: FlagValueType;
}

export type FlagValueType = "boolean" | "number" | "string";

export const FLAG_VALUE_TYPE_OPTIONS: Array<{
  value: FlagValueType;
  label: string;
}> = [
  { value: "boolean", label: "Boolean" },
  { value: "number", label: "Number" },
  { value: "string", label: "String" }
];

export function isFlagValueType(value: unknown): value is FlagValueType {
  return value === "boolean" || value === "number" || value === "string";
}

export function createFlagDefinition(
  options: {
    definitionId?: string;
    name?: string;
    displayName?: string;
    description?: string;
    valueType?: FlagValueType;
  } = {}
): FlagDefinition {
  const name = options.name ?? "newFlag";
  return {
    definitionId: options.definitionId ?? createUuid(),
    name,
    displayName: options.displayName ?? name,
    description: options.description ?? "",
    valueType: options.valueType ?? "boolean"
  };
}

export function normalizeFlagDefinition(
  definition: Partial<FlagDefinition> | null | undefined
): FlagDefinition {
  const name = typeof definition?.name === "string" ? definition.name : "";
  return {
    definitionId: definition?.definitionId ?? createUuid(),
    name,
    displayName: definition?.displayName ?? name,
    description: definition?.description ?? "",
    valueType: isFlagValueType(definition?.valueType)
      ? definition.valueType
      : "boolean"
  };
}

/**
 * The name a flag reference resolves to, or `null` when the id names no entry.
 * A caller that gets `null` is holding a dangling reference -- the condition
 * cannot be evaluated, so it fails rather than guessing a key.
 */
export type FlagNameResolver = (flagId: string) => string | null;

export function createFlagNameResolver(
  definitions: readonly FlagDefinition[]
): FlagNameResolver {
  const namesById = new Map(
    definitions.map((definition) => [definition.definitionId, definition.name])
  );
  return (flagId) => namesById.get(flagId) ?? null;
}

/**
 * True when every entry has a distinct, non-empty name. Duplicate names share
 * one slot in the runtime store, so two flags an author sees as separate would
 * read and write each other's value.
 */
export function findDuplicateFlagNames(
  definitions: readonly FlagDefinition[]
): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const definition of definitions) {
    if (seen.has(definition.name)) {
      duplicates.add(definition.name);
    }
    seen.add(definition.name);
  }
  return [...duplicates];
}
