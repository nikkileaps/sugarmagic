import { describe, expect, it, vi } from "vitest";
import {
  createWorldFlagDefinition,
  createWorldFlagNameResolver,
  createDefaultQuestDefinition,
  createDefaultQuestNodeDefinition,
  createDefaultQuestStageDefinition,
  createQuestNodeId
} from "@sugarmagic/domain";
import {
  createRuntimeBlackboard,
  createWorldFlagProjection,
  getWorldFlagFact,
  QuestManager,
  WORLD_FLAG_FACT,
  WorldFlagManager,
  createBlackboardScope
} from "@sugarmagic/runtime-core";

const GATE_FLAG_ID = "flag:gate";
const GATE_FLAG_NAME = "gate-open";

function createProjectedStore(): {
  flags: WorldFlagManager;
  blackboard: ReturnType<typeof createRuntimeBlackboard>;
} {
  const blackboard = createRuntimeBlackboard();
  const flags = new WorldFlagManager();
  flags.setWorldFlagNameResolver(
    createWorldFlagNameResolver([
      createWorldFlagDefinition({ definitionId: GATE_FLAG_ID, name: GATE_FLAG_NAME })
    ])
  );
  flags.setWriteObserver(
    createWorldFlagProjection({
      blackboard,
      definitions: [
        createWorldFlagDefinition({ definitionId: GATE_FLAG_ID, name: GATE_FLAG_NAME })
      ]
    })
  );
  return { flags, blackboard };
}

describe("world flag projection", () => {
  it("puts a flag on the blackboard when it is set", () => {
    const { flags, blackboard } = createProjectedStore();

    flags.setFlag(GATE_FLAG_NAME, "unlatched");

    expect(getWorldFlagFact(blackboard, GATE_FLAG_NAME)).toBe("unlatched");
  });

  // The write the quest system uses inside its own refresh loop. It skips the
  // change handler on purpose; the projection must not skip with it, or every
  // authored setFlag action would be missing from the blackboard.
  it("projects the write that does not notify", () => {
    const { flags, blackboard } = createProjectedStore();

    flags.setFlagWithoutNotifying(GATE_FLAG_NAME, true);

    expect(getWorldFlagFact(blackboard, GATE_FLAG_NAME)).toBe(true);
  });

  it("projects a flag an authored setFlag action wrote", () => {
    const { flags, blackboard } = createProjectedStore();
    const nodeId = createQuestNodeId();
    const stage = createDefaultQuestStageDefinition({
      nodeDefinitions: [
        {
          ...createDefaultQuestNodeDefinition({
            nodeId,
            displayName: "Open the gate",
            description: "Sets the gate flag on activation"
          }),
          onEnterActions: [
            { type: "setFlag", worldFlagId: GATE_FLAG_ID, value: "true" }
          ]
        }
      ],
      entryNodeIds: [nodeId]
    });
    const questManager = new QuestManager();
    questManager.registerDefinitions([
      {
        ...createDefaultQuestDefinition({
          definitionId: "quest:gate",
          displayName: "Gate"
        }),
        startStageId: stage.stageId,
        stageDefinitions: [stage]
      }
    ]);
    questManager.setWorldFlagManager(flags);
    flags.setChangeHandler(() => questManager.update());

    questManager.startQuest("quest:gate");
    questManager.update();

    expect(flags.hasFlag(GATE_FLAG_NAME, true)).toBe(true);
    expect(getWorldFlagFact(blackboard, GATE_FLAG_NAME)).toBe(true);
  });

  it("republishes flags from a restored save", () => {
    const { flags, blackboard } = createProjectedStore();

    flags.deserializeSaveSlice({
      schemaVersion: 1,
      data: { worldFlags: { [GATE_FLAG_NAME]: "unlatched" } }
    });

    expect(getWorldFlagFact(blackboard, GATE_FLAG_NAME)).toBe("unlatched");
  });

  // A save taken before the flag was set. Restoring it has to take the flag
  // back off the blackboard, not leave the pre-restore value sitting there.
  it("takes a flag off the blackboard when a restored save does not have it", () => {
    const { flags, blackboard } = createProjectedStore();
    flags.setFlag(GATE_FLAG_NAME, "unlatched");

    flags.deserializeSaveSlice({
      schemaVersion: 1,
      data: { worldFlags: {} }
    });

    expect(flags.hasFlag(GATE_FLAG_NAME, "unlatched")).toBe(false);
    expect(getWorldFlagFact(blackboard, GATE_FLAG_NAME)).toBeNull();
  });

  // Quest state is restored before flags are. Re-evaluating quest conditions
  // here would activate and complete nodes during load and toast them at the
  // player; the first frame's `update()` does the evaluation instead.
  it("does not re-evaluate quest conditions while restoring", () => {
    const { flags } = createProjectedStore();
    flags.setChangeHandler(() => {
      throw new Error("restore must not trigger a quest refresh");
    });

    flags.deserializeSaveSlice({
      schemaVersion: 1,
      data: { worldFlags: { [GATE_FLAG_NAME]: true } }
    });

    expect(flags.hasFlag(GATE_FLAG_NAME, true)).toBe(true);
  });

  // The dev console handle and an agent's conversation proposal name a flag in
  // a string. Those stay in the store and stay in the save; they are not a
  // closed set of keys, so they do not become blackboard facts.
  it("does not project a flag the registry does not list", () => {
    const { flags, blackboard } = createProjectedStore();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    flags.setFlag("invented-at-runtime", true);
    flags.setFlag("invented-at-runtime", false);

    expect(flags.hasFlag("invented-at-runtime", false)).toBe(true);
    expect(getWorldFlagFact(blackboard, "invented-at-runtime")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("refuses a projection write from a system that does not own the fact", () => {
    const blackboard = createRuntimeBlackboard();

    expect(() =>
      blackboard.setFact({
        definition: WORLD_FLAG_FACT,
        scope: createBlackboardScope("global", GATE_FLAG_NAME),
        value: true,
        sourceSystem: "quest-system"
      })
    ).toThrow(/owned by "world-flag-system"/);
  });
});
