// Plugin host-middleware registry — consumed by Studio's vite.config.ts.
// Studio has zero direct knowledge of any specific plugin: it imports
// gatherDiscoveredHostMiddleware once and spreads the result into Vite's
// `plugins:` array.
//
// Why this is structured as a lazy wrapper, not an eager listDiscovered →
// flatMap chain: at Vite's config-load phase, vite.config.ts is bundled
// with plain esbuild (no Vite transforms). Any value import that
// transitively traces into `@sugarmagic/domain`, `@sugarmagic/runtime-core`,
// or any catalog plugin definition gets externalized — and the workspace's
// TS-source-export entrypoints then fail to resolve at Node runtime. The
// plugin catalog has *many* such transitive value imports we don't want
// to whack-a-mole.
//
// Instead, we register a single Vite plugin whose configureServer hook
// uses server.ssrLoadModule to import `@sugarmagic/plugins` at dev-server
// startup. At that point Vite's full SSR transform pipeline is online and
// every workspace TS file loads natively — no externalization, no .ts
// loader error. The discovery walks every plugin definition's
// `hostMiddleware?.createMiddleware()` contribution and applies each
// returned Vite plugin's own configureServer hook to mount its middleware.

import type {
  Connect,
  Plugin as VitePlugin,
  ViteDevServer
} from "vite";

export * from "./command";
export * from "./binary-check";

interface DiscoveredHostMiddlewareModule {
  listDiscoveredPluginDefinitions: () => Array<{
    manifest: { pluginId: string };
    hostMiddleware?: {
      createMiddleware: () => VitePlugin[] | Promise<VitePlugin[]>;
    };
  }>;
}

export function gatherDiscoveredHostMiddleware(): VitePlugin[] {
  return [
    {
      name: "sugarmagic-host-discovery",
      async configureServer(server: ViteDevServer) {
        let mod: DiscoveredHostMiddlewareModule;
        try {
          mod = (await server.ssrLoadModule(
            "@sugarmagic/plugins"
          )) as DiscoveredHostMiddlewareModule;
        } catch (error) {
          server.config.logger.error(
            `[sugarmagic-host-discovery] failed to ssrLoadModule("@sugarmagic/plugins"); host middleware not mounted: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          return;
        }

        const definitions = mod.listDiscoveredPluginDefinitions();
        for (const definition of definitions) {
          const factory = definition.hostMiddleware?.createMiddleware;
          if (!factory) continue;
          const contributedPlugins = await factory();
          for (const contributedPlugin of contributedPlugins) {
            const hook = contributedPlugin.configureServer;
            if (typeof hook !== "function") continue;
            // Each contributed Vite plugin's configureServer normally
            // receives the dev server and registers `server.middlewares.use`
            // routes. We forward our server here so the contributions mount
            // their middleware on the same chain as everything else. The
            // return value (post-cleanup callback) is ignored — Studio's
            // dev server lifecycle handles teardown. Cast through `unknown`
            // because Vite's ServerHook type expects a MinimalPluginContext
            // `this`; our contributed plugins' hooks only use the `server`
            // arg, not `this`, so plain-function invocation is correct.
            const callableHook = hook as unknown as (
              server: ViteDevServer
            ) => Promise<unknown> | unknown;
            await callableHook(server);
          }
        }
      }
    }
  ];
}
