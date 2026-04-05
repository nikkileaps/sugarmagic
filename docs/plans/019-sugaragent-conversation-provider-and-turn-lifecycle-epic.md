# Plan 019: SugarAgent Conversation Provider and Turn Lifecycle Epic

**Status:** Proposed  
**Date:** 2026-04-04

## Epic

### Title

Port SugarAgent into Sugarmagic as an optional `conversation.provider` plugin built around an explicit `Interpret -> Retrieve -> Plan -> Generate -> Audit -> Repair` turn lifecycle while preserving engine authority, evidence-first grounding, and clean separation from Sugarlang.

### Goal

Deliver the first real SugarAgent architecture for Sugarmagic that:

- keeps SugarAgent fully optional
- keeps normal non-plugin RPG games working with no behavior change
- lets NPCs be authored as `scripted`, `agent`, or `guided`
- gives Sugarmagic an explicit, first-class turn lifecycle instead of a monolithic plugin shell
- keeps world truth, quest truth, and state mutation under `packages/runtime-core`
- allows SugarAgent to free-chat in accordance with:
  - game context
  - NPC background/persona
  - world lore
  - NPC motivations
  - active beat or quest context when present
- does not require local LLM or local ONNX embeddings as the default architecture
- explicitly uses the Anthropic API for v1 LLM generation
- explicitly uses the OpenAI embeddings API and OpenAI-hosted vector stores for v1 semantic retrieval
- leaves room for Sugarlang to compose later through middleware rather than by coupling the two plugins together
- adheres to the project principles:
  - one source of truth
  - single enforcer
  - one-way dependencies
  - one type per behavior
  - goals must be verifiable

## Scope

This epic includes:

- SugarAgent as a real optional plugin for Sugarmagic
- SugarAgent runtime conversation provider implementation
- explicit turn lifecycle modules/classes for:
  - `Interpret`
  - `Retrieve`
  - `Plan`
  - `Generate`
  - `Audit`
  - `Repair`
- runtime-core host contracts needed to support that lifecycle cleanly
- NPC interaction mode support:
  - `scripted`
  - `agent`
  - `guided`
- NPC authoring fields required for agent conversation behavior
- plugin settings needed for SugarAgent runtime configuration
- deterministic engine-side action proposal validation/execution
- typed diagnostics and traceability for each stage
- structured debug logging for plugin lifecycle and turn lifecycle visibility
- fail-safe fallback and abstention behavior
- explicit logging for every degraded path and fallback decision

## Out Of Scope

This epic does not include:

- Sugarlang porting
- pedagogy tuning or learner-model behavior
- dynamic side-quest generation as a shipped gameplay feature
- full blackboard-driven autonomous NPC scheduling
- full GOAP simulation as a shipped gameplay feature
- local LLM runtime as a required dependency
- local ONNX embeddings as a required dependency
- HTTP or remote service transport as the default plugin architecture
- letting the model directly mutate world state
- letting the model invent arbitrary game entities, items, or quests outside engine validation

These may become later extensions, but they are not the first stable SugarAgent slice.

## Why this epic exists

SugarAgent in Sugarengine eventually converged on several genuinely strong ideas:

- evidence-first conversation architecture
- explicit separation between interpretation, retrieval, planning, realization, and verification
- deterministic engine authority over quest/world progression
- optional plugin behavior
- NPC interaction modes like `scripted | agent | guided`
- authored beat contracts for guided free-form interactions

But the old integration shell also accumulated problems:

- one giant plugin file owning too many responsibilities
- config drift and multiple enablement dialects
- too much runtime complexity concentrated in the plugin shell
- local LLM and local embeddings feeling more central than they should have been
- fallback/repair/debug logic mixed directly into the same integration layer

Sugarmagic should preserve the strong architecture while deleting the baggage.

## Source references from Sugarengine

Strong runtime-core direction:

- [SugarAgent session runtime](/Users/nikki/projects/sugarengine/packages/sugaragent-runtime-core/src/session/runtime.ts)
- [Interpret stage](/Users/nikki/projects/sugarengine/packages/sugaragent-runtime-core/src/session/core/interpret/stage.ts)
- [Retrieve stage](/Users/nikki/projects/sugarengine/packages/sugaragent-runtime-core/src/session/core/retrieve/stage.ts)
- [Plan stage](/Users/nikki/projects/sugarengine/packages/sugaragent-runtime-core/src/session/core/plan/stage.ts)
- [SugarAgent service interfaces](/Users/nikki/projects/sugarengine/packages/sugaragent-runtime-core/src/services.ts)

