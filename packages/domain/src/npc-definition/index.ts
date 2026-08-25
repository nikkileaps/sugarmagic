/**
 * packages/domain/src/npc-definition/index.ts
 *
 * Purpose: Defines the canonical authored NPC model and its normalization rules.
 *
 * Exports:
 *   - NPCDefinition and related presentation types
 *   - createDefaultNPCDefinition
 *   - normalizeNPCDefinition
 *   - normalizeNPCDefinitionForWrite
 *
 * Relationships:
 *   - Is consumed by authored project state, runtime NPC assembly, and conversation selection.
 *   - Owns the plugin metadata extension point used by sugarlang and future plugins.
 *
 * Implements: Epic 2 domain prerequisite for NPC metadata propagation
 *
 * Status: active
 */

import { createUuid } from "../shared/identity";

export type NPCAnimationSlot = "idle" | "walk" | "run";

/**
 * What an author reads for each animation slot. Exhaustive over
 * NPCAnimationSlot, so adding a slot without a label fails the typecheck.
 */
export const NPC_ANIMATION_SLOT_LABELS: Record<NPCAnimationSlot, string> = {
  idle: "Idle",
  walk: "Walk",
  run: "Run"
};
export type NPCInteractionMode = "scripted" | "agent";

/** Where an NPC's effective mode came from. */
export type NPCInteractionModeTier = "definition" | "quest";

export interface ResolvedNPCInteractionMode {
  mode: NPCInteractionMode;
  tier: NPCInteractionModeTier;
}

/**
 * THE precedence for an NPC's interaction mode. The authored
 * definition says what an NPC normally is; a quest action can
 * override it while the story needs something else, and clearing
 * the override hands the NPC back to its definition.
 *
 * Every site that branches on scripted-vs-agent resolves through
 * here rather than reading `npcDefinition.interactionMode`, so
 * there is one answer rather than one per caller. Today that is
 * four sites: three in `gameplay-session` (which selection shape,
 * whether the NPC is interactable, which resolve path) and
 * sugarlang's `listWarmableNpcIds`. Everything further downstream
 * already routes on the DERIVED `conversationKind`, so it follows
 * automatically.
 *
 * `tier` is returned so a caller can say WHY -- the same reason
 * `resolveEffectiveInstanceCollider` returns one.
 */
export function resolveEffectiveInteractionMode(
  definitionMode: NPCInteractionMode,
  questOverride: NPCInteractionMode | null | undefined
): ResolvedNPCInteractionMode {
  return questOverride
    ? { mode: questOverride, tier: "quest" }
    : { mode: definitionMode, tier: "definition" };
}

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
  // Plugin metadata keys must follow the namespace convention documented in
  // packages/domain/README.md ("Plugin Metadata Convention").
  metadata?: Record<string, unknown>;
  presentation: NPCPresentationProfile;
}

export const DEFAULT_NPC_ANIMATION_BINDINGS: NPCAnimationBindings = {
  idle: null,
  walk: null,
  run: null
};

export const DEFAULT_NPC_MODEL_HEIGHT = 1.7;

function isMetadataRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeNpcMetadata(
  metadata: unknown
): Record<string, unknown> | undefined {
  if (!isMetadataRecord(metadata)) {
    return undefined;
  }

  return { ...metadata };
}

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
  const normalizedMetadata = normalizeNpcMetadata(npcDefinition?.metadata);

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
    ...(normalizedMetadata ? { metadata: normalizedMetadata } : {}),
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
