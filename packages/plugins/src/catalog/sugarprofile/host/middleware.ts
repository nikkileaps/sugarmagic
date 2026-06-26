// SugarProfile plugin's host-middleware contribution. All
// `/__sugarprofile/*` routes live here, owned by the plugin
// end-to-end. Two endpoints today:
//
//   POST /__sugarprofile/probe-supabase   — health-check the
//     configured Supabase project (URL + anon key reach the
//     PostgREST endpoint).
//   POST /__sugarprofile/run-migration    — apply pending Supabase
//     migrations under `deployment/supabase/`. Uses the Supabase
//     CLI installed as a workspace devDependency (no global
//     install needed) and authenticates via the
//     SUPABASE_ACCESS_TOKEN env var derived from a Personal Access
//     Token the user pastes into Studio.
//
// Implements: Plan 047 §Story 47.8

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin as VitePlugin } from "vite";
import { runHostCommand } from "../../../host";

// Story 47.8 — workspace-pinned Supabase CLI binary. pnpm puts the
// shim at packages/plugins/node_modules/.bin/supabase but that
// directory is NOT on Studio's PATH (Studio's vite process only
// has apps/studio/node_modules/.bin). Resolve the absolute path
// from this file's location so the spawn finds it regardless of
// which workspace package launched the dev server.
const SUPABASE_BIN_PATH = fileURLToPath(
  new URL("../../../../node_modules/.bin/supabase", import.meta.url)
);

function readJsonBody(
  req: import("node:http").IncomingMessage
): Promise<unknown> {
  return new Promise((resolveBody, rejectBody) => {
    let buffer = "";
    req.on("data", (chunk) => {
      buffer += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolveBody(buffer.trim().length > 0 ? JSON.parse(buffer) : {});
      } catch (error) {
        rejectBody(error);
      }
    });
    req.on("error", rejectBody);
  });
}

function sendJson(
  res: import("node:http").ServerResponse,
  statusCode: number,
  payload: unknown
) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload, null, 2));
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// The Supabase CLI is a devDependency of @sugarmagic/plugins; pnpm
// hoists its binary into the workspace's node_modules/.bin so plain
// `supabase` resolves on PATH inside the Studio dev-server process
// without requiring a global install. If the resolution fails we
// surface a useful error rather than a generic "not found".

// Story 47.8 — probe the Supabase project's PostgREST root with
// the configured anon key. A 200 + JSON body confirms URL + key
// pair is valid; anything else surfaces the error to the user
// before they bother with the migration step.
function createProbeSupabasePlugin(): VitePlugin {
  return {
    name: "sugarprofile-probe-supabase",
    configureServer(server) {
      server.middlewares.use(
        "/__sugarprofile/probe-supabase",
        async (req, res, next) => {
          if (req.method !== "POST") {
            next();
            return;
          }
          try {
            const body = (await readJsonBody(req)) as {
              supabaseUrl?: unknown;
              supabaseAnonKey?: unknown;
            };
            const supabaseUrl = readString(body.supabaseUrl);
            const supabaseAnonKey = readString(body.supabaseAnonKey);
            if (!supabaseUrl) {
              sendJson(res, 400, {
                ok: false,
                reason: "supabaseUrl is required."
              });
              return;
            }
            if (!supabaseAnonKey) {
              sendJson(res, 400, {
                ok: false,
                reason: "supabaseAnonKey is required."
              });
              return;
            }
            const probeUrl = `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/`;
            const response = await fetch(probeUrl, {
              headers: {
                apikey: supabaseAnonKey,
                authorization: `Bearer ${supabaseAnonKey}`
              }
            });
            if (!response.ok) {
              const bodyText = await response.text().catch(() => "");
              sendJson(res, 200, {
                ok: false,
                reason: `Supabase probe returned ${response.status} ${response.statusText}.`,
                detail: bodyText.slice(0, 512)
              });
              return;
            }
            sendJson(res, 200, { ok: true, probeUrl });
          } catch (error) {
            sendJson(res, 500, {
              ok: false,
              reason: error instanceof Error ? error.message : String(error)
            });
          }
        }
      );
    }
  };
}

