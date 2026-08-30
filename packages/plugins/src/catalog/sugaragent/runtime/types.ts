import type {
  ConversationActionProposal,
  ConversationSelectionContext,
  ConversationTurnEnvelope
} from "@sugarmagic/runtime-core";
// The gateway owns what a recovery strategy is; the runtime consumes the same
// definition rather than restating it. `lore-designation` is the deliberately
// import-free module both sides share.
import type { RecoveryStrategy } from "../../../deployment/gateway/lore-designation";

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
  /** Model the gateway uses for regen calls (purpose:"regen"). Falls back to
   *  SUGARMAGIC_SUGARAGENT_ANTHROPIC_MODEL when unset. */
  anthropicRegenModel: string;
  maxLoreResults: number;
  /**
   * Plan 072.6 — per-evidence-item character budget forwarded to the prompt.
   * Replaces the old hard 180-char truncation; the wiki's richness must reach
   * the model. Total evidence budget is bounded by maxLoreResults x this.
   */
  maxLoreCharsPerItem: number;
  /**
   * Plan 078.2 — minimum similarity score a retrieved chunk must clear to
   * enter loreContext. 0 = off (default; today's behavior). Clamped 0..1.
   * Pinned own-page chunks and synthetic runtime-location evidence bypass
   * this filter. Set conservatively low; see docs/api/sugaragent-npcs.md.
   */
  loreRelevanceFloor: number;
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
  /**
   * Plan 077.5 — master switch for quest-aware NPC behavior. When false,
   * the quest-context middleware is not registered and NPCs behave as they
   * did before Plan 077 (no world-framed context, no ease-off blackboard).
   */
  questAwareNpcsEnabled: boolean;
  debugLogging: boolean;
  /** Overall tone for NPC dialogue (e.g. "cozy", "gritty", "whimsical"). */
  tone: string;
  /**
   * Plan 075.3 -- master switch for input/output moderation. When false,
   * the moderation middleware is not registered.
   */
  moderationEnabled: boolean;
  /**
   * Plan 075.4 -- comma-separated topic blocklist applied to player input
   * at the gateway (pre-moderation) and inside the /generate handler
   * (defense-in-depth). Hotfixable via the sugardeploy update-blocklist
   * action without a client rebuild. Stored in deployable config so the
   * initial value is version-controlled; fast updates bypass this path.
   */
  blocklist: string;
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
  /**
   * The moves this character can make when it does not understand the player,
   * read from `## Recovery`. Empty for a character with no such section, which
   * is every character until one is written -- the planner supplies a default.
   *
   * Required rather than optional so a persona built anywhere has to say what
   * it holds.
   */
  recoveryStrategies: RecoveryStrategy[];
  /**
   * The `## Recovery` prose as authored, for the prompt. The strategy names
   * above are the same text read as data; this is what the writer sees.
   */
  recoverySections: LoreCardSection[];
}

export interface SugarAgentProviderState {
  sessionId: string;
  turnCount: number;
  consecutiveFallbackTurns: number;
  /**
   * Clarifying questions asked since the last real exchange. Separate from
   * `consecutiveFallbackTurns` because the two answer different questions: a
   * stalled turn means the machinery failed, a clarifying question means it
   * worked and the player was not understood. Read by the Plan stage to cap
   * how many times in a row an NPC may ask.
   *
   * A recovery turn HOLDS this rather than clearing it, so a run of confusion
   * yields one clarifying question however long it lasts. Only a turn that is
   * neither a clarify nor a recovery clears it -- the player said something
   * that landed, and the next stretch of confusion earns its own question.
   */
  consecutiveClarifyTurns: number;
  /**
   * Recovery moves made this conversation. Indexes the character's
   * `## Recovery` list so several authored moves are used in turn instead of
   * the first one repeating.
   */
  recoveryTurnCount: number;
  /** Plan 075.2 -- 3-strike governor: consecutive turns where judge failed and regen ran */
  consecutiveJudgeFailures: number;
  closeRequested: boolean;
  history: SugarAgentSessionHistoryEntry[];
  /**
   * #184 -- names the player has given for THEMSELVES this session, from
   * Interpret's `declaredIdentityName` ("my name is X", "I'm X").
   *
   * A player has authority over who they are; they have none over what exists.
   * So a self-introduction is real, and is checked against as reality, while an
   * arbitrary name they mention is not. Only the introduction patterns feed
   * this, so "Do you know Brindlebear's Book Emporium?" never lands here.
   */
  playerDeclaredNames: string[];
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

export interface RetrievalScoreEntry {
  score: number;
  /** How this chunk entered loreContext. */
  source: "retrieved" | "pinned" | "synthetic-location";
  pageId: string | null;
  fileId: string;
}

export interface RetrieveResult {
  loreContext: RetrievedEvidenceItem[];
  loreSearchPerformed: boolean;
}

export interface PlanResult {
  /**
   * #184 -- names the player used that reality did not recognise. Present only
   * when the turn abstains BECAUSE of them, so the writer's instruction can say
   * "you have never heard of it" instead of "you need more context" -- two very
   * different sentences, and the generic one produced a canned-sounding reply
   * that read as out of character.
   */
  unknownNamedEntities?: string[];
  responseIntent:
    | "greet"
    | "chat"
    | "answer"
    | "redirect"
    | "goodbye"
    | "clarify"
    | "abstain"
    | "recover";
  /**
   * Which move a `recover` turn makes, from the NPC's `## Recovery` list.
   * Absent on every other intent.
   *
   * A separate axis from the intent: `recover` says the NPC stopped asking and
   * did something instead, this says what. Keeping it off `responseIntent`
   * means the five moves do not each need a goal sentence, an audit cue and an
   * initiative action of their own.
   */
  recoveryStrategy?: RecoveryStrategy;
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
  /**
   * The text the writer was given, carried forward so the judge scores against
   * the same grounding rather than a smaller reconstruction of it (#185).
   *
   * Absent on the deterministic paths, which build no prompt. JudgeStage skips
   * those turns anyway (`usedLlm === false`), so the two agree by construction.
   */
  judgeContext?: string;
}

export interface AuditResult {
  passed: boolean;
  violations: string[];
}

export interface JudgeResult {
  passed: boolean;
  violations: string[];
  repairHint: string | null;
  /**
   * Whether the reply suits the player's language level. Contributed by a
   * language plugin; absent when none is installed.
   *
   * tsg phase 2 lets this fail a turn, so it DOES reach `passed` -- but only
   * through `languageOnlyFailure`, never through the strike governors.
   */
  languageFit?: boolean;
  languageNote?: string | null;
  /**
   * True when language was the ONLY reason this turn failed.
   *
   * The escalation ladder must not treat it like a character or safety
   * failure: a too-advanced line is still in character, grounded and safe, so
   * the terminal recourse is to ship it, not to swap in a canned template and
   * eventually close the conversation. See JudgeStage.
   */
  languageOnlyFailure?: boolean;
  /** true when the judge was not invoked (no LLM text, no provider) */
  skipped: boolean;
  /** true when the judge errored; verdict is fail-open (passed: true) */
  errorOccurred: boolean;
}

export interface RepairResult {
  text: string;
  actionProposals: ConversationActionProposal[];
  llmBackend: GenerateResult["llmBackend"];
  repaired: boolean;
}