Strong architectural docs:

- [ADR-SA-010: In-Engine Runtime Integration and NPC Authoring Surface](/Users/nikki/projects/sugarengine/src/plugins/sugaragent/docs/adr/010-in-engine-runtime-integration-and-npc-authoring-surface.md)
- [ADR-016: Evidence-First Dialogue Architecture](/Users/nikki/projects/sugarengine/src/plugins/sugaragent/docs/adr/016-evidence-first-dialogue-architecture.md)
- [ADR-035: Subject-Centric Evidence Selection And Relation-Distance Planning](/Users/nikki/projects/sugarengine/src/plugins/sugaragent/docs/adr/035-subject-centric-evidence-selection-and-relation-distance.md)
- [SugarAgent session runtime API docs](/Users/nikki/projects/sugarengine/docs/api/plugins/sugaragent/17-sugaragent-session-runtime.md)

Legacy integration baggage to avoid preserving:

- [Old SugarAgent plugin shell](/Users/nikki/projects/sugarengine/src/plugins/sugaragent/plugin.ts)
- [Old plugin runtime config drift tests](/Users/nikki/projects/sugarengine/src/plugins/runtime.test.ts)

## Recommendation

### Core recommendation

Sugarmagic should port SugarAgent by preserving the runtime pipeline architecture from `packages/sugaragent-runtime-core` and not by porting the old monolithic `src/plugins/sugaragent/plugin.ts` shell.

### Provider recommendation

SugarAgent should enter Sugarmagic as a real `conversation.provider` plugin.

It should:

- participate through the engine-owned conversation host already added to `packages/runtime-core`
- never own the conversation host itself
- never call Sugarlang directly
- never directly mutate canonical game state

### Interaction mode recommendation

Sugarmagic should define NPC interaction modes with explicit semantics:

- `scripted`
  - uses the built-in scripted dialogue path
  - deterministic authored dialogue remains the source of truth
- `agent`
  - uses SugarAgent in open free-chat mode
  - grounded in lore, persona, motivations, and world state
- `guided`
  - uses SugarAgent under stronger authored narrative constraints
  - the player can still interact in free text
  - the NPC responds agentically
  - but the turn pipeline is constrained by things such as:
    - active beat contracts
    - required and forbidden facts
    - authored main-story context
    - blackboard or world-state alignment
    - NPC goals and motivations

Important clarification:

- `guided` does not mean ad hoc provider switching between scripted and agent paths inside the same conversation by default
- `guided` means SugarAgent is the active provider, but it operates under stronger narrative and gameplay constraints than open `agent` mode
- scripted handoff or fallback may still exist as an explicit runtime outcome, but that is not the defining meaning of `guided`

### Runtime authority recommendation

`packages/runtime-core` must remain the single enforcer for:

- world state mutation
- quest advancement
- flag changes
- inventory changes
- dialogue session state
- accepted action execution

SugarAgent may propose actions or outcomes, but runtime-core validates and executes them.

### Session state ownership recommendation

SugarAgent session memory and conversation persistence must align with the engine-owned conversation host rather than introducing a parallel plugin-owned state container.

Recommended ownership split:

- `runtime-core` conversation host owns the session state container
- SugarAgent provider owns the shape and interpretation of its session state within that container

That means SugarAgent session state such as:

- conversation history
- referent tracking
- topic coverage
- turn-local memory scaffolding
- other provider session memory

should live inside the host-managed conversation execution state rather than in a hidden side store.

Important rules:

- session state should flow through `ConversationExecutionContext.state` or its Sugarmagic successor contract
- the host remains the single owner of the container lifecycle
- the provider remains the owner of the typed state shape stored inside that container
- persisted conversation/session memory should build on this same ownership model rather than bypassing it

This preserves one source of truth while still allowing provider-specific session behavior.

### Diagnostics vs debug logging recommendation

Sugarmagic should treat diagnostics and debug logging as related but distinct concerns.

Diagnostics are:

- structured per-turn and per-stage data
- attached to runtime results such as `TurnStageResult.diagnostics` and the final conversation turn envelope
- intended for testability, inspection, and deterministic reasoning about what the stage decided
- part of the stage or turn contract

Debug logs are:

- structured operational events emitted outward to a log sink
- intended for runtime visibility and troubleshooting
- gated by verbosity or diagnostics settings
- not the primary return contract of the stage

