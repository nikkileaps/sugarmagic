import type { GameProject } from "../game-project";
import type { RegionDocument } from "../region-authoring";
import { createWorldFlagDefinition } from "./index";
import { mapWorldFlagReferences } from "./references";

/**
 * Turns flag references written before the registry existed into real ones.
 *
 * Content authored before epic 206 names a flag by its key -- `"gate-open"` --
 * in the same field that now holds a reference. Anything that is not already a
 * registry id becomes an entry named after the string found there, and the
 * reference is rewritten to that entry's id.
 *
 * Runs over the project AND its regions together, because a flag written by a
 * quest action can be read by a region condition, and the two live in
 * different files. Splitting the pass would give one flag two entries.
 *
 * Idempotent: a second run finds every reference already resolves and changes
 * nothing.
 */
export function migrateWorldFlagReferences(
  gameProject: GameProject,
  regions: readonly RegionDocument[]
): { gameProject: GameProject; regions: RegionDocument[]; changed: boolean } {
  const definitions = [...gameProject.worldFlagDefinitions];
  const idsInRegistry = new Set(
    definitions.map((definition) => definition.definitionId)
  );
  const idsByName = new Map(
    definitions.map((definition) => [definition.name, definition.definitionId])
  );
  let changed = false;

  const mapped = mapWorldFlagReferences(
    gameProject,
    regions,
    (reference, site) => {
      // Already a registry id, or nothing at all. Leaving these alone is what
      // makes a second run a no-op.
      if (!reference || idsInRegistry.has(reference)) {
        return reference;
      }
      const existing = idsByName.get(reference);
      if (existing) {
        changed = true;
        return existing;
      }
      const definition = createWorldFlagDefinition({
        name: reference,
        displayName: reference,
        valueType: site.valueType ?? "boolean"
      });
      definitions.push(definition);
      idsInRegistry.add(definition.definitionId);
      idsByName.set(definition.name, definition.definitionId);
      changed = true;
      return definition.definitionId;
    }
  );

  return {
    gameProject: {
      ...mapped.gameProject,
      worldFlagDefinitions: definitions
    },
    regions: mapped.regions,
    changed
  };
}
