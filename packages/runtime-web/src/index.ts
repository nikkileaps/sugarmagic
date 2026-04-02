import {
  createRuntimeBootModel,
  type RuntimeBootModel,
  type RuntimeCompileProfile,
  type RuntimeContentSource,
  type RuntimeHostKind
} from "@sugarmagic/runtime-core";
import type { BrowserRuntimeBootHost } from "./boot";

export * from "./assets";
export * from "./audio";
export * from "./boot";
export * from "./input";
export * from "./network";
export * from "./preview";
export * from "./save";
export * from "./scheduling";
export * from "./transfer";
export * from "./viewport";
export * from "./workers";

export interface BrowserRuntimeAdapter {
  host: BrowserRuntimeBootHost;
  boot: RuntimeBootModel;
  platform: "browser";
  assetResolution: "root-relative-authored" | "published-target-manifest";
  workerPolicy: "worker-backed-heavy-jobs";
  inputPolicy: "dom-input-host";
}

export interface BrowserRuntimeAdapterRequest {
  hostKind: RuntimeHostKind;
  compileProfile: RuntimeCompileProfile;
  contentSource: RuntimeContentSource;
}

export function createBrowserRuntimeAdapter(
  request: BrowserRuntimeAdapterRequest
): BrowserRuntimeAdapter {
  const boot = createRuntimeBootModel(request);

  return {
    host: {
      boot,
      hostKind: request.hostKind,
      compileProfile: request.compileProfile,
      contentSource: request.contentSource
    },
    boot,
    platform: "browser",
    assetResolution:
      request.contentSource === "authored-game-root"
        ? "root-relative-authored"
        : "published-target-manifest",
    workerPolicy: "worker-backed-heavy-jobs",
    inputPolicy: "dom-input-host"
  };
}
