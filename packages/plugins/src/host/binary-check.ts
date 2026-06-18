// Generic "is this binary on PATH?" precondition helper for plugin host
// middleware. Replaces the per-binary `ensureTerraformOnPath` /
// `ensureGcloudOnPath` functions that used to live in Studio's
// vite.config.ts (45.4 / 45.4.5). Callers wrap this with binary-specific
// messages — see catalog/sugardeploy/host/middleware.ts for examples.

import { spawn } from "node:child_process";

export interface BinaryCheckOptions {
  /**
   * Arguments to pass to the binary for the on-PATH check. Defaults to
   * `["version"]` since most CLI tools (gcloud, terraform, git, docker)
   * accept that as a side-effect-free probe.
   */
  versionArgs?: string[];
  /**
   * Human-readable hint appended to the "not found" error message so the
   * UI can point the user at installation docs.
   */
  installHint?: string;
}

export type BinaryCheckResult =
  | { available: true }
  | { available: false; reason: string };

export function ensureBinaryOnPath(
  binary: string,
  options: BinaryCheckOptions = {}
): Promise<BinaryCheckResult> {
  const versionArgs = options.versionArgs ?? ["version"];
  return new Promise((resolveCheck) => {
    const child = spawn(binary, versionArgs, { stdio: "ignore" });
    child.on("error", () =>
      resolveCheck({
        available: false,
        reason:
          `\`${binary}\` binary not found on PATH.` +
          (options.installHint ? ` ${options.installHint}` : "")
      })
    );
    child.on("close", (code) =>
      resolveCheck(
        code === 0
          ? { available: true }
          : {
              available: false,
              reason: `\`${binary} ${versionArgs.join(" ")}\` exited with code ${code}; the binary is present but not functioning as expected.`
            }
      )
    );
  });
}