These are different consumers of related data, not the same thing. A stage may use some of its diagnostics data to produce debug log events, but diagnostics and debug logging should not be treated as interchangeable terms.

This terminology should remain aligned with the telemetry work in Plan 020.

### Debug logging recommendation

SugarAgent should ship with structured debug logging as a first-class runtime feature, not as incidental console noise.

Two distinct log lanes are required:

- plugin lifecycle logs
- turn lifecycle logs

Plugin lifecycle logs should cover:

- plugin instance creation
- provider registration with the conversation host
- plugin initialization or mount
- plugin main runtime surface invocation
- degraded mode entry
- plugin disposal or unmount

Turn lifecycle logs should cover each stage with both a `start` and `end` event:

- `Interpret`
- `Retrieve`
- `Plan`
- `Generate`
- `Audit`
- `Repair`

All logs should be structured, debug-gated by plugin diagnostics settings, and include enough context to explain what the runtime is doing without requiring ad hoc repro instrumentation. Every degraded path and fallback decision must emit a clear structured log entry that states what failed, which fallback path was chosen, and why.

### Model/runtime dependency recommendation

Sugarmagic should not treat local inference or local embeddings as the defining architecture.

Instead:

- generation should sit behind a typed generation service interface
- retrieval embeddings should sit behind a typed embeddings service interface
- the lifecycle must work with degraded or alternate implementations
- deterministic and lexical strategies should remain first-class fallbacks

### v1 provider decision

For the first SugarAgent port, Sugarmagic should explicitly use:

- Anthropic API for LLM generation
- OpenAI embeddings API for embedding generation

This means the first supported hosted runtime stack is:

- `AnthropicClient` for raw LLM HTTP/API calls
- `OpenAIEmbeddingsClient` for raw embeddings HTTP/API calls
- `OpenAIVectorStoreClient` for raw vector-store or retrieval HTTP/API calls
- OpenAI-hosted vector stores or retrieval as the v1 vector index backend
- `LLMProvider` above the Anthropic client
- `EmbeddingsProvider` above the OpenAI embeddings client
- `VectorStoreProvider` above the vector-store client
- retrieval/indexing services above the hosted vector-store client boundary

This is a deliberate v1 product decision, not an accidental implementation detail.

The architecture should still leave room for later additions such as:

- `OpenAIClient` for LLM generation
- alternate embeddings providers
- local generation backends
- local embeddings backends

but those are not required for the first SugarAgent slice.

### Client-wrapper recommendation

All direct HTTP/API calls to hosted model vendors must live inside vendor-specific client wrapper classes.

Recommended v1 wrappers:

- `AnthropicClient`
- `OpenAIEmbeddingsClient`
- `OpenAIVectorStoreClient`

Recommended future-capable wrappers:

- `OpenAIClient`
- additional embeddings clients if needed later
- alternate vector-store clients if needed later

Important boundary rules:

- raw HTTP endpoint calls belong only in these client wrappers
- `LLMProvider`, `EmbeddingsProvider`, and `VectorStoreProvider` sit above the client wrappers
- runtime-core and SugarAgent turn stages must not make direct vendor HTTP calls
- provider-specific request/response mapping must not leak through the rest of the runtime

### Vector-store provider recommendation

Vector retrieval and indexing should follow the same abstraction pattern as generation and embeddings.

Recommended layering:

- `OpenAIVectorStoreClient` owns raw OpenAI vector-store HTTP/API calls
- `VectorStoreProvider` owns Sugarmagic-facing retrieval/indexing operations
- SugarAgent retrieval/indexing logic depends only on `VectorStoreProvider`

This is required so that Sugarmagic can later migrate to a different vector datastore without rewriting SugarAgent retrieval logic.

### Hosted embeddings recommendation

Hosted embeddings are the preferred default for SugarAgent in v1.

This is appropriate for a lore/wiki dataset that starts small and may grow large, provided the runtime uses:

- sensible chunking
- vector storage and lookup
- metadata filtering
- incremental re-indexing of changed lore
- caching to avoid unnecessary recomputation

Important rule:

- embeddings improve interpretation and retrieval quality, but SugarAgent must still function coherently without embeddings through clear degraded modes and deterministic fallbacks.

### Vector store recommendation

SugarAgent v1 should use OpenAI-hosted vector stores or retrieval for lore indexing and semantic lookup.

This means v1 does not require a self-hosted vector database.

