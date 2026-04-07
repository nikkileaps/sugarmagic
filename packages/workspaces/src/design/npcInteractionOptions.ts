import type { NPCInteractionMode } from "@sugarmagic/domain";

export interface NPCInteractionOption {
  value: NPCInteractionMode;
  label: string;
  description?: string;
}

export interface NPCInteractionOptionContribution {
  interactionMode: string;
  label: string;
  summary?: string;
}

const BUILTIN_OPTION: NPCInteractionOption = {
  value: "scripted",
  label: "Scripted",
  description: "Structured authored dialogue."
};

export function resolveNPCInteractionOptions(
  pluginOptions: NPCInteractionOptionContribution[]
): NPCInteractionOption[] {
  const resolved: NPCInteractionOption[] = [BUILTIN_OPTION];
  const seen = new Set<NPCInteractionMode>(["scripted"]);

  for (const option of pluginOptions) {
    if (
      option.interactionMode !== "scripted" &&
      option.interactionMode !== "agent"
    ) {
      continue;
    }
    if (seen.has(option.interactionMode)) {
      continue;
    }
    seen.add(option.interactionMode);
    resolved.push({
      value: option.interactionMode,
      label: option.label,
      description: option.summary
    });
  }

  return resolved;
}
