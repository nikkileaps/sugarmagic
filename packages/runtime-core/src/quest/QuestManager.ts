import type {
  QuestActionDefinition,
  QuestConditionDefinition,
  QuestDefinition,
  QuestNodeDefinition,
  QuestStageDefinition,
  TimeOfDayBand,
  QuestStageState,
  SaveSlice
} from "@sugarmagic/domain";
import type { WorldFlagManager } from "../world-flags/WorldFlagManager";
import { coerceAuthoredWorldFlagValue } from "../world-flags/WorldFlagManager";

/**
 * An action together with the node that fired it. Handlers need the source to
 * name what they act on -- an audio instance key, a warning that tells the
 * author which node holds the bad reference.
 *
 * The ids are passed rather than read back from the manager because the only
 * quest state readable from outside is the tracked quest, which is not
 * necessarily the quest whose node is running.
 */
export interface QuestActionInvocation {
  action: QuestActionDefinition;
  questDefinitionId: string;
  stageId: string;
  nodeId: string;
}

export interface QuestRuntimeActionHandler {
  (invocation: QuestActionInvocation): void;
}

export interface QuestRuntimeNarrativeHandler {
  (node: QuestNodeDefinition): void;
}

export type QuestInventoryCountProvider = (itemDefinitionId: string) => number;
export type QuestSpellStateProvider = (spellDefinitionId: string) => boolean;
/**
 * Whether the player is standing in that area, or in any area nested inside
 * it. Injected rather than read here: the player's position lives in the
 * blackboard, which `quest/` must not reach into.
 */
export type QuestPlayerAreaProvider = (areaId: string) => boolean;

export interface QuestActiveObjectiveView {
  questDefinitionId: string;
  stageId: string;
  nodeId: string;
  displayName: string;
  description: string;
  objectiveSubtype?: string;
  targetId?: string;
  showInHud: boolean;
  optional: boolean;
}

export interface QuestTrackerView {
  questDefinitionId: string;
  displayName: string;
  stageId: string;
  stageDisplayName: string;
  objectives: QuestActiveObjectiveView[];
}

export interface QuestJournalQuestView {
  questDefinitionId: string;
  displayName: string;
  description: string;
  stageDisplayName: string;
  objectives: QuestActiveObjectiveView[];
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
  /**
   * Which nodes have been completed, per quest. Recorded at completion time
   * and kept outside `activeQuests`, which is deleted when a quest finishes --
   * so "this node was completed" outlives the quest that produced it.
   *
   * Never cleared. Nothing restarts a quest, so a completed node stays
   * completed for the rest of the playthrough.
   */
  private completedNodeIdsByQuest = new Map<string, Set<string>>();
  private trackedQuestDefinitionId: string | null = null;
  private onEvent: QuestRuntimeEventHandler | null = null;
  private onStateChange: (() => void) | null = null;
  private onAction: QuestRuntimeActionHandler | null = null;
  private onStageTimeOfDay: ((band: TimeOfDayBand) => void) | null = null;
  private onNarrative: QuestRuntimeNarrativeHandler | null = null;
  private getInventoryCount: QuestInventoryCountProvider = () => 0;
  private hasSpellProvider: QuestSpellStateProvider = () => false;
  private canCastSpellProvider: QuestSpellStateProvider = () => false;
  private isPlayerInAreaProvider: QuestPlayerAreaProvider = () => false;
  /**
   * The project's world flags. Not owned here -- quests are one of six callers
   * -- but a quest condition reads them and a quest action writes them.
   */
  private worldFlags: WorldFlagManager | null = null;

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

  /** Wired to worldTimeStore.setTimeBand; see applyStageTimeOfDay. */
  setStageTimeOfDayHandler(handler: (band: TimeOfDayBand) => void): void {
    this.onStageTimeOfDay = handler;
  }

  setNarrativeHandler(handler: QuestRuntimeNarrativeHandler): void {
    this.onNarrative = handler;
  }

  setInventoryCountProvider(provider: QuestInventoryCountProvider): void {
    this.getInventoryCount = provider;
  }

  setHasSpellProvider(provider: QuestSpellStateProvider): void {
    this.hasSpellProvider = provider;
  }

  setCanCastSpellProvider(provider: QuestSpellStateProvider): void {
    this.canCastSpellProvider = provider;
  }

  setPlayerAreaProvider(provider: QuestPlayerAreaProvider): void {
    this.isPlayerInAreaProvider = provider;
  }

  setWorldFlagManager(manager: WorldFlagManager): void {
    this.worldFlags = manager;
  }

