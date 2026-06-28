// Shared host-CLI execution helpers used by plugin host-middleware
// contributions. Lifted from apps/studio/vite.config.ts during 45.4.6 so
// any plugin contributing host middleware can reuse the same spawn
// semantics, sequenced execution, and not-found tolerance — rather than
// copying them or reaching back into Studio code.

import { spawn } from "node:child_process";

export interface HostCommandInput {
  command: string;
  args: string[];
  cwd: string;
  /**
   * Optional bytes piped to the child's stdin. REQUIRED for commands that
   * must not surface the input in argv — e.g., `gcloud secrets versions add
   * --data-file=-` is the only way to write a secret value without it
   * leaking into shell history, `ps` listings, and process audit logs.
   * When provided, stdio[0] flips to "pipe" and the buffer is written + ended.
   * Never logged by this helper (caller's responsibility to keep it off any
   * console.log path it might have).
   */
  stdin?: string;
  /**
   * Optional env var overrides MERGED on top of `process.env` for
   * the child process. Used by the Deploy auto-sync git invocations
   * to thread per-command env without polluting Studio's own env.
   */
  env?: Record<string, string>;
}

export interface HostCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export function runHostCommand(command: HostCommandInput): Promise<HostCommandResult> {
  return new Promise((resolveRun) => {
    const hasStdin = command.stdin != null;
    // Tuple-typed stdio so TS retains "pipe" → non-null stdout/stderr on the
    // child. With a conditional element at index 0, TS widens to a union and
    // loses the narrowing for stdout/stderr.
    const stdio: ["ignore" | "pipe", "pipe", "pipe"] = [
      hasStdin ? "pipe" : "ignore",
      "pipe",
      "pipe"
    ];
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      env: command.env ? { ...process.env, ...command.env } : process.env,
      stdio
    });
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
      resolveRun({ exitCode: 1, stdout, stderr });
    });
    child.on("close", (exitCode) => {
      resolveRun({ exitCode, stdout, stderr });
    });
    if (hasStdin && child.stdin) {
      child.stdin.write(command.stdin as string);
      child.stdin.end();
    }
  });
}

export interface HostCommandStep extends HostCommandInput {
  label: string;
  /**
   * When set, a non-zero exit whose stderr/stdout matches a "not found"
   * pattern is treated as success and the sequence continues. Used by
   * teardown flows to tolerate `gcloud run services delete` against
   * services that don't exist (the resource was already gone).
   */
  tolerateNotFound?: boolean;
}

/**
 * Run a sequence of host commands, stopping on the first non-tolerated
 * failure. Returns the aggregated stdout/stderr with each step's output
 * labeled inline, so the caller can render a single coherent log of the
 * multi-step operation.
 */
export async function runHostCommandSequence(
  steps: HostCommandStep[]
): Promise<HostCommandResult> {
  let aggregatedStdout = "";
  let aggregatedStderr = "";
  for (const step of steps) {
    aggregatedStdout += `\n# ${step.label}\n# $ ${step.command} ${step.args.join(" ")}\n`;
    const result = await runHostCommand({
      command: step.command,
      args: step.args,
      cwd: step.cwd
    });
    aggregatedStdout += result.stdout;
    aggregatedStderr += result.stderr;
    if (result.exitCode !== 0) {
      const looksLikeNotFound =
        step.tolerateNotFound &&
        /(?:NOT_FOUND|not found|could not be found|does not exist)/i.test(
          result.stderr + result.stdout
        );
      if (looksLikeNotFound) {
        aggregatedStdout += `# (tolerated: target did not exist)\n`;
        continue;
      }
      return {
        exitCode: result.exitCode,
        stdout: aggregatedStdout,
        stderr: aggregatedStderr
      };
    }
  }
  return { exitCode: 0, stdout: aggregatedStdout, stderr: aggregatedStderr };
}
