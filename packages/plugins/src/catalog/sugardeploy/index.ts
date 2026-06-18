import type { DiscoveredPluginDefinition } from "../../sdk";

export const SUGARDEPLOY_PLUGIN_ID = "sugardeploy";

export const pluginDefinition: DiscoveredPluginDefinition = {
  manifest: {
    pluginId: SUGARDEPLOY_PLUGIN_ID,
    displayName: "SugarDeploy",
    summary:
      "Deployment plugin that plans targets, fulfills requirements, and manages generated deployment files.",
    capabilityIds: ["design.workspace", "deployment.plugin"]
  },
  defaultConfig: {},
  shell: {
    designWorkspaces: [
      {
        pluginId: SUGARDEPLOY_PLUGIN_ID,
        workspaceKind: SUGARDEPLOY_PLUGIN_ID,
        label: "SugarDeploy",
        icon: "🚀",
        summary: "Plan deployment targets, inspect requirement fulfillment, and manage generated deployment surfaces."
      }
    ]
  },
  // Dynamic import — the middleware module uses node:child_process,
  // node:fs, and node:path. Statically importing it here would pull those
  // into the browser bundle (this file is loaded by Studio's runtime as
  // part of plugin discovery) and Vite would crash on first access. The
  // factory only runs server-side via the registry's SSR module load.
  hostMiddleware: {
    async createMiddleware() {
      const mod = await import("./host/middleware");
      return mod.createSugarDeployHostMiddleware();
    }
  }
};
