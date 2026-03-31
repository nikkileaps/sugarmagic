export type RuntimeCompileProfile =
  | "authoring-preview"
  | "runtime-preview"
  | "published-target";

export interface CompileProfilePolicy {
  profile: RuntimeCompileProfile;
  debugInspectionEnabled: boolean;
  targetOptimizationLevel: "interactive" | "runtime" | "published";
}

export const compileProfilePolicies: Record<
  RuntimeCompileProfile,
  CompileProfilePolicy
> = {
  "authoring-preview": {
    profile: "authoring-preview",
    debugInspectionEnabled: true,
    targetOptimizationLevel: "interactive"
  },
  "runtime-preview": {
    profile: "runtime-preview",
    debugInspectionEnabled: false,
    targetOptimizationLevel: "runtime"
  },
  "published-target": {
    profile: "published-target",
    debugInspectionEnabled: false,
    targetOptimizationLevel: "published"
  }
};
