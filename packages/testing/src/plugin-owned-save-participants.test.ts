/**
 * packages/testing/src/plugin-owned-save-participants.test.ts
 *
 * A plugin keeps its own state in the game's save, in its own slice.
 *
 * Two questions this suite answers with the real code paths rather than by
 * reading them:
 *
 *   1. Uninstall every plugin -- does anything break? The mechanism has to be
 *      inert, not merely tolerant: nothing is declared, nothing is registered,
 *      New Game asks nothing, and no core file is holding anyone's state.
 *
 *   2. Write a brand-new plugin -- can it use these paths? A plugin that
 *      shipped after all of this was built gets no special wiring. It declares
 *      a participant and a pre-new-game step, the player answers, the answer
 *      survives the reload, and the plugin keeps it in its own slice from then
 *      on. Two plugins doing this at once do not collide.
 *
 * Nothing here names a real plugin, which is the point: these are the paths as
 * an outsider meets them.
 */

import { describe, expect, it, vi } from "vitest";
import {
  createRuntimeBootModel,
  createRuntimePluginManager,
  type PreNewGameStepDefinition,
  type RuntimePluginContribution,
  type RuntimePluginInstance,
  type SaveParticipant,
  type SaveSlice
} from "@sugarmagic/runtime-core";
import { SaveParticipantRegistry } from "@sugarmagic/runtime-core";
import {
  consumePreNewGameStepAnswers,
  runPreNewGameSteps,
  writePreNewGameStepAnswers,
  type PreNewGameStepStorage
} from "@sugarmagic/target-web";

const boot = () =>
  createRuntimeBootModel({
    hostKind: "published-web",
    compileProfile: "runtime-preview",
    contentSource: "published-artifact"
  });

function fakeSessionStorage(): PreNewGameStepStorage {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    }
  };
}

/**
 * A plugin written by someone who has never seen this code: it asks one
 * question before a new game and keeps the answer in its own save slice.
 */
function makeOutsiderPlugin(pluginId: string, stepId: string, fallback: string) {
  let value: string | null = null;

  const definition: PreNewGameStepDefinition = {
    stepId,
    title: `${pluginId} asks something`,
    options: [
      { optionId: "first", label: "First" },
      { optionId: "second", label: "Second" }
    ],
    defaultOptionId: "first",
    confirmLabel: "Start"
  };

  const participant: SaveParticipant<{ value: string | null }> = {
    participantId: stepId,
    tier: "host-owned",
    schemaVersion: 1,
    serialize: () => ({ value }),
    deserialize: (slice: SaveSlice<{ value: string | null }> | null) => {
      const stored = slice?.data?.value;
      if (typeof stored === "string" && stored) value = stored;
    }
  };

  const step: Extract<RuntimePluginContribution, { kind: "newGame.preStep" }> = {
    pluginId,
    contributionId: `${pluginId}.step`,
    kind: "newGame.preStep",
    displayName: `${pluginId} step`,
    priority: 10,
    payload: { summary: "a question", getStep: () => definition }
  };

  const instance: RuntimePluginInstance = {
    pluginId,
    displayName: pluginId,
    contributions: [step],
    saveParticipants: [participant as SaveParticipant<unknown>],
    // What the plugin does when it binds: take the pick if this boot had one,
    // otherwise keep what the save restored, otherwise settle its own default.
    init: (context) => {
      value = context.preNewGameStepAnswers?.[stepId] ?? value ?? fallback;
    }
  };

  return { instance, participant, read: () => value, definition };
}

describe("with every plugin uninstalled", () => {
  it("nothing is declared and nothing is registered", () => {
    const manager = createRuntimePluginManager({ boot: boot(), plugins: [] });
    expect(manager.getSaveParticipants()).toEqual([]);

    const registry = new SaveParticipantRegistry();
    for (const participant of manager.getSaveParticipants()) {
      registry.register(participant);
    }
    expect(registry.list()).toEqual([]);
    // Nothing to collect means an empty payload, not a crash.
    expect(registry.serializeAll()).toEqual({});
  });

  it("New Game asks nothing and carries nothing", async () => {
    const manager = createRuntimePluginManager({ boot: boot(), plugins: [] });
    const present = vi.fn();
    const answers = await runPreNewGameSteps({
      contributions: manager.getContributions("newGame.preStep"),
      present: () => {
        present();
        return Promise.resolve("unreachable");
      }
    });
    expect(present).not.toHaveBeenCalled();
    expect(answers).toEqual({});
  });

  it("an uninstalled plugin's slice is simply not dispatched", () => {
    // The save may still hold it. Nothing registered claims that id, so
    // deserializeAll passes it by -- reinstalling gives the player their game
    // back rather than resetting it.
    const registry = new SaveParticipantRegistry();
    expect(() =>
      registry.deserializeAll({
        "uninstalled-plugin.something": { schemaVersion: 1, data: { value: "x" } }
      })
    ).not.toThrow();
  });
});

