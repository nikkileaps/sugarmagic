import type {
  QuestActionDefinition,
  QuestConditionDefinition,
  QuestDefinition,
  QuestNodeDefinition,
  QuestStageDefinition,
  QuestStageState
} from "@sugarmagic/domain";

export interface QuestRuntimeActionHandler {
  (action: QuestActionDefinition): void;
}

export interface QuestRuntimeNarrativeHandler {
  (node: QuestNodeDefinition): void;
}

export interface QuestActiveObjectiveView {
  questDefinitionId: string;
  stageId: string;
  nodeId: string;
  displayName: string;
  description: string;
  showInHud: boolean;
  optional: boolean;
}

export interface QuestTrackerView {
  questDefinitionId: string;
  displayName: string;
  stageDisplayName: string;
  objectives: QuestActiveObjectiveView[];
}

export interface QuestJournalQuestView {
  questDefinitionId: string;
  displayName: string;
  description: string;
  stageDisplayName: string;
  objectives: QuestActiveObjectiveView[];
  repeatable: boolean;
  completed: boolean;
}

export type QuestRuntimeEvent =
  | {
      type: "quest-start";
      questDefinitionId: string;
      displayName: string;
    }
  | {
      type: "stage-advance";
      questDefinitionId: string;
      displayName: string;
      stageDisplayName: string;
    }
  | {
      type: "quest-complete";
      questDefinitionId: string;
      displayName: string;
    }
  | {
      type: "objective-complete";
      questDefinitionId: string;
      displayName: string;
      objectiveDisplayName: string;
    };

export type QuestRuntimeEventHandler = (event: QuestRuntimeEvent) => void;

interface QuestNodeProgress {
  nodeId: string;
  status: "inactive" | "active" | "completed";
  branchResult: "pass" | "fail" | null;
}

interface QuestStageProgress {
  stageId: string;
  nodeProgress: Map<string, QuestNodeProgress>;
  forcedNodeIds: Set<string>;
}

interface ActiveQuestRuntimeState {
  questDefinitionId: string;
  currentStageId: string;
  stageProgress: Map<string, QuestStageProgress>;
}

function createNodeProgress(nodeId: string): QuestNodeProgress {
  return {
    nodeId,
    status: "inactive",
    branchResult: null
  };
}

function createStageProgress(stage: QuestStageDefinition): QuestStageProgress {
  return {
    stageId: stage.stageId,
    nodeProgress: new Map(
      stage.nodeDefinitions.map((node) => [node.nodeId, createNodeProgress(node.nodeId)])
    ),
    forcedNodeIds: new Set(stage.entryNodeIds)
  };
}

function isRequiredNode(node: QuestNodeDefinition): boolean {
  return !node.optional;
}

function isTalkObjective(node: QuestNodeDefinition): boolean {
  return node.nodeBehavior === "objective" && node.objectiveSubtype === "talk";
}

function isDialogueNarrative(node: QuestNodeDefinition): boolean {
  return node.nodeBehavior === "narrative" && node.narrativeSubtype === "dialogue";
}

export class QuestManager {
  private definitions = new Map<string, QuestDefinition>();
  private activeQuests = new Map<string, ActiveQuestRuntimeState>();
  private completedQuestIds = new Set<string>();
  private trackedQuestDefinitionId: string | null = null;
  private runtimeFlags = new Map<string, unknown>();
  private onEvent: QuestRuntimeEventHandler | null = null;
  private onStateChange: (() => void) | null = null;
  private onAction: QuestRuntimeActionHandler | null = null;
  private onNarrative: QuestRuntimeNarrativeHandler | null = null;

  registerDefinitions(definitions: QuestDefinition[]): void {
    this.definitions.clear();
    for (const definition of definitions) {
      this.definitions.set(definition.definitionId, definition);
    }
  }

  setEventHandler(handler: QuestRuntimeEventHandler): void {
    this.onEvent = handler;
  }

  setStateChangeHandler(handler: () => void): void {
    this.onStateChange = handler;
  }

  setActionHandler(handler: QuestRuntimeActionHandler): void {
    this.onAction = handler;
  }

