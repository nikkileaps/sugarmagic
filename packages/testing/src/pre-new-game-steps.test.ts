/**
 * Pre-new-game steps: the questions plugins ask between the New Game press and
 * the wipe.
 *
 * THE PROPERTY UNDER TEST IS DECOUPLING, the same one
 * `plugin-declared-assets.test.ts` guards for file-backed assets. The host runs
 * an ordered list of questions it cannot read and hands the answers to the next
 * boot. If either the core contract or the host runner learned a plugin's name,
 * turning that plugin off would stop being something the seam handles
 * generically.
 *
 * The second property is that the seam is free: with nothing contributed, New
 * Game does what it always did.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  isRenderablePreNewGameStep,
  type PreNewGameStepDefinition,
  type RuntimePluginContribution
} from "@sugarmagic/runtime-core";
import {
  consumePreNewGameStepAnswers,
  runPreNewGameSteps,
  writePreNewGameStepAnswers,
  type PreNewGameStepStorage
} from "@sugarmagic/target-web";

type StepContribution = Extract<
  RuntimePluginContribution,
  { kind: "newGame.preStep" }
>;

function step(
  pluginId: string,
  definition: PreNewGameStepDefinition | null,
  priority = 10
): StepContribution {
  return {
    pluginId,
    contributionId: `${pluginId}.step`,
    kind: "newGame.preStep",
    displayName: `${pluginId} step`,
    priority,
    payload: {
      summary: "test step",
      getStep: () => definition
    }
  };
}

function question(
  stepId: string,
  optionIds: string[],
  defaultOptionId = optionIds[0]
): PreNewGameStepDefinition {
  return {
    stepId,
    title: `Pick for ${stepId}`,
    options: optionIds.map((optionId) => ({ optionId, label: optionId })),
    defaultOptionId: defaultOptionId as string,
    confirmLabel: "OK"
  };
}

/** Answers with whatever the definition preselected. */
const answerWithDefault = (definition: PreNewGameStepDefinition) =>
  Promise.resolve(definition.defaultOptionId);

function fakeStorage(): PreNewGameStepStorage & { readAll: () => Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
    readAll: () => entries
  };
}

