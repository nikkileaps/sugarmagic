import type { RuntimePluginEnvironment } from "@sugarmagic/plugins";

export function readStudioPluginRuntimeEnvironment(): RuntimePluginEnvironment {
  return {
    SUGARMAGIC_SUGARLANG_TARGET_LANGUAGE:
      import.meta.env.VITE_SUGARMAGIC_SUGARLANG_TARGET_LANGUAGE,
    SUGARMAGIC_SUGARLANG_PROXY_BASE_URL:
      import.meta.env.VITE_SUGARMAGIC_SUGARLANG_PROXY_BASE_URL,
    SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL:
      import.meta.env.VITE_SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL,
    SUGARMAGIC_ANTHROPIC_MODEL: import.meta.env.VITE_SUGARMAGIC_ANTHROPIC_MODEL
  };
}