  setNarrativeHandler(handler: QuestRuntimeNarrativeHandler): void {
    this.onNarrative = handler;
  }

  update(): void {
    let changed = false;
    for (const state of this.activeQuests.values()) {
      changed = this.refreshQuest(state) || changed;
    }
    if (changed) {
      this.onStateChange?.();
    }
  }

  startQuest(questDefinitionId: string): boolean {
    if (this.activeQuests.has(questDefinitionId)) {
      return false;
    }

    const definition = this.definitions.get(questDefinitionId);
    if (!definition) {
      return false;
    }

    if (this.completedQuestIds.has(questDefinitionId) && !definition.repeatable) {
      return false;
    }

    const startStage =
      definition.stageDefinitions.find((stage) => stage.stageId === definition.startStageId) ??
      definition.stageDefinitions[0];
    if (!startStage) {
      return false;
    }

    const state: ActiveQuestRuntimeState = {
      questDefinitionId,
      currentStageId: startStage.stageId,
      stageProgress: new Map([[startStage.stageId, createStageProgress(startStage)]])
    };
    this.activeQuests.set(questDefinitionId, state);
    if (!this.trackedQuestDefinitionId) {
      this.trackedQuestDefinitionId = questDefinitionId;
    }

    this.emitEvent({
      type: "quest-start",
      questDefinitionId,
      displayName: definition.displayName
    });
    this.refreshQuest(state);
    this.onStateChange?.();
    return true;
  }

  isQuestActive(questDefinitionId: string): boolean {
    return this.activeQuests.has(questDefinitionId);
  }

  isQuestCompleted(questDefinitionId: string): boolean {
    return this.completedQuestIds.has(questDefinitionId);
  }

  getQuestStageState(
    questDefinitionId: string,
    stageId: string
  ): QuestStageState | null {
    const active = this.activeQuests.get(questDefinitionId);
    if (active) {
      if (active.currentStageId === stageId) {
        return "active";
      }

      const stage = this.definitions
        .get(questDefinitionId)
        ?.stageDefinitions.find((candidate) => candidate.stageId === stageId);
      const progress = active.stageProgress.get(stageId);
      if (stage && progress && this.isStageComplete(stage, progress)) {
        return "completed";
      }
    }

    if (
      this.completedQuestIds.has(questDefinitionId) &&
      this.definitions
        .get(questDefinitionId)
        ?.stageDefinitions.some((stage) => stage.stageId === stageId)
    ) {
      return "completed";
    }

    return null;
  }

  hasFlag(key: string, value?: unknown): boolean {
    if (!this.runtimeFlags.has(key)) {
      return false;
    }
    if (arguments.length === 1) {
      return true;
    }
    return this.runtimeFlags.get(key) === value;
  }

  setFlag(key: string, value: unknown = true): void {
    this.runtimeFlags.set(key, value);
    this.update();
  }

  notifyEvent(eventName: string): void {
    let changed = false;
    for (const state of this.activeQuests.values()) {
      const stage = this.getCurrentStageDefinition(state);
      const stageProgress = this.getCurrentStageProgress(state);
      if (!stage || !stageProgress) continue;

      for (const node of stage.nodeDefinitions) {
        const progress = stageProgress.nodeProgress.get(node.nodeId);
        if (!progress || progress.status !== "active") continue;
        if (node.eventName !== eventName) continue;
        this.completeNode(state, stage, stageProgress, node);
        changed = true;
      }
    }

    if (changed) {
      this.update();
    }
  }

  getDialogueOverrideForNpc(npcDefinitionId: string): string | null {
    for (const state of this.activeQuests.values()) {
      const stage = this.getCurrentStageDefinition(state);
      const stageProgress = this.getCurrentStageProgress(state);
      if (!stage || !stageProgress) continue;

      for (const node of stage.nodeDefinitions) {
        const progress = stageProgress.nodeProgress.get(node.nodeId);
        if (!progress || progress.status !== "active") continue;
        if (!isTalkObjective(node)) continue;
        if (node.targetId !== npcDefinitionId) continue;
        if (!node.dialogueDefinitionId) continue;
        return node.dialogueDefinitionId;
      }
    }

    return null;
  }