The architecture should still keep the retrieval/indexing layer abstract enough that a later migration to a self-hosted vector store remains possible if required by:

- cost
- retrieval control
- ranking customization
- portability

For v1, however, the recommendation is:

- use OpenAI-hosted vector stores or retrieval
- defer self-hosted vector database work
- monitor cost and corpus growth before introducing more infrastructure

### MCP-style tool recommendation

SugarAgent may later use an MCP-like tool surface or tool-call model, but only as a constrained bridge for reading world truth or proposing structured actions.

Safe examples:

- `getRoomInventory(roomId)`
- `getActiveQuestContext()`
- `getKnownFactsAboutSubject(subjectId)`
- `getNpcRelationshipContext(npcId)`

Unsafe examples that should not be allowed:

- direct arbitrary quest creation
- direct state mutation
- inventing non-existent entity ids and treating them as truth

If tool calling is introduced, it must still terminate in engine-owned validation.

## Keep, Modify, Discard

### Keep

1. Explicit staged turn runtime
- SugarAgent should continue to be structured around explicit stages rather than one giant opaque `runAgentTurn` blob.

2. Evidence-first grounding
- factual control should happen before prose generation whenever possible.

3. Subject-centric retrieval and relation-distance reasoning
- generic “tell me about X” should strongly prefer direct-subject facts.

4. Abstention and clarification as first-class behavior
- uncertainty is a valid answer.

5. NPC interaction modes
- `scripted`, `agent`, and `guided` remain the right authoring model.

6. Beat contract and guided free-chat concepts
- SugarAgent should be able to operate against authored main-story objectives without replacing them.

7. Explicit `guided` mode semantics
- `guided` should mean agentic NPC conversation constrained by authored narrative and world-state rails, not vague switching between scripted and agent providers.

8. Service abstractions for generation and embeddings
- these are good seams and should be retained.

### Modify

1. Make the lifecycle even more explicit
- each stage should be a named runtime type/module with a typed input and output contract.

2. Shrink the integration shell radically
- plugin bootstrap, persistence glue, and runtime orchestration should not collapse back into one massive file.

3. Make embeddings optional
- useful when present, but not foundational to whether SugarAgent works at all.

4. Prefer deterministic validation over evaluator-model dependence
- `Audit` should be primarily deterministic in the first slice.

5. Separate action proposals from action execution
- SugarAgent can suggest, runtime-core decides.

6. Keep retrieval/governance strongly typed
- provenance, owner type, subject, and support strength must stay explicit.

### Discard

1. Monolithic plugin shell architecture
- do not port the giant old plugin file shape.

2. Multiple config dialects
- Sugarmagic already fixed this in plugin infrastructure and should not regress.

3. Local llama / local ONNX as the architectural center
- keep them as possible backends, not the system identity.

4. Generate-first, repair-later as the main control strategy
- keep repair as a safety net, not the primary design.

5. Direct plugin world mutation
- violates engine authority.

## Turn lifecycle recommendation

Sugarmagic should make the turn lifecycle literal in code.

Recommended conceptual shape:

- `InterpretTurnStage`
- `RetrieveTurnStage`
- `PlanTurnStage`
- `GenerateTurnStage`
- `AuditTurnStage`
- `RepairTurnStage`
- `SugarAgentTurnPipeline`

Each stage should implement one uniform stage contract rather than an ad hoc bag-of-functions shape.

Recommended contract:

```ts
interface TurnStage<TInput, TOutput> {
  stageId: string;
  execute(input: TInput, context: TurnStageContext): Promise<TurnStageResult<TOutput>>;
}

interface TurnStageResult<TOutput> {
  output: TOutput;
  diagnostics: TurnStageDiagnostics;
  status: 'ok' | 'degraded' | 'failed';
}
```

Recommended supporting context:

- `TurnStageContext`
  - shared turn identity
  - NPC identity
  - conversation session identity
  - plugin diagnostics settings
  - telemetry collector
  - backend/provider resolution context
- `TurnStageDiagnostics`
  - stage-specific decision trace
  - degradation reason when present
  - fallback path when present
  - timing and backend details where relevant

Important rule:

- stage inputs and outputs must be explicitly typed per stage
- stage implementations should not use loose `unknown` bags as their primary contract shape
- the pipeline orchestrator composes these stages rather than hiding all behavior in one monolithic provider method

This makes the pipeline pattern literal and gives Sugarmagic one clean seam for telemetry and debug instrumentation around every `execute(...)` call.

Important adapter rule:

- `SugarAgentTurnPipeline` is internal to the SugarAgent provider implementation
- the pipeline's final stage output is mapped back into a `ConversationTurnEnvelope` before returning through the provider session's `advance()` call
- internal stage results are not exposed directly to the conversation host

## Stage failure semantics

The turn pipeline must define explicit degraded and fatal behavior per stage rather than leaving failure propagation implicit.

Recommended v1 failure model:

| Stage | Degraded behavior | Fatal condition |
| --- | --- | --- |
| `Interpret` | default to conservative or social-chat routing when ambiguity or semantic assistance fails | none; `Interpret` should always produce a result |
| `Retrieve` | lexical-only retrieval, empty evidence pack, or no-embeddings mode | none; empty evidence is a valid result |
| `Plan` | abstention plan, clarification plan, or safe uncertainty plan | none; planning should always be able to produce a safe plan |
| `Generate` | simplified realization strategy only if a generation backend is still available | generation backend unavailable or unrecoverable provider failure |
| `Audit` | deterministic pass-through, reduced audit depth, or logged degraded audit mode | none in v1; audit failure should convert into downstream repair handling |
| `Repair` | explicit uncertainty fallback, clarification fallback, or scripted handoff | none in v1; if repair cannot improve the result it must still emit a safe fallback outcome |

Important rules:

- degraded behavior must be explicit, logged, and represented in `TurnStageResult.status`
- fatal conditions should be rare and primarily concentrated at hard backend dependency boundaries
- the pipeline must convert fatal stage failures into a safe outward result whenever possible rather than exposing raw backend failure to gameplay
- the fail-safe path should prefer abstention, clarification, or explicit fallback over fabricated output

## Stage data flow

The turn stages form an explicit accumulating data pipeline. Each stage should consume typed outputs from earlier stages rather than reconstructing or re-deriving prior decisions implicitly.

Recommended flow:

| Stage | Receives | Produces |
| --- | --- | --- |
| `Interpret` | player input, NPC profile, conversation history, session context, backend/degradation context | `InterpretResult` with query type, routing, subject selection, interpretation diagnostics |
| `Retrieve` | `InterpretResult`, NPC identity, lore scope configuration, beat or quest context, retrieval config | `RetrieveResult` with evidence pack, provenance, relation-distance annotations, retrieval diagnostics |
| `Plan` | `InterpretResult`, `RetrieveResult`, NPC snapshot, initiative policy inputs, adaptation context | `PlanResult` with speech act, supported claims, action proposals, memory-write proposals, abstention or clarification state |
| `Generate` | `PlanResult`, NPC persona or tone context, delivery constraints, generation backend context | `GenerateResult` with utterance text, structured realization metadata, generation diagnostics |
| `Audit` | `GenerateResult`, `PlanResult`, `RetrieveResult`, policy constraints, audit backend context | `AuditResult` with pass or fail status, violations, degradation reason, accepted or rejected output state |
| `Repair` | `AuditResult`, `GenerateResult`, `PlanResult`, fallback policy, repair constraints | `RepairResult` with repaired utterance, fallback decision, or abstention or scripted handoff outcome |

Important rules:

- `Retrieve` must consume typed interpretation output rather than re-running interpretation logic implicitly
- `Plan` must consume typed retrieval output rather than re-fetching evidence ad hoc
- `Generate` must consume validated planning output rather than inventing semantic intent on its own
- `Audit` and `Repair` must have access to prior stage outputs so they can explain violations and fallback decisions precisely
- the pipeline should make these dependencies obvious in code and tests
- after the final stage resolves, SugarAgent must adapt the final internal result into the external `ConversationTurnEnvelope` contract expected by the conversation host

## Stage definitions

### 1. Interpret

Purpose:

- determine what the player is trying to do
- classify turn lane/risk
- resolve likely subject/referent
- decide whether this is:
  - social chat
  - self knowledge
  - world knowledge
  - other-entity knowledge
  - mixed/ambiguous

Recommended implementation:

- deterministic routing first
- optional semantic assist second
- abstain on weak subject resolution rather than force a bad winner

Important rule:

- embeddings may assist interpretation, but interpretation must not require embeddings in order to function.

### 2. Retrieve

Purpose:

- gather the grounded evidence for this turn

Inputs should include:

- current NPC identity and authored profile
- active beat/quest context
- recent session memory
- scene/region context
- known lore scopes
- resolved subject if present

Outputs should include:

