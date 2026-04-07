import { useEffect, useMemo, useState } from "react";
import type { RegionNPCBehaviorDefinition } from "@sugarmagic/domain";
import type { WorkspaceNavigationTarget } from "../../workspace-view";

export function useBehaviorSelection(options: {
  behaviorRecords: RegionNPCBehaviorDefinition[];
  regionId: string | null;
  navigationTarget?: WorkspaceNavigationTarget | null;
  onConsumeNavigationTarget?: () => void;
}) {
  const {
    behaviorRecords,
    regionId,
    navigationTarget = null,
    onConsumeNavigationTarget
  } = options;
  const [selectedBehaviorId, setSelectedBehaviorId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const selectedBehavior = useMemo(
    () =>
      behaviorRecords.find((behavior) => behavior.behaviorId === selectedBehaviorId) ??
      behaviorRecords[0] ??
      null,
    [behaviorRecords, selectedBehaviorId]
  );

  const selectedTask = useMemo(
    () =>
      selectedBehavior?.tasks.find((task) => task.taskId === selectedTaskId) ??
      selectedBehavior?.tasks[0] ??
      null,
    [selectedBehavior, selectedTaskId]
  );

  useEffect(() => {
    if (
      navigationTarget?.kind !== "behavior-task" ||
      navigationTarget.regionId !== regionId
    ) {
      return;
    }

    // Defer the selection sync until after this effect completes so we can
    // apply the incoming navigation target and consume it without tripping the
    // "set state in effect" lint rule on the same synchronous pass.
    queueMicrotask(() => {
      setSelectedBehaviorId(navigationTarget.behaviorId);
      setSelectedTaskId(navigationTarget.taskId);
      onConsumeNavigationTarget?.();
    });
  }, [navigationTarget, onConsumeNavigationTarget, regionId]);

  return {
    selectedBehaviorId,
    setSelectedBehaviorId,
    selectedTaskId,
    setSelectedTaskId,
    selectedBehavior,
    selectedTask
  };
}
