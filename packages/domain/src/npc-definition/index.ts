import { createUuid } from "../shared/identity";

export type NPCAnimationSlot = "idle" | "walk" | "run";
export type NPCInteractionMode = "scripted" | "agent";

export interface NPCAnimationBindings {
  idle: string | null;
  walk: string | null;
  run: string | null;
}

export interface NPCPresentationProfile {
  modelAssetDefinitionId: string | null;
  modelHeight: number;
  animationAssetBindings: NPCAnimationBindings;
}

export interface NPCDefinition {
  definitionId: string;
  displayName: string;
  description?: string;
  interactionMode: NPCInteractionMode;
  lorePageId: string | null;
  presentation: NPCPresentationProfile;
}

export const DEFAULT_NPC_ANIMATION_BINDINGS: NPCAnimationBindings = {
  idle: null,
  walk: null,
  run: null
};

export const DEFAULT_NPC_MODEL_HEIGHT = 1.7;

export function createNPCDefinitionId(): string {
  return createUuid();
}

export function createDefaultNPCDefinition(
  options: {
    definitionId?: string;
    displayName?: string;
    description?: string;
  } = {}
): NPCDefinition {
  return {
    definitionId: options.definitionId ?? createNPCDefinitionId(),
    displayName: options.displayName ?? "New NPC",
    description: options.description,
    interactionMode: "scripted",
    lorePageId: null,
    presentation: {
      modelAssetDefinitionId: null,
      modelHeight: DEFAULT_NPC_MODEL_HEIGHT,
      animationAssetBindings: { ...DEFAULT_NPC_ANIMATION_BINDINGS }
    }
  };
}

let hasWarnedLegacyGuidedInteractionMode = false;

function warnLegacyGuidedInteractionMode(): void {
  if (hasWarnedLegacyGuidedInteractionMode) {
    return;
  }
  hasWarnedLegacyGuidedInteractionMode = true;
  console.warn(
    '[domain] NPC interaction mode "guided" is deprecated and will be migrated to "agent" on load.'
  );
}

function normalizeNPCInteractionModeForRead(
  interactionMode: string | undefined,
  fallback: NPCInteractionMode
): NPCInteractionMode {
  if (interactionMode === "scripted") {
    return "scripted";
  }
  if (interactionMode === "agent") {
    return "agent";
  }
  if (interactionMode === "guided") {
    warnLegacyGuidedInteractionMode();
    return "agent";
  }
  return fallback;
}

function normalizeNPCInteractionModeForWrite(
  interactionMode: string | undefined
): NPCInteractionMode {
  if (interactionMode === "scripted" || interactionMode === "agent") {
    return interactionMode;
  }
  if (interactionMode === "guided") {
    throw new Error(
      'NPC interaction mode "guided" is no longer supported. Use "agent" instead.'
    );
  }
  throw new Error(
    `Unsupported NPC interaction mode "${interactionMode ?? "undefined"}".`
  );
}

export function normalizeNPCDefinition(
  npcDefinition: Partial<NPCDefinition> | null | undefined
): NPCDefinition {
  const defaultDefinition = createDefaultNPCDefinition();
  const rawInteractionMode = npcDefinition?.interactionMode as string | undefined;

  if (!npcDefinition) {
    return defaultDefinition;
  }

  return {
    definitionId: npcDefinition.definitionId ?? defaultDefinition.definitionId,
    displayName: npcDefinition.displayName ?? defaultDefinition.displayName,
    description: npcDefinition.description ?? undefined,
    interactionMode: normalizeNPCInteractionModeForRead(
      rawInteractionMode,
      defaultDefinition.interactionMode
    ),
    lorePageId:
      typeof npcDefinition.lorePageId === "string" &&
      npcDefinition.lorePageId.trim().length > 0
        ? npcDefinition.lorePageId.trim()
        : null,
    presentation: {
      modelAssetDefinitionId:
        npcDefinition.presentation?.modelAssetDefinitionId ??
        defaultDefinition.presentation.modelAssetDefinitionId,
      modelHeight:
        npcDefinition.presentation?.modelHeight ??
        defaultDefinition.presentation.modelHeight,
      animationAssetBindings: {
        ...defaultDefinition.presentation.animationAssetBindings,
        ...(npcDefinition.presentation?.animationAssetBindings ?? {})
      }
    }
  };
}

export function normalizeNPCDefinitionForWrite(
  npcDefinition: Partial<NPCDefinition> | null | undefined
): NPCDefinition {
  const rawInteractionMode = npcDefinition?.interactionMode as string | undefined;

  return normalizeNPCDefinition({
    ...npcDefinition,
    interactionMode: normalizeNPCInteractionModeForWrite(rawInteractionMode)
  });
}
