import { describe, expect, it } from "vitest";
import {
  createWorldFlagDefinition,
  createWorldFlagNameResolver,
  createDefaultQuestDefinition,
  createDefaultQuestNodeDefinition,
  createDefaultQuestStageDefinition,
  createQuestNodeId,
  type QuestConditionDefinition
} from "@sugarmagic/domain";
import {
  coerceAuthoredWorldFlagValue,
  QuestManager,
  WorldFlagManager
} from "@sugarmagic/runtime-core";

describe("QuestManager", () => {
  it("routes NPC talk objectives through dialogue and completes them on dialogue end", () => {
    const stage = createDefaultQuestStageDefinition({
      nodeDefinitions: [
        {
          ...createDefaultQuestNodeDefinition({
            displayName: "Talk to Guard",
            description: "Speak with the station guard",
            objectiveSubtype: "talk"
          }),
          targetId: "npc:guard",
          dialogueDefinitionId: "dialogue:guard",
          completeOn: "dialogueEnd",
          showInHud: true
        }
      ]
    });
    const quest = createDefaultQuestDefinition({
      definitionId: "quest:station-guard",
      displayName: "Station Guard"
    });
    const manager = new QuestManager();
    manager.registerDefinitions([
      {
        ...quest,
        startStageId: stage.stageId,
        stageDefinitions: [stage]
      }
    ]);

    expect(manager.startQuest("quest:station-guard")).toBe(true);
    expect(manager.getDialogueOverrideForNpc("npc:guard")).toBe("dialogue:guard");

    manager.notifyDialogueFinished("dialogue:guard");

    expect(manager.isQuestCompleted("quest:station-guard")).toBe(true);
    expect(manager.getTrackedQuest()).toBeNull();
  });

  /**
   * A branch on a flag. Conditions reference the flag by id; the manager
   * resolves that id to the store key "gate-open", which is what the tests
   * then set. Pass path leads to "Walk Through Gate", fail path to "Find
   * Another Way".
   */
  const GATE_FLAG_ID = "flag:gate";
  /** The flag store each fixture manager reads, so a test can write to it. */
  const managerFlags = new WeakMap<QuestManager, WorldFlagManager>();

  function flagsOf(manager: QuestManager): WorldFlagManager {
    const flags = managerFlags.get(manager);
    if (!flags) throw new Error("fixture manager has no world flag store");
    return flags;
  }

  function createGateBranchManager(
    condition: QuestConditionDefinition = {
      type: "hasFlag",
      worldFlagId: GATE_FLAG_ID,
      value: "true"
    }
  ): QuestManager {
    const branchNodeId = createQuestNodeId();
    const passNodeId = createQuestNodeId();
    const failNodeId = createQuestNodeId();

    const stage = createDefaultQuestStageDefinition({
      nodeDefinitions: [
        {
          ...createDefaultQuestNodeDefinition({
            nodeId: branchNodeId,
            displayName: "Check Gate",
            description: "See whether the gate is open",
            nodeBehavior: "branch"
          }),
          condition,
          failTargetNodeIds: [failNodeId],
          showInHud: false
        },
        {
          ...createDefaultQuestNodeDefinition({
            nodeId: passNodeId,
            displayName: "Walk Through Gate",
            description: "Use the open gate"
          }),
          prerequisiteNodeIds: [branchNodeId]
        },
        {
          ...createDefaultQuestNodeDefinition({
            nodeId: failNodeId,
            displayName: "Find Another Way",
            description: "The gate is shut",
            objectiveSubtype: "awaitEvent"
          })
        }
      ],
      entryNodeIds: [branchNodeId]
    });

    const quest = createDefaultQuestDefinition({
      definitionId: "quest:branch-test",
      displayName: "Branch Test"
    });
    const manager = new QuestManager();
    manager.registerDefinitions([
      {
        ...quest,
        startStageId: stage.stageId,
        stageDefinitions: [stage]
      }
    ]);
    const worldFlags = new WorldFlagManager();
    worldFlags.setWorldFlagNameResolver(
      createWorldFlagNameResolver([
        createWorldFlagDefinition({ definitionId: GATE_FLAG_ID, name: "gate-open" })
      ])
    );
    worldFlags.setChangeHandler(() => manager.update());
    manager.setWorldFlagManager(worldFlags);
    managerFlags.set(manager, worldFlags);
    return manager;
  }

  function trackedObjectiveNames(manager: QuestManager): string[] {
    return (
      manager.getTrackedQuest()?.objectives.map((objective) => objective.displayName) ??
      []
    );
  }

  it("activates branch fail targets without unlocking the pass path", () => {
    const manager = createGateBranchManager();

    manager.startQuest("quest:branch-test");
    manager.update();

    expect(trackedObjectiveNames(manager)).toEqual(["Find Another Way"]);
  });

  // The three tests below assert only whether the PASS node unlocks. The fail
  // node has no prerequisites, so `canActivateNode` lets it activate on either
  // branch -- asserting the whole objective list would pin that unrelated rule.

  // The trap this story exists to close: the action writes boolean `true`, the
  // author types the string "true" into the condition, and `===` says no. Both
  // sides run through `coerceAuthoredWorldFlagValue`, so they agree.
  it("matches an authored 'true' condition against a flag a setFlag action wrote", () => {
    const manager = createGateBranchManager();
    flagsOf(manager).setFlag("gate-open", coerceAuthoredWorldFlagValue("true"));

    manager.startQuest("quest:branch-test");
    manager.update();

    expect(trackedObjectiveNames(manager)).toContain("Walk Through Gate");
  });

  it("matches an authored value against the same authored value", () => {
    const manager = createGateBranchManager({
      type: "hasFlag",
      worldFlagId: GATE_FLAG_ID,
      value: "unlatched"
    });
    flagsOf(manager).setFlag("gate-open", "unlatched");

    manager.startQuest("quest:branch-test");
    manager.update();

    expect(trackedObjectiveNames(manager)).toContain("Walk Through Gate");
  });

  it("leaves the pass path locked when the values differ", () => {
    const manager = createGateBranchManager({
      type: "hasFlag",
      worldFlagId: GATE_FLAG_ID,
      value: "unlatched"
    });
    flagsOf(manager).setFlag("gate-open", "jammed");

    manager.startQuest("quest:branch-test");
    manager.update();

    expect(trackedObjectiveNames(manager)).not.toContain("Walk Through Gate");
  });

  it("coerces authored text to the type the flag store holds", () => {
    expect(coerceAuthoredWorldFlagValue("true")).toBe(true);
    expect(coerceAuthoredWorldFlagValue("false")).toBe(false);
    expect(coerceAuthoredWorldFlagValue("5")).toBe(5);
    expect(coerceAuthoredWorldFlagValue("blah")).toBe("blah");
    // Already typed -- a restored save, or a flag set from code.
    expect(coerceAuthoredWorldFlagValue(true)).toBe(true);
    expect(coerceAuthoredWorldFlagValue(7)).toBe(7);
  });

  // `runtimeHost.ts` reports flags into the quest debug dump this way.
  it("defaults a missing expected value to true, matching what setFlag writes", () => {
    const flags = new WorldFlagManager();
    expect(flags.hasFlag("talkedToDockWorker")).toBe(false);
    flags.setFlag("talkedToDockWorker");
    expect(flags.hasFlag("talkedToDockWorker")).toBe(true);
  });

  // Derived consumers -- the quest tracker, NPC interaction availability, the
  // blackboard quest facts -- resync off this handler rather than rebuilding
  // themselves every frame. A transition that moves quest state without firing
  // it leaves all of them stale.
  it("announces a state change on quest start and on node completion", () => {
    const stage = createDefaultQuestStageDefinition({
      nodeDefinitions: [
        {
          ...createDefaultQuestNodeDefinition({
            displayName: "Talk to Guard",
            description: "Speak with the station guard",
            objectiveSubtype: "talk"
          }),
          targetId: "npc:guard",
          dialogueDefinitionId: "dialogue:guard",
          completeOn: "dialogueEnd"
        }
      ]
    });
    const manager = new QuestManager();
    manager.registerDefinitions([
      {
        ...createDefaultQuestDefinition({
          definitionId: "quest:notify",
          displayName: "Notify"
        }),
        startStageId: stage.stageId,
        stageDefinitions: [stage]
      }
    ]);

    let stateChanges = 0;
    manager.setStateChangeHandler(() => {
      stateChanges += 1;
    });

    manager.startQuest("quest:notify");
    expect(stateChanges).toBeGreaterThan(0);

    const afterStart = stateChanges;
    manager.notifyDialogueFinished("dialogue:guard");
    expect(stateChanges).toBeGreaterThan(afterStart);
  });

  it("completes cast spell objectives and evaluates spell conditions from providers", () => {
    const stage = createDefaultQuestStageDefinition({
      nodeDefinitions: [
        {
          ...createDefaultQuestNodeDefinition({
            displayName: "Cast Kindle",
            description: "Use Kindle on the dark room",
            objectiveSubtype: "castSpell"
          }),
          targetId: "spell:kindle"
        },
        {
          ...createDefaultQuestNodeDefinition({
            displayName: "Verify Spell Access",
            description: "Spell conditions should evaluate",
            nodeBehavior: "condition"
          }),
          condition: {
            type: "not",
            condition: {
              type: "canCastSpell",
              spellDefinitionId: "spell:blocked"
            }
          }
        }
      ]
    });

    const quest = createDefaultQuestDefinition({
      definitionId: "quest:spell-test",
      displayName: "Spell Test"
    });
    const manager = new QuestManager();
    manager.registerDefinitions([
      {
        ...quest,
        startStageId: stage.stageId,
        stageDefinitions: [stage]
      }
    ]);
    manager.setHasSpellProvider((spellDefinitionId) => spellDefinitionId === "spell:kindle");
    manager.setCanCastSpellProvider((spellDefinitionId) => spellDefinitionId === "spell:kindle");

    expect(manager.startQuest("quest:spell-test")).toBe(true);
    expect(manager.getTrackedQuest()?.objectives.map((objective) => objective.displayName)).toContain(
      "Cast Kindle"
    );

    manager.notifySpellCast("spell:kindle");

    expect(manager.isQuestCompleted("quest:spell-test")).toBe(true);
  });
});
