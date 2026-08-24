import type { WorldFlagDefinition } from "@sugarmagic/domain";
import type { RuntimeBlackboard } from "../state/blackboard";
import { clearWorldFlagFact, setWorldFlagFact } from "../state/blackboard";
import type { WorldFlagWriteObserver } from "./WorldFlagManager";

export interface WorldFlagProjectionOptions {
  blackboard: RuntimeBlackboard;
  /** The project's flag registry. Only flags in it reach the blackboard. */
  definitions: readonly WorldFlagDefinition[];
}

/**
 * Copies world flag values onto the blackboard as they are written, so systems
 * that read the blackboard can see them. `WorldFlagManager` stays the place a
 * flag is written and saved; this is the read copy (ADR 031).
 *
 * Attach the result with `WorldFlagManager.setWriteObserver`.
 *
 * A flag the registry does not list is skipped and warned about once. The
 * registry is what makes the projection a closed set of keys instead of
 * whatever string a caller happened to pass; the two callers that can still
 * pass an unlisted name are the dev console handle and an agent's conversation
 * proposal, and neither is authored content.
 */
export function createWorldFlagProjection(
  options: WorldFlagProjectionOptions
): WorldFlagWriteObserver {
  const { blackboard, definitions } = options;
  const registeredNames = new Set(definitions.map((definition) => definition.name));
  const warnedNames = new Set<string>();

  function isRegistered(key: string): boolean {
    if (registeredNames.has(key)) {
      return true;
    }
    if (!warnedNames.has(key)) {
      warnedNames.add(key);
      console.warn(
        `[world-flags] Flag "${key}" is not in the project's flag registry, so it is not readable on the blackboard. It is still set and still saved. Add it in Design > World Flags to make it readable.`
      );
    }
    return false;
  }

  return {
    onSet(key, value) {
      if (!isRegistered(key)) {
        return;
      }
      setWorldFlagFact(blackboard, key, value);
    },
    onCleared(key) {
      if (!registeredNames.has(key)) {
        return;
      }
      clearWorldFlagFact(blackboard, key);
    }
  };
}
