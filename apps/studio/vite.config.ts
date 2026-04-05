import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  type DeploymentActionExecutionResult,
  type DeploymentActionKind,
  resolveDeploymentActionFromSettings
} from "../../packages/plugins/src/deployment/actions";
import { normalizeDeploymentSettings } from "../../packages/domain/src/deployment/index";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

interface SugarDeployActionRequest {
  actionKind: DeploymentActionKind;
  gameProject?: {
    deployment?: unknown;
  };
}

function readJsonBody(req: import("node:http").IncomingMessage): Promise<unknown> {
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

function runHostCommand(command: {
  command: string;
  args: string[];
  cwd: string;
}): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveRun) => {
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      stderr += `${error instanceof Error ? error.message : String(error)}\n`;
      resolveRun({
        exitCode: 1,
        stdout,
        stderr
      });
    });
    child.on("close", (exitCode) => {
      resolveRun({
        exitCode,
        stdout,
        stderr
      });
    });
  });
}

function createSugarDeployHostPlugin(): Plugin {
  return {
    name: "sugardeploy-host-actions",
    configureServer(server) {
      server.middlewares.use("/__sugardeploy/action", async (req, res, next) => {
        if (req.method !== "POST") {
          next();
          return;
        }

        try {
          const body = (await readJsonBody(req)) as Partial<SugarDeployActionRequest>;
          const actionKind = body.actionKind;
          if (
            actionKind !== "deploy" &&
            actionKind !== "stop" &&
            actionKind !== "status" &&
            actionKind !== "health"
          ) {
            sendJson(res, 400, {
              ok: false,
              message: "Invalid SugarDeploy action."
            });
            return;
          }

          const deploymentSettings = normalizeDeploymentSettings(
            body.gameProject?.deployment as never
          );
          const descriptor = resolveDeploymentActionFromSettings(
            deploymentSettings,
            actionKind
          );

          if (!descriptor.supported) {
            sendJson(res, 400, {
              ok: false,
              descriptor,
              exitCode: null,
              stdout: "",
              stderr: "",
              message: descriptor.reason ?? "SugarDeploy action is not supported."
            } satisfies DeploymentActionExecutionResult);
            return;
          }

          if (!descriptor.command) {
            sendJson(res, 200, {
              ok: true,
              descriptor,
              exitCode: 0,
              stdout: "",
              stderr: "",
              message:
                descriptor.healthUrl != null
                  ? `SugarDeploy resolved ${actionKind} without a shell command.`
                  : "SugarDeploy action completed."
            } satisfies DeploymentActionExecutionResult);
            return;
          }

          const resolvedCwd = resolve(descriptor.command.cwd);
          if (!existsSync(resolvedCwd)) {
            sendJson(res, 400, {
              ok: false,
              descriptor,
              exitCode: null,
              stdout: "",
              stderr: "",
              message:
                `Working directory does not exist: ${resolvedCwd}. ` +
                "Save the project first and make sure the Working Directory override points at the game root on disk."
            } satisfies DeploymentActionExecutionResult);
            return;
          }

          const runResult = await runHostCommand({
            ...descriptor.command,
            cwd: resolvedCwd
          });
          sendJson(res, runResult.exitCode === 0 ? 200 : 500, {
            ok: runResult.exitCode === 0,
            descriptor: {
              ...descriptor,
              command: {
                ...descriptor.command,
                cwd: resolvedCwd
              }
            },
            exitCode: runResult.exitCode,
            stdout: runResult.stdout,
            stderr: runResult.stderr,
            message:
              runResult.exitCode === 0
                ? `SugarDeploy ${actionKind} completed successfully.`
                : `SugarDeploy ${actionKind} failed with exit code ${runResult.exitCode ?? "unknown"}.`
          } satisfies DeploymentActionExecutionResult);
        } catch (error) {
          sendJson(res, 500, {
            ok: false,
            message: error instanceof Error ? error.message : String(error)
          });
        }
      });
    }
  };
}

export default defineConfig({
  envDir: "../..",
  plugins: [react(), createSugarDeployHostPlugin()],
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
