import type { DiscoveredPluginDefinition } from "../../sdk";

export const SUGARDEPLOY_PLUGIN_ID = "sugardeploy";

export const pluginDefinition: DiscoveredPluginDefinition = {
  manifest: {
    pluginId: SUGARDEPLOY_PLUGIN_ID,
    displayName: "SugarDeploy",
    summary:
      "Deployment plugin that plans targets, fulfills requirements, and manages generated deployment files.",
    capabilityIds: ["publish.workspace", "deployment.plugin"]
  },
  defaultConfig: {},
  // Story 46.5 — SugarDeploy contributes three Publish-productmode
  // workspaces (no Design workspace anymore). The Publish productmode
  // shell renders them in `order` after Studio core's baseline
  // `package` tab.
  shell: {
    publishWorkspaces: [
      {
        pluginId: SUGARDEPLOY_PLUGIN_ID,
        workspaceKind: "sugardeploy-provision",
        label: "Provision",
        icon: "🏗️",
        summary:
          "Configure sources, deployment targets, and secrets. Stand up infrastructure with Setup Infra.",
        order: 100
      },
      {
        pluginId: SUGARDEPLOY_PLUGIN_ID,
        workspaceKind: "sugardeploy-release",
        label: "Release",
        icon: "🏷️",
        summary:
          "Cut a new major version: tag the current commit, bump majorVersion, register a fresh GCP project suffix.",
        order: 110
      },
      {
        pluginId: SUGARDEPLOY_PLUGIN_ID,
        workspaceKind: "sugardeploy-deploy",
        label: "Deploy",
        icon: "🚀",
        summary:
          "Ship the current version to the selected publish + deployment target. Health + Status chips probe the live service.",
        order: 120
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
