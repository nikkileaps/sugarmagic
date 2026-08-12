/**
 * packages/testing/src/language-picker-end-to-end.test.ts
 *
 * Pick Italian on a Spanish project and end up playing Italian.
 *
 * This walks the real path a player takes, minus the page reload: the host
 * asks sugarlang's contributed step, the answer goes into the reload
 * handshake, comes back at boot, reaches plugin init, and sugarlang settles it
 * into its own save slice. Every piece is exercised through its public
 * surface -- the point is that the pieces meet, which is the part no
 * single-package test can show.
 *
 * The case that matters is a pick that DIFFERS from the project's authored
 * language. A test where they agree passes whether or not the pick is wired up
 * at all.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  createRuntimeBootModel,
  createRuntimePluginManager,
  SaveParticipantRegistry,
  type RuntimePluginInstance,
  type SaveSlice
} from "@sugarmagic/runtime-core";
import {
  consumePreNewGameStepAnswers,
  runPreNewGameSteps,
  writePreNewGameStepAnswers,
  type PreNewGameStepStorage
} from "@sugarmagic/target-web";
import { createPluginConfigurationRecord } from "@sugarmagic/domain";
import {
  createSugarlangPlugin,
  getSugarlangTargetLanguage,
  resetSugarlangTargetLanguageForTests
} from "@sugarmagic/plugins";

afterEach(() => {
  resetSugarlangTargetLanguageForTests();
});

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

/** Sugarlang as the host builds it, for a project authored in Spanish. */
function spanishProjectPlugin(): RuntimePluginInstance {
  const instance = createSugarlangPlugin({
    boot: boot(),
    configuration: createPluginConfigurationRecord("sugarlang", true, {
      targetLanguage: "es"
    }),
    environment: {}
  });
  if (!instance) throw new Error("sugarlang runtime plugin did not build");
  return instance;
}

/**
 * One New Game press and the boot that follows it, minus the reload. Returns
 * the collected save slices so a caller can boot again from them.
 */
async function pressNewGameAndReboot(options: {
  chooses: string;
  storedSlices?: Record<string, SaveSlice<unknown>>;
}) {
  const manager = createRuntimePluginManager({
    boot: boot(),
    plugins: [spanishProjectPlugin()]
  });
  const storage = fakeSessionStorage();

  const answers = await runPreNewGameSteps({
    contributions: manager.getContributions("newGame.preStep"),
    present: () => Promise.resolve(options.chooses)
  });
  writePreNewGameStepAnswers(answers, storage);

  // --- the page reloads here ---
  resetSugarlangTargetLanguageForTests();
  const carried = consumePreNewGameStepAnswers(storage);
  const registry = new SaveParticipantRegistry();
  for (const participant of manager.getSaveParticipants()) {
    registry.register(participant);
  }
  registry.deserializeAll(options.storedSlices ?? {}, ["host-owned"]);
  await manager.init({ preNewGameStepAnswers: carried });
  return { answers, slices: registry.serializeAll() };
}

describe("picking a language at New Game", () => {
  it("asks one question, with both languages on it", async () => {
    const manager = createRuntimePluginManager({
      boot: boot(),
      plugins: [spanishProjectPlugin()]
    });
    const steps = manager.getContributions("newGame.preStep");
    expect(steps).toHaveLength(1);
    const definition = steps[0]!.payload.getStep();
    expect(definition?.options.map((option) => option.label)).toEqual([
      "Spanish",
      "Italian"
    ]);
  });

  it("THE ONE THAT MATTERS: choosing Italian on a Spanish project plays Italian", async () => {
    const { answers, slices } = await pressNewGameAndReboot({ chooses: "it" });
    expect(Object.values(answers)).toEqual(["it"]);
    expect(getSugarlangTargetLanguage()).toBe("it");
    // And it is in the save, so the next boot does not have to be told again.
    expect(slices["sugarlang.targetLanguage"]?.data).toEqual({
      targetLanguage: "it"
    });
  });

  it("THE RACE: the pick is in the save even when sugarlang is not the first plugin", async () => {
    // Plugin `init` is started without being awaited, and the manager runs the
    // plugins in the order the project lists them. With anything ahead of
    // sugarlang that awaits, sugarlang has not settled the language yet when a
    // synchronous serialize happens -- so the save captured `null` and the
    // player's choice survived only until the tab closed.
    let resolveSlowPlugin: () => void = () => {};
    const slowPlugin: RuntimePluginInstance = {
      pluginId: "slow-plugin",
      displayName: "slow",
      contributions: [],
      init: () =>
        new Promise<void>((resolve) => {
          resolveSlowPlugin = resolve;
        })
    };

    const manager = createRuntimePluginManager({
      boot: boot(),
      plugins: [slowPlugin, spanishProjectPlugin()]
    });
    const registry = new SaveParticipantRegistry();
    for (const participant of manager.getSaveParticipants()) {
      registry.register(participant);
    }
    registry.deserializeAll({}, ["host-owned"]);

    const initialized = manager.init({
      preNewGameStepAnswers: { "sugarlang.targetLanguage": "it" }
    });
    // Serializing here is what the host used to do: sugarlang has not run.
    expect(() => registry.serializeAll()).not.toThrow();
    expect(getSugarlangTargetLanguage()).toBeNull();

    // Awaiting init first is the fix, and then the save carries the pick.
    resolveSlowPlugin();
    await initialized;
    expect(getSugarlangTargetLanguage()).toBe("it");
    expect(registry.serializeAll()["sugarlang.targetLanguage"]?.data).toEqual({
      targetLanguage: "it"
    });
  });

  it("Continue keeps the picked language, not the project's", async () => {
    const first = await pressNewGameAndReboot({ chooses: "it" });

    // Boot again with no New Game press: the handshake is empty and the save
    // decides. The project is still authored in Spanish.
    resetSugarlangTargetLanguageForTests();
    const manager = createRuntimePluginManager({
      boot: boot(),
      plugins: [spanishProjectPlugin()]
    });
    const registry = new SaveParticipantRegistry();
    for (const participant of manager.getSaveParticipants()) {
      registry.register(participant);
    }
    registry.deserializeAll(first.slices, ["host-owned"]);
    await manager.init({ preNewGameStepAnswers: {} });
    expect(getSugarlangTargetLanguage()).toBe("it");
  });

  it("a save older than the picker falls back to the project's language", async () => {
    // No slice and no pick: sugarlang settles its authored default once, which
    // pins that game to it from then on. No modal, nothing the player sees.
    resetSugarlangTargetLanguageForTests();
    const manager = createRuntimePluginManager({
      boot: boot(),
      plugins: [spanishProjectPlugin()]
    });
    const registry = new SaveParticipantRegistry();
    for (const participant of manager.getSaveParticipants()) {
      registry.register(participant);
    }
    registry.deserializeAll({}, ["host-owned"]);
    await manager.init({ preNewGameStepAnswers: {} });
    expect(getSugarlangTargetLanguage()).toBe("es");
    expect(registry.serializeAll()["sugarlang.targetLanguage"]?.data).toEqual({
      targetLanguage: "es"
    });
  });
});
