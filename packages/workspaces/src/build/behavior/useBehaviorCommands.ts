import { useCallback, useMemo } from "react";
import type {
  NPCDefinition,
  RegionDocument,
  RegionNPCBehaviorDefinition,
  RegionNPCBehaviorTask,
  SemanticCommand
} from "@sugarmagic/domain";
import {
  createRegionNPCBehaviorDefinition,
  createRegionNPCBehaviorId,
  createRegionNPCBehaviorTask,
  createRegionNPCBehaviorTaskId
} from "@sugarmagic/domain";

export function useBehaviorCommands(options: {
  region: RegionDocument | null;
  npcDefinitions: NPCDefinition[];
  onCommand: (command: SemanticCommand) => void;
  selectedBehavior: RegionNPCBehaviorDefinition | null;
  setSelectedBehaviorId: (behaviorId: string | null) => void;
  setSelectedTaskId: (taskId: string | null) => void;
}) {
  const {
    region,
    npcDefinitions,
    onCommand,
    selectedBehavior,
    setSelectedBehaviorId,
    setSelectedTaskId
  } = options;

  const updateBehavior = useCallback((nextBehavior: RegionNPCBehaviorDefinition) => {
    if (!region) {
      return;
    }
    onCommand({
      kind: "UpdateRegionNPCBehavior",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: {
        subjectKind: "region-document",
        subjectId: nextBehavior.behaviorId
      },
      payload: {
        behavior: nextBehavior
      }
    });
  }, [onCommand, region]);

  const createBehavior = useCallback(() => {
    if (!region) {
      return;
    }
    const usedNpcIds = new Set(region.behaviors.map((behavior) => behavior.npcDefinitionId));
    const nextNpc =
      region.scene.npcPresences.find((presence) => !usedNpcIds.has(presence.npcDefinitionId))
        ?.npcDefinitionId ??
      region.scene.npcPresences[0]?.npcDefinitionId ??
      npcDefinitions[0]?.definitionId;
    if (!nextNpc) {
      return;
    }
    const npcDisplayName =
      npcDefinitions.find((definition) => definition.definitionId === nextNpc)?.displayName ??
      "NPC";
    const nextBehavior = createRegionNPCBehaviorDefinition({
      behaviorId: createRegionNPCBehaviorId(),
      npcDefinitionId: nextNpc,
      displayName: `${npcDisplayName} Behavior`,
      tasks: [
        createRegionNPCBehaviorTask({
          taskId: createRegionNPCBehaviorTaskId(),
          displayName: "Default Task",
          description: null,
          currentActivity: "idle",
          currentGoal: "idle"
        })
      ]
    });
    onCommand({
      kind: "CreateRegionNPCBehavior",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: {
        subjectKind: "region-document",
        subjectId: nextBehavior.behaviorId
      },
      payload: {
        behavior: nextBehavior
      }
    });
    setSelectedBehaviorId(nextBehavior.behaviorId);
    setSelectedTaskId(nextBehavior.tasks[0]?.taskId ?? null);
  }, [npcDefinitions, onCommand, region, setSelectedBehaviorId, setSelectedTaskId]);

  const deleteBehavior = useCallback((behaviorId: string) => {
    if (!region) {
      return;
    }
    onCommand({
      kind: "DeleteRegionNPCBehavior",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: {
        subjectKind: "region-document",
        subjectId: behaviorId
      },
      payload: {
        behaviorId
      }
    });
  }, [onCommand, region]);

  const updateTask = useCallback((nextTask: RegionNPCBehaviorTask) => {
    if (!selectedBehavior) {
      return;
    }
    updateBehavior({
      ...selectedBehavior,
      tasks: selectedBehavior.tasks.map((task) =>
        task.taskId === nextTask.taskId ? nextTask : task
      )
    });
  }, [selectedBehavior, updateBehavior]);

  const createTask = useCallback(() => {
    if (!selectedBehavior) {
      return;
    }
    const nextTask = createRegionNPCBehaviorTask({
      taskId: createRegionNPCBehaviorTaskId(),
      displayName: `Task ${selectedBehavior.tasks.length + 1}`
    });
    updateBehavior({
      ...selectedBehavior,
      tasks: [...selectedBehavior.tasks, nextTask]
    });
    setSelectedTaskId(nextTask.taskId);
  }, [selectedBehavior, setSelectedTaskId, updateBehavior]);

  const deleteTask = useCallback((taskId: string) => {
    if (!selectedBehavior || selectedBehavior.tasks.length <= 1) {
      return;
    }
    updateBehavior({
      ...selectedBehavior,
      tasks: selectedBehavior.tasks.filter((task) => task.taskId !== taskId)
    });
  }, [selectedBehavior, updateBehavior]);

  return useMemo(
    () => ({
      updateBehavior,
      createBehavior,
      deleteBehavior,
      updateTask,
      createTask,
      deleteTask
    }),
    [
      updateBehavior,
      createBehavior,
      deleteBehavior,
      updateTask,
      createTask,
      deleteTask
    ]
  );
}
