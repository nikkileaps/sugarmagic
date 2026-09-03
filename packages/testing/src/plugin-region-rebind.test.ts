/**
 * Plugins hear about a region change (epic #226 story 13).
 *
 * `init` is guarded against running twice, deliberately -- it does
 * one-time setup. That guard is also why a plugin which snapshotted the
 * region at boot had no way to learn the player had walked out of it:
 * sugarlang binds `activeRegion` in `bindRuntime` and its warmer reads it,
 * so after a transition it kept preparing conversations for NPCs the
 * player had left behind.
 *
 * `onRegionChanged` is that missing half.
 */

import { describe, expect, it } from "vitest";
import {
  createRuntimePluginManager,
  type RuntimePluginInstance
} from "@sugarmagic/runtime-core";

const BOOT = { hostKind: "web" } as never;

/** A plugin that only records which lifecycle calls it received. */
function recordingPlugin(pluginId: string, log: string[]): RuntimePluginInstance {
  return {
    pluginId,
    displayName: pluginId,
    contributions: [],
    init: () => {
      log.push(`${pluginId}:init`);
    },
    onRegionChanged: () => {
      log.push(`${pluginId}:rebind`);
    }
  };
}

describe("telling plugins the region changed", () => {
  it("reaches every plugin that asked to hear", async () => {
    const log: string[] = [];
    const manager = createRuntimePluginManager({
      boot: BOOT,
      plugins: [recordingPlugin("a", log), recordingPlugin("b", log)]
    });

    await manager.init({} as never);
    await manager.notifyRegionChanged({} as never);

    expect(log).toEqual(["a:init", "b:init", "a:rebind", "b:rebind"]);
  });

  it("can be called repeatedly, unlike init", async () => {
    // The point of the split: init is once per page, this is once per
    // region change, and there can be many.
    const log: string[] = [];
    const manager = createRuntimePluginManager({
      boot: BOOT,
      plugins: [recordingPlugin("a", log)]
    });

    await manager.init({} as never);
    await manager.init({} as never);
    await manager.notifyRegionChanged({} as never);
    await manager.notifyRegionChanged({} as never);

    expect(log).toEqual(["a:init", "a:rebind", "a:rebind"]);
  });

  it("one plugin failing does not stop the rest rebinding", async () => {
    // Same trade as `beforeFirstFrame`: a plugin that throws costs its own
    // freshness. Letting it strand the others would mean one bad plugin
    // leaves the whole game reading the region the player left.
    const log: string[] = [];
    const manager = createRuntimePluginManager({
      boot: BOOT,
      plugins: [
        {
          pluginId: "thrower",
          displayName: "thrower",
          contributions: [],
          onRegionChanged: () => {
            throw new Error("nope");
          }
        },
        recordingPlugin("b", log)
      ]
    });

    await manager.notifyRegionChanged({} as never);

    expect(log).toEqual(["b:rebind"]);
  });

  it("ignores a plugin that does not care", async () => {
    const manager = createRuntimePluginManager({
      boot: BOOT,
      plugins: [
        { pluginId: "quiet", displayName: "quiet", contributions: [] }
      ]
    });

    await expect(manager.notifyRegionChanged({} as never)).resolves.toBeUndefined();
  });
});
