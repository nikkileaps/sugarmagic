import { describe, expect, it } from "vitest";
import {
  BillboardComponent,
  BillboardSystem,
  Position,
  World,
  resolveBillboardLodState,
  type CameraSnapshot
} from "@sugarmagic/runtime-core";

function createCameraSnapshot(): CameraSnapshot {
  return {
    position: { x: 0, y: 0, z: 0 },
    forward: { x: 0, y: 0, z: -1 },
    frustumPlanes: [
      { nx: 1, ny: 0, nz: 0, d: 10 },
      { nx: -1, ny: 0, nz: 0, d: 10 },
      { nx: 0, ny: 1, nz: 0, d: 10 },
      { nx: 0, ny: -1, nz: 0, d: 10 },
      { nx: 0, ny: 0, nz: 1, d: 10 },
      { nx: 0, ny: 0, nz: -1, d: 20 }
    ],
    viewport: { width: 1280, height: 720 },
    fov: Math.PI / 3
  };
}

describe("billboard runtime", () => {
  it("resolves LOD states from distance thresholds", () => {
    expect(resolveBillboardLodState(2, { billboard: 5, cull: 20 })).toBe("full-mesh");
    expect(resolveBillboardLodState(10, { billboard: 5, cull: 20 })).toBe("billboard");
    expect(resolveBillboardLodState(25, { billboard: 5, cull: 20 })).toBe("culled");
    expect(resolveBillboardLodState(10)).toBe("billboard");
  });

  it("updates billboard LOD and frustum visibility from the camera snapshot", () => {
    const world = new World();
    const system = new BillboardSystem();
    const entity = world.createEntity();
    world.addComponent(entity, new Position(0, 0, -8));
    world.addComponent(
      entity,
      new BillboardComponent(
        { kind: "text", content: "hello" },
        {
          size: { width: 2, height: 1 },
          lodThresholds: { billboard: 5, cull: 15 }
        }
      )
    );

    system.update(world, 1 / 60, createCameraSnapshot());

    const billboard = world.getComponent(entity, BillboardComponent)!;
    expect(billboard.lodState).toBe("billboard");
    expect(billboard.visible).toBe(true);
  });

  it("marks billboards invisible when the sphere falls outside the frustum", () => {
    const world = new World();
    const system = new BillboardSystem();
    const entity = world.createEntity();
    world.addComponent(entity, new Position(30, 0, -8));
    world.addComponent(
      entity,
      new BillboardComponent(
        { kind: "text", content: "offscreen" },
        { size: { width: 1, height: 1 } }
      )
    );

    system.update(world, 1 / 60, createCameraSnapshot());

    const billboard = world.getComponent(entity, BillboardComponent)!;
    expect(billboard.lodState).toBe("billboard");
    expect(billboard.visible).toBe(false);
  });

  it("falls back to hidden billboards when no camera snapshot is available", () => {
    const world = new World();
    const system = new BillboardSystem();
    const entity = world.createEntity();
    world.addComponent(entity, new Position(0, 0, -4));
    world.addComponent(entity, new BillboardComponent({ kind: "text", content: "hidden" }));

    system.update(world, 1 / 60);

    const billboard = world.getComponent(entity, BillboardComponent)!;
    expect(billboard.visible).toBe(false);
  });
});
