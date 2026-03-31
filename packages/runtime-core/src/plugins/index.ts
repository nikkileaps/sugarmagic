export interface PluginRuntimeHookDescriptor {
  hookId: string;
  phase: "boot" | "scene-load" | "runtime-session";
}
