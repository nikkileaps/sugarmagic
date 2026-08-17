/**
 * packages/testing/src/plugin-before-first-frame.test.ts
 *
 * Purpose: Verifies the boot step that lets plugins get ready before the first
 *   frame -- who it calls, in what order, and what a failure costs.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises createRuntimePluginManager's beforeFirstFrame dispatch.
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import {
  createRuntimeBootModel,
  createRuntimePluginManager,
  type RuntimePluginInstance
} from "@sugarmagic/runtime-core";

function makeBoot() {
  return createRuntimeBootModel({
    hostKind: "published-web",
    compileProfile: "runtime-preview",
    contentSource: "published-artifact"
  });
}

function makePlugin(
  pluginId: string,
  beforeFirstFrame?: RuntimePluginInstance["beforeFirstFrame"]
): RuntimePluginInstance {
  return {
    pluginId,
    displayName: pluginId,
    contributions: [],
    ...(beforeFirstFrame ? { beforeFirstFrame } : {})
  };
}

describe("beforeFirstFrame", () => {
  it("THE ARCHITECTURAL GUARD: core calls whoever declared it, and knows none of them", async () => {
    // The property that matters: the manager dispatches to plugins it was
    // handed, by contract, with no knowledge of which plugins exist. These
    // plugin ids are invented by the test -- if core had to recognise a
    // specific plugin for this hook to fire, this could not pass.
    const order: string[] = [];
    const manager = createRuntimePluginManager({
      boot: makeBoot(),
      plugins: [
        makePlugin("first-invented-plugin", async () => {
          order.push("first-invented-plugin");
        }),
        // Declares no hook at all. Most plugins will not.
        makePlugin("declares-nothing"),
        makePlugin("second-invented-plugin", async () => {
          order.push("second-invented-plugin");
        })
      ]
    });

    await manager.beforeFirstFrame();

    expect(order).toEqual(["first-invented-plugin", "second-invented-plugin"]);
  });

  it("waits for each plugin, so the boot can wait for the whole step", async () => {
    // The point of the step is that the player does not get control until the
    // work is done. Dispatching without awaiting would make it a timer again.
    let finished = false;
    const manager = createRuntimePluginManager({
      boot: makeBoot(),
      plugins: [
        makePlugin("slow", async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          finished = true;
        })
      ]
    });

    await manager.beforeFirstFrame();

    expect(finished).toBe(true);
  });

  it("a plugin that throws is logged and skipped; the rest still get ready", async () => {
    // Being unprepared is a worse first few seconds. No plugin gets to take
    // the boot down with it.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const readied: string[] = [];
    const manager = createRuntimePluginManager({
      boot: makeBoot(),
      plugins: [
        makePlugin("throws", async () => {
          throw new Error("gateway down");
        }),
        makePlugin("after-the-thrower", async () => {
          readied.push("after-the-thrower");
        })
      ]
    });

    await expect(manager.beforeFirstFrame()).resolves.toBeUndefined();

    expect(readied).toEqual(["after-the-thrower"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
