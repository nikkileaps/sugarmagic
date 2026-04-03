import type { DocumentIdentity, RegionReference } from "../shared/identity";
import {
  normalizeNPCDefinition,
  type NPCDefinition
} from "../npc-definition";
import {
  createDefaultPlayerDefinition,
  normalizePlayerDefinition,
  type PlayerDefinition
} from "../player-definition";

export interface GameProject {
  identity: DocumentIdentity;
  displayName: string;
  gameRootPath: string;
  regionRegistry: RegionReference[];
  pluginConfigIds: string[];
  contentLibraryId: string | null;
  playerDefinition: PlayerDefinition;
  npcDefinitions: NPCDefinition[];
}

export function normalizeGameProject(
  gameProject: GameProject | (Omit<GameProject, "playerDefinition" | "npcDefinitions"> & {
    playerDefinition?: Partial<PlayerDefinition> | null;
    npcDefinitions?: Array<Partial<NPCDefinition>> | null;
  })
): GameProject {
  return {
    ...gameProject,
    playerDefinition: normalizePlayerDefinition(
      gameProject.playerDefinition,
      gameProject.identity.id
    ),
    npcDefinitions: (gameProject.npcDefinitions ?? []).map((definition) =>
      normalizeNPCDefinition(definition)
    )
  };
}

export function createDefaultGameProject(
  gameName: string,
  slug: string
): GameProject {
  return {
    identity: { id: slug, schema: "GameProject", version: 1 },
    displayName: gameName,
    gameRootPath: ".",
    regionRegistry: [],
    pluginConfigIds: [],
    contentLibraryId: `${slug}:content-library`,
    playerDefinition: createDefaultPlayerDefinition(slug),
    npcDefinitions: []
  };
}