// Story 47.8 — apply pending Supabase migrations via the
// workspace-pinned Supabase CLI using `db push --db-url`. The
// --db-url path connects directly to Postgres so we don't need
// `supabase link` state on disk + we don't need a Personal Access
// Token. The user pastes their project's database password
// (Project Settings -> Database -> Database password); the host
// endpoint constructs the canonical connection string + invokes
// the CLI with it. Database password lives in browser
// localStorage; it never enters the project's plugin config and
// never gets committed.
function buildDirectConnectionString(args: {
  supabaseUrl: string;
  databasePassword: string;
}): string | null {
  const match = /^https?:\/\/([a-z0-9-]+)\.supabase\.co(?:\/|$)/i.exec(
    args.supabaseUrl.trim()
  );
  if (!match) return null;
  const projectRef = match[1];
  const encodedPassword = encodeURIComponent(args.databasePassword);
  return `postgresql://postgres:${encodedPassword}@db.${projectRef}.supabase.co:5432/postgres`;
}

function sanitizeStderr(stderr: string, secret: string): string {
  if (!secret) return stderr;
  return stderr.split(secret).join("***");
}

function createRunMigrationPlugin(): VitePlugin {
  return {
    name: "sugarprofile-run-migration",
    configureServer(server) {
      server.middlewares.use(
        "/__sugarprofile/run-migration",
        async (req, res, next) => {
          if (req.method !== "POST") {
            next();
            return;
          }
          try {
            const body = (await readJsonBody(req)) as {
              workingDirectory?: unknown;
              supabaseUrl?: unknown;
              databasePassword?: unknown;
            };
            const workingDirectory = readString(body.workingDirectory);
            const supabaseUrl = readString(body.supabaseUrl);
            const databasePassword = readString(body.databasePassword);
            if (!workingDirectory) {
              sendJson(res, 400, {
                ok: false,
                reason: "workingDirectory is required."
              });
              return;
            }
            if (!supabaseUrl) {
              sendJson(res, 400, {
                ok: false,
                reason:
                  "supabaseUrl is required. Set it in the SugarProfile workspace's Supabase URL field."
              });
              return;
            }
            if (!databasePassword) {
              sendJson(res, 400, {
                ok: false,
                reason:
                  "databasePassword is required. Find it at Project Settings -> Database -> Database password in the Supabase dashboard."
              });
              return;
            }
            if (!existsSync(workingDirectory)) {
              sendJson(res, 200, {
                ok: false,
                reason: `workingDirectory does not exist on disk: ${workingDirectory}`
              });
              return;
            }
            const configPath = `${workingDirectory}/deployment/supabase/config.toml`;
            if (!existsSync(configPath)) {
              sendJson(res, 200, {
                ok: false,
                reason: `Missing ${configPath}. Save the project in Studio so SugarProfile emits its managed files first.`
              });
              return;
            }
            if (!existsSync(SUPABASE_BIN_PATH)) {
              sendJson(res, 200, {
                ok: false,
                reason: `Supabase CLI binary not found at ${SUPABASE_BIN_PATH}. Run \`pnpm install\` from the sugarmagic monorepo root to restore the workspace devDependency.`
              });
              return;
            }
            const dbUrl = buildDirectConnectionString({
              supabaseUrl,
              databasePassword
            });
            if (!dbUrl) {
              sendJson(res, 200, {
                ok: false,
                reason: `Could not extract a Supabase project ref from supabaseUrl="${supabaseUrl}". Expected the canonical https://<ref>.supabase.co shape.`
              });
              return;
            }
            // `db push --db-url <conn>` connects directly to the
            // remote Postgres without needing `supabase link`
            // state on disk. `--workdir deployment` tells the CLI
            // where to find migrations; `--yes` skips the prompt.
            const result = await runHostCommand({
              command: SUPABASE_BIN_PATH,
              args: [
                "db",
                "push",
                "--workdir",
                "deployment",
                "--db-url",
                dbUrl,
                "--yes"
              ],
              cwd: workingDirectory
            });
            if (result.exitCode !== 0) {
              sendJson(res, 200, {
                ok: false,
                reason: `supabase db push exited with code ${result.exitCode}.`,
                stdout: result.stdout,
                stderr: sanitizeStderr(result.stderr, databasePassword)
              });
              return;
            }
            sendJson(res, 200, {
              ok: true,
              stdout: result.stdout,
              stderr: sanitizeStderr(result.stderr, databasePassword)
            });
          } catch (error) {
            sendJson(res, 500, {
              ok: false,
              reason: error instanceof Error ? error.message : String(error)
            });
          }
        }
      );
    }
  };
}

export function createSugarProfileHostMiddleware(): VitePlugin[] {
  return [createProbeSupabasePlugin(), createRunMigrationPlugin()];
}
