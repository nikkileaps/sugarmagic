import { beforeEach, describe, expect, it, vi } from "vitest";

const { readBlobFileMock } = vi.hoisted(() => ({
  readBlobFileMock: vi.fn()
}));

vi.mock("@sugarmagic/io", () => ({
  readBlobFile: readBlobFileMock
}));

import { createAssetSourceStore, createProjectStore } from "@sugarmagic/shell";

function createSessionWithAssetPath(relativeAssetPath: string) {
  return {
    contentLibrary: {
      assetDefinitions: [
        {
          source: {
            relativeAssetPath
          }
        }
      ],
      textureDefinitions: []
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
      createSessionWithAssetPath("assets/player.glb")
    );
    assetSourceStore.getState().start(firstHandle, projectStore);
    await flushAsyncWork();

    expect(assetSourceStore.getState().sources["assets/player.glb"]).toBe(
      "blob:project-one:assets/player.glb"
    );

    projectStore.getState().setActive(
      secondHandle,
      descriptor,
      createSessionWithAssetPath("assets/player.glb")
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
});
