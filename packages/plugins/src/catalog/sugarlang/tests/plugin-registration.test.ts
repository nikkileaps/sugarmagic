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
  it("registers the decorator, the display-text resolver, and the middleware chain", () => {
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
    expect(instance.contributions).toHaveLength(11);
    expect(instance.contributions.map((entry) => entry.kind)).toEqual([
      "dialogue.entryDecorator",
      // Runtime grading seam. Its absence is what makes the game plain English,
      // so its PRESENCE here is the thing worth pinning.
      "displayText.resolver",
      // Plan 090.1 -- Studio-preview-only readout of the seeded scene context.
      // hostKinds gates it out of published builds; see the card's own tests.
      "debug.hudCard",
      // What the teaching system knows about the learner while playing. Also
      // studio-only. Contributed here rather than built into the HUD so that a
      // game without sugarlang has no learner card, rather than an empty one.
      "debug.hudCard",
      // The placement assessment as a QUEST FORM. Its presence is what lets an
      // assessment objective open a form without a conversation -- placement
      // used to ride on a dialogue turn and so only worked for free-form NPCs.
      "quest.assessment",
      // The language question, asked once between the New Game press and the
      // save being wiped. Its presence here is what makes the game ask at all;
      // without it every game silently runs in the project's authored
      // language.
      "newGame.preStep",
      "conversation.middleware",
      "conversation.middleware",
      "conversation.middleware",
      "conversation.middleware",
      "conversation.middleware"
    ]);
    // Learner state only. The Teacher's current directive is NOT among these:
    // it is a cache, rebuildable by asking the Teacher again, and it lives in
    // the directive store rather than in the world state.
    expect(instance.blackboardFactDefinitions?.map((fact) => fact.key)).toEqual([
      "sugarlang.learner-profile",
      "sugarlang.placement-status",
      "sugarlang.lemma-observation"
    ]);
    expect(typeof instance.init).toBe("function");
    expect(typeof instance.dispose).toBe("function");
  });

  it("publishes its Epic 12 shell contribution surface for Studio discovery", () => {
    expect(pluginDefinition.shell?.designWorkspaces).toEqual([
      expect.objectContaining({
        workspaceKind: SUGARLANG_PLUGIN_ID
      })
    ]);
    expect(pluginDefinition.shell?.designSections).toHaveLength(10);
  });
});
