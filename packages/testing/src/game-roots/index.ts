import type { GameRootDescriptor } from "@sugarmagic/io";

export function createGameRootFixture(rootPath: string): GameRootDescriptor {
  return {
    rootPath,
    projectFileName: "project.sgrmagic",
    authoredAssetsPath: "assets",
    exportsPath: "exports",
    publishPath: "publish"
  };
}
