import type { RuntimeCompileProfile } from "./materials";
import type { RuntimeSessionBoundary } from "./state";

export * from "./camera";
export * from "./coordination";
export * from "./ecs";
export * from "./input";
export * from "./environment";
export * from "./interaction";
export * from "./jobs";
export * from "./landscape";
export * from "./materials";
export * from "./plugins";
export * from "./scene";
export * from "./state";
export * from "./streaming";
export * from "./vfx";

export type RuntimeHostKind = "studio" | "published-web";
export type RuntimeContentSource = "authored-game-root" | "published-artifact";

export interface RuntimeBootRequest {
  hostKind: RuntimeHostKind;
  compileProfile: RuntimeCompileProfile;
  contentSource: RuntimeContentSource;
}

export interface RuntimeBootModel {
  hostKind: RuntimeHostKind;
  compileProfile: RuntimeCompileProfile;
  contentSource: RuntimeContentSource;
  runtimeFamily: "sugarmagic-shared-runtime";
  usesSharedSemantics: true;
  sessionBoundary: RuntimeSessionBoundary;
}

export function createRuntimeBootModel(
  request: RuntimeBootRequest
): RuntimeBootModel {
  return {
    ...request,
    runtimeFamily: "sugarmagic-shared-runtime",
    usesSharedSemantics: true,
    sessionBoundary: "isolated-runtime-session"
  };
}
