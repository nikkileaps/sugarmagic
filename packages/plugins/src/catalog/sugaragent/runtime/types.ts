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
  /**
   * Story 46.14 — REQUIRED. Browser-side SugarAgent always routes
   * through a proxy (the local SugarDeploy gateway in dev, reached via
   * repo-root .env VITE_SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL; the
   * deployed Cloud Run gateway in published-web). Third-party API keys
   * (Anthropic / OpenAI) NEVER live in browser code; the proxy
   * terminates the LLM calls server-side using keys from the local
   * `.env` (Studio) or Secret Manager (Cloud Run).
   */
  proxyBaseUrl: string;
  /**
   * Story 46.14 — when the gateway runs in `bearer` auth mode (the
   * 45.5.8 default), every non-`/health` request must carry
   * `Authorization: Bearer <token>`. Empty string = the gateway is
   * in `none` auth mode (public) and no header is sent. Sourced
   * from `SUGARMAGIC_GATEWAY_BEARER_TOKEN` at build time (which
   * Studio reads from `VITE_SUGARMAGIC_GATEWAY_BEARER_TOKEN` and
   * the GHA `deploy-frontend` job's "Resolve gateway bearer
   * token" step resolves via `gcloud secrets versions access`).
   */
  gatewayBearerToken: string;
  loreSourceKind: "local" | "github";
  loreLocalPath: string;
  loreRepositoryUrl: string;
  loreRepositoryRef: string;
  /**
   * Story 46.15 — per-game gateway runtime config. Empty string
   * means "let the gateway's own default take over." Surfaces in
   * SugarAgent's Studio settings panel; propagates to Cloud Run
   * at deploy time via the `gatewayRuntimeConfigKeys` plugin
   * declaration -> deploy.sh `--set-env-vars` chain.
   */
  openAiVectorStoreId: string;
  /** Model the gateway uses for NPC dialogue turns (empty = gateway
   *  default). Deployed as the gateway env default; the browser sends
   *  an empty model for dialogue and the gateway fills it in. */
  anthropicModel: string;
  /**
   * Plan 073.2 — model for the cheap end-of-conversation memory summary (a
   * background task, deliberately smaller/cheaper than the dialogue model).
   * Resolved SERVER-SIDE, same as `anthropicModel`: the browser sends
   * `purpose:"summary"` and an empty model id, and the gateway reads the model
   * from `SUGARMAGIC_SUGARAGENT_SUMMARY_MODEL` (deployed from this value via
   * gatewayRuntimeConfigKeys). Empty => gateway default `claude-haiku-4-5`.
   */
  anthropicSummaryModel: string;
  maxEvidenceResults: number;
  /**
   * Plan 072.6 — per-evidence-item character budget forwarded to the prompt.
   * Replaces the old hard 180-char truncation; the wiki's richness must reach
   * the model. Total evidence budget is bounded by maxEvidenceResults x this.
   */
  maxEvidenceCharsPerItem: number;
  /**
   * Plan 073.5 — master switch for NPC memory (persistence + recall). When
   * false, the memory middleware and the end-of-conversation summarizer are
   * no-ops: NPCs neither write nor read memory.
   */
  memoryEnabled: boolean;
  /**
   * Plan 073.5 — hard cap on the memory digest injected into the cached system
   * prefix. Keeps the prompt (and its cache write) bounded per conversation.
   */
  memoryDigestMaxChars: number;
  debugLogging: boolean;
  /** Overall tone for NPC dialogue (e.g. "cozy", "gritty", "whimsical"). */
  tone: string;
}

export interface SugarAgentSessionHistoryEntry {
  role: "user" | "assistant";
  text: string;
}

/**
 * Plan 072.3 -- a designated section of the NPC's lore page, ready for the
 * prompt. `## Secrets` is already excluded upstream (072.2 lore/resolve), so a
 * loaded persona never carries secret content.
 */
export interface LoreCardSection {
  heading: string;
  slug: string;
  content: string;
}

/**
 * Plan 072.3 -- the NPC's persona/core knowledge loaded ONCE at session start
 * from lore/resolve and held in session state for the prompt builder (072.4).
 * Missing/unfetchable page degrades (D3): `loaded: false`, empty layers, a
 * `fallbackReason` -- the conversation still runs on name + game tone.
 */
export interface LoadedPersona {
  /** Requested page id; null when the NPC has no lorePageId. */
  pageId: string | null;
  /** true when the page resolved and was designated; false = degraded. */
  loaded: boolean;
  /** "persona-unavailable" when degraded, else null. */
  fallbackReason: string | null;
  /** `## Persona` + `## Voice`, in document order. */
  personaCard: LoreCardSection[];
  /** Everything else on the page (implicit Overview + other sections). */
  coreKnowledge: LoreCardSection[];
  /**
   * Plan 072.8 — a compact persona reminder (first lines of `## Persona` +
   * `## Voice`), computed once at session start, re-injected at the END of the
   * user message each turn to fight ~8-turn character drift. Empty when
   * degraded or no persona sections authored.
   */
  digest: string;
}

export interface SugarAgentProviderState {
  sessionId: string;
  turnCount: number;
  consecutiveFallbackTurns: number;
  closeRequested: boolean;
  history: SugarAgentSessionHistoryEntry[];
  lastTurnDiagnostics: Record<string, TurnStageDiagnostics>;
  /** Plan 072.3 -- loaded once at session start; undefined until then. */
  persona?: LoadedPersona;
  /**
   * Plan 073.2 -- a fuller conversation transcript for end-of-session
   * memory summarization. `history` is capped at 12 for the prompt's
   * recent-turns window; the summarizer wants earlier exchanges too
   * (e.g. the player's introduction), so this accumulates a higher-
   * bounded copy. Session-scoped, never enters the prompt.
   */
  transcript?: SugarAgentSessionHistoryEntry[];
}

export type TurnIntent =
  | "social_chat"
  | "session_recall"
  | "identity_self"
  | "lore_world"
  | "lore_other"
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
export type ContextAnchor = "none" | "current_location";

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
  contextAnchor: ContextAnchor;
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
  vectorSearchPerformed: boolean;
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
  envelopeOverride?: ConversationTurnEnvelope;
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