describe("pre-new-game steps", () => {
  it("THE ONE THAT MATTERS: no contributed steps means nothing is asked", async () => {
    // The whole seam has to be free when unused. If this produced answers, or
    // called the presenter, then installing the seam would have changed what
    // New Game does for every project that contributes no steps.
    const present = vi.fn(answerWithDefault);
    const answers = await runPreNewGameSteps({ contributions: [], present });
    expect(answers).toEqual({});
    expect(present).not.toHaveBeenCalled();

    const storage = fakeStorage();
    writePreNewGameStepAnswers(answers, storage);
    expect(storage.readAll().size).toBe(0);
  });

  it("asks each step and keys the answer by its stepId", async () => {
    const answers = await runPreNewGameSteps({
      contributions: [
        step("plugin-a", question("language", ["es", "it"], "it")),
        step("plugin-b", question("difficulty", ["gentle", "steep"]))
      ],
      present: answerWithDefault
    });
    expect(answers).toEqual({ language: "it", difficulty: "gentle" });
  });

  it("ANY plugin can contribute one, not one blessed plugin", async () => {
    // The generality check. Two unrelated plugins, identical mechanism.
    const asked: string[] = [];
    await runPreNewGameSteps({
      contributions: [
        step("some-plugin", question("first", ["x"])),
        step("some-other-plugin", question("second", ["y"]))
      ],
      present: (definition) => {
        asked.push(definition.stepId);
        return answerWithDefault(definition);
      }
    });
    expect(asked).toEqual(["first", "second"]);
  });

  it("asks in the order the contributions arrive", async () => {
    // getContributions sorts by priority ascending; the runner must not
    // reorder what it is handed.
    const asked: string[] = [];
    await runPreNewGameSteps({
      contributions: [
        step("plugin-a", question("earlier", ["x"]), 5),
        step("plugin-b", question("later", ["y"]), 50)
      ],
      present: (definition) => {
        asked.push(definition.stepId);
        return answerWithDefault(definition);
      }
    });
    expect(asked).toEqual(["earlier", "later"]);
  });

  it("a step with no question to ask is skipped", async () => {
    const answers = await runPreNewGameSteps({
      contributions: [
        step("plugin-a", null),
        step("plugin-b", question("kept", ["x"]))
      ],
      present: answerWithDefault
    });
    expect(answers).toEqual({ kept: "x" });
  });

  it("a broken step cannot strand the player mid-New-Game", async () => {
    // New Game is already under way by the time these run. A plugin that
    // throws, offers no options, or preselects an option it did not offer gets
    // skipped -- the alternative is a modal with no way out of it.
    const thrower = step("plugin-a", null);
    thrower.payload.getStep = () => {
      throw new Error("boom");
    };
    const answers = await runPreNewGameSteps({
      contributions: [
        thrower,
        step("plugin-b", question("no-options", [])),
        step("plugin-c", question("bad-default", ["x"], "not-offered")),
        step("plugin-d", question("kept", ["x"]))
      ],
      present: answerWithDefault
    });
    expect(answers).toEqual({ kept: "x" });
  });

  it("a shown step always yields an answer", () => {
    // The picker downstream relies on this: there is always a default and no
    // dismiss, so nothing downstream has to handle "shown but unanswered".
    expect(isRenderablePreNewGameStep(question("ok", ["x", "y"]))).toBe(true);
    expect(isRenderablePreNewGameStep(null)).toBe(false);
    expect(isRenderablePreNewGameStep(question("none", []))).toBe(false);
    expect(
      isRenderablePreNewGameStep(question("bad", ["x"], "not-offered"))
    ).toBe(false);
  });

  it("the answers survive the reload, once", () => {
    const storage = fakeStorage();
    writePreNewGameStepAnswers({ language: "it" }, storage);
    expect(consumePreNewGameStepAnswers(storage)).toEqual({ language: "it" });
    // Consumed means gone: the boot after this one is an ordinary boot.
    expect(consumePreNewGameStepAnswers(storage)).toEqual({});
  });

  it("an unreadable handshake does not stop the boot", () => {
    // sessionStorage is shared with everything else on this origin.
    const storage = fakeStorage();
    for (const junk of ["not json", "[]", "42", '{"language":7}', "null"]) {
      storage.setItem("sugarmagic.pre-new-game-answers", junk);
      expect(() => consumePreNewGameStepAnswers(storage)).not.toThrow();
      expect(consumePreNewGameStepAnswers(storage)).toEqual({});
    }
  });

  it("THE ARCHITECTURAL GUARD: the seam and the runner name no plugin", () => {
    // Scoped to the two files that own the mechanism. runtimeHost.ts is
    // deliberately not scanned: it names SugarProfile for the Play page URL,
    // which is a legitimate config read, not the step seam.
    const sources = {
      "runtime-core/src/plugins/pre-new-game-steps.ts": readFileSync(
        fileURLToPath(
          new URL(
            "../../runtime-core/src/plugins/pre-new-game-steps.ts",
            import.meta.url
          )
        ),
        "utf8"
      ),
      "targets/web/src/preNewGameSteps.ts": readFileSync(
        fileURLToPath(
          new URL(
            "../../../targets/web/src/preNewGameSteps.ts",
            import.meta.url
          )
        ),
        "utf8"
      )
    };
    for (const [label, source] of Object.entries(sources)) {
      for (const pluginId of [
        "sugarlang",
        "sugaragent",
        "sugarprofile",
        "sugardeploy",
        "fireflies"
      ]) {
        expect(source, `${label} must not name "${pluginId}"`).not.toContain(
          pluginId
        );
      }
    }
  });
});
