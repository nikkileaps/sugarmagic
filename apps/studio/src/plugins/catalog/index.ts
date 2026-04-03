import type { StudioPluginWorkspaceDefinition } from "../sdk";

const pluginWorkspaceModules = import.meta.glob("./*/index.tsx", {
  eager: true
}) as Record<
  string,
  {
    pluginWorkspaceDefinition?: StudioPluginWorkspaceDefinition;
  }
>;

const discoveredPluginWorkspaceDefinitions = Object.values(
  pluginWorkspaceModules
)
  .map((module) => module.pluginWorkspaceDefinition)
  .filter(
    (
      definition
    ): definition is StudioPluginWorkspaceDefinition => definition != null
  )
  .sort((left, right) => left.workspaceKind.localeCompare(right.workspaceKind));

export function listStudioPluginWorkspaceDefinitions(): StudioPluginWorkspaceDefinition[] {
  return discoveredPluginWorkspaceDefinitions;
}

export function getStudioPluginWorkspaceDefinition(
  workspaceKind: string
): StudioPluginWorkspaceDefinition | null {
  return (
    discoveredPluginWorkspaceDefinitions.find(
      (definition) => definition.workspaceKind === workspaceKind
    ) ?? null
  );
}
