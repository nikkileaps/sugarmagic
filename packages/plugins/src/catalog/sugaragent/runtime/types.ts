import type {
  ConversationActionProposal,
  ConversationSelectionContext,
  ConversationTurnEnvelope
} from "@sugarmagic/runtime-core";

export type TurnStageStatus = "ok" | "degraded" | "failed";

export interface TurnStageDiagnostics {
  stageId: string;
  status: TurnStageStatus;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  payload: Record<string, unknown>;
  fallbackReason?: string | null;
}

export interface TurnStageContext {
  readonly turnId: string;
  readonly sessionId: string;
  readonly pluginId: string;
  readonly selection: ConversationSelectionContext;
  readonly config: SugarAgentPluginConfig;
  logStageStart: (stageId: string, payload: Record<string, unknown>) => void;
  logStageEnd: (diagnostics: TurnStageDiagnostics) => void;
}

export interface TurnStage<TInput, TOutput> {
  readonly stageId: string;
  execute(
    input: TInput,
    context: TurnStageContext
  ): Promise<TurnStageResult<TOutput>>;
}

export interface TurnStageResult<TOutput> {
  output: TOutput;
  diagnostics: TurnStageDiagnostics;
  status: TurnStageStatus;
}

export interface SugarAgentPluginConfig {
  proxyBaseUrl: string;
  loreSourceKind: "local" | "github";
  loreLocalPath: string;
  loreRepositoryUrl: string;
  loreRepositoryRef: string;
  anthropicApiKey: string;
  anthropicModel: string;
  openAiApiKey: string;
  openAiEmbeddingModel: string;
  openAiVectorStoreId: string;
  maxEvidenceResults: number;
  debugLogging: boolean;
}

export interface SugarAgentSessionHistoryEntry {
  role: "user" | "assistant";
  text: string;
}

export interface SugarAgentProviderState {
  sessionId: string;
  turnCount: number;
  consecutiveFallbackTurns: number;
  closeRequested: boolean;
  history: SugarAgentSessionHistoryEntry[];
  topicCoverage: string[];
  referents: string[];
  lastTurnDiagnostics: Record<string, TurnStageDiagnostics>;
}

export type TurnIntent =
  | "social_chat"
  | "session_recall"
  | "identity_self"
  | "lore_world"
  | "lore_other"
  | "mixed_knowledge"
  | "quest_guidance"
  | "farewell"
  | "unclear";

export type QueryLane = "social" | "knowledge" | "memory";
export type QueryTarget = "self" | "world" | "other" | "mixed" | "unknown";
export type QueryFacet =
  | "identity"
  | "occupation"
  | "current_activity"
  | "location"
  | "background"
  | "preference"
  | "relationship"
  | "general_lore"
  | "unknown";
export type QueryTimeframe = "current" | "habitual" | "past" | "future" | "unknown";
export type QueryType =
  | "conversation"
  | "self_query"
  | "other_query"
  | "world_query"
  | "mixed_query"
  | "quest_query";
export type TurnPath = "social_fast" | "grounded";
export type ReferentKind = "npc" | "location" | "faction" | "object" | "topic" | "unknown";
export type PendingExpectationKind =
  | "none"
  | "answer_name"
  | "answer_question"
  | "confirm"
  | "clarify";
export type SocialMove =
  | "none"
  | "greeting"
  | "introduction"
  | "acknowledgement"
  | "smalltalk"
  | "farewell";

export interface ResolvedPrimaryReferent {
  text: string;
  id?: string;
  kind: ReferentKind;
  confidence: number;
}

export interface TurnInterpretation {
  intent: TurnIntent;
  lane: QueryLane;
  target: QueryTarget;
  facet: QueryFacet;
  timeframe: QueryTimeframe;
  socialMove: SocialMove;
  declaredIdentityName: string | null;
  focusText: string;
  confidence: number;
  margin: number;
  ambiguous: boolean;
  primaryReferent?: ResolvedPrimaryReferent;
}

export interface TurnRoutingDecision {
  path: TurnPath;
  socialFastPathEligible: boolean;
  factualRiskSignals: string[];
  semanticSocialProtected?: boolean;
  heuristicFallbackUsed?: boolean;
  heuristicFallbackReason?: string;
  suppressedRiskSignals?: string[];
}

export interface PendingExpectation {
  kind: PendingExpectationKind;
  sourceTurnId?: string;
}

export interface PlanNoveltyState {
  repeatedUserMessage: boolean;
  repeatedAssistantReplyRisk: boolean;
  exhausted: boolean;
  recentAssistantQuestionCount: number;
}

export interface InterpretResult {
  userText: string | null;
  queryType: QueryType;
  interpretation: TurnInterpretation;
  turnRouting: TurnRoutingDecision;
  pendingExpectation: PendingExpectation;
  searchQuery: string;
  shouldCloseAfterReply: boolean;
}

export interface RetrievedEvidenceItem {
  fileId: string;
  filename: string;
  score: number;
  text: string;
  attributes: Record<string, unknown>;
}

export interface RetrieveResult {
  evidencePack: RetrievedEvidenceItem[];
  usedEmbeddings: boolean;
  vectorSearchPerformed: boolean;
  semanticQueryFingerprint: number[] | null;
}

export interface PlanResult {
  responseIntent:
    | "greet"
    | "chat"
    | "answer"
    | "redirect"
    | "goodbye"
    | "clarify"
    | "abstain";
  responseGoal: string;
  responseSpecificity: "grounded" | "generic-only";
  turnPath: TurnPath;
  initiativeAction:
    | "npc_initiate"
    | "player_respond"
    | "clarify"
    | "abstain"
    | "close";
  noveltyState: PlanNoveltyState;
  claims: string[];
  actionProposals: ConversationActionProposal[];
  replyInputMode: ConversationTurnEnvelope["inputMode"];
  replyPlaceholder: string;
}

export interface GenerateResult {
  text: string;
  usedLlm: boolean;
  llmBackend: "anthropic" | "deterministic";
  actionProposals: ConversationActionProposal[];
}

export interface AuditResult {
  passed: boolean;
  violations: string[];
}

export interface RepairResult {
  text: string;
  actionProposals: ConversationActionProposal[];
  llmBackend: GenerateResult["llmBackend"];
  repaired: boolean;
}