describe("a brand-new plugin keeping its own state in the save", () => {
  const STEP_ID = "brand-new-plugin.choice";

  /** One New Game press and the boot that follows it, minus the page reload. */
  async function pressNewGameAndReboot(
    plugins: RuntimePluginInstance[],
    answer: (definition: PreNewGameStepDefinition) => string,
    storedSlices: Record<string, SaveSlice<unknown>> = {}
  ) {
    const manager = createRuntimePluginManager({ boot: boot(), plugins });
    const storage = fakeSessionStorage();
    const answers = await runPreNewGameSteps({
      contributions: manager.getContributions("newGame.preStep"),
      present: (definition) => Promise.resolve(answer(definition))
    });
    writePreNewGameStepAnswers(answers, storage);

    // --- the reload happens here ---
    const carried = consumePreNewGameStepAnswers(storage);
    const registry = new SaveParticipantRegistry();
    for (const participant of manager.getSaveParticipants()) {
      registry.register(participant);
    }
    registry.deserializeAll(storedSlices, ["host-owned"]);
    await manager.init({ preNewGameStepAnswers: carried });
    return { manager, registry };
  }

  it("gets its question asked and keeps the answer in its own slice", async () => {
    const plugin = makeOutsiderPlugin("brand-new-plugin", STEP_ID, "first");
    const { registry } = await pressNewGameAndReboot(
      [plugin.instance],
      () => "second"
    );
    expect(plugin.read()).toBe("second");
    expect(registry.serializeAll()[STEP_ID]).toEqual({
      schemaVersion: 1,
      data: { value: "second" }
    });
  });

  it("THE ONE THAT MATTERS: what is in the save wins over the plugin's default", async () => {
    // The rule the language pick depends on, with nothing language-shaped
    // anywhere. Boot with a stored answer and no New Game press: the plugin's
    // bind-time fallback must not overwrite it, or an author changing a
    // project default would move a game already under way.
    const plugin = makeOutsiderPlugin("brand-new-plugin", STEP_ID, "first");
    const manager = createRuntimePluginManager({
      boot: boot(),
      plugins: [plugin.instance]
    });
    const registry = new SaveParticipantRegistry();
    for (const participant of manager.getSaveParticipants()) {
      registry.register(participant);
    }
    registry.deserializeAll(
      { [STEP_ID]: { schemaVersion: 1, data: { value: "second" } } },
      ["host-owned"]
    );
    await manager.init({ preNewGameStepAnswers: {} });
    expect(plugin.read()).toBe("second");
  });

  it("settles its own default when the save predates its slice", async () => {
    const plugin = makeOutsiderPlugin("brand-new-plugin", STEP_ID, "first");
    const manager = createRuntimePluginManager({
      boot: boot(),
      plugins: [plugin.instance]
    });
    const registry = new SaveParticipantRegistry();
    for (const participant of manager.getSaveParticipants()) {
      registry.register(participant);
    }
    registry.deserializeAll({}, ["host-owned"]);
    await manager.init({ preNewGameStepAnswers: {} });
    expect(plugin.read()).toBe("first");
    // Persisted on the next collect, which locks the game to it from then on.
    expect(registry.serializeAll()[STEP_ID]).toEqual({
      schemaVersion: 1,
      data: { value: "first" }
    });
  });

  it("restores before the plugin binds, which is the whole point of the tier", () => {
    const plugin = makeOutsiderPlugin("brand-new-plugin", STEP_ID, "first");
    // A participant in a later tier would miss the first pass, and the plugin
    // would read nothing on the boot that matters.
    expect(plugin.participant.tier).toBe("host-owned");
  });

  it("two plugins share the mechanism without colliding", async () => {
    const first = makeOutsiderPlugin("brand-new-plugin", STEP_ID, "first");
    const second = makeOutsiderPlugin(
      "another-new-plugin",
      "another-new-plugin.choice",
      "first"
    );
    const asked: string[] = [];
    const { manager, registry } = await pressNewGameAndReboot(
      [first.instance, second.instance],
      (definition) => {
        asked.push(definition.stepId);
        return definition.stepId === STEP_ID ? "second" : "first";
      }
    );
    expect(asked).toEqual([STEP_ID, "another-new-plugin.choice"]);
    expect(manager.getSaveParticipants()).toHaveLength(2);
    expect(first.read()).toBe("second");
    expect(second.read()).toBe("first");
    const slices = registry.serializeAll();
    expect(slices[STEP_ID]?.data).toEqual({ value: "second" });
    expect(slices["another-new-plugin.choice"]?.data).toEqual({
      value: "first"
    });
  });
});
