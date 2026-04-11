/**
 * packages/plugins/src/catalog/sugarlang/tests/plugin-registration.test.ts
 *
 * Purpose: Verifies that the sugarlang plugin can be imported and instantiated without throwing.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Depends on ../index.ts for the plugin factory entry point.
 *   - Guards the Epic 1 registration contract described in docs/api/README.md.
 *
 * Implements: Proposal 001 §The Substrate (Untouched) / §File Structure
 *
 * Status: active
 */

import { createPluginConfigurationRecord } from "@sugarmagic/domain";
import { createRuntimeBootModel } from "@sugarmagic/runtime-core";
import { describe, expect, it } from "vitest";
import {
  createSugarlangPlugin,
  pluginDefinition,
  SUGARLANG_DISPLAY_NAME,
  SUGARLANG_PLUGIN_ID
} from "../index";

describe("sugarlang plugin registration", () => {
  it("creates a runtime plugin instance with the four middleware contributions", () => {
    const instance = createSugarlangPlugin({
      boot: createRuntimeBootModel({
        hostKind: "studio",
        compileProfile: "authoring-preview",
        contentSource: "authored-game-root"
      }),
      configuration: createPluginConfigurationRecord(SUGARLANG_PLUGIN_ID, true, {}),
      environment: {}
    });

    expect(instance.pluginId).toBe(SUGARLANG_PLUGIN_ID);
    expect(instance.displayName).toBe(SUGARLANG_DISPLAY_NAME);
    expect(instance.contributions).toHaveLength(5);
    expect(instance.contributions.map((entry) => entry.kind)).toEqual([
      "dialogue.entryDecorator",
      "conversation.middleware",
      "conversation.middleware",
      "conversation.middleware",
      "conversation.middleware"
    ]);
    expect(instance.blackboardFactDefinitions).toHaveLength(4);
    expect(typeof instance.init).toBe("function");
    expect(typeof instance.dispose).toBe("function");
  });

  it("publishes its Epic 12 shell contribution surface for Studio discovery", () => {
    expect(pluginDefinition.shell?.designWorkspaces).toEqual([
      expect.objectContaining({
        workspaceKind: SUGARLANG_PLUGIN_ID
      })
    ]);
    expect(pluginDefinition.shell?.designSections).toHaveLength(8);
  });
});