- typed evidence pack
- provenance and ownership metadata
- relation-distance annotations
- retrieval diagnostics

Important rule:

- retrieval should support both semantic and non-semantic strategies.

### 3. Plan

Purpose:

- decide what the NPC is going to do and say semantically before generating prose

Outputs should include:

- speech act
- supported claims
- clarification question if needed
- abstention state if needed
- safe memory-write proposals
- typed `ActionProposal[]` values
- beat evidence or guided objective evidence when applicable

Important rule:

- no factual claim without support.

### 4. Generate

Purpose:

- realize the validated plan as actual natural-language output

Important rule:

- the generator may style and phrase the answer
- it may not introduce new unsupported facts outside the plan

### 5. Audit

Purpose:

- ensure the generated response still matches the plan and constraints

Checks should include:

- unsupported factual leakage
- subject/ownership mismatch
- policy violations
- malformed structured output
- action/tool proposal validity

Important rule:

- the first slice should prefer deterministic checks wherever feasible.

### 6. Repair

Purpose:

- repair bounded failures without exposing broken output to the player

Allowed strategies:

- one repair pass
- safe simplification
- uncertainty fallback
- clarification fallback

Important rule:

- bounded retries only
- no cascading complexity spiral

## Proposed runtime contracts

SugarAgent needs a few runtime-core seams to be explicit.

### 1. Conversation execution context

The provider should receive a typed context containing:

- NPC identity
- authored NPC interaction mode
- authored SugarAgent profile
- active conversation/session history
- active quest/beat bindings
- region and scene context
- read-only world truth access
- host-owned conversation execution state container
- optional plugin middleware-prepared context

Important rule:

- SugarAgent session memory should live in the host-owned execution state container
- SugarAgent defines the typed shape of its own provider state within that container
- this state model is the basis for later session persistence rather than a separate hidden plugin-only store

### 2. Action proposal contract

SugarAgent should not execute actions directly.

Instead it should return a typed discriminated union of structured action proposals.

Recommended conceptual shape:

```ts
type ActionProposal =
  | { kind: 'start-scripted-followup'; dialogueDefinitionId: string }
  | { kind: 'set-conversation-flag'; key: string; value: unknown }
  | { kind: 'surface-beat-evidence'; beatId: string; evidence: string }
  | { kind: 'request-close' }
  | { kind: 'propose-quest-hook'; questTemplateId: string; params: Record<string, unknown> };
```

This union should be refined as implementation needs sharpen, but the important rule is that the provider boundary uses explicit discriminated action kinds rather than loose shape inference.

Runtime-core then:

- validates each proposal kind explicitly
- accepts or rejects each proposal deterministically
- executes only allowed proposals
- records the outcome of that decision

Important rules:

- action proposals must be exhaustively handled by runtime-core validation
- proposal handling should be easy to test with a switch or visitor-style validator
- unknown or unsupported proposal kinds must be rejected safely
- no proposal kind may bypass canonical runtime authority

### 3. Diagnostics contract

Each turn should emit structured diagnostics so behavior is testable and reviewable.

Diagnostics are the stage's and turn's structured evidence of what they did.

Suggested categories:

- routing
- retrieval
- subject selection
- plan validity
- realization audit
- repair outcome
- degradation reasons

The diagnostics contract should align with the stage contract above so each `TurnStageResult` returns one standard diagnostics object rather than inventing stage-local shapes without a common wrapper.

Expected consumers of diagnostics:

- tests
- turn inspection tooling
- debug overlays or developer inspectors
- the final conversation turn envelope where appropriate

### 4. Debug logging contract

SugarAgent should emit structured debug logs for both plugin lifecycle and per-turn lifecycle behavior.

Debug logs are operational visibility events emitted outward to a logging sink. They are not the same thing as the returned diagnostics contract, even when they reuse some of the same underlying data.

Required plugin lifecycle events:

- plugin instance created
- provider registered
- plugin mounted or initialized
- plugin main provider surface invoked
- degraded mode entered
- plugin disposed or unmounted

Required turn lifecycle events:

- stage start
- stage end

for each stage:

- `Interpret`
- `Retrieve`
- `Plan`
- `Generate`
- `Audit`
- `Repair`

Required common debug fields:

- `pluginId`
- `providerId`
- `npcId` when relevant
- `conversationSessionId`
- `turnId`
- `stage`
- `event` such as `start` or `end`
- `durationMs` on completion
- degradation or failure reason when present
- explicit fallback path chosen when present
- resolved generation backend
- resolved embeddings backend
- resolved vector-store backend

