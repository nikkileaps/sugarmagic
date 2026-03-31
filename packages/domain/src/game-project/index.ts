import type { DocumentIdentity, RegionReference } from "../shared/identity";

export interface GameProject {
  identity: DocumentIdentity;
  displayName: string;
  gameRootPath: string;
  regionRegistry: RegionReference[];
  pluginConfigIds: string[];
}
