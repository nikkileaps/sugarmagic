import type {
  RuntimeBootModel,
  RuntimeCompileProfile,
  RuntimeContentSource,
  RuntimeHostKind
} from "@sugarmagic/runtime-core";

export interface BrowserRuntimeBootHost {
  boot: RuntimeBootModel;
  hostKind: RuntimeHostKind;
  compileProfile: RuntimeCompileProfile;
  contentSource: RuntimeContentSource;
}