Stage-specific debug payloads should include inspectable data that helps explain decisions, for example:

- `Interpret`
  - routing result
  - referent candidates
  - selected primary subject
- `Retrieve`
  - evidence pack summary
  - retrieval matches
  - relation-distance annotations
- `Plan`
  - speech act
  - selected claims
  - proposed actions
  - abstention or clarification decision
- `Generate`
  - realization strategy
  - utterance preview
- `Audit`
  - validation result
  - failure reasons
- `Repair`
  - repair strategy
  - fallback outcome

These logs should be structured and gated by SugarAgent/plugin diagnostics settings so they are available for debugging without becoming unbounded runtime noise. Fallbacks such as no-embeddings mode, lexical-only retrieval, deterministic abstention, simplified realization, or scripted handoff must always be logged clearly.

## Session memory and persistence recommendation

SugarAgent needs explicit session-memory ownership before the rest of the turn pipeline grows more complex.

Recommended model:

- conversation/session state container is owned by the runtime-core conversation host
- SugarAgent provider state is stored inside that container as typed provider-owned data
- later persistence of conversation memory should serialize from this same host-owned state path

This means we should not introduce:

- a separate hidden plugin-managed session store outside the host
- a second competing source of truth for conversation history

Examples of provider-owned state that may live in the host container:

- recent turn history
- referent cache
- topic coverage state
- lightweight conversation memory
- provider-specific continuity markers

This is a prerequisite for future conversation persistence and should be addressed early in the epic rather than as a late afterthought.

## Authoring recommendation

SugarAgent should remain cross-cutting authoring, not necessarily a giant dedicated workspace.

## Interaction mode semantics

The authoring/runtime contract for interaction modes should be explicit.

### `scripted`

- uses authored dialogue as the interaction surface
- quest-critical authored text is the runtime source of truth

### `agent`

- uses SugarAgent in open free-chat mode
- suitable for NPCs that should converse freely from lore, persona, and motivations

### `guided`

- uses SugarAgent, not the scripted dialogue provider, as the primary conversation engine
- but the SugarAgent turn context is constrained by authored main-story and runtime alignment signals
- this is the mode intended for more experimental, agentified NPC behavior that still supports the authored story

Recommended `guided` constraints include:

- active beat contracts
- required facts
- forbidden facts
- authored quest or stage context
- blackboard or world-state alignment
- NPC goals and motivations

Important rule:

- `guided` is not defined as loose back-and-forth provider switching within one session
- it is defined as SugarAgent running under a guided narrative policy

Scripted handoff may still exist as an explicit fallback or runtime action, but that is separate from the meaning of the `guided` mode itself.

Recommended authoring surfaces:

### Project/plugin settings

For plugin-wide configuration such as:

- generation backend selection
- embeddings backend selection
- safety bounds
- default retrieval strategy
- diagnostics verbosity

For v1, the default configured values should be:

- generation backend: Anthropic
- embeddings backend: OpenAI
- vector store backend: OpenAI hosted retrieval

Even with those defaults, the code should still preserve the provider seam so the backend can be swapped later without rewriting SugarAgent retrieval logic.

### NPC fields

Required:

- `interactionMode?: "scripted" | "agent" | "guided"`
- `agentProfile`

Recommended `agentProfile` shape:

```ts
interface AgentProfile {
  voice?: {
    persona?: string;
    tone?: string;
    constraints?: string[];
  };
  lore?: {
    scopes?: string[];
    selfScopes?: string[];
    relatedScopes?: string[];
  };
  innerState?: {
    motivations?: string[];
    secrets?: string[];
  };
}
```

Why this grouping is recommended:

- `voice` is primarily consumed by `Generate`
- `lore` is primarily consumed by `Retrieve`
- `innerState` is primarily consumed by `Plan`

Clarification:

- `voice.constraints` should govern tone, style, phrasing, and delivery behavior
- factual, quest, or narrative guardrails should not be modeled as `voice.constraints`; they belong in beat contracts, guided-mode constraints, or other runtime policy surfaces

This grouped shape is clearer to author, easier to validate, and better aligned with the turn-stage boundaries than a flat bag of loosely related fields.

### Quest/beat fields

For guided main-story free-form interactions:

- beat contracts
- required facts
- forbidden facts
- completion rules
- fallback scripted handoff

## Blackboard, motivations, and GOAP recommendation

