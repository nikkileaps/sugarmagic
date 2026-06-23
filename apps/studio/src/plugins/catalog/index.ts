import type { StudioPluginWorkspaceDefinition } from "../sdk";

// Story 46.5 — plugins can now export EITHER the singular
// `pluginWorkspaceDefinition` (back-compat for plugins that contribute
// a single workspace, like Hello / SugarAgent / Sugarlang today) OR
// the plural `pluginWorkspaceDefinitions` array (for plugins that
// contribute multiple workspaces across one or more productmodes,
// like SugarDeploy's Provision / Release / Deploy contributions).
const pluginWorkspaceModules = import.meta.glob("./*/index.tsx", {
  eager: true
}) as Record<
  string,
  {
    pluginWorkspaceDefinition?: StudioPluginWorkspaceDefinition;
    pluginWorkspaceDefinitions?: StudioPluginWorkspaceDefinition[];
  }
>;

const discoveredPluginWorkspaceDefinitions = Object.values(
  pluginWorkspaceModules
)
  .flatMap((module) => {
    const collected: StudioPluginWorkspaceDefinition[] = [];
    if (module.pluginWorkspaceDefinition) {
      collected.push(module.pluginWorkspaceDefinition);
    }
    if (module.pluginWorkspaceDefinitions) {
      collected.push(...module.pluginWorkspaceDefinitions);
    }
    return collected;
  })
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
