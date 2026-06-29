/**
 * Story 50.2 — RuntimeActionRegistry tests.
 *
 * Two layers:
 *   - Pure `planKeydownDispatch` function — exhaustive matrix
 *     of mode / key / focus permutations.
 *   - The registry itself, with a mock target capturing the
 *     installed listener so we can synthesise keydowns and
 *     assert handlers fire (without needing a DOM).
 */

import { describe, expect, it, vi } from "vitest";
import {
  createGameStateStore,
  createRuntimeActionRegistry,
  createUIStateStore,
  planKeydownDispatch,
  type RegisteredAction,
  type RuntimeActionRegistryTarget
} from "@sugarmagic/runtime-core";

function makeAction(
  patch: Partial<RegisteredAction> = {}
): RegisteredAction {
  return {
    actionId: patch.actionId ?? "test-action",
    modes: patch.modes ?? ["in-game"],
    key: patch.key ?? "i",
    handler: patch.handler ?? (() => {})
  };
}

describe("planKeydownDispatch", () => {
  it("returns empty when isInputFocused is true regardless of any match", () => {
    const action = makeAction({ modes: ["in-game"], key: "i" });
    expect(
      planKeydownDispatch({
        actions: [action],
        mode: "in-game",
        eventKey: "i",
        isInputFocused: true
      })
    ).toEqual([]);
  });

  it("returns the matching action when mode + key both match", () => {
    const action = makeAction({ modes: ["in-game"], key: "i" });
    expect(
      planKeydownDispatch({
        actions: [action],
        mode: "in-game",
        eventKey: "i",
        isInputFocused: false
      })
    ).toEqual([action]);
  });

  it("matches keys case-insensitively (Shift+I still fires i)", () => {
    const action = makeAction({ modes: ["in-game"], key: "i" });
    expect(
      planKeydownDispatch({
        actions: [action],
        mode: "in-game",
        eventKey: "I",
        isInputFocused: false
      })
    ).toEqual([action]);
  });

  it("returns empty when the mode does not match", () => {
    const action = makeAction({ modes: ["in-game"], key: "i" });
    expect(
      planKeydownDispatch({
        actions: [action],
        mode: "paused",
        eventKey: "i",
        isInputFocused: false
      })
    ).toEqual([]);
  });

  it('"any" modes match every mode', () => {
    const action = makeAction({ modes: ["any"], key: "`" });
    for (const mode of [
      "in-game",
      "paused",
      "start-menu",
      "dialogue",
      "login-modal"
    ] as const) {
      expect(
        planKeydownDispatch({
          actions: [action],
          mode,
          eventKey: "`",
          isInputFocused: false
        })
      ).toEqual([action]);
    }
  });

  it("filters to actions whose key matches; multiple matches all fire", () => {
    const a = makeAction({ actionId: "a", modes: ["in-game"], key: "i" });
    const b = makeAction({ actionId: "b", modes: ["in-game"], key: "i" });
    const c = makeAction({ actionId: "c", modes: ["in-game"], key: "j" });
    const matches = planKeydownDispatch({
      actions: [a, b, c],
      mode: "in-game",
      eventKey: "i",
      isInputFocused: false
    });
    expect(matches).toEqual([a, b]);
  });
});