  update(): void {
    let changed = false;
    // Settles rather than making one pass: finishing a quest can satisfy
    // another's start condition, and starting one can satisfy a third's.
    // Nothing ever un-starts or un-finishes a quest, so one pass per
    // quest plus one is always enough to reach the end of a chain.
    const passLimit = this.definitions.size + 1;
    for (let pass = 0; pass < passLimit; pass += 1) {
      let passChanged = false;
      for (const state of this.activeQuests.values()) {
        passChanged = this.refreshQuest(state) || passChanged;
      }
      passChanged = this.startQualifyingQuests() || passChanged;
      if (!passChanged) {
        break;
      }
      changed = true;
    }
    if (changed) {
      this.onStateChange?.();
    }
  }

  /**
   * Start every quest that is neither running nor finished and whose
   * start condition holds. No start condition means it qualifies right
   * away, which is what every quest did before conditions existed.
   *
   * Deliberately NOT called from `registerDefinitions`: a restored save
   * loads its finished and active quests after registration, so a check
   * there would judge conditions against empty state and start quests the
   * player is already past.
   */
  private startQualifyingQuests(): boolean {
    let started = false;
    for (const [definitionId, definition] of this.definitions) {
      if (this.activeQuests.has(definitionId)) continue;
      if (this.completedQuestIds.has(definitionId)) continue;
      if (
        definition.startCondition &&
        !this.evaluateCondition(definition.startCondition)
      ) {
        continue;
      }
      started = this.startQuest(definitionId) || started;
    }
    return started;
  }