  notifyDialogueFinished(
    dialogueDefinitionId: string,
    lastDialogueNodeId: string | null = null
  ): void {
    let changed = false;

    for (const state of this.activeQuests.values()) {
      const stage = this.getCurrentStageDefinition(state);
      const stageProgress = this.getCurrentStageProgress(state);
      if (!stage || !stageProgress) continue;

      for (const node of stage.nodeDefinitions) {
        const progress = stageProgress.nodeProgress.get(node.nodeId);
        if (!progress || progress.status !== "active") continue;

        if (isDialogueNarrative(node) && node.dialogueDefinitionId === dialogueDefinitionId) {
          this.completeNode(state, stage, stageProgress, node);
          changed = true;
          continue;
        }

        if (!isTalkObjective(node) || node.dialogueDefinitionId !== dialogueDefinitionId) {
          continue;
        }

        if (
          !node.completeOn ||
          node.completeOn === "dialogueEnd" ||
          node.completeOn === lastDialogueNodeId
        ) {
          this.completeNode(state, stage, stageProgress, node);
          changed = true;
        }
      }
    }

    if (changed) {
      this.update();
    }
  }

  setTrackedQuest(questDefinitionId: string | null): void {
    if (questDefinitionId && !this.activeQuests.has(questDefinitionId)) {
      return;
    }
    this.trackedQuestDefinitionId = questDefinitionId;
    this.onStateChange?.();
  }

  getTrackedQuest(): QuestTrackerView | null {
    const questDefinitionId =
      this.trackedQuestDefinitionId ?? Array.from(this.activeQuests.keys())[0] ?? null;
    if (!questDefinitionId) return null;
    const state = this.activeQuests.get(questDefinitionId);
    const definition = this.definitions.get(questDefinitionId);
    const stage = state ? this.getCurrentStageDefinition(state) : null;
    if (!state || !definition || !stage) return null;

    return {
      questDefinitionId,
      displayName: definition.displayName,
      stageDisplayName: stage.displayName,
      objectives: this.getActiveObjectivesForStage(
        definition.definitionId,
        stage,
        this.getCurrentStageProgress(state)
      ).filter((objective) => objective.showInHud)
    };
  }

  getJournalData(): {
    active: QuestJournalQuestView[];
    completed: QuestJournalQuestView[];
    trackedQuestDefinitionId: string | null;
  } {
    const active = Array.from(this.activeQuests.values())
      .map((state) => this.toJournalQuestView(state, false))
      .filter((quest): quest is QuestJournalQuestView => quest !== null);
    const completed = Array.from(this.completedQuestIds)
      .map<QuestJournalQuestView | null>((questDefinitionId) => {
        const definition = this.definitions.get(questDefinitionId);
        if (!definition) return null;
        const stage =
          definition.stageDefinitions.find((candidate) => candidate.stageId === definition.startStageId) ??
          definition.stageDefinitions[0];
        if (!stage) return null;
        return {
          questDefinitionId,
          displayName: definition.displayName,
          description: definition.description,
          stageDisplayName: stage.displayName,
          objectives: [] as QuestActiveObjectiveView[],
          repeatable: definition.repeatable,
          completed: true
        };
      })
      .filter((quest): quest is QuestJournalQuestView => quest !== null);

    return {
      active,
      completed,
      trackedQuestDefinitionId:
        this.trackedQuestDefinitionId ?? active[0]?.questDefinitionId ?? null
    };
  }

  private toJournalQuestView(
    state: ActiveQuestRuntimeState,
    completed: boolean
  ): QuestJournalQuestView | null {
    const definition = this.definitions.get(state.questDefinitionId);
    const stage = this.getCurrentStageDefinition(state);
    if (!definition || !stage) return null;

    return {
      questDefinitionId: definition.definitionId,
      displayName: definition.displayName,
      description: definition.description,
      stageDisplayName: stage.displayName,
      objectives: this.getActiveObjectivesForStage(
        definition.definitionId,
        stage,
        this.getCurrentStageProgress(state)
      ),
      repeatable: definition.repeatable,
      completed
    };
  }

