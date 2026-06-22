import { spawn } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
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

// Story 46.1 — Package host endpoint. The Publish productmode's
// baseline Package workspace POSTs here to shell
// `pnpm --filter @sugarmagic/target-web build`, then surfaces the
// resulting `targets/web/dist/` path + total size in the UI. Studio-
// core middleware (not a plugin contribution) because the Package
// workspace is owned by Studio core and ships regardless of which
// plugins are installed.
function createPackagePureClientPlugin(): Plugin {
  const monorepoRoot = new URL("../..", import.meta.url).pathname;
  const distDir = resolve(monorepoRoot, "targets/web/dist");
  return {
    name: "sugarmagic-package-pure-client",
    configureServer(server) {
      server.middlewares.use(
        "/__studio/package-pure-client",
        async (req, res) => {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: false, reason: "POST required." }));
            return;
          }
          try {
            const result = await runBuild(monorepoRoot);
            if (result.exitCode !== 0) {
              res.statusCode = 200;
              res.setHeader("content-type", "application/json; charset=utf-8");
              res.end(
                JSON.stringify({
                  ok: false,
                  reason: `pnpm build exited with code ${result.exitCode}.`,
                  buildLog:
                    `${result.stdout}\n${result.stderr}`.trim()
                })
              );
              return;
            }
            const sizeBytes = await directorySize(distDir).catch(() => 0);
            res.statusCode = 200;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({
                ok: true,
                distPath: distDir,
                sizeBytes,
                buildLog: `${result.stdout}\n${result.stderr}`.trim()
              })
            );
          } catch (error) {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({
                ok: false,
                reason: error instanceof Error ? error.message : String(error)
              })
            );
          }
        }
      );
    }
  };
}

interface BuildResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function runBuild(cwd: string): Promise<BuildResult> {
  return new Promise((resolveBuild) => {
    const child = spawn(
      "pnpm",
      ["--filter", "@sugarmagic/target-web", "build"],
      {
        cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      stderr += `${error instanceof Error ? error.message : String(error)}\n`;
      resolveBuild({ exitCode: 1, stdout, stderr });
    });
    child.on("close", (exitCode) => {
      resolveBuild({ exitCode, stdout, stderr });
    });
  });
}

async function directorySize(dir: string): Promise<number> {
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(entryPath);
    } else if (entry.isFile()) {
      const info = await stat(entryPath);
      total += info.size;
    }
  }
  return total;
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
    createMechanicsSchemaPlugin(),
    createPackagePureClientPlugin()
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