  /**
   * Start this quest now. A start condition is not consulted: it says
   * when the quest starts ON ITS OWN, and a caller reaching this method
   * has already decided. `startQualifyingQuests` is the one place that
   * reads the condition.
   */
  startQuest(questDefinitionId: string): boolean {
    if (this.activeQuests.has(questDefinitionId)) {
      return false;
    }

    const definition = this.definitions.get(questDefinitionId);
    if (!definition) {
      return false;
    }

    // A finished quest stays finished. Nothing restarts one.
    if (this.completedQuestIds.has(questDefinitionId)) {
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
    this.applyStageTimeOfDay(startStage);
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

  notifySpellCast(spellDefinitionId: string): void {
    let changed = false;

    for (const state of this.activeQuests.values()) {
      const stage = this.getCurrentStageDefinition(state);
      const stageProgress = this.getCurrentStageProgress(state);
      if (!stage || !stageProgress) continue;

      for (const node of stage.nodeDefinitions) {
        const progress = stageProgress.nodeProgress.get(node.nodeId);
        if (!progress || progress.status !== "active") continue;
        if (node.nodeBehavior !== "objective" || node.objectiveSubtype !== "castSpell") continue;
        if (node.targetId !== spellDefinitionId) continue;
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

  // Intentionally NO showInHud filter here. showInHud controls HUD display
  // only -- it has nothing to do with whether an objective is relevant to NPC
  // context or the blackboard. getTrackedQuest() (below) filters by showInHud
  // for the player-facing HUD tracker. This method is the NPC/blackboard path
  // and must return ALL active objectives regardless of display preference.
  // Filtering here was the original bug: quest-context middleware silently
  // received empty objectives and skipped the vector search entirely.
  getActiveObjectivesForTrackedQuest(): QuestActiveObjectiveView[] {
    const questDefinitionId =
      this.trackedQuestDefinitionId ?? Array.from(this.activeQuests.keys())[0] ?? null;
    if (!questDefinitionId) return [];
    const state = this.activeQuests.get(questDefinitionId);
    const definition = this.definitions.get(questDefinitionId);
    const stage = state ? this.getCurrentStageDefinition(state) : null;
    if (!state || !definition || !stage) return [];
    return this.getActiveObjectivesForStage(
      definition.definitionId,
      stage,
      this.getCurrentStageProgress(state)
    );
  }

  private recordCompletedNode(questDefinitionId: string, nodeId: string): void {
    let completed = this.completedNodeIdsByQuest.get(questDefinitionId);
    if (!completed) {
      completed = new Set<string>();
      this.completedNodeIdsByQuest.set(questDefinitionId, completed);
    }
    completed.add(nodeId);
  }

  /**
   * True when this node has been completed at any point in this playthrough,
   * including after its quest finished.
   */
  isNodeCompleted(questDefinitionId: string, nodeId: string): boolean {
    return this.completedNodeIdsByQuest.get(questDefinitionId)?.has(nodeId) ?? false;
  }

  /**
   * True while this node is the one being worked on: its prerequisites are
   * met and it has not been completed. False before it opens and false again
   * once it is done.
   */
  isNodeActive(questDefinitionId: string, nodeId: string): boolean {
    const state = this.activeQuests.get(questDefinitionId);
    if (!state) {
      return false;
    }
    for (const stageProgress of state.stageProgress.values()) {
      const progress = stageProgress.nodeProgress.get(nodeId);
      if (progress) {
        return progress.status === "active";
      }
    }
    return false;
  }

  /**
   * True once every node this stage needs has been completed, and from then
   * on -- including after the whole quest has finished.
   */
  isStageCompleted(questDefinitionId: string, stageId: string): boolean {
    return this.getQuestStageState(questDefinitionId, stageId) === "completed";
  }

  /**
   * Every quest in progress, with the stage it is on.
   *
   * This is what region quest bindings evaluate against -- which NPCs stand
   * where, which doors are passable. `getTrackedQuest()` below is the player's
   * journal selection and answers a different question.
   *
   * A quest whose current stage cannot be resolved still appears, with a null
   * stage, so a binding naming only the quest still matches it.
   */
  getActiveQuestStates(): Array<{
    questDefinitionId: string;
    stageId: string | null;
  }> {
    return Array.from(this.activeQuests.entries()).map(([questDefinitionId, state]) => ({
      questDefinitionId,
      stageId: this.getCurrentStageDefinition(state)?.stageId ?? null
    }));
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
      stageId: stage.stageId,
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
        objectiveSubtype: node.objectiveSubtype,
        targetId: node.targetId,
        showInHud: node.showInHud,
        optional: node.optional ?? false
      }));
  }

  /**
   * `visitedStageIds` carries the stages this pass has already advanced through,
   * because a stage with no nodes is complete the moment it starts: two such
   * stages naming each other as `nextStageId` would advance back and forth until
   * the stack ran out. Advancing through several finished stages in one pass is
   * legitimate, so the stop condition is re-entering a stage, not a step count.
   */
  private refreshQuest(
    state: ActiveQuestRuntimeState,
    visitedStageIds: Set<string> = new Set()
  ): boolean {
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

        if (
          progress.status === "active" &&
          node.nodeBehavior === "objective" &&
          node.objectiveSubtype === "collect" &&
          node.targetId
        ) {
          const targetCount = Math.max(1, node.count ?? 1);
          if (this.getInventoryCount(node.targetId) >= targetCount) {
            this.completeNode(state, stage, stageProgress, node);
            changed = true;
            loop = true;
          }
        }

        if (
          progress.status === "active" &&
          node.nodeBehavior === "objective" &&
          node.objectiveSubtype === "location" &&
          node.targetAreaId
        ) {
          // Read inside the tick: the player's area is a frame-lifecycle fact,
          // so it is only meaningful while the frame it was written for is the
          // current one.
          if (this.isPlayerInAreaProvider(node.targetAreaId)) {
            this.completeNode(state, stage, stageProgress, node);
            changed = true;
            loop = true;
          }
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
      if (visitedStageIds.has(stage.stageId)) {
        // The stages loop. Park the quest here rather than advancing forever;
        // the author sees it as a warning in the quest editor.
        console.warn(
          `[quest] Quest "${state.questDefinitionId}" advanced back into stage "${stage.stageId}" without progressing. Stopping here; check the stage's Next Stage for a loop.`
        );
        return changed;
      }
      visitedStageIds.add(stage.stageId);
      this.advanceQuestStage(state, stage, visitedStageIds);
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
    this.executeActions(node.onEnterActions, {
      questDefinitionId: state.questDefinitionId,
      stageId: stage.stageId,
      nodeId: node.nodeId
    });

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
    this.recordCompletedNode(state.questDefinitionId, node.nodeId);
    this.executeActions(node.onCompleteActions, {
      questDefinitionId: state.questDefinitionId,
      stageId: stage.stageId,
      nodeId: node.nodeId
    });

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
    stage: QuestStageDefinition,
    visitedStageIds: Set<string> = new Set()
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

    this.applyStageTimeOfDay(nextStage);
    this.emitEvent({
      type: "stage-advance",
      questDefinitionId: definition.definitionId,
      displayName: definition.displayName,
      stageDisplayName: nextStage.displayName
    });
    this.refreshQuest(state, visitedStageIds);
  }

  /**
   * Sets the world clock to the stage's time of day, if it declares one.
   *
   * A stage is a scene at a time -- "the dock, late afternoon" -- so the time
   * rides the stage rather than an action on whichever node happens to run
   * first. Re-entering a stage re-asserts its time; a stage with no time
   * leaves the clock wherever it was.
   */
  private applyStageTimeOfDay(stage: QuestStageDefinition): void {
    if (!stage.timeOfDay) return;
    this.onStageTimeOfDay?.(stage.timeOfDay);
  }

  /**
   * `source` is taken as an argument, not held on the manager, because this
   * runs reentrantly: an `emitEvent` action calls `notifyEvent`, which can
   * complete another node, which runs its own actions before this loop ends.
   */
  private executeActions(
    actions: QuestActionDefinition[],
    source: { questDefinitionId: string; stageId: string; nodeId: string }
  ): void {
    for (const action of actions) {
      if (action.type === "setFlag" && action.worldFlagId) {
        // The write that does not notify: this runs reentrantly inside
        // refreshQuest, and a change notification would refresh again.
        this.worldFlags?.setFlagByIdWithoutNotifying(
          action.worldFlagId,
          coerceAuthoredWorldFlagValue(action.value ?? true)
        );
        continue;
      }

      if (action.type === "emitEvent" && action.eventName) {
        this.notifyEvent(action.eventName);
        continue;
      }

      this.onAction?.({ action, ...source });
    }
  }

  private evaluateCondition(condition: QuestConditionDefinition): boolean {
    switch (condition.type) {
      case "hasFlag":
        return (
          this.worldFlags?.hasFlagById(
            condition.worldFlagId,
            coerceAuthoredWorldFlagValue(condition.value ?? true)
          ) ?? false
        );
      case "hasSpell":
        return this.hasSpellProvider(condition.spellDefinitionId);
      case "canCastSpell":
        return this.canCastSpellProvider(condition.spellDefinitionId);
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

  // ---- Plan 055 §055.4 — save participation ---------------------------

  /**
   * Capture live quest-manager state into a serialize-safe slice.
   * Maps/Sets flatten to Records/arrays so the payload survives
   * JSON round-trip through any GameSaveStore backend.
   */
  serializeSaveSlice(): QuestManagerSlice {
    const activeQuests: Record<string, SerializedActiveQuest> = {};
    for (const [questId, state] of this.activeQuests) {
      const stageProgress: Record<string, SerializedQuestStageProgress> = {};
      for (const [stageId, progress] of state.stageProgress) {
        const nodeProgress: Record<string, SerializedQuestNodeProgress> = {};
        for (const [nodeId, node] of progress.nodeProgress) {
          nodeProgress[nodeId] = {
            nodeId: node.nodeId,
            status: node.status,
            branchResult: node.branchResult
          };
        }
        stageProgress[stageId] = {
          stageId: progress.stageId,
          nodeProgress,
          forcedNodeIds: Array.from(progress.forcedNodeIds)
        };
      }
      activeQuests[questId] = {
        questDefinitionId: state.questDefinitionId,
        currentStageId: state.currentStageId,
        stageProgress
      };
    }
    const completedNodeIds: Record<string, string[]> = {};
    for (const [questId, nodeIds] of this.completedNodeIdsByQuest) {
      completedNodeIds[questId] = Array.from(nodeIds);
    }
    return {
      activeQuests,
      completedQuestIds: Array.from(this.completedQuestIds),
      completedNodeIds,
      trackedQuestDefinitionId: this.trackedQuestDefinitionId
    };
  }

  /**
   * Restore quest-manager state from a persisted slice.
   *
   * Called by the `quest.manager` SaveParticipant during
   * host.start's Phase 2 deserialize — AFTER definitions are
   * loaded (`registerDefinitions`) but BEFORE `startInitialQuests`
   * runs. That ordering matters: `startInitialQuests` short-
   * circuits on quests already in `activeQuests` or
   * `completedQuestIds`, so this call populates the "you've
   * touched these" set first and leaves fresh initial quest state
   * for definitions the save didn't know about (new quests added
   * to the project after the save was written).
   *
   * Merge semantics for `activeQuests`: only quests present in
   * the slice AND still known to `definitions` are restored; the
   * rest of the map is untouched. Quests referenced by the slice
   * whose definition can't be found are dropped with a
   * console.warn (usually authoring renamed the id after the save
   * was written).
   *
   * `completedQuestIds`, `completedNodeIds` and
   * `trackedQuestDefinitionId` fully replace
   * whatever's currently there — they're single-value stores, not
   * composed. Replacing is safe for `completedNodeIds` because
   * this runs before `startInitialQuests`, so nothing has
   * recorded a completion yet. A save written before the field
   * existed has none, and restores as empty.
   *
   * `null` slice = fresh player. Nothing to restore.
   */
  deserializeSaveSlice(
    slice: SaveSlice<QuestManagerSlice> | null
  ): void {
    if (!slice) return;
    const data = slice.data;

    for (const [questId, saved] of Object.entries(data.activeQuests ?? {})) {
      const definition = this.definitions.get(questId);
      if (!definition) {
        console.warn(
          `[quest] restore: dropping active quest "${questId}" — no matching definition.`
        );
        continue;
      }
      const stageProgress = new Map<string, QuestStageProgress>();
      for (const [stageId, savedStage] of Object.entries(saved.stageProgress ?? {})) {
        const nodeProgressMap = new Map<string, QuestNodeProgress>();
        for (const [nodeId, savedNode] of Object.entries(savedStage.nodeProgress ?? {})) {
          nodeProgressMap.set(nodeId, {
            nodeId: savedNode.nodeId,
            status: savedNode.status,
            branchResult: savedNode.branchResult
          });
        }
        stageProgress.set(stageId, {
          stageId: savedStage.stageId,
          nodeProgress: nodeProgressMap,
          forcedNodeIds: new Set(savedStage.forcedNodeIds ?? [])
        });
      }
      this.activeQuests.set(questId, {
        questDefinitionId: saved.questDefinitionId,
        currentStageId: saved.currentStageId,
        stageProgress
      });
    }

    this.completedQuestIds = new Set(data.completedQuestIds ?? []);
    this.completedNodeIdsByQuest = new Map(
      Object.entries(data.completedNodeIds ?? {}).map(([questId, nodeIds]) => [
        questId,
        new Set(nodeIds)
      ])
    );
    if (data.trackedQuestDefinitionId !== undefined) {
      this.trackedQuestDefinitionId = data.trackedQuestDefinitionId;
    }

    // Restore IS a state change — fire the same notification
    // `startQuest`/`completeNode` do so every derived consumer
    // (NPC interactable availability, quest tracker, blackboard
    // quest facts, interaction prompt) resyncs against the
    // restored state. Without this, a restored save whose quests
    // short-circuit `startInitialQuests` leaves those consumers
    // frozen at their pre-deserialize (empty-quest-state) values —
    // the "NPC talk prompt gone after Continue" bug (2026-07-05).
    // Deliberately NOT emitEvent: notifications ("Quest started")
    // must not re-toast on load; onStateChange is the silent sync
    // channel.
    this.onStateChange?.();
  }
}

// ---- Plan 055 §055.4 — persisted slice shape (wire format) ----------

/**
 * Serialize-safe shape of `QuestNodeProgress`. Same fields — the
 * type re-declared here so the wire type isn't tied to the
 * internal one, and future internal renames don't silently break
 * old saves.
 */
export interface SerializedQuestNodeProgress {
  nodeId: string;
  status: "inactive" | "active" | "completed";
  branchResult: "pass" | "fail" | null;
}

/**
 * Serialize-safe shape of `QuestStageProgress`. `Set<string>` on
 * the internal side flattens to `string[]` here so JSON survives.
 */
export interface SerializedQuestStageProgress {
  stageId: string;
  nodeProgress: Record<string, SerializedQuestNodeProgress>;
  forcedNodeIds: string[];
}

/**
 * Serialize-safe shape of `ActiveQuestRuntimeState`.
 * `Map<string, QuestStageProgress>` -> `Record<...>`.
 */
export interface SerializedActiveQuest {
  questDefinitionId: string;
  currentStageId: string;
  stageProgress: Record<string, SerializedQuestStageProgress>;
}

/**
 * The persisted slice the `quest.manager` SaveParticipant hands
 * to and receives from the save store.
 *
 * Design notes:
 *   - `activeQuests` keyed by questDefinitionId, values contain
 *     the full stage/node progress tree.
 *   - `completedQuestIds` a plain array; converted to a Set on
 *     restore.
 *
 * Legacy pre-055 saves reach `deserializeSaveSlice` with only
 * `trackedQuestDefinitionId` populated (synthesized by
 * `upgradeLegacyPayload`) — the other fields default via `??`
 * to their empty forms.
 */
export interface QuestManagerSlice {
  activeQuests: Record<string, SerializedActiveQuest>;
  completedQuestIds: string[];
  /** Completed node ids per quest. Absent in saves written before it existed. */
  completedNodeIds?: Record<string, string[]>;
  trackedQuestDefinitionId: string | null;
}
