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

/**
 * What an NPC does when it cannot understand the player.
 *
 * The list is closed: an author picks from these six rather than typing a
 * word, so nothing downstream has to decide what an unrecognized one means.
 */
export const RECOVERY_STRATEGIES = [
  "curt-exit",
  "change-subject",
  "joke",
  "playful-probe",
  "self-disclosure",
  "gossip"
] as const;

export type RecoveryStrategy = (typeof RECOVERY_STRATEGIES)[number];

const RECOVERY_STRATEGY_SET: ReadonlySet<string> = new Set(RECOVERY_STRATEGIES);

/** [LAW:parse-dont-validate] The one place an unknown word becomes a known
 *  strategy. Callers take `RecoveryStrategy` and never re-check. */
export function isRecoveryStrategy(value: unknown): value is RecoveryStrategy {
  return typeof value === "string" && RECOVERY_STRATEGY_SET.has(value);
}

/**
 * One authored recovery entry: the strategy and the writer's note about why
 * it suits this character.
 *
 * [LAW:one-source-of-truth] The strategy an NPC reaches for and the prose that
 * reaches the prompt are two readings of ONE authored entry, not two fields
 * that can disagree.
 */
export interface NPCRecoveryStrategy {
  strategy: RecoveryStrategy;
  /** Empty when the author has not written one. */
  note: string;
}

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
  /**
   * What this NPC does when it cannot understand the player, in the order it
   * reaches for them. Order is authored order and decides which strategy comes
   * first. Empty is valid and means the NPC talks about itself.
   */
  recoveryStrategies: NPCRecoveryStrategy[];
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

/**
 * Reads authored recovery entries, dropping anything that is not one of the
 * six strategies and keeping the first entry when a strategy repeats.
 *
 * A project saved before this field existed reads as an empty list, which is
 * the same as an NPC whose author has not chosen any: it talks about itself.
 */
function normalizeRecoveryStrategies(value: unknown): NPCRecoveryStrategy[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<RecoveryStrategy>();
  const entries: NPCRecoveryStrategy[] = [];

  for (const entry of value) {
    if (!isMetadataRecord(entry)) continue;
    const strategy = entry["strategy"];
    if (!isRecoveryStrategy(strategy) || seen.has(strategy)) continue;

    seen.add(strategy);
    const note = entry["note"];
    // Stored exactly as typed, like `description`. Trimming here would run on
    // every keystroke -- normalize is on the write path -- and the editor reads
    // its value back out of the store, so the author could never type a space.
    // The prompt builder trims when it renders the brief.
    entries.push({
      strategy,
      note: typeof note === "string" ? note : ""
    });
  }

  return entries;
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
    recoveryStrategies: [],
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
    recoveryStrategies: normalizeRecoveryStrategies(
      npcDefinition.recoveryStrategies
    ),
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
