import type { RuntimeBootModel } from "@sugarmagic/runtime-core";

export interface PluginRuntimeContribution {
  pluginId: string;
  phases: RuntimeBootModel["hostKind"][];
}
