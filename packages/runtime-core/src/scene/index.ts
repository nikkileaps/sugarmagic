import type { RegionDocument } from "@sugarmagic/domain";

export interface RuntimeSceneLoadRequest {
  region: RegionDocument;
  compileProfile: "authoring-preview" | "runtime-preview" | "published-target";
}

export interface RuntimeSceneDescriptor {
  sceneId: string;
  regionId: string;
}
