export type WorkspaceNavigationTarget =
  | {
      kind: "quest-stage";
      questDefinitionId: string;
      stageId: string | null;
    }
  | {
      kind: "behavior-task";
      regionId: string;
      behaviorId: string;
      taskId: string | null;
    }
  | {
      kind: "shader-graph";
      shaderDefinitionId: string;
    };
