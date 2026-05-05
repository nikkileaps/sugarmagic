/**
 * Mechanics emit handler plugin seam tests.
 *
 * Guards the new plugin contribution kind without coupling tests to a DOM
 * mini-game implementation.
 */

import { describe, expect, it, vi } from "vitest";
import { createPluginConfigurationRecord } from "@sugarmagic/domain";
import {
  createRuntimeBootModel,
  createRuntimePluginManager,
  type MechanicsEmitDispatch,
  type RuntimePluginInstance
} from "@sugarmagic/runtime-core";

describe("mechanics emit handler plugin seam", () => {
  it("registers and dispatches matching mechanics emits", () => {
    const handle = vi.fn<(dispatch: MechanicsEmitDispatch) => void>();
    const plugin: RuntimePluginInstance = {
      pluginId: "test-plugin",
      displayName: "Test Plugin",
      config: { enabled: true },
      contributions: [
        {
          pluginId: "test-plugin",
          contributionId: "test.emit-handler",
          kind: "mechanics.emitHandler",
          displayName: "Test Emit Handler",
          priority: 0,
          payload: {
            emitKinds: ["focus.opened"],
            setup: () => ({ handle })
          }
        }
      ]
    };
    const manager = createRuntimePluginManager({
      boot: createRuntimeBootModel({
        hostKind: "published-web",
        compileProfile: "runtime-preview",
        contentSource: "published-artifact"
      }),
      plugins: [plugin]
    });
    const contribution = manager.getContributions("mechanics.emitHandler")[0]!;
    const setup = contribution.payload.setup({
      mountRoot: {} as HTMLElement,
      config: plugin.config ?? {},
      dispatchCastable: () => ({
        status: "success",
        castable: null
      }),
      claimInput: () => {},
      releaseInput: () => {}
    });

    setup.handle({
      emitKind: "focus.opened",
      payload: { source: "test" },
      caster: {} as MechanicsEmitDispatch["caster"],
      target: null
    });

    expect(contribution.payload.emitKinds).toEqual(["focus.opened"]);
    expect(handle).toHaveBeenCalledWith({
      emitKind: "focus.opened",
      payload: { source: "test" },
      caster: expect.anything(),
      target: null
    });
  });

  it("preserves plugin configuration records for setup context", () => {
    const config = createPluginConfigurationRecord("test-plugin", true, {
      triggers: [{ emitKind: "focus.opened" }]
    });
    const plugin: RuntimePluginInstance = {
      pluginId: config.pluginId,
      displayName: "Test Plugin",
      config: config.config,
      contributions: []
    };

    expect(plugin.config).toEqual({
      triggers: [{ emitKind: "focus.opened" }]
    });
  });
});
