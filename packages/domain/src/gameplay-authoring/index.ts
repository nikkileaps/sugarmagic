import type { DocumentIdentity } from "../shared/identity";

export interface GameplayDefinitionDocument {
  identity: DocumentIdentity;
  definitionKind: "quest" | "dialogue" | "npc" | "item" | "world-rule";
  displayName: string;
}
