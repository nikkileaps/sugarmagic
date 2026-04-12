/**
 * packages/runtime-core/src/plugins/index.test.ts
 *
 * Purpose: Verifies runtime plugin contribution filtering and sorting for debug HUD contributions.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { createRuntimeBootModel } from "../index";
import {
  createRuntimePluginManager,
  type DebugEntityBillboardContribution,
  type DebugHudCardContribution,
  type RuntimePluginInstance
} from "./index";

describe("runtime plugin manager debug contributions", () => {
  it("returns debug HUD contributions sorted by priority and filtered by host", () => {
    const boot = createRuntimeBootModel({
      hostKind: "studio",
      compileProfile: "authoring-preview",
      contentSource: "authored-game-root"
    });

    const hudCard: DebugHudCardContribution = {
      pluginId: "test.plugin",
      contributionId: "debug-card",
      kind: "debug.hudCard",
      displayName: "Test HUD Card",
      priority: 20,
      hostKinds: ["studio"],
      payload: {
        cardId: "test-card",
        renderCard() {}
      }
    };
    const billboard: DebugEntityBillboardContribution = {
      pluginId: "test.plugin",
      contributionId: "debug-billboard",
      kind: "debug.entityBillboard",
      displayName: "Test Billboard",
      priority: 10,
      hostKinds: ["studio"],
      payload: {
        getLines() {
          return ["ok"];
        }
      }
    };

    const manager = createRuntimePluginManager({
      boot,
      plugins: [
        {
          pluginId: "test.plugin",
          displayName: "Test Plugin",
          contributions: [hudCard, billboard]
        } satisfies RuntimePluginInstance
      ]
    });

    expect(manager.getContributions("debug.entityBillboard")).toEqual([billboard]);
    expect(manager.getContributions("debug.hudCard")).toEqual([hudCard]);
  });
});