describe("createRuntimeActionRegistry", () => {
  function makeTarget(): RuntimeActionRegistryTarget & {
    listeners: Array<(event: KeyboardEvent) => void>;
    fire(event: Partial<KeyboardEvent>): void;
  } {
    // Capture the listener the registry installs so the test
    // can fire synthetic events without depending on a real
    // EventTarget implementation.
    const listeners: Array<(event: KeyboardEvent) => void> = [];
    return {
      listeners,
      addEventListener(type, listener) {
        if (type === "keydown") listeners.push(listener);
      },
      removeEventListener(type, listener) {
        if (type === "keydown") {
          const idx = listeners.indexOf(listener);
          if (idx !== -1) listeners.splice(idx, 1);
        }
      },
      fire(event) {
        const synthetic = {
          key: event.key ?? "",
          target: event.target ?? null,
          preventDefault: () => {}
        } as unknown as KeyboardEvent;
        for (const listener of listeners) listener(synthetic);
      }
    };
  }

  it("installs the listener on first registration and removes it on last unregister", () => {
    const target = makeTarget();
    const registry = createRuntimeActionRegistry({
      stateStore: createUIStateStore(),
      target,
      isInputContext: () => false
    });
    expect(target.listeners.length).toBe(0);
    const unregister = registry.register({
      actionId: "inv",
      modes: ["in-game"],
      key: "i",
      handler: () => {}
    });
    expect(target.listeners.length).toBe(1);
    unregister();
    expect(target.listeners.length).toBe(0);
  });

  it("dispatches matching actions on keydown", () => {
    const target = makeTarget();
    const stateStore = createUIStateStore();
    const handler = vi.fn();
    const registry = createRuntimeActionRegistry({
      stateStore,
      target,
      isInputContext: () => false
    });
    registry.register({
      actionId: "inv",
      modes: ["in-game"],
      key: "i",
      handler
    });
    target.fire({ key: "i" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("skips dispatch when the current mode does not match", () => {
    const target = makeTarget();
    const stateStore = createUIStateStore();
    const gameStateStore = createGameStateStore({ lifecycle: "paused" });
    const handler = vi.fn();
    const registry = createRuntimeActionRegistry({
      stateStore,
      gameStateStore,
      target,
      isInputContext: () => false
    });
    registry.register({
      actionId: "inv",
      modes: ["in-game"],
      key: "i",
      handler
    });
    target.fire({ key: "i" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("skips dispatch when isInputContext returns true", () => {
    const target = makeTarget();
    const stateStore = createUIStateStore();
    const handler = vi.fn();
    const registry = createRuntimeActionRegistry({
      stateStore,
      target,
      isInputContext: () => true
    });
    registry.register({
      actionId: "inv",
      modes: ["in-game"],
      key: "i",
      handler
    });
    target.fire({ key: "i" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("reacts live to GameStateStore lifecycle changes between keydowns", () => {
    const target = makeTarget();
    const stateStore = createUIStateStore();
    const gameStateStore = createGameStateStore({ lifecycle: "playing" });
    const handler = vi.fn();
    const registry = createRuntimeActionRegistry({
      stateStore,
      gameStateStore,
      target,
      isInputContext: () => false
    });
    registry.register({
      actionId: "inv",
      modes: ["in-game"],
      key: "i",
      handler
    });
    target.fire({ key: "i" });
    expect(handler).toHaveBeenCalledTimes(1);
    gameStateStore.setState({ lifecycle: "paused" });
    target.fire({ key: "i" });
    expect(handler).toHaveBeenCalledTimes(1); // didn't fire again
    gameStateStore.setState({ lifecycle: "playing" });
    target.fire({ key: "i" });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('"any" mode actions fire regardless of current mode', () => {
    const target = makeTarget();
    const stateStore = createUIStateStore({
      activeOverlayMenuKey: "start-menu",
      isPaused: true
    });
    const handler = vi.fn();
    const registry = createRuntimeActionRegistry({
      stateStore,
      target,
      isInputContext: () => false
    });
    registry.register({
      actionId: "debug",
      modes: ["any"],
      key: "`",
      handler
    });
    target.fire({ key: "`" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("refuses to double-register the same actionId", () => {
    const target = makeTarget();
    const registry = createRuntimeActionRegistry({
      stateStore: createUIStateStore(),
      target,
      isInputContext: () => false
    });
    registry.register({
      actionId: "inv",
      modes: ["in-game"],
      key: "i",
      handler: () => {}
    });
    expect(() =>
      registry.register({
        actionId: "inv",
        modes: ["in-game"],
        key: "i",
        handler: () => {}
      })
    ).toThrow(/already registered/);
  });

  it("re-registration after unregister is allowed", () => {
    const target = makeTarget();
    const registry = createRuntimeActionRegistry({
      stateStore: createUIStateStore(),
      target,
      isInputContext: () => false
    });
    const unregister = registry.register({
      actionId: "inv",
      modes: ["in-game"],
      key: "i",
      handler: () => {}
    });
    unregister();
    expect(() =>
      registry.register({
        actionId: "inv",
        modes: ["in-game"],
        key: "i",
        handler: () => {}
      })
    ).not.toThrow();
  });

  it("dispose() removes the listener and clears all registrations", () => {
    const target = makeTarget();
    const registry = createRuntimeActionRegistry({
      stateStore: createUIStateStore(),
      target,
      isInputContext: () => false
    });
    registry.register({
      actionId: "a",
      modes: ["in-game"],
      key: "i",
      handler: () => {}
    });
    registry.register({
      actionId: "b",
      modes: ["in-game"],
      key: "j",
      handler: () => {}
    });
    expect(registry.getRegisteredActions().length).toBe(2);
    registry.dispose();
    expect(registry.getRegisteredActions().length).toBe(0);
    expect(target.listeners.length).toBe(0);
  });
});