  private getCurrentStageDefinition(
    state: ActiveQuestRuntimeState
  ): QuestStageDefinition | null {
    const definition = this.definitions.get(state.questDefinitionId);
    return (
      definition?.stageDefinitions.find((stage) => stage.stageId === state.currentStageId) ?? null
    );
  }

  private getCurrentStageProgress(
    state: ActiveQuestRuntimeState
  ): QuestStageProgress | null {
    return state.stageProgress.get(state.currentStageId) ?? null;
  }

  private getActiveObjectivesForStage(
    questDefinitionId: string,
    stage: QuestStageDefinition,
    stageProgress: QuestStageProgress | null
  ): QuestActiveObjectiveView[] {
    if (!stageProgress) return [];
    return stage.nodeDefinitions
      .filter((node) => {
        const progress = stageProgress.nodeProgress.get(node.nodeId);
        return progress?.status === "active";
      })
      .map((node) => ({
        questDefinitionId,
        stageId: stage.stageId,
        nodeId: node.nodeId,
        displayName: node.displayName,
        description: node.description,
        showInHud: node.showInHud,
        optional: node.optional ?? false
      }));
  }

  private refreshQuest(state: ActiveQuestRuntimeState): boolean {
    const stage = this.getCurrentStageDefinition(state);
    const stageProgress = this.getCurrentStageProgress(state);
    if (!stage || !stageProgress) {
      return false;
    }

    let changed = false;
    let loop = true;
    while (loop) {
      loop = false;
      for (const node of stage.nodeDefinitions) {
        const progress = stageProgress.nodeProgress.get(node.nodeId);
        if (!progress) continue;

        if (progress.status === "inactive" && this.canActivateNode(node, stage, stageProgress)) {
          this.activateNode(state, stage, stageProgress, node);
          changed = true;
          loop = true;
          continue;
        }

        if (progress.status === "active" && node.nodeBehavior === "condition") {
          if (node.condition && this.evaluateCondition(node.condition)) {
            this.completeNode(state, stage, stageProgress, node);
            changed = true;
            loop = true;
          }
          continue;
        }

        if (progress.status === "active" && node.nodeBehavior === "branch") {
          const passed = node.condition ? this.evaluateCondition(node.condition) : false;
          this.completeNode(state, stage, stageProgress, node, passed ? "pass" : "fail");
          if (!passed) {
            for (const failTargetNodeId of node.failTargetNodeIds) {
              stageProgress.forcedNodeIds.add(failTargetNodeId);
            }
          }
          changed = true;
          loop = true;
        }
      }
    }

    if (this.isStageComplete(stage, stageProgress)) {
      this.advanceQuestStage(state, stage);
      return true;
    }

    return changed;
  }

  private activateNode(
    state: ActiveQuestRuntimeState,
    stage: QuestStageDefinition,
    stageProgress: QuestStageProgress,
    node: QuestNodeDefinition
  ): void {
    const progress = stageProgress.nodeProgress.get(node.nodeId);
    if (!progress || progress.status !== "inactive") return;

    stageProgress.forcedNodeIds.delete(node.nodeId);
    progress.status = "active";
    this.executeActions(node.onEnterActions);

    if (node.nodeBehavior === "narrative") {
      if (isDialogueNarrative(node) && node.dialogueDefinitionId) {
        this.onNarrative?.(node);
      } else {
        this.completeNode(state, stage, stageProgress, node);
      }
      return;
    }

    if (node.nodeBehavior === "objective" && node.autoStart && node.eventName) {
      this.notifyEvent(node.eventName);
    }
  }

  private completeNode(
    state: ActiveQuestRuntimeState,
    stage: QuestStageDefinition,
    stageProgress: QuestStageProgress,
    node: QuestNodeDefinition,
    branchResult: "pass" | "fail" | null = null
  ): void {
    const progress = stageProgress.nodeProgress.get(node.nodeId);
    if (!progress || progress.status === "completed") return;

    progress.status = "completed";
    progress.branchResult = branchResult;
    this.executeActions(node.onCompleteActions);

    const definition = this.definitions.get(state.questDefinitionId);
    if (definition) {
      this.emitEvent({
        type: "objective-complete",
        questDefinitionId: definition.definitionId,
        displayName: definition.displayName,
        objectiveDisplayName: node.displayName
      });
    }
  }

