import type { DocumentIdentity } from "../shared/identity";

export interface ContentDefinitionReference {
  definitionId: string;
  definitionKind:
    | "asset"
    | "material"
    | "npc"
    | "dialogue"
    | "quest"
    | "item"
    | "inspection"
    | "resonance-point"
    | "vfx";
}

export interface ContentLibrarySnapshot {
  identity: DocumentIdentity;
  definitions: ContentDefinitionReference[];
}
