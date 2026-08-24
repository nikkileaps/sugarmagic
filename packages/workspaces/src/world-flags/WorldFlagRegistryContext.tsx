/**
 * Flag registry context.
 *
 * The project's declared flags, plus the one way to add another. This is
 * ambient environment -- the same project-wide catalog whichever surface is
 * being edited -- and the surfaces that need it are spread across both product
 * modes: quest conditions and actions, dialogue conditions, spell effects, NPC
 * behavior activation, containment volume gates. Threading an identical pair of
 * props down five separate component chains would be pass-through code in
 * roughly fifteen files, so it flows through context instead.
 *
 * Same shape and same reasoning as SurfaceAuthoringContext.
 */

import { createContext, useContext, type ReactNode } from "react";
import type { WorldFlagDefinition } from "@sugarmagic/domain";

export interface WorldFlagRegistry {
  worldFlagDefinitions: WorldFlagDefinition[];
  /**
   * Declares a flag with that name and returns its definitionId, so the
   * control that asked can point its content at the new flag in one step.
   */
  createWorldFlag: (name: string) => string;
}

const WorldFlagRegistryContext = createContext<WorldFlagRegistry | null>(null);

export function WorldFlagRegistryProvider({
  registry,
  children
}: {
  registry: WorldFlagRegistry;
  children: ReactNode;
}) {
  return (
    <WorldFlagRegistryContext.Provider value={registry}>
      {children}
    </WorldFlagRegistryContext.Provider>
  );
}

export function useWorldFlagRegistry(): WorldFlagRegistry {
  const registry = useContext(WorldFlagRegistryContext);
  if (!registry) {
    throw new Error(
      "useWorldFlagRegistry: no WorldFlagRegistryProvider above this component. " +
        "Flag pickers must render inside the provider (mounted in Studio's App)."
    );
  }
  return registry;
}
