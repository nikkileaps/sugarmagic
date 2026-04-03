import { createUuid } from "../shared/identity";

export type NPCAnimationSlot = "idle" | "walk" | "run";

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
    presentation: {
      modelAssetDefinitionId: null,
      modelHeight: DEFAULT_NPC_MODEL_HEIGHT,
      animationAssetBindings: { ...DEFAULT_NPC_ANIMATION_BINDINGS }
    }
  };
}

export function normalizeNPCDefinition(
  npcDefinition: Partial<NPCDefinition> | null | undefined
): NPCDefinition {
  const defaultDefinition = createDefaultNPCDefinition();

  if (!npcDefinition) {
    return defaultDefinition;
  }

  return {
    definitionId: npcDefinition.definitionId ?? defaultDefinition.definitionId,
    displayName: npcDefinition.displayName ?? defaultDefinition.displayName,
    description: npcDefinition.description ?? undefined,
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
