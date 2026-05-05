/**
 * Fireflies plugin tests.
 *
 * Tests the config-driven mechanics seam with an injected puzzle runner so
 * the runtime contract is verified without requiring a browser canvas.
 */

import { describe, expect, it, vi } from "vitest";
import type { CastableInvocation } from "@sugarmagic/domain";
import { createFirefliesRuntimePlugin } from "@sugarmagic/plugins";
import type {
  MechanicsEmitDispatch,
  MechanicsEmitHandlerContribution
} from "@sugarmagic/runtime-core";

describe("Fireflies plugin", () => {
  it("dispatches the configured success castable when the puzzle succeeds", () => {
    const completion = {
      current: null as ((result: "success" | "fail") => void) | null
    };
    const dispatchCastable = vi.fn<(invocation: CastableInvocation) => void>();
    const plugin = createFirefliesRuntimePlugin({
      pluginId: "fireflies",
      displayName: "Fireflies",
      config: {
        triggers: [
          {
            emitKind: "focus.open",
            difficulty: "easy",
            onSuccess: { id: "gain-focus", args: { amount: 25 } }
          }
        ]
      },
      runPuzzle: (options) => {
        completion.current = options.onComplete;
        return { dispose: vi.fn() };
      }
    });
    const contribution = plugin
      .contributions[0] as MechanicsEmitHandlerContribution;
    const setup = contribution.payload.setup({
      mountRoot: {} as HTMLElement,
      config: plugin.config ?? {},
      dispatchCastable: (invocation) => {
        dispatchCastable(invocation);
        return { status: "success", castable: null };
      },
      claimInput: vi.fn(),
      releaseInput: vi.fn()
    });

    setup.handle({
      emitKind: "focus.open",
      payload: undefined,
      caster: {} as MechanicsEmitDispatch["caster"],
      target: null
    });
    completion.current?.("success");

    expect(contribution.payload.emitKinds).toEqual(["focus.open"]);
    expect(dispatchCastable).toHaveBeenCalledWith({
      id: "gain-focus",
      args: { amount: 25 }
    });
  });

  it("dispatches the configured fail castable when the puzzle fails", () => {
    const completion = {
      current: null as ((result: "success" | "fail") => void) | null
    };
    const dispatchCastable = vi.fn<(invocation: CastableInvocation) => void>();
    const plugin = createFirefliesRuntimePlugin({
      pluginId: "fireflies",
      displayName: "Fireflies",
      config: {
        triggers: [
          {
            emitKind: "focus.open",
            onFail: { id: "lose-focus", args: { amount: 3 } }
          }
        ]
      },
      runPuzzle: (options) => {
        completion.current = options.onComplete;
        return { dispose: vi.fn() };
      }
    });
    const contribution = plugin
      .contributions[0] as MechanicsEmitHandlerContribution;
    const setup = contribution.payload.setup({
      mountRoot: {} as HTMLElement,
      config: plugin.config ?? {},
      dispatchCastable: (invocation) => {
        dispatchCastable(invocation);
        return { status: "success", castable: null };
      },
      claimInput: vi.fn(),
      releaseInput: vi.fn()
    });

    setup.handle({
      emitKind: "focus.open",
      payload: undefined,
      caster: {} as MechanicsEmitDispatch["caster"],
      target: null
    });
    completion.current?.("fail");

    expect(dispatchCastable).toHaveBeenCalledWith({
      id: "lose-focus",
      args: { amount: 3 }
    });
  });

  it("throws loudly on invalid config", () => {
    const plugin = createFirefliesRuntimePlugin({
      pluginId: "fireflies",
      displayName: "Fireflies",
      config: { triggers: [{ difficulty: "medium" }] },
      runPuzzle: () => ({ dispose: vi.fn() })
    });
    const contribution = plugin
      .contributions[0] as MechanicsEmitHandlerContribution;

    expect(() =>
      contribution.payload.setup({
        mountRoot: {} as HTMLElement,
        config: plugin.config ?? {},
        dispatchCastable: () => ({ status: "success", castable: null }),
        claimInput: vi.fn(),
        releaseInput: vi.fn()
      })
    ).toThrow("Invalid plugin config");
  });
});
