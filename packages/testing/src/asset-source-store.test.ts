import { beforeEach, describe, expect, it, vi } from "vitest";

const { readBlobFileMock } = vi.hoisted(() => ({
  readBlobFileMock: vi.fn()
}));

vi.mock("@sugarmagic/io", () => ({
  readBlobFile: readBlobFileMock
}));

import { createAssetSourceStore, createProjectStore } from "@sugarmagic/shell";

function createSessionWithSources(options: {
  assetPaths?: string[];
  texturePaths?: string[];
  maskPaths?: string[];
}) {
  const {
    assetPaths = [],
    texturePaths = [],
    maskPaths = []
  } = options;
  return {
    contentLibrary: {
      assetDefinitions: assetPaths.map((relativeAssetPath) => ({
        source: {
          relativeAssetPath
        }
      })),
      textureDefinitions: texturePaths.map((relativeAssetPath) => ({
        source: {
          relativeAssetPath
        }
      })),
      maskTextureDefinitions: maskPaths.map((relativeAssetPath) => ({
        source: {
          relativeAssetPath
        }
      }))
    }
  } as never;
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("asset source store", () => {
  beforeEach(() => {
    readBlobFileMock.mockReset();
    vi.restoreAllMocks();
    vi.spyOn(URL, "createObjectURL").mockImplementation(
      ((value: { mockUrl?: string }) => value.mockUrl ?? "blob:missing") as typeof URL.createObjectURL
    );
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    readBlobFileMock.mockImplementation(
      async (handle: { name?: string }, ...pathSegments: string[]) => ({
        mockUrl: `blob:${handle.name ?? "unknown"}:${pathSegments.join("/")}`
      })
    );
  });

  it("invalidates previous path state when switching projects with overlapping relative asset paths", async () => {
    const assetSourceStore = createAssetSourceStore();
    const projectStore = createProjectStore();
    const firstHandle = { name: "project-one" } as FileSystemDirectoryHandle;
    const secondHandle = { name: "project-two" } as FileSystemDirectoryHandle;
    const descriptor = { gameRootPath: "." } as never;

    projectStore.getState().setActive(
      firstHandle,
      descriptor,
      createSessionWithSources({
        assetPaths: ["assets/player.glb"]
      })
    );
    assetSourceStore.getState().start(firstHandle, projectStore);
    await flushAsyncWork();

    expect(assetSourceStore.getState().sources["assets/player.glb"]).toBe(
      "blob:project-one:assets/player.glb"
    );

    projectStore.getState().setActive(
      secondHandle,
      descriptor,
      createSessionWithSources({
        assetPaths: ["assets/player.glb"]
      })
    );
    assetSourceStore.getState().start(secondHandle, projectStore);
    await flushAsyncWork();

    expect(assetSourceStore.getState().sources["assets/player.glb"]).toBe(
      "blob:project-two:assets/player.glb"
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(
      "blob:project-one:assets/player.glb"
    );
  });

  it("serves mask texture definitions and refreshes blob urls for same-path rewrites", async () => {
    const assetSourceStore = createAssetSourceStore();
    const projectStore = createProjectStore();
    const handle = { name: "paint-project" } as FileSystemDirectoryHandle;
    const descriptor = { gameRootPath: "." } as never;
    const pathVersions = new Map<string, string>([
      ["masks/flower-mask.png", "v1"]
    ]);

    readBlobFileMock.mockImplementation(
      async (currentHandle: { name?: string }, ...pathSegments: string[]) => ({
        mockUrl: `blob:${currentHandle.name ?? "unknown"}:${pathSegments.join("/")}:${pathVersions.get(pathSegments.join("/")) ?? "missing"}`
      })
    );

    projectStore.getState().setActive(
      handle,
      descriptor,
      createSessionWithSources({
        maskPaths: ["masks/flower-mask.png"]
      })
    );
    assetSourceStore.getState().start(handle, projectStore);
    await flushAsyncWork();

    expect(assetSourceStore.getState().sources["masks/flower-mask.png"]).toBe(
      "blob:paint-project:masks/flower-mask.png:v1"
    );

    pathVersions.set("masks/flower-mask.png", "v2");
    await assetSourceStore.getState().refreshPaths(["masks/flower-mask.png"]);

    expect(assetSourceStore.getState().sources["masks/flower-mask.png"]).toBe(
      "blob:paint-project:masks/flower-mask.png:v2"
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(
      "blob:paint-project:masks/flower-mask.png:v1"
    );
  });
});