These ideas are promising, but should be phased carefully.

### Keep the concept

Longer-term, Sugarmagic should support richer NPC inner life through:

- shared blackboard/world truth
- authored motivations and goals
- constrained planning over those goals

### Do not over-scope the first SugarAgent port

The first port should not try to ship:

- full autonomous world simulation
- hidden agent-only world state competing with core runtime truth
- broad unsupervised side-quest invention

Instead, the first port should focus on:

- grounded free-chat
- guided objective interactions
- better NPC conversation depth
- safe action proposals

## Side-quest generation recommendation

This is compelling, but should not be the first stable slice.

Recommended direction for later phases:

- use constrained quest templates
- allow SugarAgent to fill narrative flavor and propose parameterization
- require runtime-core validation against canonical world entities
- let Sugarlang later influence template selection or wording when installed

Not recommended for the first slice:

- unconstrained quest invention by the model
- direct creation of arbitrary items, actors, or objectives outside engine validation

## Independence from Sugarlang

This epic is specifically for SugarAgent alone.

Required behavior matrix:

### No plugins
- normal authored RPG works

### SugarAgent only
- `agent` NPCs work in open free-chat mode
- `guided` NPCs work under authored beat and narrative constraints
- no pedagogy required

### Sugarlang only
- not covered by this epic

### Both later
- Sugarlang should compose through middleware and shared contracts
- no direct plugin-to-plugin dependency should be introduced here

## Stories

1. Define host-owned SugarAgent session state, conversation memory shape, and persistence seam on top of the conversation host state container
2. Extend runtime-core conversation contracts for provider-side turn lifecycle support
3. Add SugarAgent plugin runtime package and provider bootstrap
4. Add explicit SugarAgent `TurnStage<TInput, TOutput>` contracts, turn lifecycle modules, and pipeline orchestration
5. Add deterministic evidence pack, subject-selection, plan validation, and typed action-proposal flow
6. Add `AnthropicClient`, `OpenAIEmbeddingsClient`, `OpenAIVectorStoreClient`, provider wrappers, and generation/embeddings/vector-store service seams with graceful degradation
7. Add runtime-core discriminated-union action proposal validation and execution path for provider-produced actions
8. Add NPC interaction mode and SugarAgent authoring fields
9. Add beat-contract binding for guided free-chat against authored narrative objectives
10. Add structured diagnostics, plugin lifecycle logs, turn-stage start/end logs, eval-style tests, and failure-path regression coverage

## Verification

This epic is complete when all of the following are true:

1. a project with no plugins behaves exactly as before
2. SugarAgent session memory and conversation state live in the host-owned conversation state container rather than a parallel hidden plugin store
3. the SugarAgent provider owns the typed shape of its session state within that host-owned container
4. a project with SugarAgent enabled can author an NPC as `agent` and converse with it in free text
5. a project can author an NPC as `guided`, and that NPC runs through SugarAgent under authored beat and narrative constraints
6. `guided` mode is explicitly implemented as guided agentic behavior, not vague provider switching
7. SugarAgent responses are grounded in available evidence or correctly abstain/clarify
8. no provider-generated action can mutate canonical world state without runtime-core validation
9. provider-produced actions cross the boundary as typed discriminated `ActionProposal` values
10. the turn lifecycle is represented in explicit `TurnStage<TInput, TOutput>` runtime modules/types, not collapsed into one opaque integration file
11. each stage returns a uniform `TurnStageResult<TOutput>` shape with diagnostics and status
12. SugarAgent v1 uses Anthropic for generation and OpenAI for embeddings plus OpenAI-hosted vector retrieval through explicit client wrappers
13. SugarAgent functions without requiring local ONNX embeddings
14. SugarAgent functions without requiring a local LLM runtime as the architectural baseline
15. SugarAgent v1 does not require a self-hosted vector database
16. runtime diagnostics make each stage decision auditable in tests
17. structured debug logs exist for plugin mount/provider invocation, resolved backends, degraded paths, and each turn stage start/end
18. Sugarlang is not required for any SugarAgent-only flow

## Non-goals for v1

To keep the first SugarAgent port achievable, this epic intentionally does not require:

- perfect open-ended quest generation
- full autonomous NPC schedule simulation
- universal tool-calling support
- full blackboard gameplay system
- individual-player adaptive pedagogy
- replacing authored narrative design with model-authored story structure

The first win is a grounded, engine-safe, optional agent conversation provider that plays well with Sugarmagic's authored game structure.
