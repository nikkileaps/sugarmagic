/**
 * packages/plugins/src/catalog/sugarlang/tests/plugin-registration.test.ts
 *
 * Purpose: Verifies that the skeleton sugarlang plugin can be imported and instantiated without throwing.
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
 * Status: skeleton (no implementation yet; see Epic 1 Story 1.9)
 */

import { createPluginConfigurationRecord } from "@sugarmagic/domain";
import { createRuntimeBootModel } from "@sugarmagic/runtime-core";
import { describe, expect, it } from "vitest";
import {
  createSugarlangPlugin,
  SUGARLANG_DISPLAY_NAME,
  SUGARLANG_PLUGIN_ID
} from "../index";

describe("sugarlang plugin registration", () => {
  it("creates a skeleton runtime plugin instance", () => {
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
    expect(instance.contributions).toEqual([]);
    expect(typeof instance.init).toBe("function");
    expect(typeof instance.dispose).toBe("function");
  });
});
