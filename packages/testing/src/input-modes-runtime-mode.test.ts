/**
 * Story 50.1 — resolveRuntimeMode pure function tests.
 *
 * Guards the priority cascade: login-modal overrides everything;
 * mode-defining menu keys (start-menu, pause-menu, dialogue)
 * win over generic isPaused; non-mode-defining menu keys
 * (inventory, etc.) fall through to in-game.
 */

import { describe, expect, it } from "vitest";
import {
  resolveRuntimeMode,
  type RuntimeUIState
} from "@sugarmagic/runtime-core";

function makeState(patch: Partial<RuntimeUIState> = {}): RuntimeUIState {
  return {
    activeOverlayMenuKey: null,
    isPaused: false,
    savePresent: false,
    loginModalOpen: false,
    ...patch
  };
}

describe("resolveRuntimeMode", () => {
  it("returns in-game on a fresh runtime state", () => {
    expect(resolveRuntimeMode(makeState())).toBe("in-game");
  });

  it("returns login-modal when the modal flag is set, overriding every other field", () => {
    expect(
      resolveRuntimeMode(
        makeState({
          loginModalOpen: true,
          isPaused: true,
          activeOverlayMenuKey: "start-menu"
        })
      )
    ).toBe("login-modal");
  });

  it("returns start-menu when activeOverlayMenuKey is the start menu", () => {
    expect(
      resolveRuntimeMode(
        makeState({ activeOverlayMenuKey: "start-menu", isPaused: true })
      )
    ).toBe("start-menu");
  });

  it("returns paused when the pause menu is up", () => {
    expect(
      resolveRuntimeMode(
        makeState({ activeOverlayMenuKey: "pause-menu", isPaused: true })
      )
    ).toBe("paused");
  });

  it("returns dialogue when activeOverlayMenuKey is dialogue (50.5 wires this end-to-end)", () => {
    expect(
      resolveRuntimeMode(
        makeState({ activeOverlayMenuKey: "dialogue", isPaused: true })
      )
    ).toBe("dialogue");
  });

  it("returns paused when isPaused is set but no menu key is mode-defining", () => {
    expect(
      resolveRuntimeMode(makeState({ isPaused: true }))
    ).toBe("paused");
  });

  it("falls through to in-game when a non-mode-defining menu (e.g. inventory) is visible", () => {
    // Inventory is an overlay opened during gameplay; the mode
    // stays in-game so other in-game shortcuts continue to work.
    // Critical contract: when 50.3 migrates the inventory
    // handler to register `modes: ["in-game"]`, pressing `i`
    // again to close still fires.
    expect(
      resolveRuntimeMode(makeState({ activeOverlayMenuKey: "inventory" }))
    ).toBe("in-game");
  });

  it("login-modal beats start-menu beats dialogue beats paused beats in-game", () => {
    // Sanity: explicit priority cascade exercised as a single
    // matrix so adding a new mode-defining key in the future
    // also lands a deliberate spot in the priority order.
    const cascade: Array<{
      patch: Partial<RuntimeUIState>;
      expected: ReturnType<typeof resolveRuntimeMode>;
    }> = [
      {
        patch: {
          loginModalOpen: true,
          activeOverlayMenuKey: "start-menu",
          isPaused: true
        },
        expected: "login-modal"
      },
      {
        patch: { activeOverlayMenuKey: "start-menu", isPaused: true },
        expected: "start-menu"
      },
      {
        patch: { activeOverlayMenuKey: "dialogue", isPaused: true },
        expected: "dialogue"
      },
      {
        patch: { activeOverlayMenuKey: "pause-menu", isPaused: true },
        expected: "paused"
      },
      { patch: { isPaused: true }, expected: "paused" },
      { patch: {}, expected: "in-game" }
    ];
    for (const { patch, expected } of cascade) {
      expect(resolveRuntimeMode(makeState(patch))).toBe(expected);
    }
  });
});
