import type { PublishArtifactSpec } from "@sugarmagic/domain";

export interface PublishRequest {
  rootPath: string;
  targetKind: PublishArtifactSpec["targetKind"];
}

export interface PublishResult {
  manifestPath: string;
}
