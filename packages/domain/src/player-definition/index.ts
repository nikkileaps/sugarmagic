import { createScopedId } from "../shared/identity";

export type PlayerAnimationSlot = "idle" | "walk" | "run";

export interface PlayerPhysicalProfile {
  height: number;
  radius: number;
  eyeHeight: number;
}

export interface PlayerMovementProfile {
  walkSpeed: number;
  runSpeed: number;
  acceleration: number;
}

export interface PlayerCasterProfile {
  initialBattery: number;
  rechargeRate: number;
  initialResonance: number;
  allowedSpellTags: string[];
  blockedSpellTags: string[];
}

export interface PlayerAnimationBindings {
  idle: string | null;
  walk: string | null;
  run: string | null;
}

export interface PlayerPresentationProfile {
  modelAssetDefinitionId: string | null;
  animationAssetBindings: PlayerAnimationBindings;
}

export interface PlayerDefinition {
  definitionId: string;
  displayName: string;
  physicalProfile: PlayerPhysicalProfile;
  movementProfile: PlayerMovementProfile;
  casterProfile: PlayerCasterProfile;
  presentation: PlayerPresentationProfile;
}

export const DEFAULT_PLAYER_PHYSICAL_PROFILE: PlayerPhysicalProfile = {
  height: 1.8,
  radius: 0.35,
  eyeHeight: 1.62
};

export const DEFAULT_PLAYER_MOVEMENT_PROFILE: PlayerMovementProfile = {
  walkSpeed: 4.5,
  runSpeed: 6.5,
  acceleration: 10
};

export const DEFAULT_PLAYER_CASTER_PROFILE: PlayerCasterProfile = {
  initialBattery: 100,
  rechargeRate: 1,
  initialResonance: 0,
  allowedSpellTags: [],
  blockedSpellTags: []
};

export const DEFAULT_PLAYER_ANIMATION_BINDINGS: PlayerAnimationBindings = {
  idle: null,
  walk: null,
  run: null
};

export function createPlayerDefinitionId(projectId: string): string {
  return `${projectId}:player:${createScopedId("player")}`;
}

export function createDefaultPlayerDefinition(
  projectId: string,
  options: {
    definitionId?: string;
    displayName?: string;
  } = {}
): PlayerDefinition {
  return {
    definitionId:
      options.definitionId ?? `${projectId}:player:default`,
    displayName: options.displayName ?? "Player",
    physicalProfile: { ...DEFAULT_PLAYER_PHYSICAL_PROFILE },
    movementProfile: { ...DEFAULT_PLAYER_MOVEMENT_PROFILE },
    casterProfile: {
      ...DEFAULT_PLAYER_CASTER_PROFILE,
      allowedSpellTags: [...DEFAULT_PLAYER_CASTER_PROFILE.allowedSpellTags],
      blockedSpellTags: [...DEFAULT_PLAYER_CASTER_PROFILE.blockedSpellTags]
    },
    presentation: {
      modelAssetDefinitionId: null,
      animationAssetBindings: { ...DEFAULT_PLAYER_ANIMATION_BINDINGS }
    }
  };
}

export function normalizePlayerDefinition(
  playerDefinition: Partial<PlayerDefinition> | null | undefined,
  projectId: string
): PlayerDefinition {
  const defaultDefinition = createDefaultPlayerDefinition(projectId);

  if (!playerDefinition) {
    return defaultDefinition;
  }

  return {
    definitionId: playerDefinition.definitionId ?? defaultDefinition.definitionId,
    displayName: playerDefinition.displayName ?? defaultDefinition.displayName,
    physicalProfile: {
      ...defaultDefinition.physicalProfile,
      ...(playerDefinition.physicalProfile ?? {})
    },
    movementProfile: {
      ...defaultDefinition.movementProfile,
      ...(playerDefinition.movementProfile ?? {})
    },
    casterProfile: {
      ...defaultDefinition.casterProfile,
      ...(playerDefinition.casterProfile ?? {}),
      allowedSpellTags: [
        ...(playerDefinition.casterProfile?.allowedSpellTags ??
          defaultDefinition.casterProfile.allowedSpellTags)
      ],
      blockedSpellTags: [
        ...(playerDefinition.casterProfile?.blockedSpellTags ??
          defaultDefinition.casterProfile.blockedSpellTags)
      ]
    },
    presentation: {
      modelAssetDefinitionId:
        playerDefinition.presentation?.modelAssetDefinitionId ??
        defaultDefinition.presentation.modelAssetDefinitionId,
      animationAssetBindings: {
        ...defaultDefinition.presentation.animationAssetBindings,
        ...(playerDefinition.presentation?.animationAssetBindings ?? {})
      }
    }
  };
}
