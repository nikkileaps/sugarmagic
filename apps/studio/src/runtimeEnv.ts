import type { RuntimePluginEnvironment } from "@sugarmagic/plugins";

export function readStudioPluginRuntimeEnvironment(): RuntimePluginEnvironment {
  return {
    // No SUGARMAGIC_SUGARLANG_TARGET_LANGUAGE here (removed 2026-07-29): target
    // language is a player's choice, not a deploy variable. It resolves from the
    // player's selection, falling back to the project's authored default.
    SUGARMAGIC_SUGARLANG_PROXY_BASE_URL:
      import.meta.env.VITE_SUGARMAGIC_SUGARLANG_PROXY_BASE_URL,
    SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL:
      import.meta.env.VITE_SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL,
    SUGARMAGIC_ANTHROPIC_MODEL: import.meta.env.VITE_SUGARMAGIC_ANTHROPIC_MODEL
  };
}
