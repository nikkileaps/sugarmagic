import { readFile } from "node:fs/promises";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { gatherDiscoveredHostMiddleware } from "../../packages/plugins/src/host";

function createMechanicsSchemaPlugin(): Plugin {
  const schemaPath = new URL(
    "../../packages/domain/schemas/mechanics.schema.json",
    import.meta.url
  ).pathname;
  return {
    name: "sugarmagic-mechanics-schema",
    configureServer(server) {
      server.middlewares.use(
        "/schemas/mechanics.schema.json",
        async (_req, res) => {
          res.statusCode = 200;
          res.setHeader(
            "content-type",
            "application/schema+json; charset=utf-8"
          );
          res.end(await readFile(schemaPath, "utf8"));
        }
      );
    }
  };
}

export default defineConfig({
  envDir: "../..",
  plugins: [
    react(),
    // Plugin host-middleware registry. Every plugin that contributes
    // server-side middleware gets mounted here automatically via its
    // `hostMiddleware` SDK contribution. Studio has zero direct knowledge
    // of any specific plugin — a plugin opts in by adding
    // `hostMiddleware: ...` to its `pluginDefinition`. See
    // packages/plugins/src/host/ for the registry and
    // packages/plugins/src/sdk/ for the contribution type.
    ...gatherDiscoveredHostMiddleware(),
    createMechanicsSchemaPlugin()
  ],
  resolve: {
    alias: {
      "@sugarmagic/target-web": new URL(
        "../../targets/web/src/index.ts",
        import.meta.url
      ).pathname
    }
  },
  build: {
    rolldownOptions: {
      input: {
        main: "index.html",
        preview: "preview.html"
      }
    }
  }
});