  private canActivateNode(
    node: QuestNodeDefinition,
    stage: QuestStageDefinition,
    stageProgress: QuestStageProgress
  ): boolean {
    if (stageProgress.forcedNodeIds.has(node.nodeId)) {
      return true;
    }

    if (node.prerequisiteNodeIds.length === 0) {
      return true;
    }

    for (const prerequisiteNodeId of node.prerequisiteNodeIds) {
      const progress = stageProgress.nodeProgress.get(prerequisiteNodeId);
      if (!progress || progress.status !== "completed") {
        return false;
      }

      const prerequisiteNode = stage.nodeDefinitions.find(
        (candidate) => candidate.nodeId === prerequisiteNodeId
      );
      if (prerequisiteNode?.nodeBehavior === "branch" && progress.branchResult !== "pass") {
        return false;
      }
    }

    return true;
  }

  private isStageComplete(
    stage: QuestStageDefinition,
    stageProgress: QuestStageProgress
  ): boolean {
    for (const node of stage.nodeDefinitions) {
      if (!isRequiredNode(node)) {
        continue;
      }

      const progress = stageProgress.nodeProgress.get(node.nodeId);
      if (!progress) {
        return false;
      }

      if (progress.status === "completed") {
        continue;
      }

      if (progress.status === "active") {
        return false;
      }

      if (this.canActivateNode(node, stage, stageProgress)) {
        return false;
      }
    }

    return true;
  }

  private advanceQuestStage(
    state: ActiveQuestRuntimeState,
    stage: QuestStageDefinition
  ): void {
    const definition = this.definitions.get(state.questDefinitionId);
    if (!definition) return;

    if (!stage.nextStageId) {
      this.activeQuests.delete(state.questDefinitionId);
      this.completedQuestIds.add(state.questDefinitionId);
      if (this.trackedQuestDefinitionId === state.questDefinitionId) {
        this.trackedQuestDefinitionId = Array.from(this.activeQuests.keys())[0] ?? null;
      }
      this.emitEvent({
        type: "quest-complete",
        questDefinitionId: definition.definitionId,
        displayName: definition.displayName
      });
      return;
    }

    const nextStage = definition.stageDefinitions.find(
      (candidate) => candidate.stageId === stage.nextStageId
    );
    if (!nextStage) {
      this.activeQuests.delete(state.questDefinitionId);
      this.completedQuestIds.add(state.questDefinitionId);
      return;
    }

    state.currentStageId = nextStage.stageId;
    if (!state.stageProgress.has(nextStage.stageId)) {
      state.stageProgress.set(nextStage.stageId, createStageProgress(nextStage));
    }

    this.emitEvent({
      type: "stage-advance",
      questDefinitionId: definition.definitionId,
      displayName: definition.displayName,
      stageDisplayName: nextStage.displayName
    });
    this.refreshQuest(state);
  }

  private executeActions(actions: QuestActionDefinition[]): void {
    for (const action of actions) {
      if (action.type === "setFlag" && action.targetId) {
        this.runtimeFlags.set(action.targetId, action.value ?? true);
        continue;
      }

      if (action.type === "emitEvent" && action.targetId) {
        this.notifyEvent(action.targetId);
        continue;
      }

      this.onAction?.(action);
    }
  }

  private evaluateCondition(condition: QuestConditionDefinition): boolean {
    switch (condition.type) {
      case "hasFlag":
        return this.hasFlag(condition.key, condition.value);
      case "questActive":
        return this.isQuestActive(condition.questDefinitionId);
      case "questCompleted":
        return this.isQuestCompleted(condition.questDefinitionId);
      case "questStage":
        return (
          this.getQuestStageState(condition.questDefinitionId, condition.stageId) ===
          condition.state
        );
      case "not":
        return !this.evaluateCondition(condition.condition);
      default:
        return false;
    }
  }

  private emitEvent(event: QuestRuntimeEvent): void {
    this.onEvent?.(event);
    this.onStateChange?.();
  }
}
