import type { DocumentIdentity } from "../shared/identity";

export interface PublishArtifactSpec {
  identity: DocumentIdentity;
  targetKind: "published-web" | "compatibility-export";
  sourceDocumentIds: string[];
}
