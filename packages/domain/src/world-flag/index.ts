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
export interface WorldFlagDefinition {
  definitionId: string;
  /**
   * The flag's key in the runtime store. Unique across the project -- two
   * entries with the same name would collide in one slot.
   */
  name: string;
  displayName: string;
  description: string;
  /** What the flag holds. Conditions compare against a value of this type. */
  valueType: WorldFlagValueType;
}

export type WorldFlagValueType = "boolean" | "number" | "string";

export const WORLD_FLAG_VALUE_TYPE_OPTIONS: Array<{
  value: WorldFlagValueType;
  label: string;
}> = [
  { value: "boolean", label: "Boolean" },
  { value: "number", label: "Number" },
  { value: "string", label: "String" }
];

export function isWorldFlagValueType(value: unknown): value is WorldFlagValueType {
  return value === "boolean" || value === "number" || value === "string";
}

/**
 * A flag condition or action with no value never matches anything, because the
 * comparison is an equality check. Blank is refused at authoring time rather
 * than given a meaning, so there is one rule: a flag holds a value, and a
 * condition names the value it wants.
 */
export function isBlankWorldFlagValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

export function createWorldFlagDefinition(
  options: {
    definitionId?: string;
    name?: string;
    displayName?: string;
    description?: string;
    valueType?: WorldFlagValueType;
  } = {}
): WorldFlagDefinition {
  const name = options.name ?? "newFlag";
  return {
    definitionId: options.definitionId ?? createUuid(),
    name,
    displayName: options.displayName ?? name,
    description: options.description ?? "",
    valueType: options.valueType ?? "boolean"
  };
}

export function normalizeWorldFlagDefinition(
  definition: Partial<WorldFlagDefinition> | null | undefined
): WorldFlagDefinition {
  const name = typeof definition?.name === "string" ? definition.name : "";
  return {
    definitionId: definition?.definitionId ?? createUuid(),
    name,
    displayName: definition?.displayName ?? name,
    description: definition?.description ?? "",
    valueType: isWorldFlagValueType(definition?.valueType)
      ? definition.valueType
      : "boolean"
  };
}

/**
 * The name a flag reference resolves to, or `null` when the id names no entry.
 * A caller that gets `null` is holding a dangling reference -- the condition
 * cannot be evaluated, so it fails rather than guessing a key.
 */
export type WorldFlagNameResolver = (worldFlagId: string) => string | null;

export function createWorldFlagNameResolver(
  definitions: readonly WorldFlagDefinition[]
): WorldFlagNameResolver {
  const namesById = new Map(
    definitions.map((definition) => [definition.definitionId, definition.name])
  );
  return (worldFlagId) => namesById.get(worldFlagId) ?? null;
}

/**
 * The names that more than one entry uses. Duplicates share one slot in the
 * runtime store, so two flags an author sees as separate would read and write
 * each other's value.
 *
 * Says nothing about a name being blank; `validateProjectContent` checks that
 * separately, because one blank name is a problem on its own and two of them
 * would otherwise only be reported as a duplicate.
 */
export function findDuplicateWorldFlagNames(
  definitions: readonly WorldFlagDefinition[]
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
