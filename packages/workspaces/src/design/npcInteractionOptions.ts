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

// The domain union is the source of truth for interaction modes; the
// dropdown must stay inside it or writes fail at normalize. A plugin
// wanting a new mode widens NPCInteractionMode first.
const VALID_MODES: ReadonlySet<string> = new Set<NPCInteractionMode>([
  "scripted",
  "agent"
]);

export function resolveNPCInteractionOptions(
  pluginOptions: NPCInteractionOptionContribution[]
): NPCInteractionOption[] {
  const resolved: NPCInteractionOption[] = [BUILTIN_OPTION];
  const seen = new Set<string>(["scripted"]);

  for (const option of pluginOptions) {
    if (!VALID_MODES.has(option.interactionMode) || seen.has(option.interactionMode)) {
      continue;
    }
    seen.add(option.interactionMode);
    resolved.push({
      value: option.interactionMode as NPCInteractionMode,
      label: option.label,
      description: option.summary
    });
  }

  return resolved;
}
