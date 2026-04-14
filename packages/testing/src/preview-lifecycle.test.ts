import { describe, expect, it } from "vitest";
import {
  World,
  Position,
  Velocity,
  PlayerControlled,
  MovementSystem
} from "@sugarmagic/runtime-core";
import { createPreviewStore } from "@sugarmagic/shell";

describe("ECS gameplay kernel", () => {
  it("moves player forward (W) relative to camera yaw", () => {
    const world = new World();
    const player = world.createEntity();
    world.addComponent(player, new Position(0, 0, 0));
    world.addComponent(player, new Velocity());
    world.addComponent(player, new PlayerControlled(5));

    const movementSystem = new MovementSystem();
    // W key = moveY: -1 (Sugarengine convention)
    // Camera yaw = 0: rig at +Z, looking toward -Z
    // moveY=-1 with yaw=0 → vel.z = -(-1)*sin(0) + (-1)*cos(0) = -1 → moves -Z (forward)
    movementSystem.setInputProvider(() => ({ moveX: 0, moveY: -1 }));
    movementSystem.setCameraYawProvider(() => 0);
    world.addSystem(movementSystem);

    world.update(1 / 60);

    const pos = world.getComponent(player, Position)!;
    expect(pos.z).toBeLessThan(0);
    expect(Math.abs(pos.x)).toBeLessThan(0.001);
  });

  it("applies camera-relative movement", () => {
    const world = new World();
    const player = world.createEntity();
    world.addComponent(player, new Position(0, 0, 0));
    world.addComponent(player, new Velocity());
    world.addComponent(player, new PlayerControlled(10));

    const movementSystem = new MovementSystem();
    // W key = moveY: -1, camera yaw = PI/2
    movementSystem.setInputProvider(() => ({ moveX: 0, moveY: -1 }));
    movementSystem.setCameraYawProvider(() => Math.PI / 2);
    world.addSystem(movementSystem);

    world.update(1);

    const pos = world.getComponent(player, Position)!;
    expect(Math.abs(pos.x)).toBeGreaterThan(0.1);
  });

  it("queries entities by component", () => {
    const world = new World();
    const e1 = world.createEntity();
    const e2 = world.createEntity();
    world.addComponent(e1, new Position());
    world.addComponent(e1, new PlayerControlled());
    world.addComponent(e2, new Position());

    const players = world.query(Position, PlayerControlled);
    expect(players).toHaveLength(1);
    expect(players[0]).toBe(e1);
  });
});

describe("preview lifecycle state", () => {
  it("starts and stops preview with snapshot restore", () => {
    const store = createPreviewStore();
    const snapshot = {
      activeProductMode: "build" as const,
      activeBuildWorkspaceKind: "layout" as const,
      activeDesignWorkspaceKind: "player" as const,
      activeRenderWorkspaceKind: "shaders" as const,
      activeRegionId: "region-1",
      activeEnvironmentId: "env-default",
      activeWorkspaceId: "build:layout:region-1",
      selectedEntityIds: ["obj-1"]
    };

    // Simulate starting preview
    const mockState = { closed: false };
    const mockWindow = { get closed() { return mockState.closed; }, close: () => { mockState.closed = true; } } as unknown as Window;
    store.getState().startPreview(snapshot, mockWindow);
    expect(store.getState().isPreviewRunning).toBe(true);
    expect(store.getState().authoringSnapshot).toEqual(snapshot);

    // Simulate stopping preview
    const restored = store.getState().stopPreview();
    expect(store.getState().isPreviewRunning).toBe(false);
    expect(restored).toEqual(snapshot);
  });

  it("returns null if stopped without starting", () => {
    const store = createPreviewStore();
    const restored = store.getState().stopPreview();
    expect(restored).toBeNull();
  });
});
