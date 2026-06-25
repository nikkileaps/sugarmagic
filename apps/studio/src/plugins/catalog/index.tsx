import { listDiscoveredPluginDefinitions } from "@sugarmagic/plugins";
import { PluginSchemaSettingsPanel } from "../PluginSchemaSettingsPanel";
import type { StudioPluginWorkspaceDefinition } from "../sdk";

// Story 46.5 — plugins can now export EITHER the singular
// `pluginWorkspaceDefinition` (back-compat for plugins that contribute
// a single workspace, like Hello / SugarAgent today) OR the plural
// `pluginWorkspaceDefinitions` array (for plugins that contribute
// multiple workspaces across one or more productmodes, like
// SugarDeploy's Provision / Release / Deploy contributions).
const pluginWorkspaceModules = import.meta.glob("./*/index.tsx", {
  eager: true
}) as Record<
  string,
  {
    pluginWorkspaceDefinition?: StudioPluginWorkspaceDefinition;
    pluginWorkspaceDefinitions?: StudioPluginWorkspaceDefinition[];
  }
>;

const manualPluginWorkspaceDefinitions = Object.values(pluginWorkspaceModules)
  .flatMap((module) => {
    const collected: StudioPluginWorkspaceDefinition[] = [];
    if (module.pluginWorkspaceDefinition) {
      collected.push(module.pluginWorkspaceDefinition);
    }
    if (module.pluginWorkspaceDefinitions) {
      collected.push(...module.pluginWorkspaceDefinitions);
    }
    return collected;
  });

// Story 46.16 — auto-mount schema-rendered workspaces for plugins
// that declare a `pluginSettingsSchema` AND a `designWorkspaces` shell
// contribution but ship no hand-written `apps/studio/.../index.tsx`.
// The override mechanism IS the existence of a manual file: if a
// plugin contributes a workspace with the same workspaceKind via
// the glob above, the auto-mount skips it (manual wins).
//
// This is what makes the plugin contract auto-discoverable: a plugin
// author writes ONE definition (with manifest + defaultConfig +
// pluginSettingsSchema + designWorkspaces) and Studio finds + renders
// the settings panel without any per-plugin Studio code. The same
// pattern as the host-middleware contribution (plugin declares,
// Studio walks + mounts).
const manualWorkspaceKinds = new Set(
  manualPluginWorkspaceDefinitions.map((definition) => definition.workspaceKind)
);

const autoMountedPluginWorkspaceDefinitions: StudioPluginWorkspaceDefinition[] =
  [];
for (const definition of listDiscoveredPluginDefinitions()) {
  const schema = definition.pluginSettingsSchema;
  const contributions = definition.shell?.designWorkspaces ?? [];
  if (!schema || schema.length === 0) continue;
  for (const contribution of contributions) {
    if (manualWorkspaceKinds.has(contribution.workspaceKind)) continue;
    autoMountedPluginWorkspaceDefinitions.push({
      pluginId: definition.manifest.pluginId,
      workspaceKind: contribution.workspaceKind,
      createWorkspaceView: (props) => ({
        leftPanel: (
          <PluginSchemaSettingsPanel
            pluginId={definition.manifest.pluginId}
            gameProjectId={props.gameProjectId}
            pluginConfigurations={props.pluginConfigurations}
            onCommand={props.onCommand}
          />
        ),
        rightPanel: null,
        viewportOverlay: null
      })
    });
  }
}

const discoveredPluginWorkspaceDefinitions = [
  ...manualPluginWorkspaceDefinitions,
  ...autoMountedPluginWorkspaceDefinitions
].sort((left, right) => left.workspaceKind.localeCompare(right.workspaceKind));

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
