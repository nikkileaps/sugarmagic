import type { PublishRequest } from "@sugarmagic/io";

export function createPublishHarness(request: PublishRequest) {
  return {
    request,
    manifestPath: `${request.rootPath}/publish/manifest.json`
  };
}
